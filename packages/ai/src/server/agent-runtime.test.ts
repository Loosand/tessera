/**
 * [INPUT]: 工作区文档写入输入 Schema、请求相关性、外部 MCP 工具、研究阶段文本、联网搜索预算耗尽与 AI SDK Schema/审批适配
 * [OUTPUT]: DeepSeek 等供应商可接受的根对象 Schema、工作区能力相关性、create/update 条件校验、研究草稿隐藏、搜索预算工具错误续答和 MCP 强制审批回归
 * [POS]: @tessera/ai/server 工作区 Agent 工具协议单元测试
 * [DOC]: docs/architecture/mcp.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { zodSchema } from "ai"
import { describe, expect, it } from "vitest"
import {
  canCompleteAfterWebSearchBudget,
  createExternalAgentToolSet,
  shouldHideResearchDraftText,
  webSearchBudgetToolErrorChunk,
  workspaceAccessRelevant,
  workspaceDocumentChangeInputSchema,
} from "./agent-runtime"

const validBaseContentHash = "a".repeat(64)

describe("工作区工具相关性", () => {
  it("公开网页问题不因为任务绑定工作区就暴露本地工具", () => {
    expect(
      workspaceAccessRelevant([
        {
          id: "user-public",
          role: "user",
          parts: [{ type: "text", text: "《贵族生活》有哪些歌，双方分别负责什么？" }],
        },
      ]),
    ).toBe(false)
  })

  it("明确工作区请求、Markdown 附件和承接本地工具结果时保持授权", () => {
    expect(
      workspaceAccessRelevant([
        {
          id: "user-workspace",
          role: "user",
          parts: [{ type: "text", text: "请检查工作区里的研究文档" }],
        },
      ]),
    ).toBe(true)
    expect(
      workspaceAccessRelevant(
        [
          {
            id: "user-follow-up",
            role: "user",
            parts: [{ type: "text", text: "继续说明第二点" }],
          },
        ],
        "notes/research.md",
      ),
    ).toBe(true)
    expect(
      workspaceAccessRelevant([
        {
          id: "user-first",
          role: "user",
          parts: [{ type: "text", text: "检查本地材料" }],
        },
        {
          id: "assistant-read",
          role: "assistant",
          parts: [
            {
              type: "tool-read-workspace-file",
              toolCallId: "read-1",
              state: "output-available",
              input: { path: "notes/research.md" },
              output: { content: "证据" },
            },
          ],
        },
        {
          id: "user-follow-up",
          role: "user",
          parts: [{ type: "text", text: "那第二点呢？" }],
        },
      ]),
    ).toBe(true)
  })
})

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

describe("外部 MCP Agent 工具", () => {
  it("不论服务器 annotations 都固定要求人工审批", () => {
    const tools = createExternalAgentToolSet(
      [
        {
          id: "mcp__test__search",
          title: "Test / search",
          description: "搜索外部数据",
          inputSchema: { type: "object", properties: {} },
          execute: async () => ({ ok: true }),
        },
      ],
      new AbortController().signal,
    )

    expect(tools.mcp__test__search?.needsApproval).toBe(true)
  })
})

describe("研究最终答复边界", () => {
  it("完成检查前隐藏模型进度旁白，通过后才公开最终正文", () => {
    expect(shouldHideResearchDraftText("text-delta", null)).toBe(true)
    expect(shouldHideResearchDraftText("reasoning-delta", null)).toBe(false)
    expect(shouldHideResearchDraftText("text-delta", "complete")).toBe(false)
    expect(shouldHideResearchDraftText("text-delta", "partial")).toBe(false)
  })
})

describe("联网搜索预算耗尽", () => {
  it("降级为标准工具错误，并在预算后正文完整结束时允许正常完成", () => {
    expect(webSearchBudgetToolErrorChunk("search-6")).toMatchObject({
      type: "tool-output-error",
      toolCallId: "search-6",
      providerExecuted: true,
      failure: {
        code: "execution",
        retryable: false,
        toolCallId: "search-6",
        toolName: "web_search",
      },
    })
    expect(canCompleteAfterWebSearchBudget("使用已有五次搜索结果完成的答案。", true)).toBe(true)
    expect(canCompleteAfterWebSearchBudget("未完成", false)).toBe(false)
    expect(canCompleteAfterWebSearchBudget("   ", true)).toBe(false)
  })
})
