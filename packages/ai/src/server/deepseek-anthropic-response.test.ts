/**
 * [INPUT]: DeepSeek Anthropic 兼容端点的 JSON/SSE Web Search 结果样例
 * [OUTPUT]: 已知错误数组被窄归一化、成功数组不变且分片流可继续解析的回归验证
 * [POS]: DeepSeek Anthropic 响应兼容边界的单元测试
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  createDeepSeekAnthropicFetch,
  normalizeDeepSeekAnthropicPayload,
} from "./deepseek-anthropic-response"

const searchLimitError = {
  type: "web_search_tool_result_error",
  error_code: "max_uses_exceeded",
}

describe("DeepSeek Anthropic 响应兼容", () => {
  it("把 Web Search 单元素错误数组归一化为 Anthropic 规定的错误对象", () => {
    expect(
      normalizeDeepSeekAnthropicPayload({
        type: "content_block_start",
        index: 17,
        content_block: {
          type: "web_search_tool_result",
          tool_use_id: "call-1",
          content: [searchLimitError],
        },
      }),
    ).toEqual({
      type: "content_block_start",
      index: 17,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "call-1",
        content: searchLimitError,
      },
    })
  })

  it("保留正常 Web Search 结果数组", () => {
    const payload = {
      type: "web_search_tool_result",
      tool_use_id: "call-1",
      content: [
        {
          type: "web_search_result",
          url: "https://example.com/celeste",
          title: "Celeste",
          page_age: null,
          encrypted_content: "opaque",
        },
      ],
    }
    expect(normalizeDeepSeekAnthropicPayload(payload)).toEqual(payload)
  })

  it("跨 SSE 网络分片归一化错误结果且保留事件边界", async () => {
    const event = JSON.stringify({
      type: "content_block_start",
      index: 17,
      content_block: {
        type: "web_search_tool_result",
        tool_use_id: "call-1",
        content: [searchLimitError],
      },
    })
    const bytes = new TextEncoder().encode(`event: content_block_start\ndata: ${event}\n\n`)
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 37))
        controller.enqueue(bytes.slice(37))
        controller.close()
      },
    })
    const normalizedFetch = createDeepSeekAnthropicFetch(async () =>
      Promise.resolve(
        new Response(responseBody, {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    )

    const response = await normalizedFetch("https://api.deepseek.com/anthropic/v1/messages")
    const text = await response.text()
    const dataLine = text.split("\n").find((line) => line.startsWith("data: "))
    expect(dataLine).toBeDefined()
    const payload = JSON.parse(dataLine?.slice(6) ?? "{}")
    expect(payload.content_block.content).toEqual(searchLimitError)
    expect(text.endsWith("\n\n")).toBe(true)
  })

  it("同样归一化非流式 JSON 响应", async () => {
    const normalizedFetch = createDeepSeekAnthropicFetch(async () =>
      Promise.resolve(
        Response.json({
          type: "web_search_tool_result",
          tool_use_id: "call-1",
          content: [searchLimitError],
        }),
      ),
    )

    const response = await normalizedFetch("https://api.deepseek.com/anthropic/v1/messages")
    expect(await response.json()).toEqual({
      type: "web_search_tool_result",
      tool_use_id: "call-1",
      content: searchLimitError,
    })
  })
})
