/**
 * [INPUT]: 供应商设置纯状态辅助与代表性持久化连接配置
 * [OUTPUT]: 判别式选择、连接枚举及配置/草稿转换的回归验证
 * [POS]: provider-settings-state 的无 React 单元测试
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiProviderConfig } from "@tessera/contracts"
import { describe, expect, it } from "vitest"
import { createInitialAiProviderDrafts } from "../provider-catalog"
import {
  ALL_PROVIDER_SELECTION,
  draftFromConfig,
  listProviderConnections,
  providerConfigSelection,
  saveInputFromDraft,
} from "./provider-settings-state"

const CONFIG: AiProviderConfig = {
  apiKeyConfigured: true,
  baseUrl: "https://openrouter.ai/api/v1",
  configId: "openrouter",
  displayName: "OpenRouter",
  enabled: true,
  models: [
    {
      contextWindow: null,
      enabled: true,
      id: "openrouter/auto",
      maxOutputTokens: null,
      name: "Auto",
      ownedBy: "openrouter",
    },
  ],
  providerId: "openrouter",
  updatedAt: 100,
}

describe("供应商设置纯状态", () => {
  it("用判别字段区分总览与具体连接", () => {
    expect(ALL_PROVIDER_SELECTION).toEqual({ kind: "all" })
    expect(providerConfigSelection("openrouter")).toEqual({ configId: "openrouter", kind: "config" })
  })

  it("把持久化配置转换为独立草稿，并只在存在新密钥时写入保存输入", () => {
    const draft = draftFromConfig(CONFIG)
    expect(draft).toMatchObject({ configId: "openrouter", models: [{ id: "openrouter/auto" }] })
    expect(draft.models).not.toBe(CONFIG.models)
    expect(saveInputFromDraft(draft)).not.toHaveProperty("apiKey")
    expect(saveInputFromDraft(draft, "  secret-key  ")).toMatchObject({ apiKey: "secret-key" })
  })

  it("把内置与命名连接解析为带供应商定义的视图", () => {
    const drafts = createInitialAiProviderDrafts([
      CONFIG,
      {
        ...CONFIG,
        configId: "openai-compatible:relay",
        displayName: "Relay",
        models: [],
        providerId: "openai-compatible",
      },
    ])

    expect(
      listProviderConnections(drafts).map(({ draft, provider }) => [draft.configId, provider.id]),
    ).toContainEqual(["openai-compatible:relay", "openai-compatible"])
  })
})
