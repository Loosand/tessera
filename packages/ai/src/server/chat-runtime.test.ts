/**
 * [INPUT]: AI SDK UI 工具增量、Markdown 上下文附件、供应商错误与 Tessera 公开流式协议
 * [OUTPUT]: 文档材料边界、工具/引申问题增量裁剪、错误归类脱敏和 Skill 搜索额度策略的回归验证
 * [POS]: Chat/Agent 共用 UIMessageChunk 裁剪边界的单元测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  classifyProviderStreamError,
  isWebSearchMaxUsesExceededError,
  publicChunk,
  safeErrorMessage,
  toUiMessages,
  webSearchMaxUsesForSkill,
} from "./chat-runtime"

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

  it("仅为研究 Skill 提升有界搜索额度", () => {
    expect(webSearchMaxUsesForSkill("research")).toBe(30)
    expect(webSearchMaxUsesForSkill("writing")).toBe(12)
    expect(webSearchMaxUsesForSkill("question-answering")).toBe(12)
    expect(webSearchMaxUsesForSkill(null)).toBe(12)
  })
})
