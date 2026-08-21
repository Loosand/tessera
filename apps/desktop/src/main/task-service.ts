/**
 * [INPUT]: SQLite 任务仓储、显式可空工作区归属的跨进程任务输入与主进程当前工作区
 * [OUTPUT]: 任务列表/读取/保存/重命名/删除、工作区归属校验、版本化消息校验与运行前 mode/工作区授权
 * [POS]: Electron 主进程中的通用 Chat/Agent 任务会话领域服务
 * [DOC]: docs/architecture/database.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AiProviderId,
  TaskMessage,
  TaskMessagePart,
  TaskMode,
  TaskSessionSaveInput,
  TaskSessionSnapshot,
  TaskSessionStatus,
  TaskSessionSummary,
  WorkspaceInfo,
} from "@tessera/contracts"
import {
  type DatabaseClient,
  deleteTaskSession,
  findTaskSession,
  listRecentTaskSessions,
  listWorkspaceTaskSessions,
  renameTaskSession,
  saveTaskSession,
} from "@tessera/database"

const MAX_TASK_MESSAGE_BYTES = 32 * 1024 * 1024
const MAX_TASK_MESSAGES = 500
const TASK_STATUSES = new Set<TaskSessionStatus>(["idle", "running", "completed", "failed", "cancelled"])
const TASK_MODES = new Set<TaskMode>(["chat", "agent"])
const TOOL_STATES = new Set([
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
  "output-available",
  "output-error",
  "output-denied",
])
const PROVIDER_IDS = new Set<AiProviderId>([
  "openai-compatible",
  "anthropic-compatible",
  "deepseek",
  "grok",
  "openrouter",
])

type TaskRecord = NonNullable<ReturnType<typeof findTaskSession>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function validateTaskId(value: string) {
  if (!value || value.length > 128 || !/^[\w-]+$/u.test(value)) throw new Error("任务 ID 无效。")
  return value
}

function validateTaskTitle(value: string) {
  const title = value.trim().replace(/\s+/gu, " ").slice(0, 120)
  return title || "新任务"
}

function validateTaskMode(value: unknown): TaskMode {
  if (!TASK_MODES.has(value as TaskMode)) throw new Error("任务模式无效。")
  return value as TaskMode
}

function validateTaskStatus(value: unknown): TaskSessionStatus {
  if (!TASK_STATUSES.has(value as TaskSessionStatus)) throw new Error("任务状态无效。")
  return value as TaskSessionStatus
}

function validateOptionalString(value: unknown) {
  return value === undefined || typeof value === "string"
}

function validateTaskPart(part: unknown): part is TaskMessagePart {
  if (!isRecord(part) || typeof part.type !== "string") return false
  if (part.type === "text") {
    return (
      typeof part.text === "string" &&
      (part.state === undefined || part.state === "streaming" || part.state === "done")
    )
  }
  if (part.type === "reasoning") {
    return (
      typeof part.text === "string" &&
      validateOptionalString(part.id) &&
      (part.state === undefined || part.state === "streaming" || part.state === "done")
    )
  }
  if (part.type === "file") {
    return (
      typeof part.url === "string" &&
      typeof part.mediaType === "string" &&
      validateOptionalString(part.filename)
    )
  }
  if (part.type === "source-url") {
    return (
      typeof part.sourceId === "string" && typeof part.url === "string" && validateOptionalString(part.title)
    )
  }
  if (part.type === "source-document") {
    return (
      typeof part.sourceId === "string" &&
      typeof part.mediaType === "string" &&
      typeof part.title === "string" &&
      validateOptionalString(part.filename)
    )
  }
  if (part.type === "step-start") return true
  if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) return false
  if (
    typeof part.toolCallId !== "string" ||
    !TOOL_STATES.has(part.state as string) ||
    !validateOptionalString(part.title) ||
    (part.type === "dynamic-tool" && typeof part.toolName !== "string") ||
    (part.preliminary !== undefined && typeof part.preliminary !== "boolean") ||
    !validateOptionalString(part.errorText)
  ) {
    return false
  }
  if (part.approval === undefined) return true
  return (
    isRecord(part.approval) &&
    typeof part.approval.id === "string" &&
    (part.approval.approved === undefined || typeof part.approval.approved === "boolean") &&
    (part.approval.isAutomatic === undefined || typeof part.approval.isAutomatic === "boolean") &&
    validateOptionalString(part.approval.reason) &&
    validateOptionalString(part.approval.signature)
  )
}

function validateTaskMessages(value: unknown): TaskMessage[] {
  if (!Array.isArray(value) || value.length > MAX_TASK_MESSAGES) throw new Error("任务消息无效。")

  for (const message of value) {
    if (
      !isRecord(message) ||
      typeof message.id !== "string" ||
      !message.id ||
      message.id.length > 128 ||
      (message.role !== "user" && message.role !== "assistant") ||
      !Array.isArray(message.parts) ||
      !message.parts.every(validateTaskPart)
    ) {
      throw new Error("任务消息无效。")
    }
    if (message.metadata !== undefined) {
      if (
        !isRecord(message.metadata) ||
        !validateOptionalString(message.metadata.modelId) ||
        (message.metadata.providerId !== undefined &&
          !PROVIDER_IDS.has(message.metadata.providerId as AiProviderId))
      ) {
        throw new Error("任务消息元数据无效。")
      }
    }
  }

  let payload: string
  try {
    payload = JSON.stringify(value)
  } catch {
    throw new Error("任务消息无法序列化。")
  }
  if (Buffer.byteLength(payload, "utf8") > MAX_TASK_MESSAGE_BYTES) {
    throw new Error("任务消息超出本地保存上限。")
  }
  return value as TaskMessage[]
}

function toTaskSummary(record: ReturnType<typeof listRecentTaskSessions>[number]): TaskSessionSummary {
  return {
    ...record,
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
  }
}

function toTaskSnapshot(record: TaskRecord): TaskSessionSnapshot {
  const messages = record.messagePayloads.map((payload) => {
    try {
      return JSON.parse(payload) as unknown
    } catch {
      throw new Error("任务消息已经损坏，无法恢复。")
    }
  })
  return { ...toTaskSummary(record), messages: validateTaskMessages(messages) }
}

export interface DesktopTaskService {
  authorizeTurn(taskId: string, mode: TaskMode, workspace: WorkspaceInfo | null): void
  listRecent(): TaskSessionSummary[]
  listWorkspace(workspaceId: string): TaskSessionSummary[]
  read(taskId: string): TaskSessionSnapshot
  rename(taskId: string, title: string): TaskSessionSummary
  delete(taskId: string): boolean
  save(input: TaskSessionSaveInput, workspace: WorkspaceInfo | null): TaskSessionSnapshot
}

export function createDesktopTaskService(client: DatabaseClient): DesktopTaskService {
  return {
    listRecent: () => listRecentTaskSessions(client).map(toTaskSummary),
    listWorkspace: (workspaceId) => listWorkspaceTaskSessions(client, workspaceId).map(toTaskSummary),
    read: (taskId) => {
      const record = findTaskSession(client, validateTaskId(taskId))
      if (!record) throw new Error("找不到这个任务。")
      return toTaskSnapshot(record)
    },
    rename: (taskId, title) => {
      const record = renameTaskSession(client, validateTaskId(taskId), validateTaskTitle(title))
      if (!record) throw new Error("找不到这个任务。")
      return toTaskSummary(record)
    },
    delete: (taskId) => deleteTaskSession(client, validateTaskId(taskId)),
    save: (input, workspace) => {
      const id = validateTaskId(input?.id)
      const mode = validateTaskMode(input?.mode)
      const status = validateTaskStatus(input?.status)
      const title = validateTaskTitle(input?.title ?? "")
      const messages = validateTaskMessages(input?.messages)
      const requestedWorkspaceId = input?.workspaceId
      if (requestedWorkspaceId !== null && typeof requestedWorkspaceId !== "string") {
        throw new Error("任务工作区无效。")
      }
      const existing = findTaskSession(client, id)
      if (existing?.mode && existing.mode !== mode) throw new Error("任务创建后不能切换模式。")
      if (existing && existing.workspaceId !== requestedWorkspaceId) {
        throw new Error("任务创建后不能更改绑定的工作区。")
      }
      if (existing?.mode === "agent" && existing.workspaceId !== workspace?.id) {
        throw new Error("请先打开这个 Agent 任务绑定的工作区。")
      }
      if (requestedWorkspaceId && requestedWorkspaceId !== workspace?.id) {
        throw new Error("请先打开任务要绑定的工作区。")
      }
      const workspaceId = existing ? existing.workspaceId : requestedWorkspaceId
      if (mode === "agent" && !workspaceId) throw new Error("Agent 任务必须绑定工作区。")

      const record = saveTaskSession(client, {
        id,
        mode,
        workspaceId,
        title,
        status,
        updatedAt: new Date(),
        messagePayloads: messages.map((message) => JSON.stringify(message)),
      })
      if (!record) throw new Error("任务保存失败。")
      return toTaskSnapshot(record)
    },
    authorizeTurn: (taskId, mode, workspace) => {
      const record = findTaskSession(client, validateTaskId(taskId))
      if (!record) throw new Error("请先创建任务再发送消息。")
      if (record.mode !== validateTaskMode(mode)) throw new Error("任务运行模式与已保存会话不一致。")
      if (record.mode === "agent" && record.workspaceId !== workspace?.id) {
        throw new Error("请先打开这个 Agent 任务绑定的工作区。")
      }
    },
  }
}
