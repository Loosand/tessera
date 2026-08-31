/**
 * [INPUT]: AI 供应商定义、持久化连接配置、界面草稿与当前连接选择
 * [OUTPUT]: 设置页共用的判别式选择、连接视图、配置/草稿转换与供应商定义解析辅助
 * [POS]: @tessera/ai/react 供应商设置界面的无 React 状态与转换边界
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiProviderConfig, AiProviderSaveInput } from "@tessera/contracts"
import {
  AI_PROVIDER_DEFINITIONS,
  type AiProviderDefinition,
  type AiProviderDraft,
  type AiProviderDrafts,
  type AiProviderId,
} from "../catalog/provider-catalog"

export type ProviderSelection = Readonly<{ kind: "all" }> | Readonly<{ configId: string; kind: "config" }>

export type ProviderConnectionView = Readonly<{
  draft: AiProviderDraft
  provider: AiProviderDefinition
}>

export const ALL_PROVIDER_SELECTION: ProviderSelection = { kind: "all" }

export function providerConfigSelection(configId: string): ProviderSelection {
  return { configId, kind: "config" }
}

export function findProviderDefinition(providerId: AiProviderId): AiProviderDefinition {
  const provider = AI_PROVIDER_DEFINITIONS.find((candidate) => candidate.id === providerId)
  if (!provider) throw new Error(`未知的 AI 供应商协议：${providerId}`)
  return provider
}

function isAiProviderDraft(draft: AiProviderDraft | undefined): draft is AiProviderDraft {
  return draft !== undefined
}

export function listProviderConnections(drafts: AiProviderDrafts): ProviderConnectionView[] {
  return Object.values(drafts)
    .filter(isAiProviderDraft)
    .map((draft) => ({
      draft,
      provider: findProviderDefinition(draft.providerId),
    }))
}

export function draftFromConfig(config: AiProviderConfig): AiProviderDraft {
  return {
    apiKeyConfigured: config.apiKeyConfigured,
    baseUrl: config.baseUrl,
    configId: config.configId,
    displayName: config.displayName,
    enabled: config.enabled,
    models: config.models.map((model) => ({ ...model })),
    providerId: config.providerId,
  }
}

export function saveInputFromDraft(draft: AiProviderDraft, apiKey = ""): AiProviderSaveInput {
  return {
    configId: draft.configId,
    displayName: draft.displayName,
    providerId: draft.providerId,
    enabled: draft.enabled,
    baseUrl: draft.baseUrl,
    models: draft.models.map((model) => ({ ...model })),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
  }
}
