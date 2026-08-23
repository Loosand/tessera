/**
 * [INPUT]: AI SDK 合成搜索工具增量、搜索额度顶层错误、额度后完整正文与尾部供应商错误
 * [OUTPUT]: 统一 Agent 将额度耗尽降级为 Tool Error、保留正文并正常结束的流式回归验证
 * [POS]: @tessera/ai/server 搜索预算兼容恢复的集成测试
 * [DOC]: docs/architecture/ai-providers.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiChatStreamChunk } from "@tessera/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

const runtimeState = vi.hoisted(() => ({
  events: [] as Array<{ chunk: AiChatStreamChunk } | { error: unknown }>,
  webSearchMaxUses: 0,
}))

vi.mock("./ai-sdk-runtime", () => ({
  createAiSdkChatRuntime: (_input: unknown, options: { webSearchMaxUses?: number }) => {
    runtimeState.webSearchMaxUses = options.webSearchMaxUses ?? 0
    return { model: {}, tools: {} }
  },
}))

vi.mock("./task-agent", () => ({
  createTaskAgent: ({ tools }: { tools: unknown }) => ({ tools }),
}))

vi.mock("./follow-up-questions", () => ({
  generateFollowUpQuestions: async () => null,
  mergeFollowUpRunMetrics: (metrics: unknown) => metrics,
}))

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>()
  return {
    ...actual,
    createAgentUIStream: async ({ onError }: { onError: (error: unknown) => string }) => ({
      async *[Symbol.asyncIterator]() {
        for (const event of runtimeState.events) {
          if ("error" in event) {
            yield { type: "error", errorText: onError(event.error) }
          } else {
            yield event.chunk
          }
        }
      },
    }),
  }
})

import { streamAiAgent } from "./agent-runtime"

describe("Agent 联网搜索预算兼容恢复", () => {
  beforeEach(() => {
    runtimeState.events = []
    runtimeState.webSearchMaxUses = 0
  })

  it("额度错误后保留完整正文，并把供应商尾部错误恢复为正常完成", async () => {
    runtimeState.events = [
      { chunk: { type: "start", messageId: "assistant-search-budget" } },
      {
        chunk: {
          type: "tool-input-available",
          toolCallId: "search-13",
          toolName: "web_search",
          input: { query: "最新资料" },
          providerExecuted: true,
        },
      },
      { error: new Error("web_search_tool_result error_code=max_uses_exceeded") },
      { chunk: { type: "text-start", id: "answer" } },
      { chunk: { type: "text-delta", id: "answer", delta: "使用已有结果完成答案。" } },
      { chunk: { type: "text-end", id: "answer" } },
      { error: { message: "Bad request", statusCode: 400 } },
    ]
    const chunks: AiChatStreamChunk[] = []

    await streamAiAgent(
      {
        apiKey: "test-key",
        baseUrl: "https://api.deepseek.com",
        configId: "deepseek",
        endpointType: "anthropic-messages",
        messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "请查最新资料" }] }],
        mode: "agent",
        modelId: "deepseek-v4-flash",
        providerId: "deepseek",
        requestId: "request-search-budget",
        runPolicy: {
          limits: { maxOutputTokens: 4_096, maxSteps: 8, timeoutMs: 120_000 },
          mode: "agent",
          reasoning: "high",
          skillId: null,
          toolScope: "conversation",
          webSearch: true,
        },
        skillId: null,
        taskId: "task-search-budget",
      },
      {
        abortSignal: new AbortController().signal,
        onChunk: async (chunk) => {
          chunks.push(chunk)
        },
      },
    )

    expect(runtimeState.webSearchMaxUses).toBe(12)
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-error",
        toolCallId: "search-13",
        providerExecuted: true,
      }),
    )
    expect(chunks).toContainEqual({ type: "text-delta", id: "answer", delta: "使用已有结果完成答案。" })
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false)
    expect(chunks.at(-1)).toEqual({ type: "finish", finishReason: "stop" })
  })
})
