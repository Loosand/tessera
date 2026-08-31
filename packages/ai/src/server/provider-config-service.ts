/**
 * [INPUT]: 类型化供应商配置、可注入配置仓储与平台安全密钥存储
 * [OUTPUT]: 已校验且兼容旧模型能力的统一供应商配置读写/删除、请求头安全密钥加解密和连接凭据解析服务
 * [POS]: @tessera/ai/server 中独立于 Electron 与 SQLite 实现的配置持久化领域层
 * [DOC]: docs/architecture/ai-providers.md、docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  AI_MODEL_ENDPOINT_TYPES,
  AI_MODEL_MODALITIES,
  AI_MODEL_TYPES,
  type AiModelCapabilities,
  type AiModelCapabilityKey,
  type AiModelCapabilitySource,
  type AiModelCapabilityState,
  type AiModelEndpointBinding,
  type AiModelModality,
  type AiModelProfileField,
  type AiModelType,
  type AiProviderConfig,
  type AiProviderConfiguredModel,
  type AiProviderConnectionInput,
  type AiProviderId,
  type AiProviderSaveInput,
  isAiProviderId,
} from "@tessera/contracts"
import { resolveAiModelCapabilities } from "../catalog/model-capabilities"
import { normalizeAiProviderModelId, validateAiProviderBaseUrl } from "../catalog/provider-input-validation"
import { aiProviderApiKeyValidationMessage } from "./api-key-validation"

const MULTI_CONFIG_PROVIDER_IDS = new Set<AiProviderId>(["openai-compatible", "anthropic-compatible"])
const CAPABILITY_STATES = [
  "supported",
  "unsupported",
  "unknown",
] as const satisfies readonly AiModelCapabilityState[]
const CAPABILITY_SOURCES = [
  "builtin",
  "remote",
  "custom",
  "unknown",
] as const satisfies readonly AiModelCapabilitySource[]
const MAX_MODELS = 10_000
const MAX_CONFIG_ID_LENGTH = 128
const MAX_DISPLAY_NAME_LENGTH = 80

export type AiProviderConfigStoreRecord = {
  apiKeyCiphertext: string | null
  baseUrl: string
  configId: string
  displayName: string
  enabled: boolean
  modelsJson: string
  providerId: string
  updatedAt: number
}

export type AiProviderConfigStore = {
  delete(configId: string): void
  find(configId: string): AiProviderConfigStoreRecord | null
  list(): AiProviderConfigStoreRecord[]
  save(record: AiProviderConfigStoreRecord): void
}

export type AiProviderSecretStorage = {
  decrypt(value: Uint8Array): string
  encrypt(value: string): Uint8Array
  isEncryptionAvailable(): boolean
}

export type AiProviderConfigService = {
  deleteConfig(configId: string): void
  listConfigs(): AiProviderConfig[]
  resolveConnection(input: AiProviderConnectionInput): AiProviderConnectionInput
  saveConfig(input: AiProviderSaveInput): AiProviderConfig
}

export class AiProviderConfigError extends Error {
  override readonly name = "AiProviderConfigError"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCapabilityState(value: unknown): value is AiModelCapabilityState {
  return typeof value === "string" && CAPABILITY_STATES.some((state) => state === value)
}

function isCapabilitySource(value: unknown): value is AiModelCapabilitySource {
  return typeof value === "string" && CAPABILITY_SOURCES.some((source) => source === value)
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function nullablePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null
}

function normalizeConfigId(value: unknown, providerId: AiProviderId): string {
  const configId = typeof value === "string" ? value.trim() : ""
  if (!configId || configId.length > MAX_CONFIG_ID_LENGTH || !/^[a-z0-9][a-z0-9._:-]*$/iu.test(configId)) {
    throw new AiProviderConfigError("连接 ID 无效。")
  }
  if (!MULTI_CONFIG_PROVIDER_IDS.has(providerId) && configId !== providerId) {
    throw new AiProviderConfigError("官方供应商只允许保存一条连接。")
  }
  return configId
}

function normalizeDisplayName(value: unknown): string {
  const displayName = typeof value === "string" ? value.trim() : ""
  if (!displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new AiProviderConfigError(`连接名称不能为空，且不能超过 ${MAX_DISPLAY_NAME_LENGTH} 个字符。`)
  }
  return displayName
}

function normalizeBaseUrl(value: unknown): string {
  const result = validateAiProviderBaseUrl(value)
  if (!result.ok) throw new AiProviderConfigError(result.message)
  return result.baseUrl
}

function normalizeCapabilities(value: unknown): AiModelCapabilities | undefined {
  if (!isRecord(value)) return undefined
  const functionCall = value.functionCall ?? value.toolUse
  const reasoning = value.reasoning
  const structuredOutput = value.structuredOutput ?? "unknown"
  if (
    !isCapabilityState(functionCall) ||
    !isCapabilityState(reasoning) ||
    !isCapabilityState(structuredOutput)
  ) {
    return undefined
  }
  return { functionCall, reasoning, structuredOutput }
}

function normalizeSourceMap<Key extends string>(
  value: unknown,
  keys: readonly Key[],
): Partial<Record<Key, AiModelCapabilitySource>> | undefined {
  if (!isRecord(value)) return undefined
  const result: Partial<Record<Key, AiModelCapabilitySource>> = {}
  for (const key of keys) {
    if (isCapabilitySource(value[key])) result[key] = value[key]
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeModalities(value: unknown): AiModelModality[] | undefined {
  if (!Array.isArray(value)) return undefined
  const modalities = value.filter(
    (candidate): candidate is AiModelModality =>
      typeof candidate === "string" && AI_MODEL_MODALITIES.some((modality) => modality === candidate),
  )
  return [...new Set(modalities)]
}

function isModelType(value: unknown): value is AiModelType {
  return typeof value === "string" && AI_MODEL_TYPES.some((modelType) => modelType === value)
}

function normalizeModelType(value: unknown): AiModelType | undefined {
  return isModelType(value) ? value : undefined
}

function isEndpointType(value: unknown): value is AiModelEndpointBinding["endpointType"] {
  return typeof value === "string" && AI_MODEL_ENDPOINT_TYPES.some((known) => known === value)
}

function normalizeEndpointBindings(value: unknown): AiModelEndpointBinding[] | undefined {
  if (!Array.isArray(value)) return undefined
  const bindings: AiModelEndpointBinding[] = []
  const endpointTypes = new Set<AiModelEndpointBinding["endpointType"]>()
  for (const candidate of value) {
    if (!isRecord(candidate)) continue
    const endpointType = candidate.endpointType
    if (
      !isEndpointType(endpointType) ||
      endpointTypes.has(endpointType) ||
      !isCapabilityState(candidate.nativeWebSearch) ||
      !isCapabilitySource(candidate.source)
    ) {
      continue
    }
    endpointTypes.add(endpointType)
    const capabilityOverrides = normalizeCapabilities(candidate.capabilityOverrides)
    bindings.push({
      endpointType,
      nativeWebSearch: candidate.nativeWebSearch,
      source: candidate.source,
      ...(candidate.officialOnly === true ? { officialOnly: true } : {}),
      ...(capabilityOverrides ? { capabilityOverrides } : {}),
    })
  }
  return bindings.length > 0 ? bindings : undefined
}

function normalizeModel(value: unknown, providerId: AiProviderId): AiProviderConfiguredModel | null {
  if (!isRecord(value)) return null
  const id = normalizeAiProviderModelId(value.id)
  if (!id || typeof value.enabled !== "boolean") return null
  const capabilitySource = isCapabilitySource(value.capabilitySource) ? value.capabilitySource : undefined
  const capabilities = normalizeCapabilities(value.capabilities)
  const legacyCapabilities = isRecord(value.capabilities) ? value.capabilities : null
  const capabilitySources = normalizeSourceMap<AiModelCapabilityKey>(value.capabilitySources, [
    "functionCall",
    "reasoning",
    "structuredOutput",
  ])
  const fieldSources = normalizeSourceMap<AiModelProfileField>(value.fieldSources, [
    "contextWindow",
    "inputModalities",
    "maxInputTokens",
    "maxOutputTokens",
    "modelType",
    "name",
    "outputModalities",
  ])
  const normalizedInputModalities = normalizeModalities(value.inputModalities)
  const endpointBindings = normalizeEndpointBindings(value.endpointBindings)
  const modelType = normalizeModelType(value.modelType)
  const outputModalities = normalizeModalities(value.outputModalities)
  const legacyInputModalities =
    legacyCapabilities && legacyCapabilities.imageInput === "supported"
      ? (["text", "image"] satisfies AiModelModality[])
      : legacyCapabilities && legacyCapabilities.imageInput === "unsupported"
        ? (["text"] satisfies AiModelModality[])
        : undefined
  const inputModalities = normalizedInputModalities ?? legacyInputModalities
  return {
    ...resolveAiModelCapabilities(providerId, {
      id,
      name: nullableString(value.name),
      ownedBy: nullableString(value.ownedBy),
      contextWindow: nullablePositiveInteger(value.contextWindow),
      maxInputTokens: nullablePositiveInteger(value.maxInputTokens),
      maxOutputTokens: nullablePositiveInteger(value.maxOutputTokens),
      ...(capabilities ? { capabilities } : {}),
      ...(capabilitySources ? { capabilitySources } : {}),
      ...(capabilitySource ? { capabilitySource } : {}),
      ...(endpointBindings ? { endpointBindings } : {}),
      ...(fieldSources ? { fieldSources } : {}),
      ...(inputModalities ? { inputModalities } : {}),
      ...(modelType ? { modelType } : {}),
      ...(outputModalities ? { outputModalities } : {}),
    }),
    enabled: value.enabled,
  }
}

function normalizeModels(value: unknown, providerId: AiProviderId): AiProviderConfiguredModel[] {
  if (!Array.isArray(value)) throw new AiProviderConfigError("模型配置格式无效。")
  if (value.length > MAX_MODELS) throw new AiProviderConfigError(`单个供应商最多保存 ${MAX_MODELS} 个模型。`)
  const models: AiProviderConfiguredModel[] = []
  const ids = new Set<string>()
  for (const candidate of value) {
    const model = normalizeModel(candidate, providerId)
    if (!model || ids.has(model.id)) continue
    ids.add(model.id)
    models.push(model)
  }
  return models
}

function decodeModels(record: AiProviderConfigStoreRecord, providerId: AiProviderId) {
  try {
    return normalizeModels(JSON.parse(record.modelsJson), providerId)
  } catch {
    return []
  }
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function hexToBytes(value: string): Uint8Array {
  if (!value || value.length % 2 !== 0 || !/^[\da-f]+$/iu.test(value)) {
    throw new AiProviderConfigError("保存的 API Key 密文已损坏，请删除后重新保存。")
  }
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16))
}

function publicConfig(record: AiProviderConfigStoreRecord): AiProviderConfig | null {
  if (!isAiProviderId(record.providerId)) return null
  return {
    configId: record.configId,
    displayName: record.displayName,
    providerId: record.providerId,
    enabled: record.enabled,
    baseUrl: record.baseUrl,
    models: decodeModels(record, record.providerId),
    apiKeyConfigured: Boolean(record.apiKeyCiphertext),
    updatedAt: record.updatedAt,
  }
}

export type CreateAiProviderConfigServiceOptions = {
  now?: () => number
  secretStorage: AiProviderSecretStorage
  store: AiProviderConfigStore
}

export function createAiProviderConfigService({
  store,
  secretStorage,
  now = Date.now,
}: CreateAiProviderConfigServiceOptions): AiProviderConfigService {
  const requireEncryption = () => {
    if (!secretStorage.isEncryptionAvailable()) {
      throw new AiProviderConfigError("系统安全凭据存储当前不可用，无法保存或读取 API Key。")
    }
  }

  return {
    listConfigs: () =>
      store
        .list()
        .map(publicConfig)
        .filter((config): config is AiProviderConfig => config !== null),

    saveConfig: (input) => {
      if (!isRecord(input) || !isAiProviderId(input.providerId)) {
        throw new AiProviderConfigError("不支持这个 AI 供应商。")
      }
      if (typeof input.enabled !== "boolean") throw new AiProviderConfigError("供应商启用状态无效。")
      const configId = normalizeConfigId(input.configId, input.providerId)
      const displayName = normalizeDisplayName(input.displayName)
      const baseUrl = normalizeBaseUrl(input.baseUrl)
      const models = normalizeModels(input.models, input.providerId)
      const existing = store.find(configId)
      if (existing && existing.providerId !== input.providerId) {
        throw new AiProviderConfigError("连接与所选协议不匹配。")
      }
      let apiKeyCiphertext = existing?.apiKeyCiphertext ?? null
      if (input.removeApiKey) {
        apiKeyCiphertext = null
      } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
        const apiKey = input.apiKey.trim()
        const validationMessage = aiProviderApiKeyValidationMessage(apiKey)
        if (validationMessage) throw new AiProviderConfigError(validationMessage)
        requireEncryption()
        apiKeyCiphertext = bytesToHex(secretStorage.encrypt(apiKey))
      }

      const record: AiProviderConfigStoreRecord = {
        configId,
        displayName,
        providerId: input.providerId,
        enabled: input.enabled,
        baseUrl,
        modelsJson: JSON.stringify(models),
        apiKeyCiphertext,
        updatedAt: now(),
      }
      store.save(record)
      const config = publicConfig(record)
      if (!config) throw new AiProviderConfigError("供应商配置无效。")
      return config
    },

    deleteConfig: (configId) => {
      if (typeof configId !== "string" || !configId.trim()) {
        throw new AiProviderConfigError("连接 ID 无效。")
      }
      store.delete(configId.trim())
    },

    resolveConnection: (input) => {
      if (!isRecord(input) || !isAiProviderId(input.providerId)) {
        throw new AiProviderConfigError("不支持这个 AI 供应商。")
      }
      const configId = normalizeConfigId(input.configId, input.providerId)
      if (typeof input.apiKey === "string" && input.apiKey.trim()) {
        const apiKey = input.apiKey.trim()
        const validationMessage = aiProviderApiKeyValidationMessage(apiKey)
        if (validationMessage) throw new AiProviderConfigError(validationMessage)
        return { ...input, configId, apiKey }
      }
      const config = store.find(configId)
      if (config && config.providerId !== input.providerId) {
        throw new AiProviderConfigError("连接与所选协议不匹配。")
      }
      const ciphertext = config?.apiKeyCiphertext
      if (!ciphertext) return { ...input, configId, apiKey: "" }
      requireEncryption()
      try {
        const apiKey = secretStorage.decrypt(hexToBytes(ciphertext))
        const validationMessage = aiProviderApiKeyValidationMessage(apiKey)
        if (validationMessage) throw new AiProviderConfigError(validationMessage)
        return { ...input, configId, apiKey }
      } catch (error) {
        if (error instanceof AiProviderConfigError) throw error
        throw new AiProviderConfigError("保存的 API Key 无法解密，请删除后重新保存。")
      }
    },
  }
}
