/**
 * [INPUT]: 工作区文档写入输入 Schema 与 AI SDK 的 Zod 到 JSON Schema 转换
 * [OUTPUT]: DeepSeek 等供应商可接受的根对象 Schema 和 create/update 条件校验回归
 * [POS]: @tessera/ai/server 工作区 Agent 工具协议单元测试
 * [DOC]: docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { zodSchema } from "ai"
import { describe, expect, it } from "vitest"
import { workspaceDocumentChangeInputSchema } from "./agent-runtime"

const validBaseContentHash = "a".repeat(64)

describe("工作区 Agent 写入工具 Schema", () => {
  it("向供应商发送顶层 type 为 object 的 JSON Schema", async () => {
    const jsonSchema = await zodSchema(workspaceDocumentChangeInputSchema).jsonSchema

    expect(jsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["operation", "path", "content", "reason"],
    })
    expect(jsonSchema.properties).toMatchObject({
      operation: { type: "string", enum: ["create", "update"] },
    })
  })

  it("仅在 update 操作中强制要求读取时的基准版本", () => {
    expect(
      workspaceDocumentChangeInputSchema.safeParse({
        operation: "create",
        path: "draft.md",
        content: "# Draft",
        reason: "创建初稿",
      }).success,
    ).toBe(true)
    expect(
      workspaceDocumentChangeInputSchema.safeParse({
        operation: "update",
        path: "README.md",
        content: "# Updated",
        reason: "更新说明",
      }).success,
    ).toBe(false)
    expect(
      workspaceDocumentChangeInputSchema.safeParse({
        operation: "update",
        path: "README.md",
        content: "# Updated",
        reason: "更新说明",
        baseModifiedAt: 1,
        baseContentHash: validBaseContentHash,
      }).success,
    ).toBe(true)
  })
})
