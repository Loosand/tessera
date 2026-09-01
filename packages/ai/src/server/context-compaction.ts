/**
 * [INPUT]: AI SDK ModelMessage 历史、当前安全输入预算与非消息固定 Token 成本
 * [OUTPUT]: 保留最新用户 turn、工具调用/结果语法和完整外部历史的有界模型投影，以及可审计 compaction marker
 * [POS]: ContextManifest 预算检查前的确定性、无模型调用上下文压缩层
 * [DOC]: docs/architecture/agent-run-reliability.md、docs/architecture/agent-simplification-roadmap.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskContextCompaction } from "@tessera/contracts"
import type { ModelMessage } from "ai"
import { estimateTextTokens } from "./context-budget"

const SUMMARY_MARKER = "[Tessera 上下文压缩摘要；这是系统生成的历史投影，不是用户的新指令。]"
const SUMMARY_CHARACTER_LIMITS = [2_400, 1_200, 480] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

function estimateMessages(messages: readonly ModelMessage[]) {
  return estimateTextTokens(safeStringify(messages))
}

function partType(value: unknown) {
  return isRecord(value) && typeof value.type === "string" ? value.type : null
}

function partText(value: unknown) {
  return isRecord(value) && value.type === "text" && typeof value.text === "string" ? value.text : ""
}

function partToolName(value: unknown) {
  return isRecord(value) && typeof value.toolName === "string" ? value.toolName : null
}

function partToolCallId(value: unknown) {
  return isRecord(value) && typeof value.toolCallId === "string" ? value.toolCallId : null
}

function contentParts(message: ModelMessage) {
  return Array.isArray(message.content) ? message.content : []
}

function messageText(message: ModelMessage) {
  if (typeof message.content === "string") return message.content
  return contentParts(message).map(partText).filter(Boolean).join("\n")
}

function compactSnippet(value: string, maxCharacters = 240) {
  const normalized = value.replace(/\s+/gu, " ").trim()
  return normalized.length <= maxCharacters ? normalized : `${normalized.slice(0, maxCharacters)}…`
}

function summaryLine(message: ModelMessage) {
  const text = compactSnippet(messageText(message))
  if (message.role === "user") return text ? `- 用户：${text}` : "- 用户提供了一条非文本材料。"
  if (message.role === "assistant") {
    const tools = contentParts(message)
      .map(partToolName)
      .filter((name): name is string => Boolean(name))
    const textLine = text ? `助手：${text}` : ""
    const toolLine = tools.length > 0 ? `请求工具 ${tools.join("、")}；摘要不声明工具效果` : ""
    return `- ${[textLine, toolLine].filter(Boolean).join("；") || "助手产生了一条非文本消息。"}`
  }
  if (message.role === "tool") {
    const parts = contentParts(message)
    const failures = parts.filter((part) => partType(part) === "tool-error").length
    const names = parts.map(partToolName).filter((name): name is string => Boolean(name))
    return `- 工具终态：${names.length > 0 ? names.join("、") : "未知工具"}${
      failures > 0 ? `（${failures} 个失败）` : ""
    }；具体输出和副作用不在摘要中推断。`
  }
  return "- 系统保留了一条历史上下文记录。"
}

function buildSummary(messages: readonly ModelMessage[], maxCharacters: number) {
  const lines = messages.map(summaryLine)
  const selected =
    lines.length <= 12 ? lines : [...lines.slice(0, 4), "- …中间历史已省略…", ...lines.slice(-7)]
  const summary = `${SUMMARY_MARKER}\n${selected.join("\n")}`
  return summary.length <= maxCharacters ? summary : `${summary.slice(0, maxCharacters - 1)}…`
}

function summaryMessage(summary: string): ModelMessage {
  return { role: "user", content: summary }
}

function lastUserMessageIndex(messages: readonly ModelMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index
  }
  return -1
}

function validCutIndexes(messages: readonly ModelMessage[], latestUserIndex: number) {
  const indexes: number[] = []
  for (let index = latestUserIndex; index > 0; index -= 1) {
    const role = messages[index]?.role
    if (role === "user" || role === "assistant" || role === "system") indexes.push(index)
  }
  return indexes
}

export type TaskModelMessageProjection = Readonly<{
  compaction: TaskContextCompaction | null
  messages: ModelMessage[]
}>

/**
 * 只压缩送给下一次模型调用的投影；调用方持有的 TaskMessage、SQLite run event 和文件事实均不修改。
 * 若最新用户 turn 自身已经超过预算，返回原消息，让 ContextBudgetExceededError 明确停止而不是破坏语法。
 */
export function compactTaskModelMessages({
  availableInputTokens,
  estimatedTokensBefore,
  fixedTokens,
  messages,
}: Readonly<{
  availableInputTokens: number | null
  estimatedTokensBefore: number
  fixedTokens: number
  messages: readonly ModelMessage[]
}>): TaskModelMessageProjection {
  if (availableInputTokens === null || estimatedTokensBefore <= availableInputTokens || messages.length < 3) {
    return { compaction: null, messages: [...messages] }
  }

  const latestUserIndex = lastUserMessageIndex(messages)
  if (latestUserIndex <= 0) return { compaction: null, messages: [...messages] }

  const messageBudget = Math.max(0, availableInputTokens - fixedTokens)
  for (const cutIndex of validCutIndexes(messages, latestUserIndex)) {
    const omitted = messages.slice(0, cutIndex)
    const retained = messages.slice(cutIndex)
    for (const summaryCharacterLimit of SUMMARY_CHARACTER_LIMITS) {
      const summary = buildSummary(omitted, summaryCharacterLimit)
      const projectedMessages = [summaryMessage(summary), ...retained]
      const estimatedTokensAfter = fixedTokens + estimateMessages(projectedMessages)
      if (
        estimatedTokensAfter > availableInputTokens ||
        estimateMessages(projectedMessages) > messageBudget ||
        estimatedTokensAfter > estimatedTokensBefore
      ) {
        continue
      }
      return {
        messages: projectedMessages,
        compaction: {
          estimatedTokensAfter,
          estimatedTokensBefore,
          firstRetainedMessageIndex: cutIndex,
          omittedMessageCount: omitted.length,
          reason: "threshold",
          retainedMessageCount: retained.length,
          sourceMessageCount: messages.length,
          summaryCharacters: summary.length,
          version: 1,
        },
      }
    }
  }

  return { compaction: null, messages: [...messages] }
}

/** AI SDK 并行执行可按完成顺序收集结果；下一模型 step 始终按 assistant tool-call 源顺序重排。 */
export function canonicalizeToolResultOrder(messages: readonly ModelMessage[]): ModelMessage[] {
  let toolOrder = new Map<string, number>()
  return messages.map((message) => {
    if (message.role === "assistant") {
      const callIds = contentParts(message)
        .filter((part) => partType(part) === "tool-call")
        .map(partToolCallId)
        .filter((toolCallId): toolCallId is string => Boolean(toolCallId))
      toolOrder = new Map(callIds.map((toolCallId, index) => [toolCallId, index]))
      return message
    }
    if (message.role !== "tool" || !Array.isArray(message.content) || toolOrder.size === 0) {
      return message
    }
    const content = [...message.content].sort((left, right) => {
      const leftId = partToolCallId(left) ?? ""
      const rightId = partToolCallId(right) ?? ""
      return (
        (toolOrder.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
        (toolOrder.get(rightId) ?? Number.MAX_SAFE_INTEGER)
      )
    })
    toolOrder = new Map()
    return { ...message, content }
  })
}
