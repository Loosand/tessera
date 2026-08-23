/**
 * [INPUT]: 用户消息与同一 Agent 消息内复用 provider reasoning ID 的多步骤 Part、正式回答前后的工具/文本、缺失/存在摘要的 reasoning Part，以及结构化研究/引申问题/本地反馈结果
 * [OUTPUT]: 用户/助手共享阅读栏、每个消息 Part 的稳定唯一 React key、“已工作”边界，以及 reasoning、搜索、研究笔记、正文、引申问题与赞踩操作的回归验证
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
import {
  ChatMessage,
  chatMessagePartKey,
  resolveAssistantPartLayout,
  shouldRenderReasoningBody,
} from "./chat-message"

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
  it("把最后一次自动执行及此前说明归入工作过程，并从后续正文开始正式回答", () => {
    const parts = [
      { type: "reasoning", text: "先判断资料范围", state: "done" },
      { type: "text", text: "我先搜索可靠来源。", state: "done" },
      {
        type: "tool-web_search",
        toolCallId: "search-layout",
        state: "output-available",
        input: {},
        output: { action: { type: "search", queries: ["Tessera"] } },
      },
      { type: "text", text: "这是正式回答。", state: "done" },
      {
        type: "data-follow-up-questions",
        id: "follow-up-layout",
        data: {
          version: 1,
          questions: [
            { id: "one", prompt: "继续看架构吗？" },
            { id: "two", prompt: "继续看交互吗？" },
          ],
        },
      },
    ] as UIMessage["parts"]

    expect(resolveAssistantPartLayout(parts)).toEqual({
      answerStartIndex: 3,
      workPartIndexes: [0, 1, 2],
    })
  })

  it("让用户消息与助手正文共享完整阅读栏", () => {
    const message = {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "请继续整理这篇文章。", state: "done" }],
    } as UIMessage

    const markup = renderToStaticMarkup(
      <ChatMessage isLast message={message} onRegenerate={() => undefined} running={false} />,
    )

    expect(markup).toContain('data-message-role="user"')
    expect(markup).toContain("请继续整理这篇文章。")
    expect(markup).toContain("w-full")
  })

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

  it("在完成回复后呈现可撤销的本地赞踩，并恢复已保存的选中态", () => {
    const message = {
      id: "assistant-feedback",
      role: "assistant",
      metadata: {
        requestId: "run-feedback",
        feedback: { rating: "positive", updatedAt: 1_788_000_000_000 },
      },
      parts: [{ type: "text", text: "这是一条有帮助的回复。", state: "done" }],
    } as UIMessage

    const markup = renderToStaticMarkup(
      <ChatMessage
        isLast
        message={message}
        onFeedback={() => undefined}
        onRegenerate={() => undefined}
        running={false}
      />,
    )

    expect(markup).toContain('aria-label="赞：这条回复有帮助"')
    expect(markup).toContain('aria-label="踩：这条回复没有帮助"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain("仅保存在本机")
  })

  it("把同一回复中的空 reasoning 与搜索统一折叠到一个已工作区块", () => {
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
      <ChatMessage
        isLast
        message={message}
        onRegenerate={() => undefined}
        running={false}
        runTiming={{ startedAt: 1_000, completedAt: 146_000 }}
      />,
    )

    expect(markup).toContain("已工作 2m 25s")
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain("Celeste Madeline character")
    expect(markup).not.toContain("example.com")
    expect(markup).toContain("最终回答")
  })

  it("运行期间展开工作过程并保留现有结构化搜索明细", () => {
    const message = {
      id: "assistant-running-search",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "正在判断检索范围。", state: "streaming" },
        {
          type: "tool-web_search",
          toolCallId: "search-running",
          state: "output-available",
          input: {},
          output: {
            action: {
              type: "search",
              queries: ["Celeste Madeline character"],
            },
          },
        },
      ],
    } as UIMessage

    const markup = renderToStaticMarkup(
      <ChatMessage
        isLast
        message={message}
        onRegenerate={() => undefined}
        running
        runTiming={{ startedAt: 1_000, completedAt: null }}
      />,
    )

    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain("正在判断检索范围。")
    expect(markup).toContain("Celeste Madeline character")
    expect(markup).not.toContain("REQUEST")
  })

  it("自动工具在工作过程里只显示可读状态而不暴露原始输入 JSON", () => {
    const message = {
      id: "assistant-running-tool",
      role: "assistant",
      parts: [
        {
          type: "tool-read-workspace-file",
          toolCallId: "read-running",
          state: "output-available",
          input: { path: "notes/research.md", internalMarker: "raw-json-must-stay-hidden" },
          output: { content: "材料正文" },
        },
      ],
    } as UIMessage

    const markup = renderToStaticMarkup(
      <ChatMessage
        isLast
        message={message}
        onRegenerate={() => undefined}
        running
        runTiming={{ startedAt: 1_000, completedAt: null }}
      />,
    )

    expect(markup).toContain("读取工作区文件")
    expect(markup).toContain("notes/research.md")
    expect(markup).not.toContain("raw-json-must-stay-hidden")
    expect(markup).not.toContain("internalMarker")
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
        running
        runTiming={{ startedAt: 1_000, completedAt: null }}
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
        running
        runTiming={{ startedAt: 1_000, completedAt: null }}
      />,
    )
    expect(curated).toContain("推荐保存的来源")
    expect(curated).toContain("一手访谈可支持人物经历与创作方法")
    expect(curated).toContain("保存所选来源（1）")
  })
})
