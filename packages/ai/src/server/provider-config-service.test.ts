/**
 * [INPUT]: 内存配置仓储、伪安全存储与供应商配置服务
 * [OUTPUT]: 跨服务实例持久化、密钥格式校验、加密/复用/删除和公开配置隔离的回归验证
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

  it("读取旧版模型能力时迁移到统一模型事实", () => {
    const store = createStore()
    store.save({
      apiKeyCiphertext: null,
      baseUrl: "https://api.deepseek.com",
      configId: "deepseek",
      displayName: "DeepSeek",
      enabled: true,
      modelsJson: JSON.stringify([
        {
          capabilities: {
            imageInput: "supported",
            reasoning: "supported",
            search: "unsupported",
            toolUse: "supported",
          },
          capabilitySource: "custom",
          contextWindow: null,
          enabled: true,
          id: "deepseek-v4-flash-vision-exp",
          maxOutputTokens: null,
          name: null,
          ownedBy: null,
        },
      ]),
      providerId: "deepseek",
      updatedAt: 1,
    })

    const model = createAiProviderConfigService({ store, secretStorage }).listConfigs()[0]?.models[0]
    expect(model).toMatchObject({
      capabilities: {
        functionCall: "supported",
        reasoning: "supported",
        structuredOutput: "unknown",
      },
      inputModalities: ["text", "image"],
      modelType: "chat",
    })
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

  it("保存时拒绝不能安全写入鉴权请求头的密钥", () => {
    const service = createAiProviderConfigService({ store: createStore(), secretStorage })

    expect(() => service.saveConfig({ ...CONFIG, apiKey: "我的 API Key" })).toThrow(
      "请只粘贴供应商提供的原始 Key",
    )
  })

  it("解析旧配置时把不安全密钥转换为可操作错误", () => {
    const store = createStore()
    const service = createAiProviderConfigService({ store, secretStorage })
    service.saveConfig({ ...CONFIG, apiKey: "secret-key" })
    const record = store.find("openrouter")
    if (!record) throw new Error("测试配置未保存")
    const legacyCiphertext = [...secretStorage.encrypt("我的 API Key")]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
    store.save({ ...record, apiKeyCiphertext: legacyCiphertext })

    expect(() =>
      service.resolveConnection({
        configId: "openrouter",
        providerId: "openrouter",
        baseUrl: CONFIG.baseUrl,
        apiKey: "",
      }),
    ).toThrow("请只粘贴供应商提供的原始 Key")
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
