/**
 * [INPUT]: 主进程持有的工作区根、read/edit/write 请求、可选 ExecutionEnvironment、提交/命令文件观察器与 AbortSignal
 * [OUTPUT]: 新运行使用的 Pi 式四核心、整篇重写的同版本完整读取许可、文件提交和命令变更后通知
 * [POS]: 供应商无关文件 capability contract 的 Electron 主进程实现
 * [DOC]: docs/architecture/agent-file-capabilities.md、docs/architecture/bash-execution-environment.md、docs/architecture/agent-simplification-roadmap.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  EditWorkspaceFileInput,
  ExecutionEnvironment,
  WorkspaceAgentTools,
  WorkspaceFileEdit,
  WorkspaceFileMutationResult,
  WriteWorkspaceFileInput,
} from "@tessera/agent-runtime"
import {
  AgentFileConflictError,
  MAX_AGENT_MARKDOWN_BYTES,
  readAgentMarkdownFile,
  readWorkspaceAgentFile,
  resolveAgentCreatePath,
  resolveAgentPath,
  writeAgentMarkdownFile,
} from "./read-only-agent-tools"
import { withWorkspaceFileMutation } from "./workspace-file-mutation-queue"

const MAX_EDITS_PER_CALL = 64

class WorkspaceAgentToolError extends Error {}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new WorkspaceAgentToolError("Agent 运行已停止。")
}

function normalizeLineEndings(content: string) {
  return content.replace(/\r\n?/gu, "\n")
}

function splitBom(content: string) {
  return content.startsWith("\uFEFF") ? { bom: "\uFEFF", content: content.slice(1) } : { bom: "", content }
}

function originalLineEnding(content: string) {
  return content.includes("\r\n") ? "\r\n" : "\n"
}

function restoreLineEndings(content: string, lineEnding: "\n" | "\r\n") {
  return lineEnding === "\n" ? content : content.replace(/\n/gu, "\r\n")
}

type LocatedEdit = Readonly<{
  end: number
  newText: string
  start: number
}>

function locateUniqueEdit(content: string, edit: WorkspaceFileEdit, index: number): LocatedEdit {
  const oldText = normalizeLineEndings(edit.oldText)
  const newText = normalizeLineEndings(edit.newText)
  if (!oldText) throw new WorkspaceAgentToolError(`第 ${index + 1} 个 edit 的 oldText 不能为空。`)
  if (oldText === newText) throw new WorkspaceAgentToolError(`第 ${index + 1} 个 edit 没有产生变化。`)

  const start = content.indexOf(oldText)
  if (start < 0) {
    throw new WorkspaceAgentToolError(`第 ${index + 1} 个 edit 的 oldText 在原始文件中不存在。`)
  }
  if (content.indexOf(oldText, start + oldText.length) >= 0) {
    throw new WorkspaceAgentToolError(`第 ${index + 1} 个 edit 的 oldText 在原始文件中不是唯一匹配。`)
  }
  return { start, end: start + oldText.length, newText }
}

/** 所有定位都基于同一原始版本，避免前一个 edit 改变后一个 edit 的匹配语义。 */
export function applyWorkspaceFileEdits(
  rawContent: string,
  edits: readonly WorkspaceFileEdit[],
  path: string,
) {
  if (edits.length === 0 || edits.length > MAX_EDITS_PER_CALL) {
    throw new WorkspaceAgentToolError(`文件「${path}」每次必须提交 1 到 ${MAX_EDITS_PER_CALL} 个 edit。`)
  }

  const { bom, content } = splitBom(rawContent)
  const lineEnding = originalLineEnding(content)
  const normalizedContent = normalizeLineEndings(content)
  const located = edits
    .map((edit, index) => locateUniqueEdit(normalizedContent, edit, index))
    .sort((left, right) => left.start - right.start)

  for (let index = 1; index < located.length; index += 1) {
    const previous = located[index - 1]
    const current = located[index]
    if (previous && current && current.start < previous.end) {
      throw new WorkspaceAgentToolError(`文件「${path}」中的 edits 不能重叠或嵌套。`)
    }
  }

  let edited = normalizedContent
  for (const edit of [...located].reverse()) {
    edited = edited.slice(0, edit.start) + edit.newText + edited.slice(edit.end)
  }
  const result = bom + restoreLineEndings(edited, lineEnding)
  if (Buffer.byteLength(result, "utf8") > MAX_AGENT_MARKDOWN_BYTES) {
    throw new WorkspaceAgentToolError("编辑后的文档超过 256 KiB 写入上限。")
  }
  return result
}

