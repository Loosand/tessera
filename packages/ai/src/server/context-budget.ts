/**
 * [INPUT]: 模型上下文/输入/输出上限、当前步骤 instructions、模型消息与活动工具名
 * [OUTPUT]: 不含正文的确定性 ContextManifest、保守 Token 估算与超预算前置错误
 * [POS]: ToolLoopAgent 每一步模型调用前的上下文预算与运行审计边界
 * [DOC]: docs/architecture/ai-observability.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskContextManifest } from "@tessera/contracts"

const DEFAULT_OUTPUT_RESERVATION = 8_192
const MAX_OUTPUT_RESERVATION = 32_768
const FIXED_FRAMING_TOKENS = 512
const TOKENS_PER_TOOL_DEFINITION = 256

export type TaskModelContextLimits = Readonly<{
  contextWindow: number | null
  maxInputTokens: number | null
  maxOutputTokens: number | null
}>

export class ContextBudgetExceededError extends Error {
  readonly manifest: TaskContextManifest

  constructor(manifest: TaskContextManifest) {
    const available = manifest.availableInputTokens?.toLocaleString("zh-CN") ?? "未知"
    super(
      `本轮上下文预计需要 ${manifest.estimatedInputTokens.toLocaleString("zh-CN")} Token，超过安全输入预算 ${available} Token。请新建任务、缩小材料范围，或切换到上下文更大的模型。`,
    )
    this.name = "ContextBudgetExceededError"
    this.manifest = manifest
  }
}

function safeStringify(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

/**
 * CJK 等非 ASCII 字符按一字符一 Token，ASCII 按四字符一 Token；
 * 这不是供应商计费 tokenizer，只用于稳定、可解释的本地预算预警。
 */
export function estimateTextTokens(value: string) {
  let asciiCharacters = 0
  let nonAsciiCharacters = 0
  for (const character of value) {
    if (character.charCodeAt(0) <= 0x7f) asciiCharacters += 1
    else nonAsciiCharacters += 1
  }
  return Math.ceil(asciiCharacters / 4) + nonAsciiCharacters
}

function estimateValueTokens(value: unknown) {
  return estimateTextTokens(safeStringify(value))
}

function isToolMessage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return (value as Record<string, unknown>).role === "tool"
}

function resolveInputCapacity(limits: TaskModelContextLimits, reservedOutputTokens: number): number | null {
  const contextCapacity = limits.contextWindow
    ? Math.max(0, limits.contextWindow - reservedOutputTokens)
    : null
  if (limits.maxInputTokens && contextCapacity !== null) {
    return Math.min(limits.maxInputTokens, contextCapacity)
  }
  return limits.maxInputTokens ?? contextCapacity
}

function safetyMargin(inputCapacity: number | null) {
  if (inputCapacity === null) return 0
  return Math.min(Math.floor(inputCapacity / 4), Math.max(2_048, Math.ceil(inputCapacity * 0.05)))
}

export function createTaskContextManifest({
  activeToolNames,
  instructions,
  limits,
  messages,
  observedStep,
  policyMaxOutputTokens,
}: Readonly<{
  activeToolNames: readonly string[]
  instructions: unknown
  limits: TaskModelContextLimits
  messages: readonly unknown[]
  observedStep: number
  policyMaxOutputTokens: number | null
}>): TaskContextManifest {
  const reservedOutputTokens =
    policyMaxOutputTokens ??
    Math.min(limits.maxOutputTokens ?? DEFAULT_OUTPUT_RESERVATION, MAX_OUTPUT_RESERVATION)
  const inputCapacity = resolveInputCapacity(limits, reservedOutputTokens)
  const margin = safetyMargin(inputCapacity)
  const availableInputTokens = inputCapacity === null ? null : Math.max(0, inputCapacity - margin)
  const toolResults = messages.filter(isToolMessage)
  const nonToolMessages = messages.filter((message) => !isToolMessage(message))
  const sections: TaskContextManifest["sections"] = [
    { kind: "instructions", estimatedTokens: estimateValueTokens(instructions) },
    { kind: "conversation", estimatedTokens: estimateValueTokens(nonToolMessages) },
    { kind: "tool-results", estimatedTokens: estimateValueTokens(toolResults) },
    {
      kind: "tool-definitions",
      estimatedTokens:
        activeToolNames.length * TOKENS_PER_TOOL_DEFINITION + estimateValueTokens(activeToolNames),
    },
    { kind: "framing", estimatedTokens: FIXED_FRAMING_TOKENS },
  ]
  const estimatedInputTokens = sections.reduce((total, section) => total + section.estimatedTokens, 0)
  return {
    availableInputTokens,
    estimatedInputTokens,
    estimator: "heuristic-v1",
    modelContextWindow: limits.contextWindow,
    modelMaxInputTokens: limits.maxInputTokens,
    observedStep,
    reservedOutputTokens,
    safetyMarginTokens: margin,
    sections,
    status:
      availableInputTokens === null
        ? "unknown"
        : estimatedInputTokens > availableInputTokens
          ? "over-budget"
          : "within-budget",
    version: 1,
  }
}

export function assertTaskContextBudget(manifest: TaskContextManifest) {
  if (manifest.status === "over-budget") throw new ContextBudgetExceededError(manifest)
}
