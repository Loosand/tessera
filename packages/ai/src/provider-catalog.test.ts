/**
 * [INPUT]: AI 供应商元数据与模型草稿转换函数
 * [OUTPUT]: 首批供应商范围、搜索与模型去重行为的回归测试
 * [POS]: @tessera/ai 供应商目录与配置模型的回归测试
 * [DOC]: design.md、docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  AI_PROVIDER_DEFINITIONS,
  appendAiProviderModel,
  createInitialAiProviderDrafts,
  matchesAiProvider,
} from "./provider-catalog"

describe("AI 供应商设置模型", () => {
  it("只暴露首批五个 API 供应商", () => {
    expect(AI_PROVIDER_DEFINITIONS.map((provider) => provider.id)).toEqual([
      "openai-compatible",
      "anthropic-compatible",
      "deepseek",
      "grok",
      "openrouter",
    ])
  })

  it("初始化时不假定任何供应商已配置", () => {
    const drafts = createInitialAiProviderDrafts()
    expect(Object.values(drafts).every((draft) => !draft.enabled && !draft.apiKeyConfigured)).toBe(true)
  })

  it("为官方服务预填可覆盖的 API 地址", () => {
    const drafts = createInitialAiProviderDrafts()
    expect(
      Object.fromEntries(
        AI_PROVIDER_DEFINITIONS.map((provider) => [provider.id, drafts[provider.id].baseUrl]),
      ),
    ).toEqual({
      "openai-compatible": "https://api.openai.com/v1",
      "anthropic-compatible": "https://api.anthropic.com/v1",
      deepseek: "https://api.deepseek.com",
      grok: "https://api.x.ai/v1",
      openrouter: "https://openrouter.ai/api/v1",
    })
  })

  it("可以按名称、协议和适配器搜索供应商", () => {
    const anthropic = AI_PROVIDER_DEFINITIONS.find((provider) => provider.id === "anthropic-compatible")
    expect(anthropic).toBeDefined()
    if (!anthropic) return
    expect(matchesAiProvider(anthropic, "anthropic")).toBe(true)
    expect(matchesAiProvider(anthropic, "messages")).toBe(true)
    expect(matchesAiProvider(anthropic, "openrouter")).toBe(false)
  })

  it("手动模型会修剪空白并拒绝重复", () => {
    const first = appendAiProviderModel([], "  model-a  ")
    expect(first).toEqual([{ id: "model-a", enabled: true }])
    expect(appendAiProviderModel(first, "model-a")).toEqual(first)
  })
})
