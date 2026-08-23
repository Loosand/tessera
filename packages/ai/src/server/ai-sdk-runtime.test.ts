/**
 * [INPUT]: 五类供应商配置、联网搜索额度与真实 AI SDK provider 工厂
 * [OUTPUT]: 密钥/地址/模型 ID 边界、供应商到 AI SDK LanguageModel、原生联网工具和有界搜索额度的映射回归验证
 * [POS]: @tessera/ai/server AI SDK 适配器单元测试
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiProviderId } from "@tessera/contracts"
import { describe, expect, it } from "vitest"
import { createAiSdkChatRuntime, createAiSdkLanguageModel } from "./ai-sdk-runtime"

describe("AI SDK 供应商适配", () => {
  it.each<[AiProviderId, string, string]>([
    ["openai-compatible", "https://api.openai.com/v1", "openai-model"],
    ["anthropic-compatible", "https://api.anthropic.com/v1", "claude-model"],
    ["deepseek", "https://api.deepseek.com", "deepseek-model"],
    ["grok", "https://api.x.ai/v1", "grok-model"],
    ["openrouter", "https://openrouter.ai/api/v1", "provider/model"],
  ])("为 %s 创建 AI SDK LanguageModel", (providerId, baseUrl, modelId) => {
    const model = createAiSdkLanguageModel({
      configId: providerId,
      providerId,
      baseUrl,
      modelId,
      apiKey: "test-key",
    })
    expect(model).toMatchObject({ modelId })
  })

  it("拒绝缺失的模型 ID", () => {
    expect(() =>
      createAiSdkLanguageModel({
        configId: "openai-compatible",
        providerId: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        modelId: " ",
        apiKey: "test-key",
      }),
    ).toThrow("请先选择模型")
  })

  it("在创建供应商客户端前拒绝包含中文的 API Key", () => {
    expect(() =>
      createAiSdkLanguageModel({
        configId: "openrouter",
        providerId: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        modelId: "provider/model",
        apiKey: "我的 API Key",
      }),
    ).toThrow("请只粘贴供应商提供的原始 Key")
  })

  it("拒绝非 HTTP(S) 的运行时地址", () => {
    expect(() =>
      createAiSdkLanguageModel({
        configId: "openai-compatible",
        providerId: "openai-compatible",
        baseUrl: "file:///tmp/models",
        modelId: "model-a",
        apiKey: "test-key",
      }),
    ).toThrow("有效的 http(s) URL")
  })

  it("在创建供应商客户端前拒绝超长 API 地址和模型 ID", () => {
    expect(() =>
      createAiSdkLanguageModel({
        configId: "openai-compatible",
        providerId: "openai-compatible",
        baseUrl: `https://example.com/${"a".repeat(2_048)}`,
        modelId: "model-a",
        apiKey: "test-key",
      }),
    ).toThrow("请输入有效的 API 地址")
    expect(() =>
      createAiSdkLanguageModel({
        configId: "openai-compatible",
        providerId: "openai-compatible",
        baseUrl: "https://example.com/v1",
        modelId: "m".repeat(513),
        apiKey: "test-key",
      }),
    ).toThrow("请先选择模型")
  })

  it.each([
    ["anthropic-compatible", "https://api.anthropic.com/v1", "claude-sonnet-4", "anthropic-messages"],
    ["deepseek", "https://api.deepseek.com", "deepseek-v4-flash", "openai-responses"],
    ["grok", "https://api.x.ai/v1", "grok-4", "xai-responses"],
  ] as const)("为 %s 接入供应商原生联网工具", (providerId, baseUrl, modelId, endpointType) => {
    const runtime = createAiSdkChatRuntime(
      { configId: providerId, providerId, baseUrl, endpointType, modelId, apiKey: "test-key" },
      { webSearch: true },
    )
    expect(runtime.tools).toHaveProperty("web_search")
  })

  it("把研究模式指定的搜索额度传给 Anthropic 原生工具", () => {
    const runtime = createAiSdkChatRuntime(
      {
        configId: "anthropic-compatible",
        providerId: "anthropic-compatible",
        baseUrl: "https://api.anthropic.com/v1",
        modelId: "claude-sonnet-4",
        apiKey: "test-key",
      },
      { webSearch: true, webSearchMaxUses: 30 },
    )
    expect(runtime.tools?.web_search).toMatchObject({ args: { maxUses: 30 } })
  })

  it("强制把 DeepSeek Responses 自定义模型按推理模型请求摘要", () => {
    const runtime = createAiSdkChatRuntime({
      configId: "deepseek",
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      endpointType: "openai-responses",
      modelId: "deepseek-v4-flash",
      apiKey: "test-key",
    })

    expect(runtime.providerOptions).toEqual({ openai: { forceReasoning: true } })
  })

  it("把异常搜索额度约束到运行时安全范围", () => {
    const runtime = createAiSdkChatRuntime(
      {
        configId: "anthropic-compatible",
        providerId: "anthropic-compatible",
        baseUrl: "https://api.anthropic.com/v1",
        modelId: "claude-sonnet-4",
        apiKey: "test-key",
      },
      { webSearch: true, webSearchMaxUses: 99 },
    )
    expect(runtime.tools?.web_search).toMatchObject({ args: { maxUses: 50 } })
  })

  it("不会为能力未知的兼容端点伪装联网搜索", () => {
    expect(() =>
      createAiSdkChatRuntime(
        {
          configId: "openai-compatible",
          providerId: "openai-compatible",
          baseUrl: "https://relay.example.com/v1",
          modelId: "custom-model",
          apiKey: "test-key",
        },
        { webSearch: true },
      ),
    ).toThrow("尚未接入")
  })

  it("不会因联网开关隐式改变 DeepSeek Chat Completions 端点", () => {
    expect(() =>
      createAiSdkChatRuntime(
        {
          configId: "deepseek",
          providerId: "deepseek",
          baseUrl: "https://api.deepseek.com",
          endpointType: "openai-chat-completions",
          modelId: "deepseek-v4-flash",
          apiKey: "test-key",
        },
        { webSearch: true },
      ),
    ).toThrow("Chat Completions 端点不提供原生联网搜索")
  })
})
