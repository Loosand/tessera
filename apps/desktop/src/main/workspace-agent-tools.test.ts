/**
 * [INPUT]: 临时 Markdown 工作区、read/edit/write/bash 请求、基准 hash、ExecutionEnvironment、提交/命令观察器、并发与 AbortSignal
 * [OUTPUT]: 完整读取许可、精确多段编辑、版本/创建冲突、bash 作用域与变更通知、串行复核和取消的回归验证
 * [POS]: 新工作区四核心的主进程集成测试
 * [DOC]: docs/architecture/agent-file-capabilities.md、docs/architecture/bash-execution-environment.md、docs/architecture/agent-simplification-roadmap.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExecutionEnvironment } from "@tessera/agent-runtime"
import { afterEach, describe, expect, test } from "vitest"
import { applyWorkspaceFileEdits, createWorkspaceAgentTools } from "./workspace-agent-tools"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function createWorkspace(content = "# 标题\n\n第一段。\n\n第二段。\n") {
  const rootPath = await mkdtemp(join(tmpdir(), "tessera-workspace-tools-"))
  temporaryDirectories.push(rootPath)
  await writeFile(join(rootPath, "README.md"), content, "utf8")
  return { rootPath, tools: createWorkspaceAgentTools({ rootPath }) }
}

describe("工作区 read/edit/write/bash 四核心", () => {
  test("read 复用分页、hash 和截断契约", async () => {
    const { tools } = await createWorkspace(
      Array.from({ length: 450 }, (_, index) => `第 ${index + 1} 行`).join("\n"),
    )

    const result = await tools.read({ path: "README.md" }, new AbortController().signal)

    expect(result.contentHash).toMatch(/^[a-f\d]{64}$/u)
    expect(result.range).toEqual({
      startLine: 1,
      endLine: 400,
      totalLines: 450,
      lineByteRange: null,
    })
    expect(result.truncation).toMatchObject({ nextOffset: 401, reason: "lines", truncated: true })
  })

  test("write update 必须在当前运行中读完同一版本的全部分页", async () => {
    const { rootPath, tools } = await createWorkspace(
      Array.from({ length: 450 }, (_, index) => `第 ${index + 1} 行`).join("\n"),
    )
    const first = await tools.read({ path: "README.md" }, new AbortController().signal)
    const input = {
      baseContentHash: first.contentHash,
      content: "# 完整重写\n",
      operation: "update" as const,
      path: "README.md",
    }

    await expect(tools.write(input, new AbortController().signal)).rejects.toThrow("所有分页")
    expect(await readFile(join(rootPath, "README.md"), "utf8")).toContain("第 450 行")

    await tools.read(
      { path: "README.md", offset: first.truncation.nextOffset ?? undefined },
      new AbortController().signal,
    )
    await expect(tools.write(input, new AbortController().signal)).resolves.toMatchObject({
      operation: "update",
      status: "saved",
    })
    expect(await readFile(join(rootPath, "README.md"), "utf8")).toBe("# 完整重写\n")
  })

  test("超长单行必须续读完全部 UTF-8 字节后才能完整重写", async () => {
    const { tools } = await createWorkspace("界".repeat(30_000))
    const first = await tools.read({ path: "README.md" }, new AbortController().signal)
    const input = {
      baseContentHash: first.contentHash,
      content: "# 已完整读取\n",
      operation: "update" as const,
      path: "README.md",
    }

    await expect(tools.write(input, new AbortController().signal)).rejects.toThrow("所有分页")
    const second = await tools.read(
      {
        path: "README.md",
        offset: first.truncation.nextOffset ?? undefined,
        lineByteOffset: first.truncation.nextLineByteOffset ?? undefined,
      },
      new AbortController().signal,
    )
    expect(second.truncation.truncated).toBe(false)
    await expect(tools.write(input, new AbortController().signal)).resolves.toMatchObject({
      operation: "update",
      status: "saved",
    })
  })

  test("一次 edit 基于同一原始版本修改多个不重叠位置", async () => {
    const { rootPath, tools } = await createWorkspace()
    const base = await tools.read({ path: "README.md" }, new AbortController().signal)

    const result = await tools.edit(
      {
        baseContentHash: base.contentHash,
        path: "README.md",
        edits: [
          { oldText: "# 标题", newText: "# 新标题" },
          { oldText: "第二段。", newText: "替换后的第二段。" },
        ],
      },
      new AbortController().signal,
    )

    expect(result).toMatchObject({ operation: "edit", path: "README.md", status: "saved" })
    expect(await readFile(join(rootPath, "README.md"), "utf8")).toBe(
      "# 新标题\n\n第一段。\n\n替换后的第二段。\n",
    )
  })

  test("edit 保留 UTF-8 BOM 与 CRLF，并允许模型使用 LF oldText", async () => {
    const { rootPath, tools } = await createWorkspace("\uFEFF# 标题\r\n\r\n旧内容。\r\n")
    const base = await tools.read({ path: "README.md" }, new AbortController().signal)

    await expect(
      tools.edit(
        {
          baseContentHash: base.contentHash,
          path: "README.md",
          edits: [{ oldText: "# 标题\n\n旧内容。", newText: "# 标题\n\n新内容。" }],
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: "saved" })
    expect(await readFile(join(rootPath, "README.md"), "utf8")).toBe("\uFEFF# 标题\r\n\r\n新内容。\r\n")
  })

  test("拒绝不存在、非唯一和重叠的精确编辑", () => {
    expect(() =>
      applyWorkspaceFileEdits("重复 重复", [{ oldText: "重复", newText: "唯一" }], "README.md"),
    ).toThrow("不是唯一匹配")
    expect(() =>
      applyWorkspaceFileEdits("原始内容", [{ oldText: "缺失", newText: "替换" }], "README.md"),
    ).toThrow("不存在")
    expect(() =>
      applyWorkspaceFileEdits(
        "abcdef",
        [
          { oldText: "abcd", newText: "A" },
          { oldText: "cdef", newText: "B" },
        ],
        "README.md",
      ),
    ).toThrow("不能重叠")
  })

  test("edit/write update 在外部版本变化时返回 conflict", async () => {
    const { rootPath, tools } = await createWorkspace()
    const base = await tools.read({ path: "README.md" }, new AbortController().signal)
    await writeFile(join(rootPath, "README.md"), "# 外部版本\n", "utf8")

    await expect(
      tools.edit(
        {
          baseContentHash: base.contentHash,
          path: "README.md",
          edits: [{ oldText: "# 标题", newText: "# Agent 版本" }],
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: "conflict" })
    await expect(
      tools.write(
        {
          baseContentHash: base.contentHash,
          content: "# 完整候选\n",
          operation: "update",
          path: "README.md",
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: "conflict" })
    expect(await readFile(join(rootPath, "README.md"), "utf8")).toBe("# 外部版本\n")
  })

  test("write create 不覆盖已有文件，创建后可按新 hash 更新", async () => {
    const { rootPath, tools } = await createWorkspace()

    await expect(
      tools.write(
        { content: "# 不覆盖\n", operation: "create", path: "README.md" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: "conflict" })
    const created = await tools.write(
      { content: "# 新文档\n", operation: "create", path: "notes.md" },
      new AbortController().signal,
    )
    expect(created).toMatchObject({ operation: "create", path: "notes.md", status: "saved" })
    if (created.status !== "saved") throw new Error("预期创建成功。")

    await expect(
      tools.write(
        {
          baseContentHash: created.contentHash,
          content: "# 更新文档\n",
          operation: "update",
          path: "notes.md",
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ operation: "update", status: "saved" })
    expect(await readFile(join(rootPath, "notes.md"), "utf8")).toBe("# 更新文档\n")
  })

  test("同一基准的并发 edit 串行复核，恰好一次提交", async () => {
    const { rootPath, tools } = await createWorkspace()
    const base = await tools.read({ path: "README.md" }, new AbortController().signal)

    const results = await Promise.all(
      ["候选 A", "候选 B"].map((title) =>
        tools.edit(
          {
            baseContentHash: base.contentHash,
            path: "README.md",
            edits: [{ oldText: "标题", newText: title }],
          },
          new AbortController().signal,
        ),
      ),
    )

    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "saved"])
    expect(["# 候选 A\n\n第一段。\n\n第二段。\n", "# 候选 B\n\n第一段。\n\n第二段。\n"]).toContain(
      await readFile(join(rootPath, "README.md"), "utf8"),
    )
  })

  test("已取消请求不会提交文件副作用", async () => {
    const { rootPath, tools } = await createWorkspace()
    const base = await tools.read({ path: "README.md" }, new AbortController().signal)
    const controller = new AbortController()
    controller.abort()

    await expect(
      tools.edit(
        {
          baseContentHash: base.contentHash,
          path: "README.md",
          edits: [{ oldText: "标题", newText: "不会提交" }],
        },
        controller.signal,
      ),
    ).rejects.toThrow("已停止")
    expect(await readFile(join(rootPath, "README.md"), "utf8")).toBe(base.content)
  })

  test("只通知成功提交，观察器失败不把已保存文件伪装成失败", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "tessera-workspace-tools-"))
    temporaryDirectories.push(rootPath)
    const notifications: string[] = []
    const tools = createWorkspaceAgentTools({
      rootPath,
      onMutation: async (result) => {
        notifications.push(`${result.operation}:${result.path}`)
        throw new Error("模拟 Artifact 登记失败")
      },
    })

    await expect(
      tools.write(
        { content: "# 已提交\n", operation: "create", path: "created.md" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: "saved" })
    await expect(
      tools.write(
        { content: "# 不覆盖\n", operation: "create", path: "created.md" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: "conflict" })
    expect(notifications).toEqual(["create:created.md"])
    expect(await readFile(join(rootPath, "created.md"), "utf8")).toBe("# 已提交\n")
  })

  test("bash 由 ExecutionEnvironment 执行，并在结果返回前通知真实文件事件", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "tessera-workspace-tools-"))
    temporaryDirectories.push(rootPath)
    const calls: string[] = []
    const executionEnvironment: ExecutionEnvironment = {
      descriptor: {
        id: "test",
        isolation: "test",
        network: "denied",
        secrets: "cleared",
      },
      execute: async (input, access) => {
        calls.push(`${access}:${input.command}`)
        return {
          access,
          changedFiles: ["artifact.md"],
          changesTruncated: false,
          durationMs: 1,
          exitCode: 0,
          signal: null,
          stderr: "",
          stderrTruncated: false,
          stdout: "ok",
          stdoutTruncated: false,
          termination: "exit",
        }
      },
    }
    const observed: string[][] = []
    const tools = createWorkspaceAgentTools({
      executionEnvironment,
      rootPath,
      onCommandFilesChanged: async (paths) => {
        observed.push([...paths])
        throw new Error("模拟 Artifact 登记失败")
      },
    })

    if (!tools.bash) throw new Error("预期 ExecutionEnvironment 注册 bash。")
    await expect(
      tools.bash({ command: "printf ok" }, "read-write", new AbortController().signal),
    ).resolves.toMatchObject({ stdout: "ok", changedFiles: ["artifact.md"] })
    expect(calls).toEqual(["read-write:printf ok"])
    expect(observed).toEqual([["artifact.md"]])
  })
})
