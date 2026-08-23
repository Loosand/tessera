/**
 * [INPUT]: 主进程捕获的未知 AI/IPC/恢复异常、AI SDK 公开工具错误、工具身份、公开安全文案与运行阶段
 * [OUTPUT]: 不泄露秘密、带稳定 code/phase/retryable 的 TaskRunErrorDataV1 与带工具关联的 TaskToolErrorDataV1
 * [POS]: Electron AI 运行与工具 IPC 边界中把实现异常映射为共享公开错误协议的分类器
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  TaskRunErrorCode,
  TaskRunErrorDataV1,
  TaskRunErrorPhase,
  TaskToolErrorCode,
  TaskToolErrorDataV1,
} from "@tessera/contracts"

const DEFAULT_ERROR_MESSAGE = "模型请求失败，请检查供应商配置、模型状态与网络连接。"
const TRUSTED_PUBLIC_ERROR_NAMES = new Set([
  "AgentChangeError",
  "AiProviderConfigError",
  "ContentLibraryError",
  "McpConfigError",
  "UserSkillError",
])
const RETRYABLE_ERROR_CODES = new Set<TaskRunErrorCode>([
  "network",
  "provider-rate-limit",
  "provider-response",
  "provider-timeout",
  "provider-unavailable",
  "stream-interrupted",
  "tool-failed",
  "transport",
])

type ErrorRecord = Record<string, unknown>

function errorRecord(error: unknown): ErrorRecord | null {
  return error && typeof error === "object" && !Array.isArray(error) ? (error as ErrorRecord) : null
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : ""
}

function rawErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : ""
}

function errorStatus(error: unknown) {
  const record = errorRecord(error)
  for (const key of ["statusCode", "status"]) {
    const value = record?.[key]
    if (typeof value === "number" && Number.isSafeInteger(value)) return value
  }
  return null
}

function searchableError(error: unknown) {
  const record = errorRecord(error)
  const values = [errorName(error), rawErrorMessage(error), record?.code]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
  return values.toLowerCase()
}

function inferErrorCode(error: unknown, phase: TaskRunErrorPhase): TaskRunErrorCode {
  const name = errorName(error)
  const status = errorStatus(error)
  const searchable = searchableError(error)

  if (phase === "resume") return "resume-failed"
  if (name === "AiProviderConfigError") return "provider-config"
  if (name === "AgentChangeError" || name === "ContentLibraryError" || name === "UserSkillError") {
    return "invalid-request"
  }
  if (name === "McpConfigError" || searchable.includes("tool execution")) return "tool-failed"
  if (status === 401 || status === 403 || /\b(unauthorized|forbidden|invalid api key)\b/u.test(searchable)) {
    return "provider-auth"
  }
  if (status === 429 || /\b(rate.?limit|too many requests)\b/u.test(searchable)) {
    return "provider-rate-limit"
  }
  if (
    status === 408 ||
    searchable.includes("timeout") ||
    searchable.includes("timed out") ||
    searchable.includes("etimedout")
  ) {
    return "provider-timeout"
  }
  if (status === 404 || searchable.includes("model not found") || searchable.includes("no such model")) {
    return "provider-unavailable"
  }
  if (status !== null && status >= 500) return "provider-unavailable"
  if (/\b(econnreset|econnrefused|enotfound|network|socket|fetch failed|connection)\b/u.test(searchable)) {
    return "network"
  }
  if (
    searchable.includes("type validation failed") ||
    searchable.includes("response format") ||
    searchable.includes("invalid response")
  ) {
    return "provider-response"
  }
  if (
    status === 400 ||
    status === 409 ||
    status === 422 ||
    searchable.includes("invalidargument") ||
    searchable.includes("invalid argument")
  ) {
    return "invalid-request"
  }
  return phase === "stream" ? "provider-unavailable" : "runtime"
}

function publicErrorMessage(error: unknown, explicitMessage?: string) {
  if (explicitMessage?.trim()) return explicitMessage.trim()
  const message = rawErrorMessage(error).trim()
  return TRUSTED_PUBLIC_ERROR_NAMES.has(errorName(error)) && message ? message : DEFAULT_ERROR_MESSAGE
}

export function taskRunError(
  code: TaskRunErrorCode,
  phase: TaskRunErrorPhase,
  message: string,
  retryable = RETRYABLE_ERROR_CODES.has(code),
): TaskRunErrorDataV1 {
  return { code, message, phase, retryable, version: 1 }
}

export function classifyTaskRunError(
  error: unknown,
  phase: TaskRunErrorPhase,
  explicitMessage?: string,
): TaskRunErrorDataV1 {
  const code = inferErrorCode(error, phase)
  return taskRunError(code, phase, publicErrorMessage(error, explicitMessage))
}

function inferToolErrorCode(message: string): TaskToolErrorCode {
  const searchable = message.toLowerCase()
  if (/\b(abort|aborted|cancel|cancelled|canceled)\b/u.test(searchable) || searchable.includes("停止")) {
    return "cancelled"
  }
  if (
    /\b(unauthorized|forbidden|permission denied|not allowed)\b/u.test(searchable) ||
    /无权|权限|拒绝访问/u.test(message)
  ) {
    return "permission-denied"
  }
  if (/\b(not found|enoent|no such file)\b/u.test(searchable) || /找不到|不存在/u.test(message)) {
    return "not-found"
  }
  if (
    /\b(conflict|already exists|changed on disk)\b/u.test(searchable) ||
    /冲突|已存在|已被修改/u.test(message)
  ) {
    return "conflict"
  }
  if (/\b(timeout|timed out|etimedout)\b/u.test(searchable) || message.includes("超时")) return "timeout"
  if (/\b(econnreset|econnrefused|enotfound|network|socket|fetch failed|connection)\b/u.test(searchable)) {
    return "network"
  }
  if (/\b(unavailable|service unavailable)\b/u.test(searchable) || message.includes("不可用")) {
    return "unavailable"
  }
  if (
    /\b(invalid|validation|schema|argument|required)\b/u.test(searchable) ||
    /参数|格式|必须|路径/u.test(message)
  ) {
    return "invalid-input"
  }
  return "execution"
}

const RETRYABLE_TOOL_ERROR_CODES = new Set<TaskToolErrorCode>(["timeout", "network", "unavailable"])

export function classifyTaskToolError(
  message: string,
  toolCallId: string,
  toolName: string,
): TaskToolErrorDataV1 {
  const code = inferToolErrorCode(message)
  return {
    code,
    message,
    retryable: RETRYABLE_TOOL_ERROR_CODES.has(code),
    toolCallId,
    toolName,
    version: 1,
  }
}
