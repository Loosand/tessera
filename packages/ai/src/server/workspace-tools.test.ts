/**
 * [INPUT]: WorkspaceAgentTools 假实现、read/edit/write/bash Schema、RunPolicy 工具作用域与 AI SDK 适配
 * [OUTPUT]: 四核心工具名称、严格版本/命令条件、bash 读写级别和无逐次审批回归验证
 * [POS]: 工作区四核心 AI SDK 窄适配层的单元测试
 * [DOC]: docs/architecture/agent-file-capabilities.md、docs/architecture/bash-execution-environment.md、docs/architecture/agent-simplification-roadmap.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { WorkspaceAgentTools } from "@tessera/agent-runtime"
import { zodSchema } from "ai"
import { describe, expect, test } from "vitest"
import {
  createWorkspaceAiToolSet,
  workspaceBashAccess,
  workspaceBashInputSchema,
  workspaceEditInputSchema,
  workspaceWriteInputSchema,
} from "./workspace-tools"

const validBaseContentHash = "a".repeat(64)

function workspaceTools(): WorkspaceAgentTools {
  return {
    bash: async (_input, access) => ({
      access,
      changedFiles: [],
      changesTruncated: false,
      durationMs: 1,
      exitCode: 0,
      signal: null,
      stderr: "",
      stderrTruncated: false,
      stdout: "ok",
      stdoutTruncated: false,
      termination: "exit",
    }),
    edit: async () => ({
      contentHash: validBaseContentHash,
      modifiedAt: 1,
      operation: "edit",
      path: "README.md",
      status: "saved",
    }),
    read: async () => ({
      content: "# README",
      contentHash: validBaseContentHash,
      modifiedAt: 1,
      path: "README.md",
      range: { endLine: 1, lineByteRange: null, startLine: 1, totalLines: 1 },
      size: 8,
      truncation: {
        lineTruncated: false,
        maxBytes: 50 * 1024,
        nextLineByteOffset: null,
        nextOffset: null,
        reason: null,
        truncated: false,
      },
    }),
    write: async ({ operation, path }) => ({
      contentHash: validBaseContentHash,
      modifiedAt: 1,
      operation,
      path,
      status: "saved",
    }),
  }
}

describe("工作区 AI SDK 工具适配", () => {
  test("新运行只注册 read/edit/write/bash 四个工作区核心工具", () => {
    const tools = createWorkspaceAiToolSet(workspaceTools(), new AbortController().signal, "workspace-write")

    expect(Object.keys(tools.readTools).sort()).toEqual(["bash", "read"])
    expect(Object.keys(tools.writeTools).sort()).toEqual(["edit", "write"])
    expect(tools.readTools.bash?.needsApproval).toBeUndefined()
    expect(tools.writeTools.edit?.needsApproval).toBeUndefined()
    expect(tools.writeTools.write?.needsApproval).toBeUndefined()
  })

  test("edit、write 和 bash 向供应商发送顶层 object Schema", async () => {
    const [editSchema, writeSchema, bashSchema] = await Promise.all([
      zodSchema(workspaceEditInputSchema).jsonSchema,
      zodSchema(workspaceWriteInputSchema).jsonSchema,
      zodSchema(workspaceBashInputSchema).jsonSchema,
    ])

    expect(editSchema).toMatchObject({
      additionalProperties: false,
      required: ["path", "baseContentHash", "edits"],
      type: "object",
    })
    expect(writeSchema).toMatchObject({
      additionalProperties: false,
      required: ["operation", "path", "content"],
      type: "object",
    })
    expect(bashSchema).toMatchObject({
      additionalProperties: false,
      required: ["command"],
      type: "object",
    })
  })

  test("问答作用域的 bash 只读，其他工作区运行可读写", () => {
    expect(workspaceBashAccess("workspace-read")).toBe("read-only")
    expect(workspaceBashAccess("workspace-write")).toBe("read-write")
    expect(workspaceBashAccess("conversation")).toBe("read-only")
  })

  test("write create 禁止 hash，update 强制 hash", () => {
    expect(
      workspaceWriteInputSchema.safeParse({
        operation: "create",
        path: "draft.md",
        content: "# Draft",
      }).success,
    ).toBe(true)
    expect(
      workspaceWriteInputSchema.safeParse({
        operation: "create",
        path: "draft.md",
        content: "# Draft",
        baseContentHash: validBaseContentHash,
      }).success,
    ).toBe(false)
    expect(
      workspaceWriteInputSchema.safeParse({
        operation: "update",
        path: "README.md",
        content: "# Updated",
      }).success,
    ).toBe(false)
    expect(
      workspaceWriteInputSchema.safeParse({
        operation: "update",
        path: "README.md",
        content: "# Updated",
        baseContentHash: validBaseContentHash,
      }).success,
    ).toBe(true)
  })
})
