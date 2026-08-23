/**
 * [INPUT]: 临时工作区、Markdown/忽略目录样例、越界与符号链接路径，以及文档版本快照
 * [OUTPUT]: 工作区文件策略、目录/文档操作、路径收口和原子保存冲突的回归验证
 * [POS]: workspace-file-service 的无 Electron 文件系统单元测试
 * [DOC]: docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  createDirectory,
  createDocument,
  isIgnoredWorkspaceEntryName,
  isMarkdownPath,
  listMarkdownDocuments,
  listWorkspaceDirectories,
  readDocument,
  renameDirectory,
  renameDocument,
  resolveWorkspacePath,
  writeDocument,
} from "./workspace-file-service"

const temporaryDirectories: string[] = []

async function createWorkspace() {
  const rootPath = await mkdtemp(join(tmpdir(), "tessera-workspace-files-"))
  temporaryDirectories.push(rootPath)
  await mkdir(join(rootPath, "notes"))
  await mkdir(join(rootPath, ".hidden"))
  await mkdir(join(rootPath, "node_modules"))
  await writeFile(join(rootPath, "README.md"), "# 首页\n")
  await writeFile(join(rootPath, "notes", "draft.markdown"), "# 草稿\n")
  await writeFile(join(rootPath, "notes", "ignored.txt"), "忽略")
  await writeFile(join(rootPath, ".hidden", "secret.md"), "隐藏")
  await writeFile(join(rootPath, "node_modules", "package.md"), "依赖")
  return realpath(rootPath)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe("工作区文件服务", () => {
  it("统一 Markdown 与忽略目录策略，并只列出可见工作区成员", async () => {
    const rootPath = await createWorkspace()

    expect(isMarkdownPath("README.MD")).toBe(true)
    expect(isMarkdownPath("notes.txt")).toBe(false)
    expect(isIgnoredWorkspaceEntryName(".hidden")).toBe(true)
    expect(isIgnoredWorkspaceEntryName("node_modules")).toBe(true)

    const documents = await listMarkdownDocuments(rootPath)
    expect(documents).toHaveLength(2)
    expect(documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "README.md", relativePath: "README.md" }),
        expect.objectContaining({ name: "draft.markdown", relativePath: "notes/draft.markdown" }),
      ]),
    )
    await expect(listWorkspaceDirectories(rootPath)).resolves.toEqual([
      { name: "notes", relativePath: "notes" },
    ])
  })

  it("拒绝目录穿越和工作区外符号链接", async () => {
    const rootPath = await createWorkspace()
    const outsidePath = await mkdtemp(join(tmpdir(), "tessera-workspace-outside-"))
    temporaryDirectories.push(outsidePath)
    await writeFile(join(outsidePath, "secret.md"), "不能读取")
    await symlink(join(outsidePath, "secret.md"), join(rootPath, "linked.md"))

    await expect(resolveWorkspacePath(rootPath, "../secret.md")).rejects.toThrow("文档必须位于当前工作区内")
    await expect(resolveWorkspacePath(rootPath, join(outsidePath, "secret.md"))).rejects.toThrow(
      "文档路径无效",
    )
    await expect(resolveWorkspacePath(rootPath, "linked.md")).rejects.toThrow(
      "文档不能通过链接指向工作区外部",
    )
  })

  it("创建和重命名成员，并以修改时间检查原子保存冲突", async () => {
    const rootPath = await createWorkspace()
    const first = await createDocument(rootPath, "notes")
    const second = await createDocument(rootPath, "notes")
    expect(first.relativePath).toBe("notes/未命名文档.md")
    expect(second.relativePath).toBe("notes/未命名文档 2.md")

    const firstDirectory = await createDirectory(rootPath)
    const secondDirectory = await createDirectory(rootPath)
    expect(firstDirectory).toEqual({ name: "新建文件夹", relativePath: "新建文件夹" })
    expect(secondDirectory).toEqual({ name: "新建文件夹 2", relativePath: "新建文件夹 2" })

    const renamedDocument = await renameDocument(
      rootPath,
      first.relativePath,
      join(rootPath, "notes", "正式稿.markdown"),
    )
    expect(renamedDocument.relativePath).toBe("notes/正式稿.markdown")
    await expect(
      renameDocument(rootPath, renamedDocument.relativePath, join(rootPath, "notes", "错误.txt")),
    ).rejects.toThrow("需要以 .md 或 .markdown 结尾")

    const renamedDirectory = await renameDirectory(
      rootPath,
      firstDirectory.relativePath,
      join(rootPath, "项目"),
    )
    expect(renamedDirectory).toEqual({ name: "项目", relativePath: "项目" })

    const current = await readDocument(rootPath, renamedDocument.relativePath)
    await expect(writeDocument(rootPath, renamedDocument.relativePath, "冲突内容", -1)).resolves.toEqual({
      status: "conflict",
      document: current,
    })
    await expect(
      writeDocument(rootPath, renamedDocument.relativePath, "# 已保存\n", current.modifiedAt),
    ).resolves.toMatchObject({ status: "saved", document: { content: "# 已保存\n" } })
    await expect(readFile(join(rootPath, renamedDocument.relativePath), "utf8")).resolves.toBe("# 已保存\n")
  })
})
