/**
 * [INPUT]: 预加载层 SQLite AI 配置查询与配置变更事件、非敏感默认模型本地偏好
 * [OUTPUT]: 应用级共享的已启用对话模型 stale-while-revalidate 快照、实际连接地址、加载状态及错误
 * [POS]: 任务界面与 Electron AI 配置窄桥之间的应用级模型快照适配器
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiConfiguredModel, AiProviderConfig, AiProviderId, DesktopApi } from "@tessera/contracts"
import { useSyncExternalStore } from "react"

const PREFERRED_MODEL_STORAGE_KEY = "tessera.preferred-ai-model.v1"

const PROVIDER_NAMES: Record<AiProviderId, string> = {
  "openai-compatible": "OpenAI 兼容",
  "anthropic-compatible": "Anthropic",
  deepseek: "DeepSeek",
  grok: "Grok",
  openrouter: "OpenRouter",
}

export type AvailableAiModel = AiConfiguredModel & {
  readonly baseUrl: string
  readonly providerName: string
}

export function selectAvailableAiModels(configs: readonly AiProviderConfig[]): AvailableAiModel[] {
  return configs.flatMap((config) =>
    config.enabled && config.apiKeyConfigured
      ? config.models
          .filter((model) => model.enabled && (model.modelType ?? "chat") === "chat")
          .map((model) => ({
            ...model,
            baseUrl: config.baseUrl,
            configId: config.configId,
            displayName: config.displayName,
            providerId: config.providerId,
            providerName: PROVIDER_NAMES[config.providerId],
          }))
      : [],
  )
}

export function readPreferredAiModelKey() {
  if (typeof localStorage === "undefined") return ""
  try {
    return localStorage.getItem(PREFERRED_MODEL_STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

export function rememberPreferredAiModelKey(key: string) {
  if (typeof localStorage === "undefined" || !key || key.length > 2_048) return
  try {
    localStorage.setItem(PREFERRED_MODEL_STORAGE_KEY, key)
  } catch {
    // 默认模型偏好不可用不应阻止任务使用当前内存选择。
  }
}

type AiModelBridge = Pick<DesktopApi, "listAiProviderConfigs" | "onAiProviderConfigsChanged">

export type AiModelStoreSnapshot = {
  readonly error: string | null
  readonly initialized: boolean
  readonly loading: boolean
  readonly models: readonly AvailableAiModel[]
  readonly refreshing: boolean
}

const INITIAL_SNAPSHOT: AiModelStoreSnapshot = {
  error: null,
  initialized: false,
  loading: true,
  models: [],
  refreshing: false,
}

export function createAiModelStore(resolveBridge: () => AiModelBridge | undefined) {
  let snapshot = INITIAL_SNAPSHOT
  let activeLoad: Promise<void> | null = null
  let reloadAfterCurrent = false
  let unsubscribeFromBridge: (() => void) | undefined
  const listeners = new Set<() => void>()

  const publish = (nextSnapshot: AiModelStoreSnapshot) => {
    snapshot = nextSnapshot
    for (const listener of listeners) listener()
  }

  const revalidate = () => {
    if (activeLoad) return activeLoad
    publish({
      ...snapshot,
      error: null,
      loading: !snapshot.initialized,
      refreshing: snapshot.initialized,
    })

    activeLoad = (async () => {
      try {
        const bridge = resolveBridge()
        if (!bridge) throw new Error("桌面 AI 服务不可用。")
        const configs = await bridge.listAiProviderConfigs()
        publish({
          error: null,
          initialized: true,
          loading: false,
          models: selectAvailableAiModels(configs),
          refreshing: false,
        })
      } catch (cause) {
        publish({
          ...snapshot,
          error: cause instanceof Error ? cause.message : "读取可用模型失败。",
          initialized: true,
          loading: false,
          refreshing: false,
        })
      }
    })().finally(() => {
      activeLoad = null
      if (!reloadAfterCurrent) return
      reloadAfterCurrent = false
      void revalidate()
    })
    return activeLoad
  }

  const queueRevalidation = () => {
    if (activeLoad) {
      reloadAfterCurrent = true
      return
    }
    void revalidate()
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    if (listeners.size === 1) {
      const bridge = resolveBridge()
      unsubscribeFromBridge = bridge?.onAiProviderConfigsChanged(queueRevalidation)
      void revalidate()
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size > 0) return
      unsubscribeFromBridge?.()
      unsubscribeFromBridge = undefined
    }
  }

  return {
    getSnapshot: () => snapshot,
    revalidate,
    subscribe,
  }
}

const aiModelStore = createAiModelStore(() => window.tessera)

export function useAiModels() {
  return useSyncExternalStore(aiModelStore.subscribe, aiModelStore.getSnapshot, aiModelStore.getSnapshot)
}
