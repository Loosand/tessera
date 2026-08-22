/**
 * [INPUT]: 创作模式、任务运行时与供应商实际连接上的模型端点
 * [OUTPUT]: 自动、研究、问答三类能力编排的回归验证
 * [POS]: task-page 隐式能力策略的纯函数单元测试
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import type { AvailableAiModel } from "../hooks/use-ai-models"
import { resolveAutomaticTaskExecution } from "./task-page"

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
      endpointType: "openai-responses",
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
