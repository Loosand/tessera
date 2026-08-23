/**
 * [INPUT]: 逐轮创作方式、任务运行时、供应商实际连接上的模型端点与助手消息本地反馈
 * [OUTPUT]: 自动、研究、问答三类能力编排、历史恢复不误保存及赞踩写入/撤销的回归验证
 * [POS]: task-page 隐式能力策略的纯函数单元测试
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import { describe, expect, it } from "vitest"
import type { AvailableAiModel } from "../hooks/use-ai-models"
import {
  resolveAutomaticTaskExecution,
  resolveTaskPersistenceAction,
  withTaskMessageFeedback,
} from "./task-page"

function deepSeekModel(baseUrl = "https://api.deepseek.com"): AvailableAiModel {
  return {
    baseUrl,
    configId: "deepseek",
    contextWindow: null,
    displayName: "DeepSeek",
    enabled: true,
    id: "deepseek-v4-pro",
    maxOutputTokens: null,
    name: "DeepSeek V4 Pro",
    ownedBy: "deepseek",
    providerId: "deepseek",
    providerName: "DeepSeek",
  }
}

describe("任务自动能力策略", () => {
  it("研究模式使用具备深度思考和原生搜索的端点", () => {
    expect(resolveAutomaticTaskExecution("research", "chat", deepSeekModel())).toMatchObject({
      capabilities: { reasoning: "supported" },
      endpointType: "anthropic-messages",
      issues: [],
      searchRoute: "provider-native",
    })
  })

  it("问答模式固定关闭联网", () => {
    expect(resolveAutomaticTaskExecution("question-answering", "chat", deepSeekModel())).toMatchObject({
      endpointType: "openai-chat-completions",
      issues: [],
      searchRoute: "unavailable",
    })
  })

  it("自动模式在自定义代理没有已验证搜索时回落到普通对话端点", () => {
    expect(
      resolveAutomaticTaskExecution(null, "chat", deepSeekModel("https://relay.example.com/v1")),
    ).toMatchObject({
      endpointType: "openai-chat-completions",
      issues: [],
      searchRoute: "unavailable",
    })
  })
})

describe("助手消息本地反馈", () => {
  const messages = [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "问题" }] },
    {
      id: "assistant-1",
      role: "assistant",
      metadata: { requestId: "run-1" },
      parts: [{ type: "text", text: "回答", state: "done" }],
    },
  ] as UIMessage[]

  it("把反馈关联到具体助手回复并保留运行元数据", () => {
    const next = withTaskMessageFeedback(messages, "assistant-1", "negative", 1_788_000_000_000)

    expect(next[1]?.metadata).toEqual({
      requestId: "run-1",
      feedback: { rating: "negative", updatedAt: 1_788_000_000_000 },
    })
    expect(next[0]).toBe(messages[0])
  })

  it("允许撤销反馈且不丢失其他消息元数据", () => {
    const rated = withTaskMessageFeedback(messages, "assistant-1", "positive", 1_788_000_000_000)
    const cleared = withTaskMessageFeedback(rated, "assistant-1", null)

    expect(cleared[1]?.metadata).toEqual({ requestId: "run-1" })
  })
})

describe("任务历史恢复持久化", () => {
  it("历史消息恢复和模型元数据补齐只初始化基线，不触发保存", () => {
    expect(
      resolveTaskPersistenceAction({
        activityObserved: false,
        currentChatIdentity: "history",
        initialChatIdentity: "history",
        nextPersistenceIdentity: "completed:history-with-model-metadata",
        previousPersistenceIdentity: "completed:history",
      }),
    ).toBe("initialize")
  })

  it("用户消息发生变化后才持久化，并跳过相同快照", () => {
    expect(
      resolveTaskPersistenceAction({
        activityObserved: false,
        currentChatIdentity: "history+new-message",
        initialChatIdentity: "history",
        nextPersistenceIdentity: "running:history+new-message",
        previousPersistenceIdentity: "completed:history",
      }),
    ).toBe("persist")
    expect(
      resolveTaskPersistenceAction({
        activityObserved: true,
        currentChatIdentity: "history+new-message",
        initialChatIdentity: "history",
        nextPersistenceIdentity: "running:history+new-message",
        previousPersistenceIdentity: "running:history+new-message",
      }),
    ).toBe("skip")
  })
})
