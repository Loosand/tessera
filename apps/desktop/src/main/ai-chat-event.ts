/**
 * [INPUT]: SQLite 中持久化的未知 AI 流事件 JSON
 * [OUTPUT]: 通过字段级校验且兼容旧文本错误的 AiChatStreamEvent，拒绝损坏、未知运行/工具错误码或过期的恢复数据
 * [POS]: 数据库运行检查点与类型化 Electron 恢复通道之间的运行时边界
 * [DOC]: docs/architecture/database.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  type AiChatStreamChunk,
  type AiChatStreamEvent,
  isTaskRunErrorDataV1,
  isTaskToolErrorDataV1,
} from "@tessera/contracts"

type UnknownRecord = Record<string, unknown>

const FINISH_REASONS = new Set(["stop", "length", "content-filter", "tool-calls", "error", "other"])

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasString(record: UnknownRecord, key: string) {
  return typeof record[key] === "string"
}

function hasOptionalString(record: UnknownRecord, key: string) {
  return record[key] === undefined || hasString(record, key)
}

function hasOptionalBoolean(record: UnknownRecord, key: string) {
  return record[key] === undefined || typeof record[key] === "boolean"
}

export function isAiChatStreamChunk(value: unknown): value is AiChatStreamChunk {
  if (!isUnknownRecord(value) || typeof value.type !== "string") return false

  switch (value.type) {
    case "start":
      return hasOptionalString(value, "messageId")
    case "start-step":
    case "finish-step":
    case "reset-step":
      return true
    case "text-start":
    case "text-end":
    case "reasoning-start":
    case "reasoning-end":
      return hasString(value, "id")
    case "text-delta":
    case "reasoning-delta":
      return hasString(value, "id") && hasString(value, "delta")
    case "source-url":
      return hasString(value, "sourceId") && hasString(value, "url") && hasOptionalString(value, "title")
    case "source-document":
      return (
        hasString(value, "sourceId") &&
        hasString(value, "mediaType") &&
        hasString(value, "title") &&
        hasOptionalString(value, "filename")
      )
    case "tool-input-start":
      return (
        hasString(value, "toolCallId") && hasString(value, "toolName") && hasOptionalString(value, "title")
      )
    case "tool-input-delta":
      return hasString(value, "toolCallId") && hasString(value, "inputTextDelta")
    case "tool-input-available":
      return (
        hasString(value, "toolCallId") &&
        hasString(value, "toolName") &&
        "input" in value &&
        hasOptionalString(value, "title")
      )
    case "tool-input-error":
      return (
        hasString(value, "toolCallId") &&
        hasString(value, "toolName") &&
        "input" in value &&
        hasString(value, "errorText") &&
        (value.failure === undefined || isTaskToolErrorDataV1(value.failure)) &&
        hasOptionalString(value, "title")
      )
    case "tool-output-available":
      return hasString(value, "toolCallId") && "output" in value
    case "tool-output-error":
      return (
        hasString(value, "toolCallId") &&
        hasString(value, "errorText") &&
        (value.failure === undefined || isTaskToolErrorDataV1(value.failure))
      )
    case "tool-output-denied":
      return hasString(value, "toolCallId")
    case "tool-approval-request":
      return (
        hasString(value, "approvalId") &&
        hasString(value, "toolCallId") &&
        hasOptionalBoolean(value, "isAutomatic") &&
        hasOptionalString(value, "signature")
      )
    case "tool-approval-response":
      return (
        hasString(value, "approvalId") &&
        typeof value.approved === "boolean" &&
        hasOptionalString(value, "reason")
      )
    case "finish":
      return (
        value.finishReason === undefined ||
        (typeof value.finishReason === "string" && FINISH_REASONS.has(value.finishReason))
      )
    case "abort":
      return hasOptionalString(value, "reason")
    case "error":
      return (
        hasString(value, "errorText") && (value.failure === undefined || isTaskRunErrorDataV1(value.failure))
      )
    default:
      return false
  }
}

export function isAiChatStreamEvent(value: unknown): value is AiChatStreamEvent {
  return (
    isUnknownRecord(value) &&
    hasString(value, "requestId") &&
    hasString(value, "taskId") &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    isAiChatStreamChunk(value.chunk)
  )
}

export function parseAiChatStreamEvent(payload: string): AiChatStreamEvent {
  const value: unknown = JSON.parse(payload)
  if (!isAiChatStreamEvent(value)) throw new Error("持久化的 AI 流事件格式无效。")
  return value
}
