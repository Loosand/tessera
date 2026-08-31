/**
 * [INPUT]: 跨进程 AI 供应商标识、首批 API/端点接入范围、模型目录能力、搜索词与用户维护的模型草稿
 * [OUTPUT]: 供应商/端点元数据、默认模型目录策略、受模型 ID 边界保护的逐字段用户覆盖、界面草稿类型与纯状态转换函数
 * [POS]: @tessera/ai 内与 UI 框架无关的供应商目录和配置模型
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AiModelCapabilities,
  AiModelCapabilityKey,
  AiModelEndpointType,
  AiModelModality,
  AiModelProfileField,
  AiModelType,
  AiProviderConfig,
  AiProviderId,
  AiProviderModel,
} from "@tessera/contracts"
import { resolveAiModelCapabilities } from "./model-capabilities"
import { normalizeAiProviderModelId } from "./provider-input-validation"

export type { AiProviderId } from "@tessera/contracts"

export type AiProviderDefinition = Readonly<{
  adapter: string
  apiKeyPlaceholder: string
  defaultBaseUrl: string
  description: string
  endpointTypes: readonly AiModelEndpointType[]
  id: AiProviderId
  multiple: boolean
  name: string
  publicModelCatalog: boolean
  protocol: string
}>

export type AiProviderModelDraft = Readonly<AiProviderModel> &
  Readonly<{
    enabled: boolean
  }>

export type AiProviderModelProfileUpdate = Readonly<{
  capabilities: AiModelCapabilities
  contextWindow: number | null
  inputModalities: AiModelModality[]
  maxInputTokens: number | null
  maxOutputTokens: number | null
  modelType: AiModelType
  name: string | null
  outputModalities: AiModelModality[]
}>

export type AiProviderDraft = Readonly<{
  apiKeyConfigured: boolean
  baseUrl: string
  configId: string
  displayName: string
  enabled: boolean
  models: readonly AiProviderModelDraft[]
  providerId: AiProviderId
}>

/** 界面允许修改的连接字段；连接标识与协议标识创建后保持不变。 */
export type AiProviderDraftUpdate = Partial<
  Pick<AiProviderDraft, "apiKeyConfigured" | "baseUrl" | "displayName" | "enabled" | "models">
>

/** 内置连接始终存在；用户建立的命名连接按配置 ID 可选存在。 */
export type AiProviderDrafts = Record<AiProviderId, AiProviderDraft> &
  Partial<Record<string, AiProviderDraft>>

export const AI_PROVIDER_DEFINITIONS = [
  {
    id: "openai-compatible",
    multiple: true,
    name: "OpenAI 兼容",
    description: "连接实现 OpenAI API 规范的服务、中转或企业网关。",
    endpointTypes: ["openai-chat-completions"],
    adapter: "AI SDK · OpenAI Compatible",
    protocol: "Chat Completions",
    apiKeyPlaceholder: "输入 API Key",
    defaultBaseUrl: "https://api.openai.com/v1",
    publicModelCatalog: false,
  },
  {
    id: "anthropic-compatible",
    multiple: true,
    name: "Anthropic 兼容",
    description: "连接 Anthropic 官方服务或兼容 Messages API 的端点。",
    endpointTypes: ["anthropic-messages"],
    adapter: "AI SDK · Anthropic",
    protocol: "Messages API",
    apiKeyPlaceholder: "输入 Anthropic API Key",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    publicModelCatalog: false,
  },
  {
    id: "deepseek",
    multiple: false,
    name: "DeepSeek",
    description: "使用 DeepSeek 的独立适配器，保留供应商能力边界。",
    endpointTypes: ["openai-chat-completions", "openai-responses", "anthropic-messages"],
    adapter: "AI SDK · DeepSeek",
    protocol: "DeepSeek API",
    apiKeyPlaceholder: "输入 DeepSeek API Key",
    defaultBaseUrl: "https://api.deepseek.com",
    publicModelCatalog: false,
  },
  {
    id: "grok",
    multiple: false,
    name: "Grok",
    description: "通过 xAI API 接入 Grok 模型与后续原生能力。",
    endpointTypes: ["openai-chat-completions", "xai-responses"],
    adapter: "AI SDK · xAI",
    protocol: "xAI API",
    apiKeyPlaceholder: "输入 xAI API Key",
    defaultBaseUrl: "https://api.x.ai/v1",
    publicModelCatalog: false,
  },
  {
    id: "openrouter",
    multiple: false,
    name: "OpenRouter",
    description: "通过单一账户选择多家模型，并保留实际路由信息。",
    endpointTypes: ["openai-chat-completions"],
    adapter: "AI SDK · OpenRouter",
    protocol: "OpenAI Compatible",
    apiKeyPlaceholder: "输入 OpenRouter API Key",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    publicModelCatalog: true,
  },
] as const satisfies readonly AiProviderDefinition[]

export function createInitialAiProviderDrafts(configs: readonly AiProviderConfig[] = []): AiProviderDrafts {
  const drafts: AiProviderDrafts = {
    "anthropic-compatible": createAiProviderDraft(AI_PROVIDER_DEFINITIONS[1]),
    deepseek: createAiProviderDraft(AI_PROVIDER_DEFINITIONS[2]),
    grok: createAiProviderDraft(AI_PROVIDER_DEFINITIONS[3]),
    "openai-compatible": createAiProviderDraft(AI_PROVIDER_DEFINITIONS[0]),
    openrouter: createAiProviderDraft(AI_PROVIDER_DEFINITIONS[4]),
  }

  for (const provider of AI_PROVIDER_DEFINITIONS) {
    const config = configs.find((candidate) => candidate.configId === provider.id)
    if (!config) continue
    drafts[provider.id] = {
      apiKeyConfigured: config.apiKeyConfigured,
      baseUrl: config.baseUrl,
      configId: config.configId,
      displayName: config.displayName,
      enabled: config.enabled,
      models: config.models.map((model) => ({ ...model })),
      providerId: config.providerId,
    }
  }

  for (const config of configs) {
    if (config.configId === config.providerId) continue
    drafts[config.configId] = {
      apiKeyConfigured: config.apiKeyConfigured,
      baseUrl: config.baseUrl,
      configId: config.configId,
      displayName: config.displayName,
      enabled: config.enabled,
      models: config.models.map((model) => ({ ...model })),
      providerId: config.providerId,
    }
  }

  return drafts
}

