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
const CAPABILITY_STATES = new Set(["supported", "unsupported", "unknown"])
const CAPABILITY_SOURCES = new Set(["builtin", "remote", "custom", "unknown"])
const MAX_API_KEY_LENGTH = 16_384
const MAX_BASE_URL_LENGTH = 2_048
const MAX_MODEL_ID_LENGTH = 512
const MAX_MODELS = 10_000

export interface AiProviderConfigStoreRecord {
  apiKeyCiphertext: string | null
  baseUrl: string
  enabled: boolean
  modelsJson: string
  providerId: string
  updatedAt: number
}

export interface AiProviderConfigStore {
  delete(providerId: string): void
  find(providerId: string): AiProviderConfigStoreRecord | null
  list(): AiProviderConfigStoreRecord[]
  save(record: AiProviderConfigStoreRecord): void
}

export interface AiProviderSecretStorage {
  decrypt(value: Uint8Array): string
  encrypt(value: string): Uint8Array
  isEncryptionAvailable(): boolean
}

export interface AiProviderConfigService {
  deleteConfig(providerId: AiProviderId): void
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
      const baseUrl = normalizeBaseUrl(input.baseUrl)
      const models = normalizeModels(input.models, input.providerId)
      const existing = store.find(input.providerId)
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

    deleteConfig: (providerId) => {
      if (!isProviderId(providerId)) throw new AiProviderConfigError("不支持这个 AI 供应商。")
      store.delete(providerId)
    },

    resolveConnection: (input) => {
      if (!isRecord(input) || !isProviderId(input.providerId)) {
        throw new AiProviderConfigError("不支持这个 AI 供应商。")
      }
      if (typeof input.apiKey === "string" && input.apiKey.trim()) {
        return { ...input, apiKey: input.apiKey.trim() }
      }
      const ciphertext = store.find(input.providerId)?.apiKeyCiphertext
      if (!ciphertext) return { ...input, apiKey: "" }
      requireEncryption()
      try {
        return { ...input, apiKey: secretStorage.decrypt(hexToBytes(ciphertext)) }
      } catch (error) {
        if (error instanceof AiProviderConfigError) throw error
        throw new AiProviderConfigError("保存的 API Key 无法解密，请删除后重新保存。")
      }
    },
  }
}
