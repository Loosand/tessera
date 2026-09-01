/**
 * [INPUT]: 临时 Markdown 工作区、越界/符号链接路径、有界 read 与带预期版本的底层写调用
 * [OUTPUT]: 文件类型、路径逃逸、体积、分页/单行续读、提交前版本复核与 Abort 的回归验证
 * [POS]: 主进程 Agent Markdown read 和文件安全原语的单元测试
 * [DOC]: docs/architecture/agent-file-capabilities.md、docs/architecture/bash-execution-environment.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  AgentFileConflictError,
  readWorkspaceAgentFile,
  writeAgentMarkdownFile,
} from "./read-only-agent-tools"

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

describe("Agent 工作区 Markdown read", () => {
  it("拒绝目录穿越、工作区外符号链接和超大文件", async () => {
    const rootPath = await createWorkspace()
    const outsidePath = await mkdtemp(join(tmpdir(), "tessera-agent-outside-"))
    temporaryDirectories.push(outsidePath)
    await writeFile(join(outsidePath, "secret.md"), "不能读取")
    await symlink(join(outsidePath, "secret.md"), join(rootPath, "linked.md"))
    await writeFile(join(rootPath, "large.md"), "x".repeat(256 * 1024 + 1))
    const signal = new AbortController().signal

    await expect(readWorkspaceAgentFile(rootPath, { path: "../secret.md" }, signal)).rejects.toThrow(
      "工作区内可见的相对路径",
    )
    await expect(
      readWorkspaceAgentFile(rootPath, { path: join(outsidePath, "secret.md") }, signal),
    ).rejects.toThrow("工作区内可见的相对路径")
    await expect(readWorkspaceAgentFile(rootPath, { path: "linked.md" }, signal)).rejects.toThrow(
      "扩大访问范围",
    )
    await expect(readWorkspaceAgentFile(rootPath, { path: "large.md" }, signal)).rejects.toThrow("256 KiB")
    await expect(readWorkspaceAgentFile(rootPath, { path: "notes/ignored.txt" }, signal)).rejects.toThrow(
      "只能读取 Markdown",
    )
  })

  it("按行分页读取并为后续内容返回 nextOffset", async () => {
    const rootPath = await createWorkspace()
    await writeFile(
      join(rootPath, "long.md"),
      Array.from({ length: 450 }, (_, index) => `第 ${index + 1} 行`).join("\n"),
    )
    const signal = new AbortController().signal

    const firstPage = await readWorkspaceAgentFile(rootPath, { path: "long.md" }, signal)
    expect(firstPage.range).toEqual({
      startLine: 1,
      endLine: 400,
      totalLines: 450,
      lineByteRange: null,
    })
    expect(firstPage.truncation).toMatchObject({
      truncated: true,
      reason: "lines",
      nextOffset: 401,
      lineTruncated: false,
    })
    expect(firstPage.content).toContain("第 400 行")
    expect(firstPage.content).not.toContain("第 401 行")

    const secondPage = await readWorkspaceAgentFile(
      rootPath,
      { path: "long.md", offset: firstPage.truncation.nextOffset ?? undefined },
      signal,
    )
    expect(secondPage.range).toEqual({
      startLine: 401,
      endLine: 450,
      totalLines: 450,
      lineByteRange: null,
    })
    expect(secondPage.truncation).toMatchObject({ truncated: false, nextOffset: null })
  })

  it("即使 Markdown 单行异常过长也不让工具结果超过字节预算", async () => {
    const rootPath = await createWorkspace()
    const original = "界".repeat(30_000)
    await writeFile(join(rootPath, "single-line.md"), original)
    const first = await readWorkspaceAgentFile(
      rootPath,
      { path: "single-line.md" },
      new AbortController().signal,
    )

    expect(Buffer.byteLength(first.content, "utf8")).toBeLessThanOrEqual(50 * 1024)
    expect(first.range.lineByteRange).toMatchObject({ startByte: 0, totalBytes: 90_000 })
    expect(first.truncation).toMatchObject({
      truncated: true,
      reason: "bytes",
      lineTruncated: true,
      nextOffset: 1,
    })
    expect(first.truncation.nextLineByteOffset).toBe(first.range.lineByteRange?.endByte)

    const second = await readWorkspaceAgentFile(
      rootPath,
      {
        path: "single-line.md",
        offset: first.truncation.nextOffset ?? undefined,
        lineByteOffset: first.truncation.nextLineByteOffset ?? undefined,
      },
      new AbortController().signal,
    )
    expect(second.range.lineByteRange).toMatchObject({
      startByte: first.truncation.nextLineByteOffset,
      endByte: 90_000,
      totalBytes: 90_000,
    })
    expect(second.truncation).toMatchObject({
      truncated: false,
      lineTruncated: false,
      nextLineByteOffset: null,
      nextOffset: null,
    })
    expect(first.content + second.content).toBe(original)
  })

  it("在主进程边界拒绝非法读取范围", async () => {
    const rootPath = await createWorkspace()
    const signal = new AbortController().signal

    await expect(readWorkspaceAgentFile(rootPath, { path: "README.md", offset: 0 }, signal)).rejects.toThrow(
      "从 1 开始",
    )
    await expect(
      readWorkspaceAgentFile(rootPath, { path: "README.md", limit: 1_001 }, signal),
    ).rejects.toThrow("1 到 1000")
    await expect(readWorkspaceAgentFile(rootPath, { path: "README.md", offset: 99 }, signal)).rejects.toThrow(
      "超出文件总行数",
    )
    await expect(
      readWorkspaceAgentFile(rootPath, { path: "README.md", lineByteOffset: 1 }, signal),
    ).rejects.toThrow("必须同时提供")
    await writeFile(join(rootPath, "multibyte.md"), "界界")
    await expect(
      readWorkspaceAgentFile(rootPath, { path: "multibyte.md", offset: 1, lineByteOffset: 1 }, signal),
    ).rejects.toThrow("UTF-8 字节边界")
  })

  it("底层原子写在提交前复核预期版本，不覆盖已经变化的文件", async () => {
    const rootPath = await createWorkspace()
    const signal = new AbortController().signal
    const base = await readWorkspaceAgentFile(rootPath, { path: "README.md" }, signal)
    await writeFile(join(rootPath, "README.md"), "# 外部版本\n", "utf8")

    await expect(
      writeAgentMarkdownFile(rootPath, "README.md", "# Agent 候选\n", "update", {
        expectedContentHash: base.contentHash,
        signal,
      }),
    ).rejects.toBeInstanceOf(AgentFileConflictError)
    expect(await readFile(join(rootPath, "README.md"), "utf8")).toBe("# 外部版本\n")
  })

  it("响应已经取消的运行", async () => {
    const rootPath = await createWorkspace()
    const controller = new AbortController()
    controller.abort()

    await expect(readWorkspaceAgentFile(rootPath, { path: "README.md" }, controller.signal)).rejects.toThrow(
      "已停止",
    )
  })

  it("工作区失效时不在错误中暴露根路径", async () => {
    const rootPath = await createWorkspace()
    await rm(rootPath, { recursive: true, force: true })

    try {
      await readWorkspaceAgentFile(rootPath, { path: "README.md" }, new AbortController().signal)
      throw new Error("预期工作区失效错误。")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain("当前工作区不可用")
      expect((error as Error).message).not.toContain(rootPath)
    }
  })
})