export function createAiProviderDraft(
  provider: AiProviderDefinition,
  configId: string = provider.id,
  displayName: string = provider.name,
): AiProviderDraft {
  return {
    apiKeyConfigured: false,
    baseUrl: provider.defaultBaseUrl,
    configId,
    displayName,
    enabled: false,
    models: [],
    providerId: provider.id,
  }
}

export function matchesAiProvider(
  provider: AiProviderDefinition,
  query: string,
  displayName = provider.name,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  return [displayName, provider.name, provider.description, provider.adapter, provider.protocol]
    .join(" ")
    .toLocaleLowerCase()
    .includes(normalizedQuery)
}

export function appendAiProviderModel(
  models: readonly AiProviderModelDraft[],
  modelId: string,
  providerId: AiProviderId,
): AiProviderModelDraft[] {
  const normalizedId = normalizeAiProviderModelId(modelId)
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
    const normalizedId = normalizeAiProviderModelId(discoveredModel.id)
    if (normalizedId) mergedModelIds.add(normalizedId)
  }

  const enableNewModelsByDefault = mergedModelIds.size === 1

  for (const discoveredModel of discoveredModels) {
    const normalizedId = normalizeAiProviderModelId(discoveredModel.id)
    if (!normalizedId || knownModelIds.has(normalizedId)) continue
    knownModelIds.add(normalizedId)
    const existingModel = existingById.get(normalizedId)
    const capabilityKeys = [
      "functionCall",
      "reasoning",
      "structuredOutput",
    ] as const satisfies readonly AiModelCapabilityKey[]
    const capabilities = Object.fromEntries(
      capabilityKeys.map((key) => [
        key,
        existingModel?.capabilitySources?.[key] === "custom"
          ? existingModel.capabilities?.[key]
          : (discoveredModel.capabilities?.[key] ?? existingModel?.capabilities?.[key]),
      ]),
    ) as AiModelCapabilities
    const capabilitySources = Object.fromEntries(
      capabilityKeys.map((key) => [
        key,
        existingModel?.capabilitySources?.[key] === "custom"
          ? "custom"
          : (discoveredModel.capabilitySources?.[key] ?? existingModel?.capabilitySources?.[key]),
      ]),
    ) as Partial<Record<AiModelCapabilityKey, "builtin" | "custom" | "remote" | "unknown">>
    const profileValue = <Value>(
      key: AiModelProfileField,
      discovered: Value | undefined,
      existing: Value | undefined,
    ) => (existingModel?.fieldSources?.[key] === "custom" ? existing : (discovered ?? existing))
    const inputModalities = profileValue(
      "inputModalities",
      discoveredModel.inputModalities,
      existingModel?.inputModalities,
    )
    const maxInputTokens = profileValue(
      "maxInputTokens",
      discoveredModel.maxInputTokens,
      existingModel?.maxInputTokens,
    )
    const modelType = profileValue("modelType", discoveredModel.modelType, existingModel?.modelType)
    const outputModalities = profileValue(
      "outputModalities",
      discoveredModel.outputModalities,
      existingModel?.outputModalities,
    )
    mergedModels.push({
      ...resolveAiModelCapabilities(providerId, {
        ...existingModel,
        ...discoveredModel,
        id: normalizedId,
        capabilities,
        capabilitySources,
        name:
          existingModel?.fieldSources?.name === "custom"
            ? existingModel.name
            : (discoveredModel.name ?? existingModel?.name ?? null),
        ownedBy: discoveredModel.ownedBy ?? existingModel?.ownedBy ?? null,
        contextWindow:
          profileValue("contextWindow", discoveredModel.contextWindow, existingModel?.contextWindow) ?? null,
        ...(inputModalities ? { inputModalities } : {}),
        ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
        maxOutputTokens:
          profileValue("maxOutputTokens", discoveredModel.maxOutputTokens, existingModel?.maxOutputTokens) ??
          null,
        ...(modelType ? { modelType } : {}),
        ...(outputModalities ? { outputModalities } : {}),
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

export function updateAiProviderModelProfile(
  models: readonly AiProviderModelDraft[],
  modelId: string,
  update: AiProviderModelProfileUpdate,
  providerId: AiProviderId,
): AiProviderModelDraft[] {
  const profileFields = [
    "contextWindow",
    "inputModalities",
    "maxInputTokens",
    "maxOutputTokens",
    "modelType",
    "name",
    "outputModalities",
  ] as const satisfies readonly AiModelProfileField[]
  return models.map((model) => {
    if (model.id !== modelId) return model
    return {
      ...resolveAiModelCapabilities(providerId, {
        ...model,
        ...update,
        capabilitySources: {
          functionCall: "custom",
          reasoning: "custom",
          structuredOutput: "custom",
        },
        fieldSources: Object.fromEntries(profileFields.map((field) => [field, "custom"])),
      }),
      enabled: model.enabled,
    }
  })
}

export function setAllAiProviderModelsEnabled(
  models: readonly AiProviderModelDraft[],
  enabled: boolean,
): AiProviderModelDraft[] {
  return models.map((model) => ({ ...model, enabled }))
}
