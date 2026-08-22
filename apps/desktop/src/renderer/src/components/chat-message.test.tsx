/**
 * [INPUT]: 同一 Agent 消息内复用 provider reasoning ID 的多步骤 Part，以及缺失/存在摘要的 reasoning Part
 * [OUTPUT]: 每个消息 Part 都获得稳定且唯一 React key，并正确聚合空 reasoning 阶段、保留搜索轨迹与真实正文的回归验证
 * [POS]: chat-message 多步骤流式协调的单元测试
 * [DOC]: docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ChatMessage, chatMessagePartKey, shouldRenderReasoningBody } from "./chat-message"

describe("ChatMessage Part key", () => {
  it("provider 在多个 Agent 步骤复用 reasoning ID 时仍保持唯一", () => {
    const providerReasoningIds = ["reasoning-0", "reasoning-0", "reasoning-0", "reasoning-0"]
    const keys = providerReasoningIds.map((_id, index) => chatMessagePartKey("assistant-1", index))

    expect(new Set(keys).size).toBe(providerReasoningIds.length)
    expect(keys).toEqual([
      "assistant-1-part-0",
      "assistant-1-part-1",
      "assistant-1-part-2",
      "assistant-1-part-3",
    ])
  })
})

describe("ChatMessage reasoning 正文可见性", () => {
  it("只有供应商返回真实文本时才呈现 reasoning 正文", () => {
    expect(shouldRenderReasoningBody({ text: "" })).toBe(false)
    expect(shouldRenderReasoningBody({ text: "   " })).toBe(false)
    expect(shouldRenderReasoningBody({ text: "可展示的推理摘要" })).toBe(true)
  })

  it("把同一回复中的多个空 reasoning 生命周期折叠为一个阶段并保留搜索明细", () => {
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "", state: "done" },
        {
          type: "tool-web_search",
          toolCallId: "search-1",
          state: "output-available",
          input: {},
          output: { action: { type: "search", queries: ["Celeste Madeline character"] } },
        },
        { type: "reasoning", text: "", state: "done" },
        {
          type: "tool-web_search",
          toolCallId: "search-2",
          state: "output-available",
          input: {},
          output: {
            action: {
              type: "openPage",
              url: "https://example.com/madeline#ws_call_id=internal",
            },
          },
        },
        { type: "reasoning", text: "", state: "done" },
        { type: "text", text: "最终回答", state: "done" },
      ],
    } as UIMessage

    const markup = renderToStaticMarkup(
      <ChatMessage isLast message={message} onRegenerate={() => undefined} running={false} />,
    )

    expect(markup.match(/思考完成/gu)).toHaveLength(1)
    expect(markup).toContain("Celeste Madeline character")
    expect(markup).toContain("example.com")
    expect(markup).toContain("最终回答")
  })

  it("在部分回复后呈现持久化失败原因与重试入口", () => {
    const message = {
      id: "assistant-failed",
      role: "assistant",
      parts: [
        { type: "text", text: "已经生成的部分。", state: "done" },
        {
          type: "data-task-error",
          data: { message: "供应商连接中断，请稍后重试。", retryable: true },
        },
      ],
    } as UIMessage

    const markup = renderToStaticMarkup(
      <ChatMessage isLast message={message} onRegenerate={() => undefined} running={false} />,
    )

    expect(markup).toContain("已经生成的部分。")
    expect(markup).toContain("这次生成未完成")
    expect(markup).toContain("供应商连接中断，请稍后重试。")
    expect(markup).toContain("重试")
  })
})
