/**
 * [INPUT]: DeepSeek、Anthropic、非对话模型与自定义代理的模型事实
 * [OUTPUT]: 端点选择、原生搜索和派生 Agent 能力的回归验证
 * [POS]: 请求期有效能力解析器的单元测试
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import { resolveAiModelExecution } from "./model-routing"

const model = (id: string) => ({
  contextWindow: null,
  id,
  maxOutputTokens: null,
  name: null,
  ownedBy: null,
})

describe("模型请求期能力解析", () => {
  it("为 DeepSeek V4 普通对话保留 Chat Completions", () => {
    expect(
      resolveAiModelExecution({
        baseUrl: "https://api.deepseek.com",
        mode: "chat",
        model: model("deepseek-v4-flash"),
        providerId: "deepseek",
        webSearch: false,
      }),
    ).toMatchObject({ endpointType: "openai-chat-completions", issues: [] })
  })

  it("为 DeepSeek V4 原生搜索显式选择 Responses", () => {
    expect(
      resolveAiModelExecution({
        baseUrl: "https://api.deepseek.com",
        mode: "chat",
        model: model("deepseek-v4-pro"),
        providerId: "deepseek",
        webSearch: true,
      }),
    ).toMatchObject({
      endpointType: "openai-responses",
      issues: [],
      searchRoute: "provider-native",
    })
  })

  it("不把 DeepSeek 官方能力套到同 ID 的自定义代理", () => {
    expect(
      resolveAiModelExecution({
        baseUrl: "https://relay.example.com/v1",
        mode: "chat",
        model: model("deepseek-v4-pro"),
        providerId: "deepseek",
        webSearch: true,
      }),
    ).toMatchObject({ endpointType: null, issues: ["native-search-unavailable"] })
  })

  it("不把 Anthropic 官方搜索能力套到兼容中转", () => {
    expect(
      resolveAiModelExecution({
        baseUrl: "https://relay.example.com/anthropic",
        mode: "chat",
        model: model("claude-sonnet-4"),
        providerId: "anthropic-compatible",
        webSearch: true,
      }),
    ).toMatchObject({ endpointType: null, issues: ["native-search-unavailable"] })
  })

  it("Agent 能力由对话类型、端点与工具调用共同派生", () => {
    const chat = resolveAiModelExecution({
      baseUrl: "https://api.deepseek.com",
      mode: "agent",
      model: model("deepseek-v4-flash"),
      providerId: "deepseek",
      webSearch: false,
    })
    const embedding = resolveAiModelExecution({
      baseUrl: "https://relay.example.com/v1",
      mode: "agent",
      model: model("text-embedding-3-large"),
      providerId: "openai-compatible",
      webSearch: false,
    })

    expect(chat).toMatchObject({ agentReady: true, issues: [] })
    expect(embedding.agentReady).toBe(false)
    expect(embedding.issues).toContain("chat-model-required")
  })
})
