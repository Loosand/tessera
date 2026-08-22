/**
 * [INPUT]: 已归一化模型、供应商连接、任务模式与联网请求
 * [OUTPUT]: 当前连接上的有效端点、能力交集、Agent 可用性、搜索路由和不可用原因
 * [POS]: 模型事实与 AI SDK 适配器之间唯一的请求期能力解析边界
 * [DOC]: docs/architecture/ai-providers.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AiModelCapabilities,
  AiModelEndpointBinding,
  AiModelEndpointType,
  AiProviderId,
  AiProviderModel,
  TaskMode,
} from "@tessera/contracts"
import { resolveAiModelCapabilities } from "./model-capabilities"

export type AiModelExecutionIssue =
  | "agent-function-call-unavailable"
  | "chat-model-required"
  | "endpoint-unavailable"
  | "native-search-unavailable"

export type AiModelSearchRoute = "provider-native" | "unavailable"

export type AiModelExecution = {
  agentReady: boolean
  capabilities: AiModelCapabilities
  endpointType: AiModelEndpointType | null
  issues: AiModelExecutionIssue[]
  model: AiProviderModel
  searchRoute: AiModelSearchRoute
}

const SEARCH_ENDPOINT_PRIORITY: readonly AiModelEndpointType[] = [
  "openai-responses",
  "anthropic-messages",
  "xai-responses",
  "openai-chat-completions",
]

const CHAT_ENDPOINT_PRIORITY: readonly AiModelEndpointType[] = [
  "openai-chat-completions",
  "anthropic-messages",
  "openai-responses",
  "xai-responses",
]

function isOfficialEndpoint(providerId: AiProviderId, baseUrl: string, modelId: string) {
  try {
    const url = new URL(baseUrl)
    if (providerId === "deepseek") return url.hostname === "api.deepseek.com"
    if (providerId === "grok") return url.hostname === "api.x.ai"
    if (providerId === "anthropic-compatible") {
      return /(?:^|\/)deepseek/u.test(modelId)
        ? url.hostname === "api.deepseek.com"
        : url.hostname === "api.anthropic.com"
    }
    return false
  } catch {
    return false
  }
}

function sortedBinding(
  bindings: readonly AiModelEndpointBinding[],
  priority: readonly AiModelEndpointType[],
) {
  return [...bindings].sort(
    (left, right) => priority.indexOf(left.endpointType) - priority.indexOf(right.endpointType),
  )[0]
}

function effectiveCapabilities(model: AiProviderModel, binding: AiModelEndpointBinding | undefined) {
  const capabilities = model.capabilities ?? {
    functionCall: "unknown",
    reasoning: "unknown",
    structuredOutput: "unknown",
  }
  return { ...capabilities, ...binding?.capabilityOverrides }
}

export function resolveAiModelExecution(input: {
  baseUrl: string
  mode: TaskMode
  model: AiProviderModel
  providerId: AiProviderId
  webSearch: boolean
}): AiModelExecution {
  const model = resolveAiModelCapabilities(input.providerId, input.model)
  const chatReady = model.modelType === "chat"
  const availableBindings = (model.endpointBindings ?? []).filter(
    (binding) =>
      !binding.officialOnly ||
      isOfficialEndpoint(input.providerId, input.baseUrl, model.id.toLocaleLowerCase()),
  )
  const binding = input.webSearch
    ? sortedBinding(
        availableBindings.filter((candidate) => candidate.nativeWebSearch === "supported"),
        SEARCH_ENDPOINT_PRIORITY,
      )
    : sortedBinding(availableBindings, CHAT_ENDPOINT_PRIORITY)
  const capabilities = effectiveCapabilities(model, binding)
  const agentReady = chatReady && capabilities.functionCall === "supported" && binding !== undefined
  const issues: AiModelExecutionIssue[] = []

  if (!chatReady) issues.push("chat-model-required")
  if (!binding) issues.push(input.webSearch ? "native-search-unavailable" : "endpoint-unavailable")
  if (input.mode === "agent" && !agentReady) issues.push("agent-function-call-unavailable")

  return {
    agentReady,
    capabilities,
    endpointType: binding?.endpointType ?? null,
    issues,
    model,
    searchRoute: input.webSearch && binding ? "provider-native" : "unavailable",
  }
}

export function aiModelExecutionIssueMessage(issue: AiModelExecutionIssue): string {
  switch (issue) {
    case "chat-model-required":
      return "所选模型不是对话模型，不能用于 Chat 或 Agent。"
    case "endpoint-unavailable":
      return "当前供应商连接没有可用的对话端点。"
    case "native-search-unavailable":
      return "所选模型在当前供应商和端点上没有已验证的原生联网搜索能力。"
    case "agent-function-call-unavailable":
      return "所选模型在当前端点上没有已验证的工具调用能力，不能用于 Agent 模式。"
  }
}
