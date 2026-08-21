/**
 * [INPUT]: 跨进程 AI 供应商标识、首批 API 接入范围、模型目录鉴权能力、搜索词与用户维护的模型草稿
 * [OUTPUT]: AI SDK 供应商元数据、默认模型目录策略、界面草稿类型与纯状态转换函数
 * [POS]: @tessera/ai 内与 UI 框架无关的供应商目录和配置模型
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiProviderConfig, AiProviderId, AiProviderModel } from "@tessera/contracts"
import { resolveAiModelCapabilities } from "./model-capabilities"

export type { AiProviderId } from "@tessera/contracts"

export interface AiProviderDefinition {
  adapter: string
  apiKeyPlaceholder: string
  defaultBaseUrl: string
  description: string
  id: AiProviderId
  name: string
  publicModelCatalog: boolean
  protocol: string
}

export interface AiProviderModelDraft extends AiProviderModel {
  enabled: boolean
}

export interface AiProviderDraft {
  apiKeyConfigured: boolean
  baseUrl: string
  enabled: boolean
  models: AiProviderModelDraft[]
}

export type AiProviderDrafts = Record<AiProviderId, AiProviderDraft>

export const AI_PROVIDER_DEFINITIONS: readonly AiProviderDefinition[] = [
  {
    id: "openai-compatible",
    name: "OpenAI 兼容",
    description: "连接实现 OpenAI API 规范的服务、中转或企业网关。",
    adapter: "AI SDK · OpenAI Compatible",
    protocol: "Chat Completions",
    apiKeyPlaceholder: "输入 API Key",
    defaultBaseUrl: "https://api.openai.com/v1",
    publicModelCatalog: false,
  },
  {
    id: "anthropic-compatible",
    name: "Anthropic 兼容",
    description: "连接 Anthropic 官方服务或兼容 Messages API 的端点。",
    adapter: "AI SDK · Anthropic",
    protocol: "Messages API",
    apiKeyPlaceholder: "输入 Anthropic API Key",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    publicModelCatalog: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "使用 DeepSeek 的独立适配器，保留供应商能力边界。",
    adapter: "AI SDK · DeepSeek",
    protocol: "DeepSeek API",
    apiKeyPlaceholder: "输入 DeepSeek API Key",
    defaultBaseUrl: "https://api.deepseek.com",
    publicModelCatalog: false,
  },
  {
    id: "grok",
    name: "Grok",
    description: "通过 xAI API 接入 Grok 模型与后续原生能力。",
    adapter: "AI SDK · xAI",
    protocol: "xAI API",
    apiKeyPlaceholder: "输入 xAI API Key",
    defaultBaseUrl: "https://api.x.ai/v1",
    publicModelCatalog: false,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "通过单一账户选择多家模型，并保留实际路由信息。",
    adapter: "AI SDK · OpenRouter",
    protocol: "OpenAI Compatible",
    apiKeyPlaceholder: "输入 OpenRouter API Key",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    publicModelCatalog: true,
  },
] as const

export function createInitialAiProviderDrafts(configs: readonly AiProviderConfig[] = []): AiProviderDrafts {
  const configsByProvider = new Map(configs.map((config) => [config.providerId, config]))
  return AI_PROVIDER_DEFINITIONS.reduce<AiProviderDrafts>((drafts, provider) => {
    const config = configsByProvider.get(provider.id)
    drafts[provider.id] = {
      apiKeyConfigured: config?.apiKeyConfigured ?? false,
      baseUrl: config?.baseUrl || provider.defaultBaseUrl,
      enabled: config?.enabled ?? false,
      models: config?.models.map((model) => ({ ...model })) ?? [],
    }
    return drafts
  }, {} as AiProviderDrafts)
}

export function matchesAiProvider(provider: AiProviderDefinition, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  return [provider.name, provider.description, provider.adapter, provider.protocol]
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalizedQuery)
}

export function appendAiProviderModel(
  models: readonly AiProviderModelDraft[],
  modelId: string,
  providerId: AiProviderId,
): AiProviderModelDraft[] {
  const normalizedId = modelId.trim()
  if (!normalizedId || models.some((model) => model.id === normalizedId)) return [...models]
  return [
    ...models,
    {
      ...resolveAiModelCapabilities(providerId, {
        id: normalizedId,
        name: null,
        ownedBy: null,
        contextWindow: null,
        maxOutputTokens: null,
      }),
      enabled: true,
    },
  ]
}

export function mergeDiscoveredAiProviderModels(
  models: readonly AiProviderModelDraft[],
  discoveredModels: readonly AiProviderModel[],
  providerId: AiProviderId,
): AiProviderModelDraft[] {
  const existingById = new Map(models.map((model) => [model.id, model]))
  const mergedModels: AiProviderModelDraft[] = []
  const knownModelIds = new Set<string>()
  const mergedModelIds = new Set(models.map((model) => model.id))

  for (const discoveredModel of discoveredModels) {
    const normalizedId = discoveredModel.id.trim()
    if (normalizedId) mergedModelIds.add(normalizedId)
  }

  const enableNewModelsByDefault = mergedModelIds.size === 1

  for (const discoveredModel of discoveredModels) {
    const normalizedId = discoveredModel.id.trim()
    if (!normalizedId || knownModelIds.has(normalizedId)) continue
    knownModelIds.add(normalizedId)
    const existingModel = existingById.get(normalizedId)
    mergedModels.push({
      ...resolveAiModelCapabilities(providerId, {
        ...discoveredModel,
        id: normalizedId,
        name: discoveredModel.name ?? existingModel?.name ?? null,
        ownedBy: discoveredModel.ownedBy ?? existingModel?.ownedBy ?? null,
        contextWindow: discoveredModel.contextWindow ?? existingModel?.contextWindow ?? null,
        maxOutputTokens: discoveredModel.maxOutputTokens ?? existingModel?.maxOutputTokens ?? null,
      }),
      enabled: existingModel?.enabled ?? enableNewModelsByDefault,
    })
  }

  for (const model of models) {
    if (knownModelIds.has(model.id)) continue
    knownModelIds.add(model.id)
    mergedModels.push(model)
  }

  return mergedModels
}

export function setAllAiProviderModelsEnabled(
  models: readonly AiProviderModelDraft[],
  enabled: boolean,
): AiProviderModelDraft[] {
  return models.map((model) => ({ ...model, enabled }))
}
