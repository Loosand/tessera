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
  type AiProviderConfigStore,
  type AiProviderConfigStoreRecord,
  createAiProviderConfigService,
} from "./provider-config-service"

function createStore(): AiProviderConfigStore {
  const records = new Map<string, AiProviderConfigStoreRecord>()
  return {
    find: (providerId) => records.get(providerId) ?? null,
    list: () => [...records.values()],
    save: (record) => records.set(record.providerId, { ...record }),
    delete: (providerId) => {
      records.delete(providerId)
    },
  }
}

const secretStorage = {
  isEncryptionAvailable: () => true,
  encrypt: (value: string) => Uint8Array.from(new TextEncoder().encode(value), (byte) => byte ^ 0xa5),
  decrypt: (value: Uint8Array) => new TextDecoder().decode(Uint8Array.from(value, (byte) => byte ^ 0xa5)),
}

const CONFIG = {
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
      service.resolveConnection({ providerId: "openrouter", baseUrl: CONFIG.baseUrl, apiKey: "" }).apiKey,
    ).toBe("first-key")

    const cleared = service.saveConfig({ ...CONFIG, removeApiKey: true })
    expect(cleared.apiKeyConfigured).toBe(false)
    expect(
      service.resolveConnection({ providerId: "openrouter", baseUrl: CONFIG.baseUrl, apiKey: "" }).apiKey,
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
})