function conflict(path: string, message: string): WorkspaceFileMutationResult {
  return { message, path, status: "conflict" }
}

function saved(
  document: Awaited<ReturnType<typeof readAgentMarkdownFile>>,
  operation: "create" | "edit" | "update",
): WorkspaceFileMutationResult {
  return {
    contentHash: document.contentHash,
    modifiedAt: document.modifiedAt,
    operation,
    path: document.path,
    status: "saved",
  }
}

function assertContentHash(value: string, operation: "edit" | "update") {
  if (!/^[a-f\d]{64}$/u.test(value)) {
    throw new WorkspaceAgentToolError(`${operation} 必须携带最近一次 read 返回的 baseContentHash。`)
  }
}

type ReadCoverageState = {
  completeLines: Set<number>
  contentHash: string
  partialLines: Map<number, Array<{ endByte: number; startByte: number }>>
  totalLines: number
}

function addByteRange(
  ranges: Array<{ endByte: number; startByte: number }>,
  next: { endByte: number; startByte: number },
) {
  const ordered = [...ranges, next].sort((left, right) => left.startByte - right.startByte)
  const merged: Array<{ endByte: number; startByte: number }> = []
  for (const range of ordered) {
    const previous = merged.at(-1)
    if (!previous || range.startByte > previous.endByte) {
      merged.push({ ...range })
    } else {
      previous.endByte = Math.max(previous.endByte, range.endByte)
    }
  }
  return merged
}

class WorkspaceReadCoverage {
  private readonly files = new Map<string, ReadCoverageState>()

  record(result: Awaited<ReturnType<typeof readWorkspaceAgentFile>>) {
    let state = this.files.get(result.path)
    if (!state || state.contentHash !== result.contentHash || state.totalLines !== result.range.totalLines) {
      state = {
        completeLines: new Set(),
        contentHash: result.contentHash,
        partialLines: new Map(),
        totalLines: result.range.totalLines,
      }
      this.files.set(result.path, state)
    }

    const byteRange = result.range.lineByteRange
    if (byteRange) {
      const line = result.range.startLine
      const ranges = addByteRange(state.partialLines.get(line) ?? [], byteRange)
      if (
        byteRange.totalBytes === 0 ||
        (ranges.length === 1 &&
          ranges[0]?.startByte === 0 &&
          ranges[0]?.endByte !== undefined &&
          ranges[0].endByte >= byteRange.totalBytes)
      ) {
        state.completeLines.add(line)
        state.partialLines.delete(line)
      } else {
        state.partialLines.set(line, ranges)
      }
      return
    }

    for (let line = result.range.startLine; line <= result.range.endLine; line += 1) {
      state.completeLines.add(line)
      state.partialLines.delete(line)
    }
  }

  hasCompleteVersion(path: string, contentHash: string) {
    const state = this.files.get(path)
    return (
      state?.contentHash === contentHash &&
      state.completeLines.size === state.totalLines &&
      state.totalLines > 0
    )
  }

  markKnown(path: string, contentHash: string, content: string) {
    const totalLines = content.split("\n").length
    this.files.set(path, {
      completeLines: new Set(Array.from({ length: totalLines }, (_, index) => index + 1)),
      contentHash,
      partialLines: new Map(),
      totalLines,
    })
  }
}

async function editWorkspaceFile(
  rootPath: string,
  input: EditWorkspaceFileInput,
  signal: AbortSignal,
): Promise<WorkspaceFileMutationResult> {
  assertContentHash(input.baseContentHash, "edit")
  throwIfAborted(signal)
  const target = await resolveAgentPath(rootPath, input.path)
  return withWorkspaceFileMutation(target.absolutePath, async () => {
    throwIfAborted(signal)
    const current = await readAgentMarkdownFile(rootPath, target.relativePath, signal)
    if (current.contentHash !== input.baseContentHash) {
      return conflict(current.path, `文件「${current.path}」已经变化，请重新 read 后再 edit。`)
    }
    const content = applyWorkspaceFileEdits(current.content, input.edits, current.path)
    throwIfAborted(signal)
    try {
      return saved(
        await writeAgentMarkdownFile(rootPath, current.path, content, "update", {
          expectedContentHash: current.contentHash,
          signal,
        }),
        "edit",
      )
    } catch (error) {
      if (error instanceof AgentFileConflictError) {
        return conflict(current.path, `文件「${current.path}」在提交前已经变化，请重新 read 后再 edit。`)
      }
      throw error
    }
  })
}

