/**
 * [INPUT]: SQLite 任务仓储、可逐轮变化的显式可空 Skill、兼容工作区归属、等待输入状态的跨进程任务输入与主进程当前工作区
 * [OUTPUT]: 任务列表/必需或可选读取/保存/重命名/删除、主进程运行状态收口、等待输入恢复、创建期工作区校验、带 requestId 的版本化引申问题/运行/工具失败消息校验与运行前逐轮 Skill 校验
 * [POS]: Electron 主进程中的统一任务会话领域服务；旧 mode/workspace 只保留兼容归属，不再决定逐轮资源授权
 * [DOC]: docs/architecture/database.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  AI_PROVIDER_IDS,
  type TaskMessage,
  type TaskMessagePart,
  type TaskMode,
  type TaskSessionSaveInput,
  type TaskSessionSnapshot,
  type TaskSessionStatus,
  type TaskSessionSummary,
  type TaskSkillId,
  type TaskToolState,
  type WorkspaceInfo,
  isTaskFollowUpQuestionsDataV1,
  isTaskRunErrorDataV1,
  isTaskSkillId,
  isTaskToolErrorDataV1,
} from "@tessera/contracts"
import {
  type DatabaseClient,
  deleteTaskSession,
  findTaskSession,
  listRecentTaskSessions,
  listWorkspaceTaskSessions,
  renameTaskSession,
  saveTaskSession,
  updateTaskSessionStatus,
} from "@tessera/database"

const MAX_TASK_MESSAGE_BYTES = 32 * 1024 * 1024
const MAX_TASK_MESSAGES = 500
const TASK_STATUSES = [
  "idle",
  "running",
  "waiting-input",
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly TaskSessionStatus[]
const TASK_MODES = ["chat", "agent"] as const satisfies readonly TaskMode[]
const TOOL_STATES = [
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
  "output-available",
  "output-error",
  "output-denied",
] as const satisfies readonly TaskToolState[]

type TaskRecord = NonNullable<ReturnType<typeof findTaskSession>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isStringValue<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return typeof value === "string" && values.some((candidate) => candidate === value)
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
  if (!isStringValue(TASK_MODES, value)) throw new Error("任务模式无效。")
  return value
}

function validateTaskSkillId(value: unknown): TaskSkillId {
  if (!isTaskSkillId(value)) throw new Error("任务 Skill 无效。")
  return value
}

function validateTaskStatus(value: unknown): TaskSessionStatus {
  if (!isStringValue(TASK_STATUSES, value)) throw new Error("任务状态无效。")
  return value
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
  if (part.type === "data-task-error") {
    if (
      !validateOptionalString(part.id) ||
      !isRecord(part.data) ||
      typeof part.data.message !== "string" ||
      typeof part.data.retryable !== "boolean"
    ) {
      return false
    }
    return part.data.version === undefined
      ? part.data.code === undefined && part.data.phase === undefined
      : isTaskRunErrorDataV1(part.data)
  }
  if (part.type === "data-follow-up-questions") {
    return validateOptionalString(part.id) && isTaskFollowUpQuestionsDataV1(part.data)
  }
  if (part.type === "data-tool-error") {
    return validateOptionalString(part.id) && isTaskToolErrorDataV1(part.data)
  }
  if (part.type === "step-start") return true
  if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) return false
  if (
    typeof part.toolCallId !== "string" ||
    !isStringValue(TOOL_STATES, part.state) ||
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

function validateTaskMessage(message: unknown): message is TaskMessage {
  if (
    !isRecord(message) ||
    typeof message.id !== "string" ||
    !message.id ||
    message.id.length > 128 ||
    (message.role !== "user" && message.role !== "assistant") ||
    !Array.isArray(message.parts) ||
    !message.parts.every(validateTaskPart)
  ) {
    return false
  }
  if (message.metadata === undefined) return true
  return (
    isRecord(message.metadata) &&
    validateOptionalString(message.metadata.configId) &&
    validateOptionalString(message.metadata.modelId) &&
    validateOptionalString(message.metadata.requestId) &&
    (message.metadata.providerId === undefined || isStringValue(AI_PROVIDER_IDS, message.metadata.providerId))
  )
}

function validateTaskMessages(value: unknown): TaskMessage[] {
  if (!Array.isArray(value) || value.length > MAX_TASK_MESSAGES) throw new Error("任务消息无效。")
  if (!value.every(validateTaskMessage)) throw new Error("任务消息无效。")

  let payload: string
  try {
    payload = JSON.stringify(value)
  } catch {
    throw new Error("任务消息无法序列化。")
  }
  if (Buffer.byteLength(payload, "utf8") > MAX_TASK_MESSAGE_BYTES) {
    throw new Error("任务消息超出本地保存上限。")
  }
  return value
}

function toTaskSummary(record: ReturnType<typeof listRecentTaskSessions>[number]): TaskSessionSummary {
  return {
    ...record,
    skillId: validateTaskSkillId(record.skillId),
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
  }
}

function toTaskSnapshot(record: TaskRecord): TaskSessionSnapshot {
  const messages = record.messagePayloads.map((payload) => {
    try {
      const message: unknown = JSON.parse(payload)
      return message
    } catch {
      throw new Error("任务消息已经损坏，无法恢复。")
    }
  })
  return { ...toTaskSummary(record), messages: validateTaskMessages(messages) }
}

export type DesktopTaskService = {
  readonly authorizeTurn: (
    taskId: string,
    mode: TaskMode,
    workspace: WorkspaceInfo | null,
    skillId?: TaskSkillId,
  ) => void
  readonly delete: (taskId: string) => boolean
  readonly listRecent: () => TaskSessionSummary[]
  readonly listWorkspace: (workspaceId: string) => TaskSessionSummary[]
  readonly read: (taskId: string) => TaskSessionSnapshot
  readonly readIfExists: (taskId: string) => TaskSessionSnapshot | null
  readonly rename: (taskId: string, title: string) => TaskSessionSummary
  readonly save: (input: TaskSessionSaveInput, workspace: WorkspaceInfo | null) => TaskSessionSnapshot
  readonly setRunStatus: (taskId: string, status: TaskSessionStatus) => TaskSessionSnapshot | null
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
    readIfExists: (taskId) => {
      const record = findTaskSession(client, validateTaskId(taskId))
      return record ? toTaskSnapshot(record) : null
    },
    rename: (taskId, title) => {
      const record = renameTaskSession(client, validateTaskId(taskId), validateTaskTitle(title))
      if (!record) throw new Error("找不到这个任务。")
      return toTaskSummary(record)
    },
    delete: (taskId) => deleteTaskSession(client, validateTaskId(taskId)),
    setRunStatus: (taskId, status) => {
      const record = updateTaskSessionStatus(client, validateTaskId(taskId), validateTaskStatus(status))
      return record ? toTaskSnapshot(record) : null
    },
    save: (input, workspace) => {
      const id = validateTaskId(input?.id)
      const mode = validateTaskMode(input?.mode)
      const skillId = validateTaskSkillId(input?.skillId)
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
      if (!existing && requestedWorkspaceId && requestedWorkspaceId !== workspace?.id) {
        throw new Error("请先打开任务要绑定的工作区。")
      }
      const workspaceId = existing ? existing.workspaceId : requestedWorkspaceId
      if (!existing && mode === "agent" && !workspaceId) throw new Error("Agent 任务必须绑定工作区。")

      const record = saveTaskSession(client, {
        id,
        mode,
        skillId,
        workspaceId,
        title,
        status,
        updatedAt: new Date(),
        messagePayloads: messages.map((message) => JSON.stringify(message)),
      })
      if (!record) throw new Error("任务保存失败。")
      return toTaskSnapshot(record)
    },
    authorizeTurn: (taskId, mode, workspace, skillId) => {
      const record = findTaskSession(client, validateTaskId(taskId))
      if (!record) throw new Error("请先创建任务再发送消息。")
      validateTaskMode(mode)
      if (skillId !== undefined) validateTaskSkillId(skillId)
      void workspace
    },
  }
}
