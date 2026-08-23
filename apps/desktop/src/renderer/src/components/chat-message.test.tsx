/**
 * [INPUT]: 同一 Agent 消息内复用 provider reasoning ID 的多步骤 Part、缺失/存在摘要的 reasoning Part，以及结构化研究/引申问题结果
 * [OUTPUT]: 每个消息 Part 都获得稳定且唯一 React key，并正确聚合空 reasoning 阶段、保留搜索轨迹、研究笔记/来源操作、真实正文与可点击引申问题的回归验证
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

  it("完成消息只用图标提供按需运行解释入口", () => {
    const message = {
      id: "assistant-run",
      role: "assistant",
      metadata: { requestId: "run-1" },
      parts: [{ type: "text", text: "完成。", state: "done" }],
    } as UIMessage

    const markup = renderToStaticMarkup(
      <ChatMessage
        isLast
        message={message}
        onReadTaskRun={async () => null}
        onRegenerate={() => undefined}
        running={false}
      />,
    )

    expect(markup).toContain('aria-label="查看本次运行信息"')
    expect(markup).not.toContain("实际模型")
    expect(markup).not.toContain("工作区读写")
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
          data: {
            code: "network",
            message: "供应商连接中断，请稍后重试。",
            phase: "stream",
            retryable: true,
            version: 1,
          },
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

  it("按稳定错误码呈现恢复失败且不提供无效重试", () => {
    const message = {
      id: "assistant-resume-failed",
      role: "assistant",
      parts: [
        {
          type: "data-task-error",
          data: {
            code: "resume-failed",
            message: "恢复检查点已经损坏。",
            phase: "resume",
            retryable: false,
            version: 1,
          },
        },
      ],
    } as UIMessage

    const markup = renderToStaticMarkup(
      <ChatMessage isLast message={message} onRegenerate={() => undefined} running={false} />,
    )

    expect(markup).toContain("无法恢复生成")
    expect(markup).toContain("恢复检查点已经损坏。")
    expect(markup).not.toContain(">重试<")
  })

  it("在回答正文后呈现可选择但不会自行发送的引申问题", () => {
    const message = {
      id: "assistant-follow-up",
      role: "assistant",
      parts: [
        { type: "text", text: "这是最终回答。", state: "done" },
        {
          type: "data-follow-up-questions",
          id: "follow-up-request-1",
          data: {
            version: 1,
            questions: [
              { id: "follow-up-1", prompt: "哪些一手来源最值得继续阅读？" },
              { id: "follow-up-2", prompt: "这个结论在最近两年发生了哪些变化？" },
            ],
          },
        },
      ],
    } as UIMessage

    const markup = renderToStaticMarkup(
      <ChatMessage
        isLast
        message={message}
        onRegenerate={() => undefined}
        onUseFollowUpQuestion={() => undefined}
        running={false}
      />,
    )

    expect(markup).toContain("这是最终回答。")
    expect(markup).toContain('aria-label="继续探索"')
    expect(markup).toContain("哪些一手来源最值得继续阅读？")
    expect(markup).toContain("这个结论在最近两年发生了哪些变化？")
    expect(markup.match(/<button[^>]*\sdisabled=/gu)).toBeNull()
  })

  it("从真实研究工具结果呈现来源推荐，并在推荐前也允许查看增量笔记", () => {
    const message = {
      id: "assistant-research",
      role: "assistant",
      parts: [
        {
          type: "tool-read-web-source",
          toolCallId: "read-1",
          state: "output-available",
          input: { url: "https://example.com/fkj" },
          output: {
            requestId: "run-fkj",
            sourceId: "source-1",
            status: "read",
            finalUrl: "https://example.com/fkj",
            title: "FKJ interview",
          },
        },
      ],
    } as UIMessage
    const beforeCuration = renderToStaticMarkup(
      <ChatMessage
        isLast
        message={message}
        onReadResearchNotebook={async () => null}
        onRegenerate={() => undefined}
        running={false}
      />,
    )
    expect(beforeCuration).toContain("查看研究笔记")

    message.parts.push({
      type: "tool-recommend-research-sources",
      toolCallId: "recommend-1",
      state: "output-available",
      input: { recommendations: [] },
      output: {
        status: "recommended",
        requestId: "run-fkj",
        recommendations: [
          {
            sourceId: "source-1",
            finalUrl: "https://example.com/fkj",
            title: "FKJ interview",
            reason: "一手访谈可支持人物经历与创作方法。",
            saved: false,
          },
        ],
      },
    } as never)
    const curated = renderToStaticMarkup(
      <ChatMessage
        isLast
        message={message}
        onReadResearchNotebook={async () => null}
        onSaveResearchRecommendations={async () => ({
          ok: true,
          artifact: null,
          savedSourceIds: [],
        })}
        onRegenerate={() => undefined}
        running={false}
      />,
    )
    expect(curated).toContain("推荐保存的来源")
    expect(curated).toContain("一手访谈可支持人物经历与创作方法")
    expect(curated).toContain("保存所选来源（1）")
  })
})
