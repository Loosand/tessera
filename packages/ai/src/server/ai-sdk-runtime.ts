/**
 * [INPUT]: 类型化供应商连接、请求期模型端点、自动联网策略、搜索额度与 AI SDK 官方供应商适配器
 * [OUTPUT]: 经密钥、API 根地址和模型 ID 统一校验后可交给 AI SDK generateText/streamText 的 LanguageModel、端点专属 provider options、分层搜索额度与显式支持的原生联网工具
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
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createXai } from "@ai-sdk/xai"
import type { AiModelEndpointType, AiProviderConnectionInput } from "@tessera/contracts"
import type { JSONValue, LanguageModel, ToolSet } from "ai"
import { normalizeAiProviderModelId, validateAiProviderBaseUrl } from "../provider-input-validation"
import { aiProviderApiKeyValidationMessage } from "./api-key-validation"

const DEFAULT_WEB_SEARCH_MAX_USES = 12
const MAX_WEB_SEARCH_MAX_USES = 50

export type AiLanguageModelInput = AiProviderConnectionInput & {
  endpointType?: AiModelEndpointType
  modelId: string
}

export type AiChatRuntimeOptions = {
  webSearch?: boolean
  webSearchMaxUses?: number
}

export type AiSdkChatRuntime = {
  model: LanguageModel
  providerOptions?: Record<string, Record<string, JSONValue>>
  tools?: ToolSet
}

function normalizedRuntimeInput(input: AiLanguageModelInput) {
  const apiKey = input.apiKey.trim()
  const modelId = normalizeAiProviderModelId(input.modelId)
  if (!apiKey) throw new Error("请先输入 API Key。")
  const apiKeyValidationMessage = aiProviderApiKeyValidationMessage(apiKey)
  if (apiKeyValidationMessage) throw new Error(apiKeyValidationMessage)
  if (!modelId) throw new Error("请先选择模型。")
  const baseUrlResult = validateAiProviderBaseUrl(input.baseUrl)
  if (!baseUrlResult.ok) throw new Error(baseUrlResult.message)
  const baseURL = baseUrlResult.url.toString().replace(/\/+$/u, "")
  return { apiKey, baseURL, modelId }
}

function normalizedWebSearchMaxUses(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_WEB_SEARCH_MAX_USES
  return Math.min(MAX_WEB_SEARCH_MAX_USES, Math.max(1, Math.trunc(value)))
}

function defaultEndpointType(providerId: AiLanguageModelInput["providerId"]): AiModelEndpointType {
  if (providerId === "anthropic-compatible") return "anthropic-messages"
  return "openai-chat-completions"
}

function deepSeekAnthropicBaseUrl(baseURL: string) {
  const url = new URL(baseURL)
  const path = url.pathname.replace(/\/(?:v1|anthropic)\/?$/u, "").replace(/\/+$/u, "")
  url.pathname = `${path}/anthropic`
  return url.toString().replace(/\/+$/u, "")
}

function deepSeekResponsesBaseUrl(baseURL: string) {
  const url = new URL(baseURL)
  url.pathname = url.pathname.replace(/\/v1\/?$/u, "") || "/"
  return url.toString().replace(/\/+$/u, "")
}

export function createAiSdkChatRuntime(
  input: AiLanguageModelInput,
  { webSearch = false, webSearchMaxUses }: AiChatRuntimeOptions = {},
): AiSdkChatRuntime {
  const { apiKey, baseURL, modelId } = normalizedRuntimeInput(input)
  const maxUses = normalizedWebSearchMaxUses(webSearchMaxUses)
  const endpointType = input.endpointType ?? defaultEndpointType(input.providerId)

  switch (input.providerId) {
    case "openai-compatible":
      if (endpointType !== "openai-chat-completions") {
        throw new Error("当前 OpenAI 兼容连接未配置这个生成端点。")
      }
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
      if (endpointType !== "anthropic-messages") {
        throw new Error("当前 Anthropic 兼容连接未配置这个生成端点。")
      }
      const anthropic = createAnthropic({ apiKey, baseURL })
      return {
        model: anthropic(modelId),
        ...(webSearch ? { tools: { web_search: anthropic.tools.webSearch_20260209({ maxUses }) } } : {}),
      }
    }
    case "deepseek": {
      if (endpointType === "openai-responses") {
        const deepseek = createOpenAI({
          name: "tesseraDeepSeekResponses",
          apiKey,
          baseURL: deepSeekResponsesBaseUrl(baseURL),
        })
        return {
          model: deepseek.responses(modelId),
          // DeepSeek 的自定义模型 ID 不在 OpenAI provider 的内置能力表中。
          // 显式标记后，AI SDK 才会把标准 reasoning effort/summary 写入 Responses 请求。
          providerOptions: { openai: { forceReasoning: true } },
          ...(webSearch
            ? { tools: { web_search: deepseek.tools.webSearch() as unknown as ToolSet[string] } }
            : {}),
        }
      }
      if (endpointType === "anthropic-messages") {
        const anthropic = createAnthropic({ apiKey, baseURL: deepSeekAnthropicBaseUrl(baseURL) })
        return {
          model: anthropic(modelId),
          ...(webSearch ? { tools: { web_search: anthropic.tools.webSearch_20260209({ maxUses }) } } : {}),
        }
      }
      if (endpointType !== "openai-chat-completions") {
        throw new Error("当前 DeepSeek 连接未配置这个生成端点。")
      }
      if (webSearch) throw new Error("DeepSeek Chat Completions 端点不提供原生联网搜索。")
      return { model: createDeepSeek({ apiKey, baseURL })(modelId) }
    }
    case "grok": {
      const xai = createXai({ apiKey, baseURL })
      if (endpointType !== "openai-chat-completions" && endpointType !== "xai-responses") {
        throw new Error("当前 Grok 连接未配置这个生成端点。")
      }
      if (webSearch && endpointType !== "xai-responses") {
        throw new Error("Grok Chat Completions 端点不提供已验证的原生联网搜索。")
      }
      return {
        model: endpointType === "xai-responses" ? xai.responses(modelId) : xai.chat(modelId),
        ...(webSearch ? { tools: { web_search: xai.tools.webSearch() } } : {}),
      }
    }
    case "openrouter":
      if (endpointType !== "openai-chat-completions") {
        throw new Error("当前 OpenRouter 连接未配置这个生成端点。")
      }
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
