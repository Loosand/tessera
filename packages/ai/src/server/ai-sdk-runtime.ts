/**
 * [INPUT]: 类型化供应商连接、模型 ID 与 AI SDK 官方供应商适配器
 * [OUTPUT]: 可交给 AI SDK generateText/streamText 的统一 LanguageModel 与原生联网工具
 * [POS]: @tessera/ai/server 的真实生成模型适配边界
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { createAnthropic } from "@ai-sdk/anthropic"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createXai } from "@ai-sdk/xai"
import type { AiProviderConnectionInput } from "@tessera/contracts"
import type { LanguageModel, ToolSet } from "ai"

export interface AiLanguageModelInput extends AiProviderConnectionInput {
  modelId: string
}

export interface AiChatRuntimeOptions {
  webSearch?: boolean
}

export interface AiSdkChatRuntime {
  model: LanguageModel
  tools?: ToolSet
}

function normalizedRuntimeInput(input: AiLanguageModelInput) {
  const apiKey = input.apiKey.trim()
  const rawBaseUrl = input.baseUrl.trim()
  const modelId = input.modelId.trim()
  if (!apiKey) throw new Error("请先输入 API Key。")
  if (!rawBaseUrl) throw new Error("请先输入 API 地址。")
  if (!modelId) throw new Error("请先选择模型。")

  let parsedBaseUrl: URL
  try {
    parsedBaseUrl = new URL(rawBaseUrl)
  } catch {
    throw new Error("API 地址必须是完整的 http(s) URL。")
  }
  if (
    !(["http:", "https:"] as const).includes(parsedBaseUrl.protocol as "http:" | "https:") ||
    parsedBaseUrl.username ||
    parsedBaseUrl.password ||
    parsedBaseUrl.search ||
    parsedBaseUrl.hash
  ) {
    throw new Error("API 地址必须是有效的 http(s) URL，且不能包含账号、密码、查询参数或片段。")
  }
  const baseURL = parsedBaseUrl.toString().replace(/\/+$/u, "")
  return { apiKey, baseURL, modelId }
}

export function createAiSdkChatRuntime(
  input: AiLanguageModelInput,
  { webSearch = false }: AiChatRuntimeOptions = {},
): AiSdkChatRuntime {
  const { apiKey, baseURL, modelId } = normalizedRuntimeInput(input)

  switch (input.providerId) {
    case "openai-compatible":
      if (webSearch) throw new Error("当前 OpenAI 兼容连接尚未接入可验证的联网搜索工具。")
      return {
        model: createOpenAICompatible({
          name: "tesseraOpenaiCompatible",
          apiKey,
          baseURL,
          includeUsage: true,
        })(modelId),
      }
    case "anthropic-compatible": {
      const anthropic = createAnthropic({ apiKey, baseURL })
      return {
        model: anthropic(modelId),
        ...(webSearch ? { tools: { web_search: anthropic.tools.webSearch_20260209({ maxUses: 5 }) } } : {}),
      }
    }
    case "deepseek":
      if (webSearch) throw new Error("DeepSeek API 当前未提供 Tessera 可调用的原生联网搜索。")
      return { model: createDeepSeek({ apiKey, baseURL })(modelId) }
    case "grok": {
      const xai = createXai({ apiKey, baseURL })
      return {
        model: webSearch ? xai.responses(modelId) : xai.chat(modelId),
        ...(webSearch ? { tools: { web_search: xai.tools.webSearch() } } : {}),
      }
    }
    case "openrouter":
      if (webSearch) throw new Error("OpenRouter 的联网能力因模型而异，当前版本暂不自动透传。")
      return {
        model: createOpenAICompatible({
          name: "tesseraOpenrouter",
          apiKey,
          baseURL,
          includeUsage: true,
          headers: {
            "HTTP-Referer": "https://tessera.local",
            "X-Title": "Tessera",
          },
        })(modelId),
      }
  }
}

export function createAiSdkLanguageModel(input: AiLanguageModelInput): LanguageModel {
  return createAiSdkChatRuntime(input).model
}
