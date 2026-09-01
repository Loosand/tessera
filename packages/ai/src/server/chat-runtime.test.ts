/**
 * [INPUT]: AI SDK UI 工具增量、Markdown 上下文附件、供应商错误与 Tessera 公开流式协议
 * [OUTPUT]: 文档材料边界、按当前工具集隔离的模型历史投影、工具/引申问题增量裁剪、错误归类与供应商响应凭据剔除、Skill 搜索额度策略的回归验证
 * [POS]: Chat/Agent 共用 UIMessageChunk 裁剪边界的单元测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskMessage } from "@tessera/contracts"
import { describe, expect, it } from "vitest"
import {
  PublicAgentToolError,
  classifyProviderStreamError,
  isWebSearchMaxUsesExceededError,
  publicChunk,
  safeErrorMessage,
  taskMessagesForModel,
  toUiMessages,
  webSearchMaxUsesForSkill,
} from "./chat-runtime"
import { ContextBudgetExceededError, createTaskContextManifest } from "./context-budget"

describe("Agent 工具公开增量", () => {
  it("保留工具名、相对路径输入与结构化输出", () => {
    expect(
      publicChunk({
        type: "tool-input-available",
        toolCallId: "call-1",
        toolName: "read-workspace-file",
        input: { path: "README.md" },
        providerExecuted: true,
      }),
    ).toEqual({
      type: "tool-input-available",
      toolCallId: "call-1",
      toolName: "read-workspace-file",
      input: { path: "README.md" },
      providerExecuted: true,
    })
    expect(
      publicChunk({
        type: "tool-output-available",
        toolCallId: "call-1",
        output: { path: "README.md", content: "# Tessera" },
        providerExecuted: true,
        preliminary: false,
      }),
    ).toEqual({
      type: "tool-output-available",
      toolCallId: "call-1",
      output: { path: "README.md", content: "# Tessera" },
      providerExecuted: true,
      preliminary: false,
    })
  })

  it("保留类型化引申问题 Data Part", () => {
    expect(
      publicChunk({
        type: "data-follow-up-questions",
        id: "follow-up-request-1",
        data: {
          version: 1,
          questions: [
            { id: "follow-up-1", prompt: "哪些证据值得继续核实？" },
            { id: "follow-up-2", prompt: "这个结论还有哪些例外？" },
          ],
        },
      }),
    ).toEqual({
      type: "data-follow-up-questions",
      id: "follow-up-request-1",
      data: {
        version: 1,
        questions: [
          { id: "follow-up-1", prompt: "哪些证据值得继续核实？" },
          { id: "follow-up-2", prompt: "这个结论还有哪些例外？" },
        ],
      },
    })
  })
})

describe("Chat 运行时边界", () => {
  it("保留 Tessera 自有领域工具的可操作公开错误", () => {
    expect(
      classifyProviderStreamError(
        new PublicAgentToolError("当前运行没有这个来源的可核查正文，请重新读取来源。"),
        "secret",
      ),
    ).toMatchObject({
      code: "runtime",
      message: "当前运行没有这个来源的可核查正文，请重新读取来源。",
      retryable: false,
    })
  })

  it("保留本地上下文预算错误，不降级为供应商失败", () => {
    const manifest = createTaskContextManifest({
      activeToolNames: [],
      instructions: "规则",
      limits: { contextWindow: 4_096, maxInputTokens: 3_000, maxOutputTokens: 1_024 },
      messages: [{ role: "user", content: "证".repeat(4_000) }],
      observedStep: 0,
      policyMaxOutputTokens: 1_024,
    })
    expect(classifyProviderStreamError(new ContextBudgetExceededError(manifest), "secret")).toMatchObject({
      code: "invalid-request",
      message: expect.stringContaining("超过安全输入预算"),
      retryable: false,
    })
  })

  it("把显式 Markdown 附件转换为有边界的模型材料", async () => {
    const content = "# 当前草稿\n\n保留未保存的编辑。"
    const messages = await toUiMessages([
      {
        id: "message-document-context",
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "text/markdown",
            filename: "notes/draft.md",
            url: `data:text/markdown;base64,${Buffer.from(content).toString("base64")}`,
          },
          { type: "text", text: "请继续修改" },
        ],
      },
    ])

    expect(messages[0]?.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining(content),
    })
    expect(messages[0]?.parts[0]).toMatchObject({
      text: expect.stringContaining('"notes/draft.md"'),
    })
  })

  it("把搜索次数耗尽和协议校验失败映射为可操作文案", () => {
    expect(safeErrorMessage(new Error("error_code: max_uses_exceeded"), "secret")).toContain(
      "达到本轮次数上限",
    )
    expect(
      safeErrorMessage(
        new Error("Type validation failed: web_search_tool_result invalid_union secret"),
        "secret",
      ),
    ).toBe("联网搜索服务返回了不兼容的结果格式，请稍后重试，或改用问答模式直接回答。")
    expect(
      isWebSearchMaxUsesExceededError(
        { cause: { message: "web_search_tool_result error_code=max_uses_exceeded" } },
        "secret",
      ),
    ).toBe(true)
  })

  it("隐藏 API Key 与 Authorization Header", () => {
    const message = safeErrorMessage(
      new Error("request failed api-key=secret-key Authorization: Bearer-token"),
      "secret-key",
    )
    expect(message).not.toContain("secret-key")
    expect(message).not.toContain("Bearer-token")
    expect(message).toBe("模型请求失败，请检查供应商配置、模型状态与网络连接。")
  })

  it("在字符串化前从 RetryError 的嵌套异常保留类别与 HTTP 状态", () => {
    expect(
      classifyProviderStreamError(
        {
          name: "AI_RetryError",
          errors: [
            new Error("temporary failure"),
            { statusCode: 429, message: "rate limit: api-key=secret-key" },
          ],
        },
        "secret-key",
      ),
    ).toEqual({
      code: "provider-rate-limit",
      httpStatus: 429,
      message: "供应商当前请求过多或额度暂不可用，请稍后继续。（HTTP 429）",
      phase: "stream",
      retryable: true,
      version: 1,
    })
  })

  it("在运行记录中保留供应商原始错误正文但剔除凭据", () => {
    expect(
      classifyProviderStreamError(
        {
          name: "AI_RetryError",
          errors: [
            {
              name: "AI_APICallError",
              statusCode: 400,
              message: "The `content[].thinking` in the thinking mode must be passed back to the API.",
              responseBody:
                '{"type":"error","error":{"type":"invalid_request_error","message":"thinking must be passed back"},"authorization":"Bearer secret-key","x-api-key":"secret-key"}',
            },
          ],
        },
        "secret-key",
      ),
    ).toEqual({
      code: "invalid-request",
      httpStatus: 400,
      message:
        "供应商拒绝了当前请求。失败或不完整的历史已自动隔离；若重试仍失败，请检查模型与端点配置。（HTTP 400）",
      phase: "stream",
      providerError:
        '{"type":"error","error":{"type":"invalid_request_error","message":"thinking must be passed back"},"authorization":"Bearer [已隐藏]","x-api-key":"[已隐藏]"}',
      retryable: false,
      version: 1,
    })
  })

  it("把 402 映射为不会无效重试的余额错误", () => {
    expect(
      classifyProviderStreamError(
        { statusCode: 402, message: "Insufficient Balance: api-key=secret-key" },
        "secret-key",
      ),
    ).toEqual({
      code: "provider-config",
      httpStatus: 402,
      message: "供应商账户余额不足，请充值，或切换到其他可用连接或模型。（HTTP 402）",
      phase: "stream",
      retryable: false,
      version: 1,
    })
  })

  it("历史助手轮次只向模型重放可见正文", () => {
    const messages: TaskMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "查资料" }] },
      {
        id: "assistant-complete",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "内部思考", state: "done" },
          { type: "step-start" },
          {
            type: "tool-web-search",
            toolCallId: "search-1",
            state: "output-available",
            input: { query: "Tessera" },
            output: { result: "结果" },
            providerExecuted: true,
          },
          { type: "text", text: "这是已完成的结论。" },
        ],
      },
      { id: "user-2", role: "user", parts: [{ type: "text", text: "继续" }] },
      {
        id: "assistant-failed",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "未完成思考", state: "streaming" },
          {
            type: "tool-web-search",
            toolCallId: "search-2",
            state: "input-available",
            input: { query: "more" },
            providerExecuted: true,
          },
          {
            type: "data-task-error",
            data: { code: "invalid-request", message: "失败", phase: "stream", retryable: false, version: 1 },
          },
        ],
      },
      { id: "user-3", role: "user", parts: [{ type: "text", text: "重试" }] },
    ]

    expect(taskMessagesForModel(messages)).toEqual([
      messages[0],
      {
        id: "assistant-complete",
        role: "assistant",
        parts: [{ type: "text", text: "这是已完成的结论。" }],
      },
      messages[2],
      messages[4],
    ])
    expect(messages[1]?.parts).toHaveLength(4)
  })

  it("显式续跑仅保留已终止的工具结果", () => {
    const continuation: TaskMessage = {
      id: "assistant-continuation",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-read-workspace-file",
          toolCallId: "read-complete",
          state: "output-available",
          input: { path: "README.md" },
          output: { content: "# Tessera" },
        },
        {
          type: "tool-read-workspace-file",
          toolCallId: "read-incomplete",
          state: "input-available",
          input: { path: "draft.md" },
        },
        {
          type: "data-task-error",
          data: { code: "network", message: "断流", phase: "stream", retryable: true, version: 1 },
        },
      ],
    }

    expect(taskMessagesForModel([continuation], continuation.id)).toEqual([
      { ...continuation, parts: continuation.parts.slice(0, 2) },
    ])
  })

  it("旧文件审批保留在可见历史但不会进入新工具集的模型续轮", () => {
    const continuation: TaskMessage = {
      id: "assistant-legacy-approval",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-write-workspace-document",
          toolCallId: "legacy-write",
          state: "approval-responded",
          input: { operation: "update", path: "README.md", content: "旧候选" },
          approval: { id: "legacy-approval", approved: true },
        },
        {
          type: "tool-read",
          toolCallId: "current-read",
          state: "output-available",
          input: { path: "README.md" },
          output: { content: "当前内容" },
        },
      ],
    }

    expect(taskMessagesForModel([continuation], continuation.id, new Set(["read", "edit", "write"]))).toEqual(
      [
        {
          ...continuation,
          parts: [continuation.parts[0], continuation.parts[2]],
        },
      ],
    )
    expect(continuation.parts).toHaveLength(3)
  })

  it("仅为研究 Skill 提升有界搜索额度", () => {
    expect(webSearchMaxUsesForSkill("research")).toBe(30)
    expect(webSearchMaxUsesForSkill("writing")).toBe(12)
    expect(webSearchMaxUsesForSkill("question-answering")).toBe(12)
    expect(webSearchMaxUsesForSkill(null)).toBe(12)
  })
})
