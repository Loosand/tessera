/**
 * [INPUT]: 内存配置仓储、伪安全存储与供应商配置服务
 * [OUTPUT]: 跨服务实例持久化、密钥加密/复用/删除和公开配置隔离的回归验证
 * [POS]: AI 供应商配置持久化领域层的无平台单元测试
 * [DOC]: docs/architecture/ai-providers.md、docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  AiProviderConfigError,
  type AiProviderConfigStore,
  type AiProviderConfigStoreRecord,
  createAiProviderConfigService,
} from "./provider-config-service"

function createStore(): AiProviderConfigStore {
  const records = new Map<string, AiProviderConfigStoreRecord>()
  return {
    find: (configId) => records.get(configId) ?? null,
    list: () => [...records.values()],
    save: (record) => records.set(record.configId, { ...record }),
    delete: (configId) => {
      records.delete(configId)
    },
  }
}

const secretStorage = {
  isEncryptionAvailable: () => true,
  encrypt: (value: string) => Uint8Array.from(new TextEncoder().encode(value), (byte) => byte ^ 0xa5),
  decrypt: (value: Uint8Array) => new TextDecoder().decode(Uint8Array.from(value, (byte) => byte ^ 0xa5)),
}

const CONFIG = {
  configId: "openrouter",
  displayName: "OpenRouter",
  providerId: "openrouter" as const,
  enabled: true,
  baseUrl: "https://openrouter.ai/api/v1/",
  models: [
    {
      id: "openrouter/auto",
      enabled: true,
      name: "Auto",
      ownedBy: "openrouter",
      contextWindow: 2_000_000,
      maxOutputTokens: null,
    },
  ],
}

describe("AI 供应商配置服务", () => {
  it("跨服务实例恢复普通配置且不向渲染层回传密钥", () => {
    const store = createStore()
    const first = createAiProviderConfigService({ store, secretStorage, now: () => 100 })
    const saved = first.saveConfig({ ...CONFIG, apiKey: "secret-key" })

    expect(saved).toMatchObject({ apiKeyConfigured: true, baseUrl: "https://openrouter.ai/api/v1" })
    expect(saved).not.toHaveProperty("apiKey")
    expect(store.find("openrouter")?.apiKeyCiphertext).not.toContain("secret-key")

    const restarted = createAiProviderConfigService({ store, secretStorage, now: () => 200 })
    expect(restarted.listConfigs()).toEqual([saved])
    expect(
      restarted.resolveConnection({
        configId: "openrouter",
        providerId: "openrouter",
        baseUrl: CONFIG.baseUrl,
        apiKey: "",
      }).apiKey,
    ).toBe("secret-key")
  })

  it("未输入新密钥时保留旧密钥，显式移除后不再解析", () => {
    const store = createStore()
    const service = createAiProviderConfigService({ store, secretStorage })
    service.saveConfig({ ...CONFIG, apiKey: "first-key" })
    service.saveConfig({ ...CONFIG, enabled: false })
    expect(
      service.resolveConnection({
        configId: "openrouter",
        providerId: "openrouter",
        baseUrl: CONFIG.baseUrl,
        apiKey: "",
      }).apiKey,
    ).toBe("first-key")

    const cleared = service.saveConfig({ ...CONFIG, removeApiKey: true })
    expect(cleared.apiKeyConfigured).toBe(false)
    expect(
      service.resolveConnection({
        configId: "openrouter",
        providerId: "openrouter",
        baseUrl: CONFIG.baseUrl,
        apiKey: "",
      }).apiKey,
    ).toBe("")
  })

  it("删除配置会同时删除普通配置和加密密钥", () => {
    const store = createStore()
    const service = createAiProviderConfigService({ store, secretStorage })
    service.saveConfig({ ...CONFIG, apiKey: "secret-key" })
    service.deleteConfig("openrouter")
    expect(service.listConfigs()).toEqual([])
    expect(store.find("openrouter")).toBeNull()
  })

  it("系统安全存储不可用时拒绝明文密钥落库", () => {
    const service = createAiProviderConfigService({
      store: createStore(),
      secretStorage: { ...secretStorage, isEncryptionAvailable: () => false },
    })
    expect(() => service.saveConfig({ ...CONFIG, apiKey: "secret-key" })).toThrow("安全凭据存储")
  })

  it("兼容协议允许保存多条具名连接，并按连接分别解析凭据", () => {
    const store = createStore()
    const service = createAiProviderConfigService({ store, secretStorage })

    service.saveConfig({
      ...CONFIG,
      configId: "anthropic-compatible:deepseek",
      displayName: "DeepSeek Messages",
      providerId: "anthropic-compatible",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: "deepseek-key",
    })
    service.saveConfig({
      ...CONFIG,
      configId: "anthropic-compatible:relay",
      displayName: "团队中转",
      providerId: "anthropic-compatible",
      baseUrl: "https://relay.example.com/anthropic",
      apiKey: "relay-key",
    })

    expect(service.listConfigs()).toMatchObject([
      {
        configId: "anthropic-compatible:deepseek",
        displayName: "DeepSeek Messages",
        providerId: "anthropic-compatible",
      },
      {
        configId: "anthropic-compatible:relay",
        displayName: "团队中转",
        providerId: "anthropic-compatible",
      },
    ])
    expect(
      service.resolveConnection({
        configId: "anthropic-compatible:relay",
        providerId: "anthropic-compatible",
        baseUrl: "https://relay.example.com/anthropic",
        apiKey: "",
      }),
    ).toMatchObject({
      baseUrl: "https://relay.example.com/anthropic",
      apiKey: "relay-key",
    })
  })

  it("官方供应商保持单例，且连接 ID 不能跨协议复用", () => {
    const store = createStore()
    const service = createAiProviderConfigService({ store, secretStorage })

    expect(() =>
      service.saveConfig({ ...CONFIG, configId: "deepseek:relay", providerId: "deepseek" }),
    ).toThrow("官方供应商只允许保存一条连接")

    service.saveConfig({
      ...CONFIG,
      configId: "compatible:shared",
      displayName: "OpenAI 中转",
      providerId: "openai-compatible",
    })
    expect(() =>
      service.saveConfig({
        ...CONFIG,
        configId: "compatible:shared",
        displayName: "Anthropic 中转",
        providerId: "anthropic-compatible",
      }),
    ).toThrow(AiProviderConfigError)
    expect(service.listConfigs()).toHaveLength(1)
    expect(service.listConfigs()[0]?.providerId).toBe("openai-compatible")
  })
})
