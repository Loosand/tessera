/**
 * [INPUT]: 主进程持有的工作区根路径、共享 Markdown/忽略目录策略与类型化 read 输入
 * [OUTPUT]: 支持超长单行续读的 Markdown 有界读取，以及提交前复核预期版本的路径、版本与原子写安全原语
 * [POS]: Electron 主进程中 Agent Markdown 文件访问的底层安全边界；列表/检索已收敛到受控 bash
 * [DOC]: docs/architecture/agent-file-capabilities.md、docs/architecture/bash-execution-environment.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { createHash, randomUUID } from "node:crypto"
import { link, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import type { ReadWorkspaceFileInput, WorkspaceFileReadResult } from "@tessera/agent-runtime"
import { isIgnoredWorkspaceEntryName, isMarkdownPath } from "./workspace-file-service"

const DEFAULT_READ_LINE_LIMIT = 400
const MAX_READ_LINE_LIMIT = 1_000
const MAX_READ_RESULT_BYTES = 50 * 1024
export const MAX_AGENT_MARKDOWN_BYTES = 256 * 1024

class ReadonlyAgentToolError extends Error {}

export class AgentFileConflictError extends Error {
  constructor(readonly path: string) {
    super(`文件「${path}」在提交前已经变化。`)
    this.name = "AgentFileConflictError"
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new ReadonlyAgentToolError("Agent 运行已停止。")
}

export function isAgentMarkdownPath(path: string) {
  return isMarkdownPath(path)
}

export function agentContentHash(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

function hasIgnoredSegment(relativePath: string) {
  return relativePath
    .split("/")
    .some((part) => !part || part === "." || part === ".." || isIgnoredWorkspaceEntryName(part))
}

function normalizedRelativePath(value: string, allowRoot: boolean) {
  const path = value.trim().split("\\").join("/")
  if (allowRoot && !path) return ""
  if (!path || path.length > 1_024 || isAbsolute(path) || path.includes("\0") || hasIgnoredSegment(path)) {
    throw new ReadonlyAgentToolError("工具路径必须是工作区内可见的相对路径。")
  }
  return path
}

async function canonicalWorkspaceRoot(rootPath: string) {
  try {
    return await realpath(rootPath)
  } catch {
    throw new ReadonlyAgentToolError("当前工作区不可用，请重新打开后再试。")
  }
}

export async function resolveAgentPath(rootPath: string, inputPath: string, allowRoot = false) {
  const relativePath = normalizedRelativePath(inputPath, allowRoot)
  const canonicalRoot = await canonicalWorkspaceRoot(rootPath)
  if (!relativePath) return { absolutePath: canonicalRoot, relativePath: "" }

  const candidate = resolve(canonicalRoot, relativePath)
  const relation = relative(canonicalRoot, candidate).split("\\").join("/")
  if (!relation || relation.startsWith("../") || isAbsolute(relation)) {
    throw new ReadonlyAgentToolError("工具路径超出当前工作区。")
  }

  let canonicalTarget: string
  try {
    canonicalTarget = await realpath(candidate)
  } catch {
    throw new ReadonlyAgentToolError(`工作区内找不到「${relativePath}」。`)
  }
  const canonicalRelation = relative(canonicalRoot, canonicalTarget).split("\\").join("/")
  if (
    !canonicalRelation ||
    canonicalRelation.startsWith("../") ||
    isAbsolute(canonicalRelation) ||
    hasIgnoredSegment(canonicalRelation)
  ) {
    throw new ReadonlyAgentToolError("工具路径不能通过链接或隐藏目录扩大访问范围。")
  }
  return { absolutePath: canonicalTarget, relativePath: canonicalRelation }
}

export async function readAgentMarkdownFile(rootPath: string, path: string, signal: AbortSignal) {
  throwIfAborted(signal)
  const target = await resolveAgentPath(rootPath, path)
  if (!isAgentMarkdownPath(target.relativePath)) {
    throw new ReadonlyAgentToolError("Agent 当前只能读取 Markdown 文件。")
  }
  try {
    const metadata = await stat(target.absolutePath)
    if (!metadata.isFile()) throw new ReadonlyAgentToolError("读取目标必须是 Markdown 文件。")
    if (metadata.size > MAX_AGENT_MARKDOWN_BYTES) {
      throw new ReadonlyAgentToolError(`文件「${target.relativePath}」超过 256 KiB 读取上限。`)
    }
    const content = await readFile(target.absolutePath, "utf8")
    throwIfAborted(signal)
    return {
      path: target.relativePath,
      size: metadata.size,
      modifiedAt: Math.trunc(metadata.mtimeMs),
      contentHash: agentContentHash(content),
      content,
    }
  } catch (error) {
    if (error instanceof ReadonlyAgentToolError) throw error
    throw new ReadonlyAgentToolError(`无法读取工作区文件「${target.relativePath}」。`)
  }
}

function normalizeReadRange(input: ReadWorkspaceFileInput) {
  const offset = input.offset ?? 1
  const limit = input.limit ?? DEFAULT_READ_LINE_LIMIT
  const lineByteOffset = input.lineByteOffset
  if (!Number.isSafeInteger(offset) || offset < 1) {
    throw new ReadonlyAgentToolError("读取起始行必须是从 1 开始的整数。")
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_READ_LINE_LIMIT) {
    throw new ReadonlyAgentToolError(`单次读取行数必须在 1 到 ${MAX_READ_LINE_LIMIT} 之间。`)
  }
  if (
    lineByteOffset !== undefined &&
    (!Number.isSafeInteger(lineByteOffset) || lineByteOffset < 0 || lineByteOffset > MAX_AGENT_MARKDOWN_BYTES)
  ) {
    throw new ReadonlyAgentToolError("单行续读位置必须是有效的 UTF-8 字节位置。")
  }
  if (lineByteOffset !== undefined && input.offset === undefined) {
    throw new ReadonlyAgentToolError("续读超长单行时必须同时提供起始行 offset。")
  }
  return { limit, lineByteOffset, offset }
}

function boundedUtf8End(bytes: Buffer, startByte: number, maxBytes: number) {
  let endByte = Math.min(bytes.byteLength, startByte + maxBytes)
  while (endByte < bytes.byteLength && endByte > startByte) {
    const value = bytes[endByte]
    if (value === undefined || (value & 0xc0) !== 0x80) break
    endByte -= 1
  }
  return endByte
}

function isUtf8Boundary(bytes: Buffer, offset: number) {
  if (offset === 0 || offset === bytes.byteLength) return true
  const value = bytes[offset]
  return value !== undefined && (value & 0xc0) !== 0x80
}

type AgentMarkdownDocument = Awaited<ReturnType<typeof readAgentMarkdownFile>>

function workspaceFileReadResult(
  document: AgentMarkdownDocument,
  input: ReadWorkspaceFileInput,
): WorkspaceFileReadResult {
  const { limit, lineByteOffset, offset } = normalizeReadRange(input)
  const lines = document.content.split("\n")
  if (offset > lines.length) {
    throw new ReadonlyAgentToolError(`读取起始行 ${offset} 超出文件总行数 ${lines.length}。`)
  }

  if (lineByteOffset !== undefined) {
    const line = lines[offset - 1] ?? ""
    const lineBytes = Buffer.from(line, "utf8")
    if (
      lineByteOffset > lineBytes.byteLength ||
      (lineByteOffset === lineBytes.byteLength && lineBytes.byteLength > 0) ||
      !isUtf8Boundary(lineBytes, lineByteOffset)
    ) {
      throw new ReadonlyAgentToolError("单行续读位置不是当前行的有效 UTF-8 字节边界。")
    }
    const endByte = boundedUtf8End(lineBytes, lineByteOffset, MAX_READ_RESULT_BYTES)
    const lineComplete = endByte === lineBytes.byteLength
    const hasMoreLines = offset < lines.length
    const reason = lineComplete ? (hasMoreLines ? "lines" : null) : "bytes"
    return {
      ...document,
      content: lineBytes.subarray(lineByteOffset, endByte).toString("utf8"),
      range: {
        startLine: offset,
        endLine: offset,
        totalLines: lines.length,
        lineByteRange: {
          startByte: lineByteOffset,
          endByte,
          totalBytes: lineBytes.byteLength,
        },
      },
      truncation: {
        truncated: reason !== null,
        reason,
        maxBytes: MAX_READ_RESULT_BYTES,
        lineTruncated: !lineComplete,
        nextOffset: lineComplete ? (hasMoreLines ? offset + 1 : null) : offset,
        nextLineByteOffset: lineComplete ? null : endByte,
      },
    }
  }

  const requestedLines = lines.slice(offset - 1, offset - 1 + limit)
  const outputLines: string[] = []
  let outputBytes = 0
  let byteLimitReached = false
  let lineTruncated = false
  let lineByteRange: WorkspaceFileReadResult["range"]["lineByteRange"] = null

  for (const line of requestedLines) {
    const separator = outputLines.length > 0 ? "\n" : ""
    const additionBytes = Buffer.byteLength(separator + line, "utf8")
    if (outputBytes + additionBytes <= MAX_READ_RESULT_BYTES) {
      outputLines.push(line)
      outputBytes += additionBytes
      continue
    }
    byteLimitReached = true
    if (outputLines.length === 0) {
      const lineBytes = Buffer.from(line, "utf8")
      const endByte = boundedUtf8End(lineBytes, 0, MAX_READ_RESULT_BYTES)
      outputLines.push(lineBytes.subarray(0, endByte).toString("utf8"))
      lineTruncated = endByte < lineBytes.byteLength
      lineByteRange = { startByte: 0, endByte, totalBytes: lineBytes.byteLength }
    }
    break
  }

  const endLine = offset + outputLines.length - 1
  const hasMoreLines = endLine < lines.length
  const reason = byteLimitReached ? "bytes" : hasMoreLines ? "lines" : null
  return {
    ...document,
    content: outputLines.join("\n"),
    range: {
      startLine: offset,
      endLine,
      totalLines: lines.length,
      lineByteRange,
    },
    truncation: {
      truncated: reason !== null,
      reason,
      maxBytes: MAX_READ_RESULT_BYTES,
      lineTruncated,
      nextOffset: lineTruncated ? offset : !hasMoreLines ? null : endLine + 1,
      nextLineByteOffset: lineTruncated ? (lineByteRange?.endByte ?? null) : null,
    },
  }
}

export async function readWorkspaceAgentFile(
  rootPath: string,
  input: ReadWorkspaceFileInput,
  signal: AbortSignal,
) {
  return workspaceFileReadResult(await readAgentMarkdownFile(rootPath, input.path, signal), input)
}

export async function resolveAgentCreatePath(rootPath: string, inputPath: string) {
  const relativePath = normalizedRelativePath(inputPath, false)
  if (!isAgentMarkdownPath(relativePath)) {
    throw new ReadonlyAgentToolError("Agent 当前只能创建 Markdown 文件。")
  }
  const canonicalRoot = await canonicalWorkspaceRoot(rootPath)
  const candidate = resolve(canonicalRoot, relativePath)
  const relation = relative(canonicalRoot, candidate).split("\\").join("/")
  if (!relation || relation.startsWith("../") || isAbsolute(relation)) {
    throw new ReadonlyAgentToolError("工具路径超出当前工作区。")
  }
  const parent = await realpath(dirname(candidate)).catch(() => {
    throw new ReadonlyAgentToolError("创建文档的父目录不存在或不可访问。")
  })
  const parentRelation = relative(canonicalRoot, parent).split("\\").join("/")
  if (
    parentRelation.startsWith("../") ||
    isAbsolute(parentRelation) ||
    (parentRelation && hasIgnoredSegment(parentRelation))
  ) {
    throw new ReadonlyAgentToolError("工具路径不能通过链接或隐藏目录扩大访问范围。")
  }
  const existing = await stat(candidate).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  })
  if (existing) throw new ReadonlyAgentToolError(`工作区内已经存在「${relation}」。`)
  return { absolutePath: candidate, relativePath: relation }
}

export async function writeAgentMarkdownFile(
  rootPath: string,
  path: string,
  content: string,
  operation: "create" | "update",
  options: Readonly<{
    expectedContentHash?: string | undefined
    signal?: AbortSignal | undefined
  }> = {},
) {
  const signal = options.signal ?? new AbortController().signal
  throwIfAborted(signal)
  if (Buffer.byteLength(content, "utf8") > MAX_AGENT_MARKDOWN_BYTES) {
    throw new ReadonlyAgentToolError("候选文档超过 256 KiB 写入上限。")
  }
  const target =
    operation === "create"
      ? await resolveAgentCreatePath(rootPath, path)
      : await resolveAgentPath(rootPath, path)
  const existingMetadata =
    operation === "update"
      ? await stat(target.absolutePath)
      : await stat(target.absolutePath).catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
          throw error
        })
  if (operation === "create" && existingMetadata) {
    throw new ReadonlyAgentToolError(`工作区内已经存在「${target.relativePath}」。`)
  }
  if (operation === "update" && !existingMetadata?.isFile()) {
    throw new ReadonlyAgentToolError("更新目标必须是 Markdown 文件。")
  }
  if (operation === "update" && !options.expectedContentHash) {
    throw new ReadonlyAgentToolError("更新目标必须携带预期内容版本。")
  }

  const temporaryPath = join(
    dirname(target.absolutePath),
    `.${basename(target.absolutePath)}.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      ...(existingMetadata ? { mode: existingMetadata.mode } : {}),
      flag: "wx",
    })
    throwIfAborted(signal)
    if (operation === "create") {
      await link(temporaryPath, target.absolutePath)
      await unlink(temporaryPath)
    } else {
      const commitTarget = await resolveAgentPath(rootPath, target.relativePath)
      if (commitTarget.absolutePath !== target.absolutePath) {
        throw new AgentFileConflictError(target.relativePath)
      }
      const currentContent = await readFile(commitTarget.absolutePath, "utf8")
      if (agentContentHash(currentContent) !== options.expectedContentHash) {
        throw new AgentFileConflictError(target.relativePath)
      }
      throwIfAborted(signal)
      await rename(temporaryPath, commitTarget.absolutePath)
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
  // 提交成功后不再因迟到 Abort 把已落盘的副作用伪装成失败。
  return readAgentMarkdownFile(rootPath, target.relativePath, new AbortController().signal)
}
