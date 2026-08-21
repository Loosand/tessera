/**
 * [INPUT]: 类型化供应商配置、可注入配置仓储与平台安全密钥存储
 * [OUTPUT]: 已校验的供应商配置读写/删除、密钥加解密和连接凭据解析服务
 * [POS]: @tessera/ai/server 中独立于 Electron 与 SQLite 实现的配置持久化领域层
 * [DOC]: docs/architecture/ai-providers.md、docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AiProviderConfig,
  AiProviderConfiguredModel,
  AiProviderConnectionInput,
  AiProviderId,
  AiProviderSaveInput,
} from "@tessera/contracts"
import { resolveAiModelCapabilities } from "../model-capabilities"

const AI_PROVIDER_IDS = new Set<AiProviderId>([
  "openai-compatible",
  "anthropic-compatible",
  "deepseek",
  "grok",
  "openrouter",
])
const MULTI_CONFIG_PROVIDER_IDS = new Set<AiProviderId>([
  "openai-compatible",
  "anthropic-compatible",
])
const CAPABILITY_STATES = new Set(["supported", "unsupported", "unknown"])
const CAPABILITY_SOURCES = new Set(["builtin", "remote", "custom", "unknown"])
const MAX_API_KEY_LENGTH = 16_384
const MAX_BASE_URL_LENGTH = 2_048
const MAX_MODEL_ID_LENGTH = 512
const MAX_MODELS = 10_000
const MAX_CONFIG_ID_LENGTH = 128
const MAX_DISPLAY_NAME_LENGTH = 80

export interface AiProviderConfigStoreRecord {
  apiKeyCiphertext: string | null
  baseUrl: string
  configId: string
  displayName: string
  enabled: boolean
  modelsJson: string
  providerId: string
  updatedAt: number
}

export interface AiProviderConfigStore {
  delete(configId: string): void
  find(configId: string): AiProviderConfigStoreRecord | null
  list(): AiProviderConfigStoreRecord[]
  save(record: AiProviderConfigStoreRecord): void
}

export interface AiProviderSecretStorage {
  decrypt(value: Uint8Array): string
  encrypt(value: string): Uint8Array
  isEncryptionAvailable(): boolean
}

export interface AiProviderConfigService {
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

function isProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && AI_PROVIDER_IDS.has(value as AiProviderId)
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function nullablePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null
}

function normalizeConfigId(value: unknown, providerId: AiProviderId): string {
  const configId = typeof value === "string" ? value.trim() : ""
  if (
    !configId ||
    configId.length > MAX_CONFIG_ID_LENGTH ||
    !/^[a-z0-9][a-z0-9._:-]*$/iu.test(configId)
  ) {
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
  const baseUrl = typeof value === "string" ? value.trim() : ""
  if (!baseUrl || baseUrl.length > MAX_BASE_URL_LENGTH) {
    throw new AiProviderConfigError("请输入有效的 API 地址。")
  }

  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new AiProviderConfigError("API 地址必须是完整的 http(s) URL。")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AiProviderConfigError("API 地址只支持 http 或 https 协议。")
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AiProviderConfigError("API 地址不能包含凭据、查询参数或片段。")
  }
  return baseUrl.replace(/\/+$/u, "")
}

function normalizeCapabilities(value: unknown) {
  if (!isRecord(value)) return undefined
  const imageInput = value.imageInput
  const reasoning = value.reasoning
  const search = value.search
  const toolUse = value.toolUse
  if (
    !CAPABILITY_STATES.has(imageInput as string) ||
    !CAPABILITY_STATES.has(reasoning as string) ||
    !CAPABILITY_STATES.has(search as string) ||
    !CAPABILITY_STATES.has(toolUse as string)
  ) {
    return undefined
  }
  return { imageInput, reasoning, search, toolUse } as AiProviderConfiguredModel["capabilities"]
}

function normalizeModel(value: unknown, providerId: AiProviderId): AiProviderConfiguredModel | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === "string" ? value.id.trim() : ""
  if (!id || id.length > MAX_MODEL_ID_LENGTH || typeof value.enabled !== "boolean") return null
  const capabilitySource = CAPABILITY_SOURCES.has(value.capabilitySource as string)
    ? (value.capabilitySource as AiProviderConfiguredModel["capabilitySource"])
    : undefined
  const capabilities = normalizeCapabilities(value.capabilities)
  return {
    ...resolveAiModelCapabilities(providerId, {
      id,
      name: nullableString(value.name),
      ownedBy: nullableString(value.ownedBy),
      contextWindow: nullablePositiveInteger(value.contextWindow),
      maxOutputTokens: nullablePositiveInteger(value.maxOutputTokens),
      ...(capabilities ? { capabilities } : {}),
      ...(capabilitySource ? { capabilitySource } : {}),
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
  if (!isProviderId(record.providerId)) return null
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

export function createAiProviderConfigService({
  store,
  secretStorage,
  now = Date.now,
}: {
  store: AiProviderConfigStore
  secretStorage: AiProviderSecretStorage
  now?: () => number
}): AiProviderConfigService {
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
      if (!isRecord(input) || !isProviderId(input.providerId)) {
        throw new AiProviderConfigError("不支持这个 AI 供应商。")
      }
      if (typeof input.enabled !== "boolean") throw new AiProviderConfigError("供应商启用状态无效。")
      const configId = normalizeConfigId(input.configId, input.providerId)
      const displayName = normalizeDisplayName(input.displayName)
      const baseUrl = normalizeBaseUrl(input.baseUrl)
      const models = normalizeModels(input.models, input.providerId)
      const existing = store.find(configId)
      let apiKeyCiphertext = existing?.apiKeyCiphertext ?? null
      if (input.removeApiKey) {
        apiKeyCiphertext = null
      } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
        const apiKey = input.apiKey.trim()
        if (apiKey.length > MAX_API_KEY_LENGTH) throw new AiProviderConfigError("API Key 长度无效。")
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
      if (!isRecord(input) || !isProviderId(input.providerId)) {
        throw new AiProviderConfigError("不支持这个 AI 供应商。")
      }
      const configId = normalizeConfigId(input.configId, input.providerId)
      if (typeof input.apiKey === "string" && input.apiKey.trim()) {
        return { ...input, configId, apiKey: input.apiKey.trim() }
      }
      const config = store.find(configId)
      if (config && config.providerId !== input.providerId) {
        throw new AiProviderConfigError("连接与所选协议不匹配。")
      }
      const ciphertext = config?.apiKeyCiphertext
      if (!ciphertext) return { ...input, configId, apiKey: "" }
      requireEncryption()
      try {
        return { ...input, configId, apiKey: secretStorage.decrypt(hexToBytes(ciphertext)) }
      } catch (error) {
        if (error instanceof AiProviderConfigError) throw error
        throw new AiProviderConfigError("保存的 API Key 无法解密，请删除后重新保存。")
      }
    },
  }
}
