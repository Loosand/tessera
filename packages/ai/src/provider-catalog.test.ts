/**
 * [INPUT]: AI 供应商元数据与模型草稿转换函数
 * [OUTPUT]: 首批供应商范围、搜索与模型去重行为的回归测试
 * [POS]: @tessera/ai 供应商目录与配置模型的回归测试
 * [DOC]: design.md、docs/architecture.md
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

  it("初始化时不假定任何供应商已配置", () => {
    const drafts = createInitialAiProviderDrafts()
    expect(Object.values(drafts).every((draft) => !draft.enabled && !draft.apiKeyConfigured)).toBe(true)
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

  it("手动模型会修剪空白并拒绝重复", () => {
    const first = appendAiProviderModel([], "  model-a  ", "openai-compatible")
    expect(first).toEqual([
      {
        id: "model-a",
        enabled: true,
        name: null,
        ownedBy: null,
        contextWindow: null,
        maxOutputTokens: null,
        capabilities: {
          imageInput: "unknown",
          reasoning: "unknown",
          search: "unsupported",
          toolUse: "unknown",
        },
        capabilitySource: "builtin",
      },
    ])
    expect(appendAiProviderModel(first, "model-a", "openai-compatible")).toEqual(first)
  })

  it("合并发现模型时保留已有开关并自动启用新模型", () => {
    expect(
      mergeDiscoveredAiProviderModels(
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
      ),
    ).toEqual([
      {
        id: "model-a",
        enabled: false,
        name: "Model A",
        ownedBy: "vendor",
        contextWindow: 128_000,
        maxOutputTokens: 16_000,
        capabilities: {
          imageInput: "unknown",
          reasoning: "unknown",
          search: "unsupported",
          toolUse: "unknown",
        },
        capabilitySource: "builtin",
      },
      {
        id: "model-b",
        enabled: true,
        name: null,
        ownedBy: null,
        contextWindow: null,
        maxOutputTokens: null,
        capabilities: {
          imageInput: "unknown",
          reasoning: "unknown",
          search: "unsupported",
          toolUse: "unknown",
        },
        capabilitySource: "builtin",
      },
    ])
  })
})
