/**
 * [INPUT]: 合法、损坏与过期的 AI 流事件 JSON
 * [OUTPUT]: 持久化恢复边界中正文、运行失败与工具失败的字段级校验回归保障
 * [POS]: AI 流事件运行时守卫单元测试
 * [DOC]: docs/architecture/database.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { isAiChatStreamChunk, parseAiChatStreamEvent } from "./ai-chat-event"

describe("AI chat persisted events", () => {
  it("接受可恢复的增量文本事件", () => {
    const event = parseAiChatStreamEvent(
      JSON.stringify({
        chunk: { type: "text-delta", id: "text-1", delta: "你好" },
        requestId: "request-1",
        sequence: 3,
        taskId: "task-1",
      }),
    )

    expect(event.chunk).toEqual({ type: "text-delta", id: "text-1", delta: "你好" })
  })

  it("保留工具输入和输出中的未知结构", () => {
    expect(
      isAiChatStreamChunk({
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "web_search",
        input: { query: "Tessera" },
      }),
    ).toBe(true)
    expect(
      isAiChatStreamChunk({
        type: "tool-output-available",
        toolCallId: "tool-1",
        output: [{ url: "https://example.com" }],
      }),
    ).toBe(true)
  })

  it("接受版本化运行失败并兼容旧的纯文本错误事件", () => {
    expect(
      isAiChatStreamChunk({
        type: "error",
        errorText: "请求受限，请稍后重试。",
        failure: {
          code: "provider-rate-limit",
          message: "请求受限，请稍后重试。",
          phase: "stream",
          retryable: true,
          version: 1,
        },
      }),
    ).toBe(true)
    expect(isAiChatStreamChunk({ type: "error", errorText: "旧版错误" })).toBe(true)
    expect(
      isAiChatStreamChunk({
        type: "error",
        errorText: "损坏错误",
        failure: { code: "future-code", retryable: true },
      }),
    ).toBe(false)
  })

  it("接受带调用关联的版本化工具失败并拒绝未知错误码", () => {
    expect(
      isAiChatStreamChunk({
        type: "tool-output-error",
        toolCallId: "tool-read",
        errorText: "连接超时。",
        failure: {
          code: "timeout",
          message: "连接超时。",
          retryable: true,
          toolCallId: "tool-read",
          toolName: "read-web-source",
          version: 1,
        },
      }),
    ).toBe(true)
    expect(
      isAiChatStreamChunk({
        type: "tool-output-error",
        toolCallId: "tool-read",
        errorText: "损坏工具错误",
        failure: { code: "future-tool-code", retryable: true },
      }),
    ).toBe(false)
  })

  it("拒绝缺字段、未知类型与非法序号", () => {
    expect(() =>
      parseAiChatStreamEvent(
        JSON.stringify({
          chunk: { type: "text-delta", id: "text-1" },
          requestId: "request-1",
          sequence: 1,
          taskId: "task-1",
        }),
      ),
    ).toThrow("持久化的 AI 流事件格式无效")
    expect(isAiChatStreamChunk({ type: "future-event" })).toBe(false)
    expect(() =>
      parseAiChatStreamEvent(
        JSON.stringify({
          chunk: { type: "finish", finishReason: "unknown" },
          requestId: "request-1",
          sequence: -1,
          taskId: "task-1",
        }),
      ),
    ).toThrow("持久化的 AI 流事件格式无效")
  })
})
