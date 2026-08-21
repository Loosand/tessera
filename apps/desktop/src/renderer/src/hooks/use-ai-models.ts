/**
 * [INPUT]: 预加载层 AI 配置查询与配置变更事件
 * [OUTPUT]: 当前可用于普通对话的已启用供应商/模型列表及加载错误
 * [POS]: 任务界面与 Electron AI 配置窄桥之间的渲染层状态适配器
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AiConfiguredModel, AiProviderId } from "@tessera/contracts"
import { useCallback, useEffect, useState } from "react"

const PROVIDER_NAMES: Record<AiProviderId, string> = {
  "openai-compatible": "OpenAI 兼容",
  "anthropic-compatible": "Anthropic",
  deepseek: "DeepSeek",
  grok: "Grok",
  openrouter: "OpenRouter",
}

export interface AvailableAiModel extends AiConfiguredModel {
  providerName: string
}

export function useAiModels() {
  const [models, setModels] = useState<AvailableAiModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const desktopApi = window.tessera
      if (!desktopApi) throw new Error("桌面 AI 服务不可用。")
      const configs = await desktopApi.listAiProviderConfigs()
      setModels(
        configs.flatMap((config) =>
          config.enabled && config.apiKeyConfigured
            ? config.models
                .filter((model) => model.enabled)
                .map((model) => ({
                  ...model,
                  providerId: config.providerId,
                  providerName: PROVIDER_NAMES[config.providerId],
                }))
            : [],
        ),
      )
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取可用模型失败。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return window.tessera?.onAiProviderConfigsChanged(() => void refresh())
  }, [refresh])

  return { error, loading, models, refresh }
}
