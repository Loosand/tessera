/**
 * [INPUT]: 不同启用、密钥与模型状态的供应商配置
 * [OUTPUT]: 任务页可用模型筛选规则的回归验证
 * [POS]: 渲染层 AI 模型状态适配器的单元测试
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiProviderConfig, AiProviderConfiguredModel, AiProviderModel } from "@tessera/contracts"
import { describe, expect, it } from "vitest"
import { mergeModelsForTaskRefresh, selectAvailableAiModels } from "./use-ai-models"

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

const discoveredModel = (id: string): AiProviderModel => ({
  contextWindow: null,
  id,
  maxOutputTokens: null,
  name: id,
  ownedBy: null,
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
        id: "deepseek-chat",
        providerId: "deepseek",
        providerName: "DeepSeek",
      }),
    ])
  })

  it("任务页首次主动发现目录时启用第一个模型", () => {
    expect(
      mergeModelsForTaskRefresh(config({ models: [] }), [
        discoveredModel("deepseek-chat"),
        discoveredModel("deepseek-reasoner"),
      ]).map(({ enabled, id }) => ({ enabled, id })),
    ).toEqual([
      { enabled: true, id: "deepseek-chat" },
      { enabled: false, id: "deepseek-reasoner" },
    ])
  })

  it("不会覆盖用户已经保存的模型启停选择", () => {
    expect(
      mergeModelsForTaskRefresh(
        config({ models: [model("deepseek-chat", false), model("deepseek-reasoner", false)] }),
        [discoveredModel("deepseek-chat"), discoveredModel("deepseek-reasoner")],
      ).every((candidate) => !candidate.enabled),
    ).toBe(true)
  })
})