async function writeWorkspaceFile(
  rootPath: string,
  input: WriteWorkspaceFileInput,
  signal: AbortSignal,
  readCoverage: WorkspaceReadCoverage,
): Promise<WorkspaceFileMutationResult> {
  throwIfAborted(signal)
  if (input.operation === "update") {
    assertContentHash(input.baseContentHash ?? "", "update")
    const target = await resolveAgentPath(rootPath, input.path)
    return withWorkspaceFileMutation(target.absolutePath, async () => {
      throwIfAborted(signal)
      const current = await readAgentMarkdownFile(rootPath, target.relativePath, signal)
      if (current.contentHash !== input.baseContentHash) {
        return conflict(current.path, `文件「${current.path}」已经变化，请重新 read 后再 write。`)
      }
      if (!readCoverage.hasCompleteVersion(current.path, current.contentHash)) {
        throw new WorkspaceAgentToolError(
          `完整更新「${current.path}」前，必须在当前运行中 read 完同一版本的所有分页；局部修改请改用 edit。`,
        )
      }
      try {
        return saved(
          await writeAgentMarkdownFile(rootPath, current.path, input.content, "update", {
            expectedContentHash: current.contentHash,
            signal,
          }),
          "update",
        )
      } catch (error) {
        if (error instanceof AgentFileConflictError) {
          return conflict(current.path, `文件「${current.path}」在提交前已经变化，请重新 read 后再 write。`)
        }
        throw error
      }
    })
  }

  if (input.baseContentHash !== undefined) {
    throw new WorkspaceAgentToolError("创建新文件时不得提供 baseContentHash。")
  }
  let target: Awaited<ReturnType<typeof resolveAgentCreatePath>>
  try {
    target = await resolveAgentCreatePath(rootPath, input.path)
  } catch (error) {
    if (error instanceof Error && error.message.includes("已经存在")) {
      return conflict(input.path, `文件「${input.path}」已经存在，write create 不会覆盖。`)
    }
    throw error
  }
  return withWorkspaceFileMutation(target.absolutePath, async () => {
    throwIfAborted(signal)
    try {
      return saved(
        await writeAgentMarkdownFile(rootPath, target.relativePath, input.content, "create", { signal }),
        "create",
      )
    } catch (error) {
      if (error instanceof Error && (error.message.includes("已经存在") || "code" in error)) {
        const code = "code" in error ? error.code : undefined
        if (code === "EEXIST" || error.message.includes("已经存在")) {
          return conflict(
            target.relativePath,
            `文件「${target.relativePath}」已经存在，write create 不会覆盖。`,
          )
        }
      }
      throw error
    }
  })
}

export type WorkspaceAgentToolOptions = Readonly<{
  executionEnvironment?: ExecutionEnvironment | undefined
  onCommandFilesChanged?: (paths: readonly string[]) => Promise<void> | void
  onMutation?: (result: Extract<WorkspaceFileMutationResult, { status: "saved" }>) => Promise<void> | void
  rootPath: string
}>

async function notifyMutation(
  result: WorkspaceFileMutationResult,
  onMutation: WorkspaceAgentToolOptions["onMutation"],
) {
  if (result.status === "saved" && onMutation) {
    try {
      await onMutation(result)
    } catch {
      // 文件已经越过原子提交点；观察器失败不能把已提交副作用伪装为可重试的工具失败。
    }
  }
  return result
}

export function createWorkspaceAgentTools({
  executionEnvironment,
  onCommandFilesChanged,
  onMutation,
  rootPath,
}: WorkspaceAgentToolOptions): WorkspaceAgentTools {
  const readCoverage = new WorkspaceReadCoverage()
  const coreTools: WorkspaceAgentTools = {
    edit: async (input, signal) =>
      notifyMutation(await editWorkspaceFile(rootPath, input, signal), onMutation),
    read: async (input, signal) => {
      const result = await readWorkspaceAgentFile(rootPath, input, signal)
      readCoverage.record(result)
      return result
    },
    write: async (input, signal) => {
      const result = await writeWorkspaceFile(rootPath, input, signal, readCoverage)
      if (result.status === "saved") {
        readCoverage.markKnown(result.path, result.contentHash, input.content)
      }
      return notifyMutation(result, onMutation)
    },
  }
  if (!executionEnvironment) return coreTools
  return {
    ...coreTools,
    bash: async (input, access, signal) => {
      const result = await executionEnvironment.execute(input, access, signal)
      if (onCommandFilesChanged && result.changedFiles.length > 0) {
        try {
          await onCommandFilesChanged(result.changedFiles)
        } catch {
          // 命令已经越过副作用提交点；Artifact 观察失败不能诱导模型重放命令。
        }
      }
      return result
    },
  }
}
