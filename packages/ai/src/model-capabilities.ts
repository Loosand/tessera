/**
 * [INPUT]: 供应商标识、模型 ID、远端目录信号与用户逐字段覆盖
 * [OUTPUT]: 统一的模型类型、输入输出模态、固有能力、Token 限额、端点绑定及逐字段来源
 * [POS]: 模型目录、持久化配置、设置界面和运行时路由共同依赖的模型事实归一化层
 * [DOC]: docs/architecture/ai-providers.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AiModelCapabilities,
  AiModelCapabilityKey,
  AiModelCapabilitySource,
  AiModelCapabilityState,
  AiModelEndpointBinding,
  AiModelModality,
  AiModelProfileField,
  AiModelType,
  AiProviderId,
  AiProviderModel,
} from "@tessera/contracts"

const UNKNOWN_CAPABILITIES: AiModelCapabilities = {
  functionCall: "unknown",
  reasoning: "unknown",
  structuredOutput: "unknown",
}

type BuiltinModelProfile = {
  capabilities: AiModelCapabilities
  contextWindow: number | null
  endpointBindings: AiModelEndpointBinding[]
  inputModalities: AiModelModality[]
  maxInputTokens: number | null
  maxOutputTokens: number | null
  modelType: AiModelType
  outputModalities: AiModelModality[]
}

function supportedWhen(condition: boolean): AiModelCapabilityState {
  return condition ? "supported" : "unknown"
}

function inferModelType(id: string): AiModelType {
  if (/realtime/u.test(id)) return "realtime"
  if (/(?:embedding|embed)(?:-|$|\/)/u.test(id)) return "embedding"
  if (/(?:rerank|re-rank)/u.test(id)) return "rerank"
  if (/(?:tts|text-to-speech|speech-generation)/u.test(id)) return "text-to-speech"
  if (/(?:whisper|speech-to-text|transcri)/u.test(id)) return "speech-to-text"
  if (/(?:sora|veo|video-generation|text-to-video)/u.test(id)) return "video-generation"
  if (/(?:dall-e|gpt-image|imagen|image-generation|text-to-image|flux)/u.test(id)) {
    return "image-generation"
  }
  return "chat"
}

function inferModalities(modelType: AiModelType, id: string) {
  switch (modelType) {
    case "embedding":
    case "rerank":
      return { inputModalities: ["text"], outputModalities: ["vector"] } as const
    case "image-generation":
      return { inputModalities: ["text", "image"], outputModalities: ["image"] } as const
    case "video-generation":
      return { inputModalities: ["text", "image", "video"], outputModalities: ["video"] } as const
    case "text-to-speech":
      return { inputModalities: ["text"], outputModalities: ["audio"] } as const
    case "speech-to-text":
      return { inputModalities: ["audio"], outputModalities: ["text"] } as const
    case "realtime":
      return { inputModalities: ["text", "audio"], outputModalities: ["text", "audio"] } as const
    case "chat":
      return {
        inputModalities: [
          "text",
          ...(/(?:vision|vl|ocr|gpt-4o|gpt-4\.1|gpt-5|claude-|grok-(?:3|4))/u.test(id)
            ? (["image"] as const)
            : []),
        ],
        outputModalities: ["text"],
      } as const
  }
}

function builtinCapabilities(modelType: AiModelType, id: string): AiModelCapabilities {
  if (modelType !== "chat" && modelType !== "realtime") {
    return {
      functionCall: "unsupported",
      reasoning: "unsupported",
      structuredOutput: "unsupported",
    }
  }

  const isClaude = /(^|\/)claude-/u.test(id)
  const isModernClaude = /claude-(?:3[-.]7|[4-9])/u.test(id)
  const isGrok = /(^|\/)grok-/u.test(id)
  const isModernGrok = /grok-(?:3|4)/u.test(id)
  const isOpenAi = /(^|\/)(?:gpt-|o[134](?:-|$))/u.test(id)
  const isOpenAiReasoning = /(^|\/)(?:gpt-5|o[134](?:-|$))/u.test(id)
  const isDeepSeek = /(?:^|\/)deepseek/u.test(id)
  const isDeepSeekReasoning = /(?:reasoner|deepseek-r1|deepseek-v(?:3\.1|4))/u.test(id)

  if (isClaude) {
    return {
      functionCall: "supported",
      reasoning: supportedWhen(isModernClaude),
      structuredOutput: supportedWhen(isModernClaude),
    }
  }
  if (isGrok) {
    return {
      functionCall: supportedWhen(isModernGrok),
      reasoning: supportedWhen(/reasoning/u.test(id) || isModernGrok),
      structuredOutput: supportedWhen(isModernGrok),
    }
  }
  if (isDeepSeek) {
    return {
      functionCall: supportedWhen(/chat|reasoner|v3|v4/u.test(id)),
      reasoning: supportedWhen(isDeepSeekReasoning),
      structuredOutput: supportedWhen(/v3|v4/u.test(id)),
    }
  }
  if (isOpenAi) {
    return {
      functionCall: "supported",
      reasoning: supportedWhen(isOpenAiReasoning),
      structuredOutput: "supported",
    }
  }
  return { ...UNKNOWN_CAPABILITIES }
}

function builtinEndpointBindings(
  providerId: AiProviderId,
  id: string,
  modelType: AiModelType,
): AiModelEndpointBinding[] {
  if (modelType !== "chat" && modelType !== "realtime") return []
  const isModernClaude = /claude-(?:3[-.]7|[4-9])/u.test(id)
  const isDeepSeekV4 = /(?:^|\/)deepseek-v4(?:-|$)/u.test(id)
  const isModernGrok = /(?:^|\/)grok-(?:3|4)(?:-|$)/u.test(id)

  switch (providerId) {
    case "openai-compatible":
    case "openrouter":
      return [
        {
          endpointType: "openai-chat-completions",
          nativeWebSearch: "unknown",
          source: "builtin",
        },
      ]
    case "anthropic-compatible":
      return [
        {
          endpointType: "anthropic-messages",
          nativeWebSearch: isModernClaude || isDeepSeekV4 ? "supported" : "unknown",
          ...(isModernClaude || isDeepSeekV4 ? { officialOnly: true } : {}),
          source: "builtin",
        },
      ]
    case "deepseek":
      return [
        {
          endpointType: "openai-chat-completions",
          nativeWebSearch: "unsupported",
          source: "builtin",
        },
        ...(isDeepSeekV4
          ? ([
              {
                endpointType: "openai-responses",
                nativeWebSearch: "supported",
                officialOnly: true,
                source: "builtin",
              },
              {
                endpointType: "anthropic-messages",
                nativeWebSearch: "supported",
                officialOnly: true,
                source: "builtin",
              },
            ] satisfies AiModelEndpointBinding[])
          : []),
      ]
    case "grok":
      return [
        {
          endpointType: "openai-chat-completions",
          nativeWebSearch: "unsupported",
          source: "builtin",
        },
        ...(isModernGrok
          ? ([
              {
                endpointType: "xai-responses",
                nativeWebSearch: "supported",
                officialOnly: true,
                source: "builtin",
              },
            ] satisfies AiModelEndpointBinding[])
          : []),
      ]
  }
}

function builtinProfile(providerId: AiProviderId, modelId: string): BuiltinModelProfile {
  const id = modelId.trim().toLocaleLowerCase()
  const modelType = inferModelType(id)
  const modalities = inferModalities(modelType, id)
  const isDeepSeekV4 = /(?:^|\/)deepseek-v4(?:-|$)/u.test(id)
  return {
    capabilities: builtinCapabilities(modelType, id),
    contextWindow: isDeepSeekV4 ? 1_048_576 : null,
    endpointBindings: builtinEndpointBindings(providerId, id, modelType),
    inputModalities: [...modalities.inputModalities],
    maxInputTokens: null,
    maxOutputTokens: isDeepSeekV4 ? 393_216 : null,
    modelType,
    outputModalities: [...modalities.outputModalities],
  }
}

function resolveCapability(
  key: AiModelCapabilityKey,
  model: AiProviderModel,
  builtin: AiModelCapabilities,
): { source: AiModelCapabilitySource; state: AiModelCapabilityState } {
  const explicit = model.capabilities?.[key]
  const explicitSource = model.capabilitySources?.[key] ?? model.capabilitySource
  if (explicitSource === "builtin") {
    const state = builtin[key]
    return { source: state === "unknown" ? "unknown" : "builtin", state }
  }
  if (explicit !== undefined && (explicitSource === "custom" || explicit !== "unknown")) {
    return { source: explicitSource ?? "remote", state: explicit }
  }
  const state = builtin[key]
  return { source: state === "unknown" ? "unknown" : "builtin", state }
}

function resolveNullableField(
  field: Extract<AiModelProfileField, "contextWindow" | "maxInputTokens" | "maxOutputTokens">,
  explicit: number | null | undefined,
  model: AiProviderModel,
  builtin: number | null,
): { source: AiModelCapabilitySource; value: number | null } {
  const explicitSource = model.fieldSources?.[field]
  if (explicitSource === "custom" || (explicit !== undefined && explicit !== null)) {
    return { source: explicitSource ?? "remote", value: explicit ?? null }
  }
  return { source: builtin === null ? "unknown" : "builtin", value: builtin }
}

export function resolveAiModelCapabilities(
  providerId: AiProviderId,
  model: AiProviderModel,
): AiProviderModel {
  const { capabilitySource: _legacyCapabilitySource, ...normalizedModel } = model
  const builtin = builtinProfile(providerId, model.id)
  const capabilityEntries = Object.keys(UNKNOWN_CAPABILITIES).map((key) => {
    const capabilityKey = key as AiModelCapabilityKey
    return [capabilityKey, resolveCapability(capabilityKey, model, builtin.capabilities)] as const
  })
  const capabilities = Object.fromEntries(
    capabilityEntries.map(([key, value]) => [key, value.state]),
  ) as AiModelCapabilities
  const capabilitySources = Object.fromEntries(
    capabilityEntries.map(([key, value]) => [key, value.source]),
  ) as Record<AiModelCapabilityKey, AiModelCapabilitySource>
  const contextWindow = resolveNullableField(
    "contextWindow",
    model.contextWindow,
    model,
    builtin.contextWindow,
  )
  const maxInputTokens = resolveNullableField(
    "maxInputTokens",
    model.maxInputTokens,
    model,
    builtin.maxInputTokens,
  )
  const maxOutputTokens = resolveNullableField(
    "maxOutputTokens",
    model.maxOutputTokens,
    model,
    builtin.maxOutputTokens,
  )
  const modelType = model.modelType ?? builtin.modelType
  const inputModalities = model.inputModalities?.length ? model.inputModalities : builtin.inputModalities
  const outputModalities = model.outputModalities?.length ? model.outputModalities : builtin.outputModalities
  const fieldSources: Record<AiModelProfileField, AiModelCapabilitySource> = {
    ...model.fieldSources,
    contextWindow: contextWindow.source,
    inputModalities: model.inputModalities?.length
      ? (model.fieldSources?.inputModalities ?? "remote")
      : "builtin",
    maxInputTokens: maxInputTokens.source,
    maxOutputTokens: maxOutputTokens.source,
    modelType: model.modelType ? (model.fieldSources?.modelType ?? "remote") : "builtin",
    name: model.fieldSources?.name ?? (model.name ? "remote" : "unknown"),
    outputModalities: model.outputModalities?.length
      ? (model.fieldSources?.outputModalities ?? "remote")
      : "builtin",
  }

  return {
    ...normalizedModel,
    capabilities,
    capabilitySources,
    contextWindow: contextWindow.value,
    endpointBindings: model.endpointBindings?.length ? model.endpointBindings : builtin.endpointBindings,
    fieldSources,
    inputModalities: [...inputModalities],
    maxInputTokens: maxInputTokens.value,
    maxOutputTokens: maxOutputTokens.value,
    modelType,
    outputModalities: [...outputModalities],
  }
}

export function createUnknownAiModelCapabilities(): AiModelCapabilities {
  return { ...UNKNOWN_CAPABILITIES }
}
