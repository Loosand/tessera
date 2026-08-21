/**
 * [INPUT]: 供应商标识、模型 ID 与远端目录可能返回的不完整能力信息
 * [OUTPUT]: 保守、带来源的模型能力集合与合并函数
 * [POS]: 模型目录 API、用户配置和对话 UI 之间的能力事实归一化层
 * [DOC]: docs/architecture/ai-providers.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AiModelCapabilities,
  AiModelCapabilitySource,
  AiModelCapabilityState,
  AiProviderId,
  AiProviderModel,
} from "@tessera/contracts"

const UNKNOWN_CAPABILITIES: AiModelCapabilities = {
  imageInput: "unknown",
  reasoning: "unknown",
  search: "unknown",
  toolUse: "unknown",
}

function supportedWhen(condition: boolean): AiModelCapabilityState {
  return condition ? "supported" : "unknown"
}

function builtinCapabilities(providerId: AiProviderId, modelId: string): AiModelCapabilities {
  const id = modelId.trim().toLocaleLowerCase()
  const isClaude = /(^|\/)claude-/u.test(id)
  const isModernClaude = /claude-(?:3[-.]7|[4-9])/u.test(id)
  const isGrok = /(^|\/)grok-/u.test(id)
  const isModernGrok = /grok-(?:3|4)/u.test(id)
  const isOpenAiMultimodal = /(^|\/)(?:gpt-4o|gpt-4\.1|gpt-5|o[134](?:-|$))/u.test(id)
  const isOpenAiReasoning = /(^|\/)(?:gpt-5|o[134](?:-|$))/u.test(id)
  const isDeepSeekReasoning = /(?:reasoner|deepseek-r1|deepseek-v(?:3\.1|4))/u.test(id)
  const isDeepSeekV4 = /(?:^|\/)deepseek-v4(?:-|$)/u.test(id)

  if (isClaude) {
    return {
      imageInput: "supported",
      reasoning: supportedWhen(isModernClaude),
      search: providerId === "anthropic-compatible" && isModernClaude ? "supported" : "unsupported",
      toolUse: "supported",
    }
  }

  if (isGrok) {
    return {
      imageInput: supportedWhen(/vision|grok-(?:3|4)/u.test(id)),
      reasoning: supportedWhen(/reasoning/u.test(id) || isModernGrok),
      search: providerId === "grok" && isModernGrok ? "supported" : "unsupported",
      toolUse: supportedWhen(isModernGrok),
    }
  }

  if (providerId === "deepseek" || /(^|\/)deepseek/u.test(id)) {
    return {
      imageInput: /(?:vision|vl|ocr)/u.test(id) ? "supported" : "unsupported",
      reasoning: supportedWhen(isDeepSeekReasoning),
      search: providerId === "deepseek" && isDeepSeekV4 ? "supported" : "unsupported",
      toolUse: supportedWhen(/chat|reasoner|v3|v4/u.test(id)),
    }
  }

  if (isOpenAiMultimodal || isOpenAiReasoning) {
    return {
      imageInput: supportedWhen(isOpenAiMultimodal),
      reasoning: supportedWhen(isOpenAiReasoning),
      search: "unsupported",
      toolUse: "supported",
    }
  }

  return {
    ...UNKNOWN_CAPABILITIES,
    search: providerId === "grok" || providerId === "anthropic-compatible" ? "unknown" : "unsupported",
  }
}

function mergeCapability(
  explicit: AiModelCapabilityState | undefined,
  builtin: AiModelCapabilityState,
): AiModelCapabilityState {
  return explicit && explicit !== "unknown" ? explicit : builtin
}

export function resolveAiModelCapabilities(
  providerId: AiProviderId,
  model: AiProviderModel,
): AiProviderModel {
  const builtin = builtinCapabilities(providerId, model.id)
  const explicit = model.capabilitySource === "builtin" ? undefined : model.capabilities
  const capabilities: AiModelCapabilities = {
    imageInput: mergeCapability(explicit?.imageInput, builtin.imageInput),
    reasoning: mergeCapability(explicit?.reasoning, builtin.reasoning),
    search: mergeCapability(explicit?.search, builtin.search),
    toolUse: mergeCapability(explicit?.toolUse, builtin.toolUse),
  }
  const hasExplicitCapability = explicit
    ? Object.values(explicit).some((value) => value !== "unknown")
    : false
  const hasBuiltinCapability = Object.values(builtin).some((value) => value !== "unknown")
  const capabilitySource: AiModelCapabilitySource = hasExplicitCapability
    ? (model.capabilitySource ?? "remote")
    : hasBuiltinCapability
      ? "builtin"
      : "unknown"

  return { ...model, capabilities, capabilitySource }
}

export function createUnknownAiModelCapabilities(): AiModelCapabilities {
  return { ...UNKNOWN_CAPABILITIES }
}
