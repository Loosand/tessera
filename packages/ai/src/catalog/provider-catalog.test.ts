/**
 * [INPUT]: AI 供应商元数据与模型草稿转换函数
 * [OUTPUT]: 首批供应商范围、搜索、模型 ID 边界、模型同步默认状态与批量启停行为的回归测试
 * [POS]: @tessera/ai 供应商目录与配置模型的回归测试
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  AI_PROVIDER_DEFINITIONS,
  appendAiProviderModel,
  createInitialAiProviderDrafts,
  matchesAiProvider,
  mergeDiscoveredAiProviderModels,
  setAllAiProviderModelsEnabled,
  updateAiProviderModelProfile,
} from "./provider-catalog"

describe("AI 供应商设置模型", () => {
  it("只暴露首批五个 API 供应商", () => {
    expect(AI_PROVIDER_DEFINITIONS.map((provider) => provider.id)).toEqual([
      "openai-compatible",
      "anthropic-compatible",
      "deepseek",
      "grok",
      "openrouter",
    ])
  })

  it("兼容协议允许多连接，官方服务保持单例", () => {
    expect(
      Object.fromEntries(AI_PROVIDER_DEFINITIONS.map((provider) => [provider.id, provider.multiple])),
    ).toEqual({
      "openai-compatible": true,
      "anthropic-compatible": true,
      deepseek: false,
      grok: false,
      openrouter: false,
    })
  })

  it("供应商定义显式声明可用生成端点", () => {
    expect(AI_PROVIDER_DEFINITIONS.find((provider) => provider.id === "deepseek")?.endpointTypes).toEqual([
      "openai-chat-completions",
      "openai-responses",
      "anthropic-messages",
    ])
  })

  it("初始化时不假定任何供应商已配置", () => {
    const drafts = createInitialAiProviderDrafts()
    expect(
      AI_PROVIDER_DEFINITIONS.every(
        (provider) => !drafts[provider.id].enabled && !drafts[provider.id].apiKeyConfigured,
      ),
    ).toBe(true)
  })

  it("为官方服务预填可覆盖的 API 地址", () => {
    const drafts = createInitialAiProviderDrafts()
    expect(
      Object.fromEntries(
        AI_PROVIDER_DEFINITIONS.map((provider) => [provider.id, drafts[provider.id].baseUrl]),
      ),
    ).toEqual({
      "openai-compatible": "https://api.openai.com/v1",
      "anthropic-compatible": "https://api.anthropic.com/v1",
      deepseek: "https://api.deepseek.com",
      grok: "https://api.x.ai/v1",
      openrouter: "https://openrouter.ai/api/v1",
    })
  })

  it("启动时以持久化配置覆盖默认值并保留其他供应商默认值", () => {
    const drafts = createInitialAiProviderDrafts([
      {
        configId: "openrouter",
        displayName: "OpenRouter",
        providerId: "openrouter",
        enabled: true,
        baseUrl: "https://relay.example.com/v1",
        apiKeyConfigured: true,
        updatedAt: 100,
        models: [
          {
            id: "openrouter/auto",
            enabled: false,
            name: "Auto",
            ownedBy: "openrouter",
            contextWindow: 2_000_000,
            maxOutputTokens: null,
          },
        ],
      },
    ])

    expect(drafts.openrouter).toMatchObject({
      enabled: true,
      baseUrl: "https://relay.example.com/v1",
      apiKeyConfigured: true,
      models: [{ id: "openrouter/auto", enabled: false }],
    })
    expect(drafts.deepseek.baseUrl).toBe("https://api.deepseek.com")
  })

  it("启动时保留同一兼容协议下的多条具名连接", () => {
    const drafts = createInitialAiProviderDrafts([
      {
        configId: "anthropic-compatible:deepseek",
        displayName: "DeepSeek Messages",
        providerId: "anthropic-compatible",
        enabled: true,
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyConfigured: true,
        updatedAt: 100,
        models: [],
      },
      {
        configId: "anthropic-compatible:relay",
        displayName: "团队中转",
        providerId: "anthropic-compatible",
        enabled: true,
        baseUrl: "https://relay.example.com/anthropic",
        apiKeyConfigured: true,
        updatedAt: 200,
        models: [],
      },
    ])

    expect(drafts["anthropic-compatible:deepseek"]).toMatchObject({
      displayName: "DeepSeek Messages",
      providerId: "anthropic-compatible",
    })
    expect(drafts["anthropic-compatible:relay"]).toMatchObject({
      displayName: "团队中转",
      providerId: "anthropic-compatible",
    })
    expect(drafts["anthropic-compatible"]).toBeDefined()
  })

  it("标记可匿名读取的默认模型目录", () => {
    expect(
      AI_PROVIDER_DEFINITIONS.filter((provider) => provider.publicModelCatalog).map(
        (provider) => provider.id,
      ),
    ).toEqual(["openrouter"])
  })

  it("可以按名称、协议和适配器搜索供应商", () => {
    const anthropic = AI_PROVIDER_DEFINITIONS.find((provider) => provider.id === "anthropic-compatible")
    expect(anthropic).toBeDefined()
    if (!anthropic) return
    expect(matchesAiProvider(anthropic, "anthropic")).toBe(true)
    expect(matchesAiProvider(anthropic, "messages")).toBe(true)
    expect(matchesAiProvider(anthropic, "openrouter")).toBe(false)
  })

  it("手动模型会修剪空白并拒绝重复或超长 ID", () => {
    const first = appendAiProviderModel([], "  model-a  ", "openai-compatible")
    expect(first).toEqual([
      expect.objectContaining({
        id: "model-a",
        enabled: true,
        modelType: "chat",
        inputModalities: ["text"],
        outputModalities: ["text"],
        capabilities: {
          functionCall: "unknown",
          reasoning: "unknown",
          structuredOutput: "unknown",
        },
      }),
    ])
    expect(appendAiProviderModel(first, "model-a", "openai-compatible")).toEqual(first)
    expect(appendAiProviderModel(first, "m".repeat(513), "openai-compatible")).toEqual(first)
  })

  it("同步多个模型时保留已有开关并默认停用新模型", () => {
    const merged = mergeDiscoveredAiProviderModels(
      [
        {
          id: "model-a",
          enabled: false,
          name: null,
          ownedBy: null,
          contextWindow: null,
          maxOutputTokens: null,
        },
      ],
      [
        {
          id: "model-a",
          name: "Model A",
          ownedBy: "vendor",
          contextWindow: 128_000,
          maxOutputTokens: 16_000,
        },
        {
          id: " model-b ",
          name: null,
          ownedBy: null,
          contextWindow: null,
          maxOutputTokens: null,
        },
      ],
      "openai-compatible",
    )
    expect(merged).toEqual([
      expect.objectContaining({
        id: "model-a",
        enabled: false,
        name: "Model A",
        ownedBy: "vendor",
        contextWindow: 128_000,
        maxOutputTokens: 16_000,
        modelType: "chat",
      }),
      expect.objectContaining({
        id: "model-b",
        enabled: false,
        name: null,
        ownedBy: null,
        contextWindow: null,
        maxOutputTokens: null,
        modelType: "chat",
      }),
    ])
  })

  it("首次同步只有一个模型时自动启用", () => {
    const models = mergeDiscoveredAiProviderModels(
      [],
      [
        {
          id: "only-model",
          name: "Only Model",
          ownedBy: "vendor",
          contextWindow: null,
          maxOutputTokens: null,
        },
      ],
      "openai-compatible",
    )

    expect(models).toHaveLength(1)
    expect(models[0]?.enabled).toBe(true)
  })

  it("用户逐字段覆盖在后续目录同步中保持最高优先级", () => {
    const initial = appendAiProviderModel([], "deepseek-v4-flash", "deepseek")
    const customized = updateAiProviderModelProfile(
      initial,
      "deepseek-v4-flash",
      {
        capabilities: {
          functionCall: "unsupported",
          reasoning: "supported",
          structuredOutput: "supported",
        },
        contextWindow: 512_000,
        inputModalities: ["text"],
        maxInputTokens: 400_000,
        maxOutputTokens: 64_000,
        modelType: "chat",
        name: "团队版 DeepSeek",
        outputModalities: ["text"],
      },
      "deepseek",
    )
    const [merged] = mergeDiscoveredAiProviderModels(
      customized,
      [
        {
          contextWindow: 1_048_576,
          id: "deepseek-v4-flash",
          maxOutputTokens: 393_216,
          name: "DeepSeek V4 Flash",
          ownedBy: "deepseek",
        },
      ],
      "deepseek",
    )

    expect(merged).toMatchObject({
      capabilities: { functionCall: "unsupported" },
      contextWindow: 512_000,
      inputModalities: ["text"],
      maxInputTokens: 400_000,
      maxOutputTokens: 64_000,
      name: "团队版 DeepSeek",
    })
    expect(merged?.capabilitySources?.functionCall).toBe("custom")
    expect(merged?.fieldSources?.contextWindow).toBe("custom")
  })

  it("首次同步四百个模型时全部保持未启用", () => {
    const discoveredModels = Array.from({ length: 400 }, (_, index) => ({
      id: `model-${index + 1}`,
      name: null,
      ownedBy: null,
      contextWindow: null,
      maxOutputTokens: null,
    }))
    const models = mergeDiscoveredAiProviderModels([], discoveredModels, "openai-compatible")

    expect(models).toHaveLength(400)
    expect(models.every((model) => !model.enabled)).toBe(true)
  })

  it("可以批量启用或停用供应商的完整模型目录", () => {
    const models = mergeDiscoveredAiProviderModels(
      [],
      [
        {
          id: "model-a",
          name: null,
          ownedBy: null,
          contextWindow: null,
          maxOutputTokens: null,
        },
        {
          id: "model-b",
          name: null,
          ownedBy: null,
          contextWindow: null,
          maxOutputTokens: null,
        },
      ],
      "openai-compatible",
    )

    const enabledModels = setAllAiProviderModelsEnabled(models, true)
    expect(enabledModels.every((model) => model.enabled)).toBe(true)
    expect(setAllAiProviderModelsEnabled(enabledModels, false).every((model) => !model.enabled)).toBe(true)
  })
})
