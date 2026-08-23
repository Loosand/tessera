/**
 * [INPUT]: 主进程持有的工作区根路径、渲染层选择的相对路径/文件名、磁盘文件与预期修改时间
 * [OUTPUT]: 工作区路径收口、Markdown/忽略目录策略，以及文档/目录列表、读取、创建、重命名和原子保存能力
 * [POS]: Electron 主进程工作区 IPC 与 Agent 文件工具共享的文件系统策略和平台服务
 * [DOC]: docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import type {
  DocumentSnapshot,
  DocumentWriteResult,
  WorkspaceDirectoryEntry,
  WorkspaceDocumentEntry,
} from "@tessera/contracts"

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"])
const IGNORED_DIRECTORIES = new Set([".git", ".tessera", "node_modules"])

function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code
}

function relativeWorkspacePath(rootPath: string, absolutePath: string) {
  return relative(rootPath, absolutePath).split("\\").join("/")
}

export function isIgnoredWorkspaceEntryName(name: string) {
  return name.startsWith(".") || IGNORED_DIRECTORIES.has(name)
}

export function isMarkdownPath(path: string) {
  return MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase())
}

export async function resolveWorkspacePath(rootPath: string, relativePath: string) {
  if (!relativePath || isAbsolute(relativePath)) throw new Error("文档路径无效。")

  const targetPath = resolve(rootPath, relativePath)
  const relation = relative(rootPath, targetPath)
  if (!relation || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("文档必须位于当前工作区内。")
  }

  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
  const canonicalRelation = relative(canonicalRoot, canonicalTarget)
  if (!canonicalRelation || canonicalRelation.startsWith("..") || isAbsolute(canonicalRelation)) {
    throw new Error("文档不能通过链接指向工作区外部。")
  }
  return canonicalTarget
}

export async function listMarkdownDocuments(rootPath: string) {
  const documents: WorkspaceDocumentEntry[] = []

  async function visit(directoryPath: string) {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        if (isIgnoredWorkspaceEntryName(entry.name)) return

        const absolutePath = join(directoryPath, entry.name)
        if (entry.isDirectory()) {
          await visit(absolutePath)
          return
        }
        if (!entry.isFile() || !isMarkdownPath(entry.name)) return

        const metadata = await stat(absolutePath)
        documents.push({
          name: entry.name,
          relativePath: relativeWorkspacePath(rootPath, absolutePath),
          modifiedAt: metadata.mtimeMs,
          size: metadata.size,
        })
      }),
    )
  }

  await visit(rootPath)
  return documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
}

export async function listWorkspaceDirectories(rootPath: string) {
  const directories: WorkspaceDirectoryEntry[] = []

  async function visit(directoryPath: string) {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        if (isIgnoredWorkspaceEntryName(entry.name) || !entry.isDirectory()) return

        const absolutePath = join(directoryPath, entry.name)
        directories.push({
          name: entry.name,
          relativePath: relativeWorkspacePath(rootPath, absolutePath),
        })
        await visit(absolutePath)
      }),
    )
  }

  await visit(rootPath)
  return directories.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
}

export async function readDocument(rootPath: string, relativePath: string): Promise<DocumentSnapshot> {
  const absolutePath = await resolveWorkspacePath(rootPath, relativePath)
  if (!isMarkdownPath(absolutePath)) throw new Error("当前仅支持 Markdown 文档。")

  const [content, metadata] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)])
  if (!metadata.isFile()) throw new Error("目标不是可读取的文档。")

  return {
    name: basename(absolutePath),
    relativePath: relativeWorkspacePath(rootPath, absolutePath),
    modifiedAt: metadata.mtimeMs,
    size: metadata.size,
    content,
  }
}

async function resolveWorkspaceDirectory(rootPath: string, relativePath = "") {
  const absolutePath = relativePath
    ? await resolveWorkspacePath(rootPath, relativePath)
    : await realpath(rootPath)
  const metadata = await stat(absolutePath)
  if (!metadata.isDirectory()) throw new Error("目标不是工作区文件夹。")
  return absolutePath
}

export async function createDocument(rootPath: string, parentRelativePath = ""): Promise<DocumentSnapshot> {
  const directoryPath = await resolveWorkspaceDirectory(rootPath, parentRelativePath)
  let sequence = 0
  let fileName = "未命名文档.md"
  let absolutePath = join(directoryPath, fileName)

  while (true) {
    try {
      await stat(absolutePath)
      sequence += 1
      fileName = `未命名文档 ${sequence + 1}.md`
      absolutePath = join(directoryPath, fileName)
    } catch {
      break
    }
  }

  await writeFile(absolutePath, "# 未命名文档\n\n从这里开始记录。\n", {
    encoding: "utf8",
    flag: "wx",
  })
  return readDocument(rootPath, relativeWorkspacePath(rootPath, absolutePath))
}

function validateWorkspaceEntryName(value: string) {
  const fileName = value.trim()
  if (!fileName || fileName === "." || fileName === ".." || basename(fileName) !== fileName) {
    throw new Error("请输入有效的文件名。")
  }
  const hasControlCharacter = [...fileName].some((character) => character.charCodeAt(0) < 32)
  if (fileName.startsWith(".") || /[<>:"/\\|?*]/u.test(fileName) || hasControlCharacter) {
    throw new Error("文件名包含不支持的字符。")
  }
  return fileName
}

function validateDocumentName(value: string) {
  const fileName = validateWorkspaceEntryName(value)
  if (!isMarkdownPath(fileName)) throw new Error("文件名需要以 .md 或 .markdown 结尾。")
  return fileName
}

export async function createDirectory(
  rootPath: string,
  parentRelativePath = "",
): Promise<WorkspaceDirectoryEntry> {
  const parentPath = await resolveWorkspaceDirectory(rootPath, parentRelativePath)
  let sequence = 0
  let name = "新建文件夹"
  let absolutePath = join(parentPath, name)

  while (true) {
    try {
      await stat(absolutePath)
      sequence += 1
      name = `新建文件夹 ${sequence + 1}`
      absolutePath = join(parentPath, name)
    } catch {
      break
    }
  }

  await mkdir(absolutePath)
  return { name, relativePath: relativeWorkspacePath(rootPath, absolutePath) }
}

export async function renameDocument(
  rootPath: string,
  relativePath: string,
  selectedPath: string,
): Promise<DocumentSnapshot> {
  const sourcePath = await resolveWorkspacePath(rootPath, relativePath)
  const fileName = validateDocumentName(basename(selectedPath))
  const destinationDirectory = await realpath(dirname(resolve(selectedPath)))
  const canonicalRoot = await realpath(rootPath)
  const destinationRelation = relative(canonicalRoot, destinationDirectory)
  if (destinationRelation.startsWith("..") || isAbsolute(destinationRelation)) {
    throw new Error("文档必须保留在当前工作区内。")
  }

  const destinationPath = join(destinationDirectory, fileName)
  if (sourcePath === destinationPath) return readDocument(rootPath, relativePath)

  try {
    await stat(destinationPath)
    throw new Error("同一位置已存在同名文档。")
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error
  }

  await rename(sourcePath, destinationPath)
  return readDocument(rootPath, relativeWorkspacePath(rootPath, destinationPath))
}

export async function renameDirectory(
  rootPath: string,
  relativePath: string,
  selectedPath: string,
): Promise<WorkspaceDirectoryEntry> {
  const sourcePath = await resolveWorkspacePath(rootPath, relativePath)
  const metadata = await stat(sourcePath)
  if (!metadata.isDirectory()) throw new Error("目标不是可重命名的文件夹。")

  const name = validateWorkspaceEntryName(basename(selectedPath))
  const destinationPath = join(dirname(sourcePath), name)
  if (sourcePath === destinationPath) return { name, relativePath }

  try {
    await stat(destinationPath)
    throw new Error("同一位置已存在同名文件夹。")
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error
  }

  await rename(sourcePath, destinationPath)
  return {
    name,
    relativePath: relativeWorkspacePath(rootPath, destinationPath),
  }
}

export async function writeDocument(
  rootPath: string,
  relativePath: string,
  content: string,
  expectedModifiedAt: number,
): Promise<DocumentWriteResult> {
  const currentDocument = await readDocument(rootPath, relativePath)
  if (currentDocument.modifiedAt !== expectedModifiedAt) {
    return { status: "conflict", document: currentDocument }
  }

  const absolutePath = await resolveWorkspacePath(rootPath, relativePath)
  const metadata = await stat(absolutePath)
  const temporaryPath = join(dirname(absolutePath), `.${basename(absolutePath)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: metadata.mode, flag: "wx" })
    await rename(temporaryPath, absolutePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }

  return { status: "saved", document: await readDocument(rootPath, relativePath) }
}
