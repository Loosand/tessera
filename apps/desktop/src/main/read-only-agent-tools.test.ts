/**
 * [INPUT]: 临时 Markdown 工作区、越界/符号链接路径与只读 Agent 工具调用
 * [OUTPUT]: 文件类型、路径逃逸、体积、分页/字节截断、检索结果和当前文档边界的回归验证
 * [POS]: 主进程只读 Agent 工作区能力的安全单元测试
 * [DOC]: docs/architecture/agent-file-capabilities.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createReadonlyWorkspaceAgentTools } from "./read-only-agent-tools"

const temporaryDirectories: string[] = []

async function createWorkspace() {
  const rootPath = await mkdtemp(join(tmpdir(), "tessera-agent-tools-"))
  temporaryDirectories.push(rootPath)
  await mkdir(join(rootPath, "notes"))
  await writeFile(join(rootPath, "README.md"), "# 首页\n\nTessera 只读 Agent\n")
  await writeFile(join(rootPath, "notes", "roadmap.md"), "# 路线\n\n支持 Agent 模式\n再次支持 Agent\n")
  await writeFile(join(rootPath, "notes", "ignored.txt"), "Agent 不应读取")
  return rootPath
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("只读 Agent 工作区工具", () => {
  it("只列出 Markdown，并以相对路径读取和检索行号", async () => {
    const rootPath = await createWorkspace()
    const tools = createReadonlyWorkspaceAgentTools({
      rootPath,
      currentDocumentPath: "notes/roadmap.md",
    })
    const signal = new AbortController().signal

    await expect(tools.listWorkspaceFiles({}, signal)).resolves.toMatchObject({
      files: [{ path: "notes/roadmap.md" }, { path: "README.md" }],
      truncated: false,
    })
    await expect(tools.readCurrentDocument(signal)).resolves.toMatchObject({
      available: true,
      path: "notes/roadmap.md",
      content: expect.stringContaining("支持 Agent 模式"),
    })
    await expect(tools.searchWorkspaceText({ query: "agent" }, signal)).resolves.toMatchObject({
      matches: [
        { path: "notes/roadmap.md", line: 3 },
        { path: "notes/roadmap.md", line: 4 },
        { path: "README.md", line: 3 },
      ],
    })
  })

  it("拒绝目录穿越、工作区外符号链接和超大文件", async () => {
    const rootPath = await createWorkspace()
    const outsidePath = await mkdtemp(join(tmpdir(), "tessera-agent-outside-"))
    temporaryDirectories.push(outsidePath)
    await writeFile(join(outsidePath, "secret.md"), "不能读取")
    await symlink(join(outsidePath, "secret.md"), join(rootPath, "linked.md"))
    await writeFile(join(rootPath, "large.md"), "x".repeat(256 * 1024 + 1))
    const tools = createReadonlyWorkspaceAgentTools({ rootPath })
    const signal = new AbortController().signal

    await expect(tools.readWorkspaceFile({ path: "../secret.md" }, signal)).rejects.toThrow(
      "工作区内可见的相对路径",
    )
    await expect(tools.readWorkspaceFile({ path: join(outsidePath, "secret.md") }, signal)).rejects.toThrow(
      "工作区内可见的相对路径",
    )
    await expect(tools.readWorkspaceFile({ path: "linked.md" }, signal)).rejects.toThrow("扩大访问范围")
    await expect(tools.readWorkspaceFile({ path: "large.md" }, signal)).rejects.toThrow("256 KiB")
    await expect(tools.readWorkspaceFile({ path: "notes/ignored.txt" }, signal)).rejects.toThrow(
      "只能读取 Markdown",
    )
  })

  it("把超量搜索结果截断为结构化响应", async () => {
    const rootPath = await createWorkspace()
    await writeFile(
      join(rootPath, "many.md"),
      Array.from({ length: 110 }, (_, index) => `Agent 结果 ${index + 1}`).join("\n"),
    )
    const tools = createReadonlyWorkspaceAgentTools({ rootPath })

    const result = await tools.searchWorkspaceText({ query: "Agent" }, new AbortController().signal)

    expect(result).toMatchObject({
      resultLimit: 100,
      truncated: true,
    })
    expect(result.matches).toHaveLength(100)
    expect(result.matches.at(-1)).toMatchObject({ path: "many.md", line: 100 })
  })

  it("按行分页读取并为后续内容返回 nextOffset", async () => {
    const rootPath = await createWorkspace()
    await writeFile(
      join(rootPath, "long.md"),
      Array.from({ length: 450 }, (_, index) => `第 ${index + 1} 行`).join("\n"),
    )
    const tools = createReadonlyWorkspaceAgentTools({ rootPath })
    const signal = new AbortController().signal

    const firstPage = await tools.readWorkspaceFile({ path: "long.md" }, signal)
    expect(firstPage.range).toEqual({ startLine: 1, endLine: 400, totalLines: 450 })
    expect(firstPage.truncation).toMatchObject({
      truncated: true,
      reason: "lines",
      nextOffset: 401,
      lineTruncated: false,
    })
    expect(firstPage.content).toContain("第 400 行")
    expect(firstPage.content).not.toContain("第 401 行")

    const secondPage = await tools.readWorkspaceFile(
      { path: "long.md", offset: firstPage.truncation.nextOffset ?? undefined },
      signal,
    )
    expect(secondPage.range).toEqual({ startLine: 401, endLine: 450, totalLines: 450 })
    expect(secondPage.truncation).toMatchObject({ truncated: false, nextOffset: null })
  })

  it("即使 Markdown 单行异常过长也不让工具结果超过字节预算", async () => {
    const rootPath = await createWorkspace()
    await writeFile(join(rootPath, "single-line.md"), "界".repeat(30_000))
    const tools = createReadonlyWorkspaceAgentTools({ rootPath })

    const result = await tools.readWorkspaceFile({ path: "single-line.md" }, new AbortController().signal)

    expect(Buffer.byteLength(result.content, "utf8")).toBeLessThanOrEqual(50 * 1024)
    expect(result.truncation).toMatchObject({
      truncated: true,
      reason: "bytes",
      lineTruncated: true,
      nextOffset: null,
    })
  })

  it("在主进程边界拒绝非法读取范围", async () => {
    const rootPath = await createWorkspace()
    const tools = createReadonlyWorkspaceAgentTools({ rootPath })
    const signal = new AbortController().signal

    await expect(tools.readWorkspaceFile({ path: "README.md", offset: 0 }, signal)).rejects.toThrow(
      "从 1 开始",
    )
    await expect(tools.readWorkspaceFile({ path: "README.md", limit: 1_001 }, signal)).rejects.toThrow(
      "1 到 1000",
    )
    await expect(tools.readWorkspaceFile({ path: "README.md", offset: 99 }, signal)).rejects.toThrow(
      "超出文件总行数",
    )
  })

  it("响应已经取消的运行", async () => {
    const rootPath = await createWorkspace()
    const tools = createReadonlyWorkspaceAgentTools({ rootPath })
    const controller = new AbortController()
    controller.abort()

    await expect(tools.listWorkspaceFiles({}, controller.signal)).rejects.toThrow("已停止")
  })

  it("工作区失效时不在错误中暴露根路径", async () => {
    const rootPath = await createWorkspace()
    const tools = createReadonlyWorkspaceAgentTools({ rootPath })
    await rm(rootPath, { recursive: true, force: true })

    try {
      await tools.listWorkspaceFiles({}, new AbortController().signal)
      throw new Error("预期工作区失效错误。")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain("当前工作区不可用")
      expect((error as Error).message).not.toContain(rootPath)
    }
  })
})
