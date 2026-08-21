/**
 * [INPUT]: 主进程持有的工作区根路径、可选当前文档路径与 Agent 工具输入
 * [OUTPUT]: 仅限 Markdown 的列表、读取、全文检索、当前文档读取，以及可写 Agent 复用的路径/版本/原子写安全原语
 * [POS]: Electron 主进程中 Agent 工作区文件访问的底层安全边界
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { createHash, randomUUID } from "node:crypto"
import { link, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import type {
  ListWorkspaceFilesInput,
  ReadWorkspaceFileInput,
  ReadonlyWorkspaceAgentTools,
  SearchWorkspaceTextInput,
} from "@tessera/ai/server"

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"])
const IGNORED_DIRECTORIES = new Set([".git", ".tessera", "node_modules"])
const MAX_FILE_BYTES = 256 * 1024
const MAX_LISTED_FILES = 500
const MAX_SCANNED_FILES = 2_000
const MAX_SEARCH_BYTES = 8 * 1024 * 1024
const MAX_SEARCH_RESULTS = 100
const MAX_MATCH_CHARACTERS = 400
export const MAX_AGENT_MARKDOWN_BYTES = 256 * 1024

class ReadonlyAgentToolError extends Error {}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new ReadonlyAgentToolError("Agent 运行已停止。")
}

export function isAgentMarkdownPath(path: string) {
  return MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase())
}

export function agentContentHash(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

function hasIgnoredSegment(relativePath: string) {
  return relativePath
    .split("/")
    .some(
      (part) =>
        !part || part === "." || part === ".." || part.startsWith(".") || IGNORED_DIRECTORIES.has(part),
    )
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

type WorkspaceFileRecord = {
  readonly absolutePath: string
  readonly modifiedAt: number
  readonly path: string
  readonly size: number
}

async function collectMarkdownFiles(
  rootPath: string,
  directory: string,
  signal: AbortSignal,
): Promise<{ files: WorkspaceFileRecord[]; truncated: boolean }> {
  const canonicalRoot = await canonicalWorkspaceRoot(rootPath)
  const start = await resolveAgentPath(canonicalRoot, directory, true)
  const startMetadata = await stat(start.absolutePath).catch(() => {
    throw new ReadonlyAgentToolError("无法访问指定的工作区目录。")
  })
  if (!startMetadata.isDirectory()) throw new ReadonlyAgentToolError("列出文件的目标必须是工作区目录。")

  const files: WorkspaceFileRecord[] = []
  let scannedFiles = 0
  let truncated = false

  async function visit(directoryPath: string) {
    throwIfAborted(signal)
    if (truncated) return
    const entries = await readdir(directoryPath, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    for (const entry of entries) {
      throwIfAborted(signal)
      if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink())
        continue
      const absolutePath = resolve(directoryPath, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath)
        if (truncated) return
        continue
      }
      if (!entry.isFile()) continue
      scannedFiles += 1
      if (scannedFiles > MAX_SCANNED_FILES) {
        truncated = true
        return
      }
      if (!isAgentMarkdownPath(entry.name)) continue
      if (files.length >= MAX_LISTED_FILES) {
        truncated = true
        return
      }
      const metadata = await stat(absolutePath)
      files.push({
        absolutePath,
        path: relative(canonicalRoot, absolutePath).split("\\").join("/"),
        size: metadata.size,
        modifiedAt: metadata.mtimeMs,
      })
    }
  }

  try {
    await visit(start.absolutePath)
  } catch (error) {
    if (error instanceof ReadonlyAgentToolError) throw error
    throw new ReadonlyAgentToolError("无法列出工作区 Markdown 文件。")
  }
  return { files, truncated }
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
) {
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
    if (operation === "create") {
      await link(temporaryPath, target.absolutePath)
      await unlink(temporaryPath)
    } else {
      await rename(temporaryPath, target.absolutePath)
    }
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
  return readAgentMarkdownFile(rootPath, target.relativePath, new AbortController().signal)
}

export type ReadonlyWorkspaceAgentToolOptions = {
  readonly currentDocumentPath?: string
  readonly rootPath: string
}

export function createReadonlyWorkspaceAgentTools({
  currentDocumentPath,
  rootPath,
}: ReadonlyWorkspaceAgentToolOptions): ReadonlyWorkspaceAgentTools {
  return {
    listWorkspaceFiles: async (input: ListWorkspaceFilesInput, signal) => {
      const result = await collectMarkdownFiles(rootPath, input.directory ?? "", signal)
      return {
        files: result.files.map(({ path, size, modifiedAt }) => ({ path, size, modifiedAt })),
        truncated: result.truncated,
        limit: MAX_LISTED_FILES,
      }
    },
    readWorkspaceFile: (input: ReadWorkspaceFileInput, signal) =>
      readAgentMarkdownFile(rootPath, input.path, signal),
    readCurrentDocument: async (signal) => {
      if (!currentDocumentPath) {
        return { available: false, reason: "用户当前没有在编辑器中打开 Markdown 文档。" }
      }
      return { available: true, ...(await readAgentMarkdownFile(rootPath, currentDocumentPath, signal)) }
    },
    searchWorkspaceText: async (input: SearchWorkspaceTextInput, signal) => {
      const query = input.query.trim()
      if (!query || query.length > 200) throw new ReadonlyAgentToolError("搜索词必须为 1 到 200 个字符。")
      const collected = await collectMarkdownFiles(rootPath, input.directory ?? "", signal)
      const normalizedQuery = query.toLocaleLowerCase()
      const matches: Array<{ path: string; line: number; text: string }> = []
      const skippedFiles: string[] = []
      let scannedBytes = 0
      let truncated = collected.truncated

      for (const file of collected.files) {
        throwIfAborted(signal)
        if (file.size > MAX_FILE_BYTES || scannedBytes + file.size > MAX_SEARCH_BYTES) {
          skippedFiles.push(file.path)
          if (scannedBytes + file.size > MAX_SEARCH_BYTES) truncated = true
          continue
        }
        scannedBytes += file.size
        let content: string
        try {
          content = await readFile(file.absolutePath, "utf8")
        } catch {
          skippedFiles.push(file.path)
          continue
        }
        const lines = content.split(/\r?\n/u)
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? ""
          if (!line.toLocaleLowerCase().includes(normalizedQuery)) continue
          matches.push({
            path: file.path,
            line: index + 1,
            text: line.slice(0, MAX_MATCH_CHARACTERS),
          })
          if (matches.length >= MAX_SEARCH_RESULTS) {
            truncated = true
            break
          }
        }
        if (matches.length >= MAX_SEARCH_RESULTS) break
      }

      return {
        query,
        matches,
        truncated,
        scannedBytes,
        skippedFiles: skippedFiles.slice(0, 20),
        resultLimit: MAX_SEARCH_RESULTS,
      }
    },
  }
}
