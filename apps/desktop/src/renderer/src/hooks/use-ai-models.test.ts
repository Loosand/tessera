/**
 * [INPUT]: 不同启用、密钥与模型状态的供应商配置，以及可控的 SQLite 配置窄桥
 * [OUTPUT]: 任务页可用模型筛选与应用级 stale-while-revalidate 快照的回归验证
 * [POS]: 渲染层应用级 AI 模型状态适配器的单元测试
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiProviderConfig, AiProviderConfiguredModel } from "@tessera/contracts"
import { describe, expect, it, vi } from "vitest"
import { createAiModelStore, selectAvailableAiModels } from "./use-ai-models"

const model = (id: string, enabled = true): AiProviderConfiguredModel => ({
  contextWindow: null,
  enabled,
  id,
  maxOutputTokens: null,
  name: id,
  ownedBy: null,
})

const config = (overrides: Partial<AiProviderConfig> = {}): AiProviderConfig => ({
  apiKeyConfigured: true,
  baseUrl: "https://api.deepseek.com/v1",
  configId: "deepseek",
  displayName: "DeepSeek",
  enabled: true,
  models: [model("deepseek-chat")],
  providerId: "deepseek",
  updatedAt: 1,
  ...overrides,
})

describe("任务页可用模型", () => {
  it("只暴露已配置密钥、已启用供应商中的已启用模型", () => {
    const available = selectAvailableAiModels([
      config({ models: [model("deepseek-chat"), model("deepseek-reasoner", false)] }),
      config({ apiKeyConfigured: false, models: [model("missing-key")] }),
      config({ enabled: false, models: [model("disabled-provider")] }),
    ])

    expect(available).toEqual([
      expect.objectContaining({
        baseUrl: "https://api.deepseek.com/v1",
        id: "deepseek-chat",
        providerId: "deepseek",
        providerName: "DeepSeek",
      }),
    ])
  })

  it("重读 SQLite 时继续提供应用级旧快照，且多个订阅者不会重复加载", async () => {
    let resolveRevalidation: ((configs: AiProviderConfig[]) => void) | undefined
    const listAiProviderConfigs = vi
      .fn<() => Promise<AiProviderConfig[]>>()
      .mockResolvedValueOnce([config({ models: [model("cached-model")] })])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRevalidation = resolve
          }),
      )
    const store = createAiModelStore(() => ({
      listAiProviderConfigs,
      onAiProviderConfigsChanged: () => () => {},
    }))

    const unsubscribeFirst = store.subscribe(() => {})
    await vi.waitFor(() => expect(store.getSnapshot().initialized).toBe(true))
    const unsubscribeSecond = store.subscribe(() => {})
    expect(listAiProviderConfigs).toHaveBeenCalledOnce()

    const revalidation = store.revalidate()
    expect(store.getSnapshot()).toMatchObject({
      loading: false,
      refreshing: true,
      models: [expect.objectContaining({ id: "cached-model" })],
    })

    resolveRevalidation?.([config({ models: [model("updated-model")] })])
    await revalidation
    expect(store.getSnapshot()).toMatchObject({
      loading: false,
      refreshing: false,
      models: [expect.objectContaining({ id: "updated-model" })],
    })
    unsubscribeSecond()
    unsubscribeFirst()
  })
})
