/**
 * [INPUT]: 任务执行模式、逐轮 Skill、研究网络模式以及持久化运行策略/ContextManifest/压缩投影/资源摘要的未知载荷
 * [OUTPUT]: Task Run Policy、脱敏上下文预算、压缩 marker、资源摘要及其依赖的稳定字面量契约与运行时守卫
 * [POS]: @tessera/contracts 中独立于 IPC 聚合入口的任务运行策略领域边界
 * [DOC]: docs/architecture/agent-run-reliability.md、docs/architecture/ai-observability.md、docs/architecture/research-workflow.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
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

export const TASK_CONTEXT_SECTION_KINDS = [
  "instructions",
  "conversation",
  "tool-results",
  "tool-definitions",
  "framing",
] as const

export type TaskContextSectionKind = (typeof TASK_CONTEXT_SECTION_KINDS)[number]

export type TaskContextCompaction = {
  estimatedTokensAfter: number
  estimatedTokensBefore: number
  firstRetainedMessageIndex: number
  omittedMessageCount: number
  reason: "threshold"
  retainedMessageCount: number
  sourceMessageCount: number
  summaryCharacters: number
  version: 1
}

export type TaskContextManifest = {
  availableInputTokens: number | null
  compaction?: TaskContextCompaction
  estimatedInputTokens: number
  estimator: "heuristic-v1"
  modelContextWindow: number | null
  modelMaxInputTokens: number | null
  observedStep: number
  reservedOutputTokens: number
  safetyMarginTokens: number
  sections: Array<{
    estimatedTokens: number
    kind: TaskContextSectionKind
  }>
  status: "within-budget" | "over-budget" | "unknown"
  version: 1
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

export function isTaskContextCompaction(value: unknown): value is TaskContextCompaction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const compaction = value as Record<string, unknown>
  return (
    compaction.version === 1 &&
    compaction.reason === "threshold" &&
    isNonNegativeSafeInteger(compaction.estimatedTokensAfter) &&
    isNonNegativeSafeInteger(compaction.estimatedTokensBefore) &&
    isNonNegativeSafeInteger(compaction.firstRetainedMessageIndex) &&
    isNonNegativeSafeInteger(compaction.omittedMessageCount) &&
    isNonNegativeSafeInteger(compaction.retainedMessageCount) &&
    isNonNegativeSafeInteger(compaction.sourceMessageCount) &&
    isNonNegativeSafeInteger(compaction.summaryCharacters) &&
    compaction.omittedMessageCount + compaction.retainedMessageCount === compaction.sourceMessageCount &&
    compaction.firstRetainedMessageIndex <= compaction.sourceMessageCount &&
    compaction.estimatedTokensAfter <= compaction.estimatedTokensBefore
  )
}

export function isTaskContextManifest(value: unknown): value is TaskContextManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const manifest = value as Record<string, unknown>
  if (!Array.isArray(manifest.sections)) return false
  return (
    manifest.version === 1 &&
    manifest.estimator === "heuristic-v1" &&
    (manifest.compaction === undefined || isTaskContextCompaction(manifest.compaction)) &&
    (manifest.status === "within-budget" ||
      manifest.status === "over-budget" ||
      manifest.status === "unknown") &&
    (manifest.availableInputTokens === null || isNonNegativeSafeInteger(manifest.availableInputTokens)) &&
    isNonNegativeSafeInteger(manifest.estimatedInputTokens) &&
    (manifest.modelContextWindow === null || isPositiveSafeInteger(manifest.modelContextWindow)) &&
    (manifest.modelMaxInputTokens === null || isPositiveSafeInteger(manifest.modelMaxInputTokens)) &&
    isNonNegativeSafeInteger(manifest.observedStep) &&
    isNonNegativeSafeInteger(manifest.reservedOutputTokens) &&
    isNonNegativeSafeInteger(manifest.safetyMarginTokens) &&
    manifest.sections.every((section) => {
      if (!section || typeof section !== "object" || Array.isArray(section)) return false
      const candidate = section as Record<string, unknown>
      return (
        typeof candidate.kind === "string" &&
        TASK_CONTEXT_SECTION_KINDS.some((kind) => kind === candidate.kind) &&
        isNonNegativeSafeInteger(candidate.estimatedTokens)
      )
    })
  )
}

export type TaskRunResourceSummary = {
  attachmentCount: number
  contextManifest?: TaskContextManifest
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
    (summary.contextManifest === undefined || isTaskContextManifest(summary.contextManifest)) &&
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
