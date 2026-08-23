/**
 * [INPUT]: 任务执行模式、逐轮 Skill、研究网络模式以及持久化运行策略/资源摘要的未知载荷
 * [OUTPUT]: Task Run Policy、资源摘要及其依赖的稳定字面量契约与运行时守卫
 * [POS]: @tessera/contracts 中独立于 IPC 聚合入口的任务运行策略领域边界
 * [DOC]: docs/architecture/ai-observability.md、docs/architecture/research-workflow.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export type AiChatReasoning = "auto" | "none" | "low" | "medium" | "high"

export type TaskMode = "chat" | "agent"

export const BUILT_IN_TASK_SKILL_IDS = ["research", "writing"] as const
export type BuiltInTaskSkillId = (typeof BUILT_IN_TASK_SKILL_IDS)[number]

export const TASK_SKILL_IDS = [...BUILT_IN_TASK_SKILL_IDS, "question-answering"] as const
export const USER_TASK_SKILL_PREFIX = "user:" as const
export type UserTaskSkillId = `${typeof USER_TASK_SKILL_PREFIX}${string}`
export type TaskSkillId = (typeof TASK_SKILL_IDS)[number] | UserTaskSkillId | null

export function isUserTaskSkillId(value: unknown): value is UserTaskSkillId {
  return (
    typeof value === "string" &&
    value.startsWith(USER_TASK_SKILL_PREFIX) &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.slice(USER_TASK_SKILL_PREFIX.length)) &&
    value.length <= USER_TASK_SKILL_PREFIX.length + 64
  )
}

export function isTaskSkillId(value: unknown): value is TaskSkillId {
  return (
    value === null ||
    (typeof value === "string" && TASK_SKILL_IDS.some((skillId) => skillId === value)) ||
    isUserTaskSkillId(value)
  )
}

export type TaskToolScope = "conversation" | "workspace-read" | "workspace-write"

export const RESEARCH_NETWORK_MODES = ["system", "direct"] as const
export type ResearchNetworkMode = (typeof RESEARCH_NETWORK_MODES)[number]

export function isResearchNetworkMode(value: unknown): value is ResearchNetworkMode {
  return typeof value === "string" && RESEARCH_NETWORK_MODES.some((mode) => mode === value)
}

export type TaskRunPolicy = {
  limits: {
    /** null 表示研究运行不人为覆盖供应商/模型的单次输出上限。 */
    maxOutputTokens: number | null
    maxSteps: number
    timeoutMs: number
  }
  mode: TaskMode
  reasoning: AiChatReasoning
  skillId: TaskSkillId
  toolScope: TaskToolScope
  webSearch: boolean
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

export function isTaskRunPolicy(value: unknown): value is TaskRunPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const policy = value as Record<string, unknown>
  const limits = policy.limits
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) return false
  const runLimits = limits as Record<string, unknown>
  return (
    (policy.mode === "chat" || policy.mode === "agent") &&
    (policy.reasoning === "auto" ||
      policy.reasoning === "none" ||
      policy.reasoning === "low" ||
      policy.reasoning === "medium" ||
      policy.reasoning === "high") &&
    isTaskSkillId(policy.skillId) &&
    (policy.toolScope === "conversation" ||
      policy.toolScope === "workspace-read" ||
      policy.toolScope === "workspace-write") &&
    typeof policy.webSearch === "boolean" &&
    (isPositiveSafeInteger(runLimits.maxOutputTokens) || runLimits.maxOutputTokens === null) &&
    isPositiveSafeInteger(runLimits.maxSteps) &&
    isPositiveSafeInteger(runLimits.timeoutMs)
  )
}

export type TaskRunResourceSummary = {
  attachmentCount: number
  continuedFromMessageId?: string | null
  currentDocumentPath: string | null
  researchNetworkMode: ResearchNetworkMode | null
  resumedResearchRequestId?: string | null
  workspaceId: string | null
  workspaceName: string | null
}

export function isTaskRunResourceSummary(value: unknown): value is TaskRunResourceSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const summary = value as Record<string, unknown>
  return (
    typeof summary.attachmentCount === "number" &&
    Number.isSafeInteger(summary.attachmentCount) &&
    summary.attachmentCount >= 0 &&
    (summary.continuedFromMessageId === undefined ||
      summary.continuedFromMessageId === null ||
      typeof summary.continuedFromMessageId === "string") &&
    (summary.currentDocumentPath === null || typeof summary.currentDocumentPath === "string") &&
    (summary.researchNetworkMode === null || isResearchNetworkMode(summary.researchNetworkMode)) &&
    (summary.resumedResearchRequestId === undefined ||
      summary.resumedResearchRequestId === null ||
      typeof summary.resumedResearchRequestId === "string") &&
    (summary.workspaceId === null || typeof summary.workspaceId === "string") &&
    (summary.workspaceName === null || typeof summary.workspaceName === "string")
  )
}
