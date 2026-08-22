/**
 * [INPUT]: 预加载层 AI 配置查询/保存、模型发现与配置变更事件
 * [OUTPUT]: 当前可用于任务 Chat/Agent 的已启用对话模型、实际连接地址、模型目录同步操作、刷新状态及错误
 * [POS]: 任务界面与 Electron AI 配置窄桥之间的渲染层状态适配器
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mergeDiscoveredAiProviderModels } from "@tessera/ai"
import type { AiConfiguredModel, AiProviderConfig, AiProviderId, AiProviderModel } from "@tessera/contracts"
import { useCallback, useEffect, useRef, useState } from "react"

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

export function mergeModelsForTaskRefresh(
  config: AiProviderConfig,
  discoveredModels: readonly AiProviderModel[],
): AiProviderConfig["models"] {
  const models = mergeDiscoveredAiProviderModels(config.models, discoveredModels, config.providerId)
  if (config.models.length > 0 || models.some((model) => model.enabled) || !models[0]) return models
  return models.map((model, index) => (index === 0 ? { ...model, enabled: true } : model))
}

export function useAiModels() {
  const [models, setModels] = useState<AvailableAiModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestVersionRef = useRef(0)
  const synchronizationVersionRef = useRef(0)

  const load = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
    setLoading(true)
    try {
      const desktopApi = window.tessera
      if (!desktopApi) throw new Error("桌面 AI 服务不可用。")
      const configs = await desktopApi.listAiProviderConfigs()
      if (requestVersion !== requestVersionRef.current) return
      setModels(selectAvailableAiModels(configs))
      setError(null)
    } catch (cause) {
      if (requestVersion !== requestVersionRef.current) return
      setError(cause instanceof Error ? cause.message : "读取可用模型失败。")
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
    synchronizationVersionRef.current = requestVersion
    setLoading(true)
    setError(null)
    try {
      const desktopApi = window.tessera
      if (!desktopApi) throw new Error("桌面 AI 服务不可用。")
      const configs = await desktopApi.listAiProviderConfigs()
      const syncableConfigs = configs.filter((config) => config.enabled && config.apiKeyConfigured)
      const outcomes = await Promise.allSettled(
        syncableConfigs.map(async (config) => {
          const result = await desktopApi.listAiProviderModels({
            apiKey: "",
            baseUrl: config.baseUrl,
            configId: config.configId,
            providerId: config.providerId,
          })
          if (!result.ok) {
            if (result.code === "catalog-unsupported") return config
            throw new Error(`${config.displayName}：${result.error}`)
          }
          if (result.models.length === 0) {
            throw new Error(`${config.displayName}：供应商没有返回任何模型。`)
          }
          const saveResult = await desktopApi.saveAiProviderConfig({
            baseUrl: config.baseUrl,
            configId: config.configId,
            displayName: config.displayName,
            enabled: config.enabled,
            models: mergeModelsForTaskRefresh(config, result.models),
            providerId: config.providerId,
          })
          if (!saveResult.ok) throw new Error(`${config.displayName}：${saveResult.error}`)
          return saveResult.config
        }),
      )
      if (requestVersion !== requestVersionRef.current) return

      const refreshedConfigs = new Map(configs.map((config) => [config.configId, config]))
      const failures: string[] = []
      for (const outcome of outcomes) {
        if (outcome.status === "fulfilled") refreshedConfigs.set(outcome.value.configId, outcome.value)
        else failures.push(outcome.reason instanceof Error ? outcome.reason.message : "刷新模型失败。")
      }
      setModels(selectAvailableAiModels([...refreshedConfigs.values()]))
      setError(failures.length > 0 ? failures.join("；") : null)
    } catch (cause) {
      if (requestVersion !== requestVersionRef.current) return
      setError(cause instanceof Error ? cause.message : "刷新模型失败。")
    } finally {
      if (synchronizationVersionRef.current === requestVersion) {
        synchronizationVersionRef.current = 0
      }
      if (requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const unsubscribe = window.tessera?.onAiProviderConfigsChanged(() => {
      if (synchronizationVersionRef.current === 0) void load()
    })
    return () => {
      requestVersionRef.current += 1
      synchronizationVersionRef.current = 0
      unsubscribe?.()
    }
  }, [load])

  return { error, loading, models, refresh }
}
