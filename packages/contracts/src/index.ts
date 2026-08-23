/**
 * [INPUT]: Electron 桌面应用当前需要的跨进程数据、生命周期、工作区条目、AI 模型事实/端点绑定、MCP 服务器、用户 Skill、研究网络偏好、任务运行策略、内容对象、开发期 AI 日志与 Agent 变更审批形状
 * [OUTPUT]: IPC 频道、工作区文件操作、模型/MCP/用户 Skill/研究网络配置、类型化 RunPolicy、版本化公开运行/工具错误、脱敏运行解释、后端无关内容引用、可恢复流式运行、开发期 AI 日志入口、客户端问答/研究计划工具、Agent Diff 审批、关闭握手与可推导的桌面 API 类型契约
 * [POS]: 应用和共享包共同依赖的底层契约入口
 * [DOC]: docs/architecture.md、docs/architecture/ai-providers.md、docs/architecture/ai-observability.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/mcp.md、docs/architecture/research-workflow.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export const IPC_CHANNELS = {
  appInfo: "app:info",
  appCancelClose: "app:cancel-close",
  appCloseRequested: "app:close-requested",
  appConfirmClose: "app:confirm-close",
  aiDevtoolsOpen: "ai-devtools:open",
  contentLibraryCurrent: "content-library:current",
  contentLibrarySelect: "content-library:select",
  contentLibraryRevoke: "content-library:revoke",
  workspaceCurrent: "workspace:current",
  workspaceSelect: "workspace:select",
  workspaceRecent: "workspace:recent",
  workspaceOpenRecent: "workspace:open-recent",
  workspaceReveal: "workspace:reveal",
  workspaceRevealRecent: "workspace:reveal-recent",
  workspaceCopyPath: "workspace:copy-path",
  workspaceRemoveRecent: "workspace:remove-recent",
  workspaceListDocuments: "workspace:list-documents",
  workspaceListDirectories: "workspace:list-directories",
  workspaceChanged: "workspace:changed",
  documentRead: "document:read",
  documentCreate: "document:create",
  documentRename: "document:rename",
  documentWrite: "document:write",
  workspaceEntryCopyPath: "workspace-entry:copy-path",
  workspaceEntryCreateDirectory: "workspace-entry:create-directory",
  workspaceEntryDelete: "workspace-entry:delete",
  workspaceEntryRenameDirectory: "workspace-entry:rename-directory",
  workspaceEntryReveal: "workspace-entry:reveal",
  aiProviderConfigsChanged: "ai-provider:configs-changed",
  aiProviderDeleteConfig: "ai-provider:delete-config",
  aiProviderListConfigs: "ai-provider:list-configs",
  aiProviderListModels: "ai-provider:list-models",
  aiProviderSaveConfig: "ai-provider:save-config",
  researchNetworkGet: "research-network:get",
  researchNetworkSet: "research-network:set",
  researchNotebookRead: "research:notebook-read",
  researchSourcesSave: "research:sources-save",
  mcpServersChanged: "mcp:servers-changed",
  mcpServerDelete: "mcp:server-delete",
  mcpServerList: "mcp:server-list",
  mcpServerSave: "mcp:server-save",
  mcpServerTest: "mcp:server-test",
  userSkillsChanged: "skill:user-skills-changed",
  userSkillDelete: "skill:user-delete",
  userSkillInstall: "skill:user-install",
  userSkillInstallScanned: "skill:user-install-scanned",
  userSkillList: "skill:user-list",
  userSkillScan: "skill:user-scan",
  userSkillSetEnabled: "skill:user-set-enabled",
  aiChatCancel: "ai-chat:cancel",
  aiChatEvent: "ai-chat:event",
  aiChatResume: "ai-chat:resume",
  aiChatStart: "ai-chat:start",
  taskRunRead: "task-run:read",
  agentChangePreview: "agent-change:preview",
  taskListRecent: "task:list-recent",
  taskListWorkspace: "task:list-workspace",
  taskRead: "task:read",
  taskSave: "task:save",
  taskRename: "task:rename",
  taskDelete: "task:delete",
  taskListArtifacts: "task:list-artifacts",
} as const

export type IpcChannelMap = typeof IPC_CHANNELS
export type IpcChannelKey = keyof IpcChannelMap
export type IpcChannel = IpcChannelMap[IpcChannelKey]

export const AI_PROVIDER_IDS = [
  "openai-compatible",
  "anthropic-compatible",
  "deepseek",
  "grok",
  "openrouter",
] as const

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && AI_PROVIDER_IDS.some((providerId) => providerId === value)
}

export type AiProviderConnectionInput = {
  apiKey: string
  baseUrl: string
  configId: string
  providerId: AiProviderId
}

export const AI_MODEL_TYPES = [
  "chat",
  "embedding",
  "rerank",
  "image-generation",
  "video-generation",
  "text-to-speech",
  "speech-to-text",
  "realtime",
] as const

export type AiModelType = (typeof AI_MODEL_TYPES)[number]

export const AI_MODEL_MODALITIES = ["text", "image", "audio", "video", "vector"] as const

export type AiModelModality = (typeof AI_MODEL_MODALITIES)[number]

export const AI_MODEL_ENDPOINT_TYPES = [
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
  "xai-responses",
] as const

export type AiModelEndpointType = (typeof AI_MODEL_ENDPOINT_TYPES)[number]

export type AiModelCapabilityState = "supported" | "unsupported" | "unknown"
export type AiModelCapabilitySource = "builtin" | "remote" | "custom" | "unknown"

export type AiModelCapabilities = {
  functionCall: AiModelCapabilityState
  reasoning: AiModelCapabilityState
  structuredOutput: AiModelCapabilityState
}

export type AiModelCapabilityKey = keyof AiModelCapabilities

export type AiModelProfileField =
  | "contextWindow"
  | "inputModalities"
  | "maxInputTokens"
  | "maxOutputTokens"
  | "modelType"
  | "name"
  | "outputModalities"

export type AiModelEndpointBinding = {
  capabilityOverrides?: Partial<AiModelCapabilities>
  endpointType: AiModelEndpointType
  nativeWebSearch: AiModelCapabilityState
  officialOnly?: boolean
  source: AiModelCapabilitySource
}

export type AiProviderModel = {
  capabilities?: AiModelCapabilities
  capabilitySources?: Partial<Record<AiModelCapabilityKey, AiModelCapabilitySource>>
  /** @deprecated 读取旧配置时使用；新配置通过 capabilitySources 逐字段记录来源。 */
  capabilitySource?: AiModelCapabilitySource
  contextWindow: number | null
  endpointBindings?: AiModelEndpointBinding[]
  fieldSources?: Partial<Record<AiModelProfileField, AiModelCapabilitySource>>
  id: string
  inputModalities?: AiModelModality[]
  maxInputTokens?: number | null
  maxOutputTokens: number | null
  modelType?: AiModelType
  name: string | null
  ownedBy: string | null
  outputModalities?: AiModelModality[]
}

export type AiProviderConfiguredModel = AiProviderModel & {
  enabled: boolean
}

export type AiProviderConfig = {
  apiKeyConfigured: boolean
  baseUrl: string
  configId: string
  displayName: string
  enabled: boolean
  models: AiProviderConfiguredModel[]
  providerId: AiProviderId
  updatedAt: number
}

export type AiProviderSaveInput = {
  apiKey?: string
  baseUrl: string
  configId: string
  displayName: string
  enabled: boolean
  models: AiProviderConfiguredModel[]
  providerId: AiProviderId
  removeApiKey?: boolean
}

export type AiConfiguredModel = AiProviderConfiguredModel & {
  configId: string
  displayName: string
  providerId: AiProviderId
}

type OperationFailure<ErrorCode extends string> = [ErrorCode] extends [never]
  ? { ok: false; error: string }
  : { ok: false; code?: ErrorCode; error: string }

export type OperationResult<Success extends object = Record<never, never>, ErrorCode extends string = never> =
  | ({ ok: true } & Success)
  | OperationFailure<ErrorCode>

export type AiProviderModelListResult = OperationResult<
  { models: AiProviderModel[] },
  "catalog-unsupported" | "request-failed"
>

export type AiProviderConfigResult = OperationResult<{ config: AiProviderConfig }>
export type AiProviderConfigDeleteResult = OperationResult

export const MCP_SERVER_TRANSPORTS = ["stdio", "streamable-http", "sse"] as const

export type McpServerTransport = (typeof MCP_SERVER_TRANSPORTS)[number]
export type McpRuntimeState = "disabled" | "idle" | "connecting" | "connected" | "error"

export type McpToolAnnotations = {
  destructive?: boolean
  idempotent?: boolean
  openWorld?: boolean
  readOnly?: boolean
}

export type McpToolSummary = {
  annotations?: McpToolAnnotations
  description?: string
  enabled: boolean
  inputSchema: Record<string, unknown>
  name: string
  serverId: string
  title?: string
}

export type McpServerConfig = {
  args: string[]
  command: string | null
  description: string
  disabledTools: string[]
  enabled: boolean
  envConfigured: boolean
  headersConfigured: boolean
  id: string
  lastError?: string
  name: string
  serverName?: string
  serverVersion?: string
  status: McpRuntimeState
  timeoutMs: number
  transport: McpServerTransport
  trusted: boolean
  updatedAt: number
  url: string | null
}

export type McpServerSaveInput = {
  args: string[]
  command?: string | null
  description: string
  disabledTools: string[]
  enabled: boolean
  env?: Record<string, string>
  headers?: Record<string, string>
  id: string
  name: string
  removeEnv?: boolean
  removeHeaders?: boolean
  timeoutMs: number
  transport: McpServerTransport
  trusted: boolean
  url?: string | null
}

export type McpServerResult = OperationResult<{ server: McpServerConfig }>
export type McpServerDeleteResult = OperationResult
export type McpServerTestResult = OperationResult<{
  server: McpServerConfig
  tools: McpToolSummary[]
}>

export type AiChatReasoning = "auto" | "none" | "low" | "medium" | "high"

export type AiChatMessagePart =
  | { type: "text"; text: string }
  | { type: "file"; filename?: string; mediaType: string; url: string }

export type AiChatMessage = {
  id: string
  parts: AiChatMessagePart[]
  role: "user" | "assistant"
}

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

export type UserSkillConfig = {
  available: boolean
  description: string
  displayName: string
  enabled: boolean
  error?: string
  fileCount: number
  id: UserTaskSkillId
  installedAt: number
  name: string
  shortDescription: string
  totalBytes: number
  updatedAt: number
}

export type UserSkillScanCandidateStatus = "ready" | "installed" | "conflict" | "invalid"

export type UserSkillScanCandidate = {
  description: string
  displayName: string
  error?: string
  id: string
  name: string | null
  relativePath: string
  status: UserSkillScanCandidateStatus
}

export type UserSkillScan = {
  candidates: UserSkillScanCandidate[]
  id: string
  rootName: string
  scannedDirectoryCount: number
  truncated: boolean
}

export type UserSkillInstallResult = OperationResult<{ skill: UserSkillConfig | null }>
export type UserSkillScanResult = OperationResult<{ scan: UserSkillScan | null }>
export type UserSkillBatchInstallFailure = {
  candidateId: string
  error: string
}
export type UserSkillBatchInstallResult = OperationResult<{
  failures: UserSkillBatchInstallFailure[]
  skills: UserSkillConfig[]
}>
export type UserSkillConfigResult = OperationResult<{ skill: UserSkillConfig }>
export type UserSkillDeleteResult = OperationResult
export type TaskSessionStatus = "idle" | "running" | "waiting-input" | "completed" | "failed" | "cancelled"

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

export function isTaskRunPolicy(value: unknown): value is TaskRunPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const policy = value as Record<string, unknown>
  const limits = policy.limits
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
    Boolean(limits) &&
    typeof limits === "object" &&
    !Array.isArray(limits) &&
    (typeof (limits as Record<string, unknown>).maxOutputTokens === "number" ||
      (limits as Record<string, unknown>).maxOutputTokens === null) &&
    typeof (limits as Record<string, unknown>).maxSteps === "number" &&
    typeof (limits as Record<string, unknown>).timeoutMs === "number"
  )
}

export type TaskRunResourceSummary = {
  attachmentCount: number
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
    (summary.currentDocumentPath === null || typeof summary.currentDocumentPath === "string") &&
    (summary.researchNetworkMode === null || isResearchNetworkMode(summary.researchNetworkMode)) &&
    (summary.resumedResearchRequestId === undefined ||
      summary.resumedResearchRequestId === null ||
      typeof summary.resumedResearchRequestId === "string") &&
    (summary.workspaceId === null || typeof summary.workspaceId === "string") &&
    (summary.workspaceName === null || typeof summary.workspaceName === "string")
  )
}

export const TASK_RUN_STATUSES = ["running", "completed", "failed", "cancelled", "interrupted"] as const

export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number]

export type TaskRunToolInspection = {
  callCount: number
  denialCount: number
  failureCount: number
  name: string
}

/** 面向产品 UI 的只读运行解释；不包含提示词、正文、绝对路径或供应商秘密。 */
export type TaskRunInspection = {
  completedAt: number | null
  failure: TaskRunErrorDataV1 | null
  finishReason: string | null
  model: {
    configId: string
    modelId: string
    providerId: string
  }
  policy: TaskRunPolicy | null
  requestId: string
  resources: TaskRunResourceSummary | null
  startedAt: number
  status: TaskRunStatus
  taskId: string
  timing: {
    durationMs: number | null
    modelDurationMs: number | null
    timeToFirstOutputMs: number | null
    toolDurationMs: number | null
  }
  tools: TaskRunToolInspection[]
  usage: {
    cacheReadTokens: number | null
    cacheWriteTokens: number | null
    inputTokens: number | null
    outputTokens: number | null
    reasoningTokens: number | null
    totalTokens: number | null
  }
}

export const REQUEST_USER_INPUT_TOOL_NAME = "request-user-input" as const
export const PUBLISH_RESEARCH_PLAN_TOOL_NAME = "publish-research-plan" as const
export const READ_WEB_SOURCE_TOOL_NAME = "read-web-source" as const
export const RECORD_RESEARCH_EVIDENCE_TOOL_NAME = "record-research-evidence" as const
export const RECOMMEND_RESEARCH_SOURCES_TOOL_NAME = "recommend-research-sources" as const
export const FINALIZE_RESEARCH_TOOL_NAME = "finalize-research" as const

export type TaskUserInputOption = {
  description?: string
  id: string
  label: string
}

export type TaskUserInputQuestion = {
  allowCustom?: boolean
  id: string
  kind: "single" | "multiple" | "text"
  options?: TaskUserInputOption[]
  prompt: string
  required?: boolean
}

export type TaskUserInputRequest = {
  description?: string
  questions: TaskUserInputQuestion[]
  title?: string
}

export type TaskUserInputAnswer = {
  optionIds?: string[]
  questionId: string
  text?: string
}

export type TaskUserInputResult =
  | { answers: TaskUserInputAnswer[]; status: "answered" }
  | { status: "dismissed" | "skipped" }

export type TaskResearchQuestion = {
  id: string
  title: string
}

export type TaskResearchPlanInput = {
  deliverable?: string
  objective: string
  questions: TaskResearchQuestion[]
  scope?: string
}

export type TaskResearchPlanOutput = {
  questionIds: string[]
  status: "published"
}

export const TASK_RESEARCH_PHASES = [
  "preparing",
  "planning",
  "discovering",
  "reading",
  "verifying",
  "synthesizing",
  "completed",
] as const
export type TaskResearchPhase = (typeof TASK_RESEARCH_PHASES)[number]

export const TASK_RESEARCH_SOURCE_STATUSES = [
  "discovered",
  "shortlisted",
  "reading",
  "read",
  "unusable",
] as const
export type TaskResearchSourceStatus = (typeof TASK_RESEARCH_SOURCE_STATUSES)[number]

export type TaskResearchQuestionCoverage = "covered" | "partial" | "uncovered"
export type TaskResearchEvidenceRelation = "supports" | "refutes" | "qualifies"
export type TaskResearchOutcome = "complete" | "partial"

export type TaskResearchReadSourceInput = {
  questionIds: string[]
  url: string
}

export type TaskResearchReadSourceOutput = {
  author?: string
  charCount: number
  content?: string
  contentHash?: string
  contentType?: string
  error?: string
  errorCode?:
    | "blocked-address"
    | "browser-failed"
    | "content-invalid"
    | "content-too-large"
    | "http-error"
    | "network-timeout"
    | "redirect-invalid"
    | "unsupported-content"
    | "unknown"
  finalUrl: string
  publishedAt?: string
  requestId: string
  sourceId: string
  status: "read" | "unusable"
  title?: string
  truncated: boolean
}

export type TaskResearchEvidenceInput = {
  claim: string
  excerpt: string
  locator?: string
  questionId: string
  relation: TaskResearchEvidenceRelation
  sourceId: string
}

export type TaskResearchEvidenceOutput = {
  evidenceId: string
  requestId: string
  status: "recorded"
}

export type TaskResearchRecommendationInput = {
  reason: string
  sourceId: string
}

export type TaskResearchRecommendedSource = {
  author?: string
  finalUrl: string
  publishedAt?: string
  reason: string
  saved: boolean
  sourceId: string
  title?: string
}

export type TaskResearchRecommendSourcesInput = {
  recommendations: TaskResearchRecommendationInput[]
}

export type TaskResearchRecommendSourcesOutput = {
  recommendations: TaskResearchRecommendedSource[]
  requestId: string
  status: "recommended"
}

export type TaskResearchQuestionResult = {
  id: string
  note: string
  status: TaskResearchQuestionCoverage
}

export type TaskResearchFinalizeInput = {
  limitations: string[]
  outcome: TaskResearchOutcome
  questions: TaskResearchQuestionResult[]
}

export type TaskResearchProgress = {
  evidenceCount: number
  outcome: TaskResearchOutcome | null
  phase: TaskResearchPhase
  planPublished: boolean
  questionCounts: Record<"covered" | "partial" | "pending" | "uncovered", number>
  recommendationCount: number
  sourceCounts: Record<TaskResearchSourceStatus, number>
}

export type TaskResearchNotebook = {
  markdown: string
  phase: TaskResearchPhase
  requestId: string
  revision: number
  taskId: string
  updatedAt: number
}

export type TaskResearchSaveSourcesResult = OperationResult<{
  artifact: TaskArtifact | null
  savedSourceIds: string[]
}>

export type TaskResearchFinalizeOutput =
  | {
      issues: string[]
      progress: TaskResearchProgress
      requestId: string
      status: "blocked"
    }
  | {
      progress: TaskResearchProgress
      requestId: string
      status: "completed" | "partial"
    }

export type TaskMessageMetadata = {
  configId?: string
  modelId?: string
  providerId?: AiProviderId
  requestId?: string
}

export const TASK_RUN_ERROR_CODES = [
  "provider-config",
  "provider-auth",
  "provider-rate-limit",
  "provider-timeout",
  "provider-unavailable",
  "provider-response",
  "network",
  "invalid-request",
  "tool-failed",
  "stream-interrupted",
  "resume-failed",
  "transport",
  "runtime",
] as const

export type TaskRunErrorCode = (typeof TASK_RUN_ERROR_CODES)[number]

export const TASK_RUN_ERROR_PHASES = ["start", "stream", "resume"] as const

export type TaskRunErrorPhase = (typeof TASK_RUN_ERROR_PHASES)[number]

/** 新运行写入 UIMessage 的版本化、可持久化公开错误。 */
export type TaskRunErrorDataV1 = {
  code: TaskRunErrorCode
  message: string
  phase: TaskRunErrorPhase
  retryable: boolean
  version: 1
}

/** 只用于读取尚未携带稳定 code/phase 的历史任务消息。 */
export type LegacyTaskRunErrorData = {
  code?: never
  message: string
  phase?: never
  retryable: boolean
  version?: never
}

export type TaskRunErrorData = TaskRunErrorDataV1 | LegacyTaskRunErrorData

export function isTaskRunErrorCode(value: unknown): value is TaskRunErrorCode {
  return typeof value === "string" && TASK_RUN_ERROR_CODES.some((candidate) => candidate === value)
}

export function isTaskRunErrorPhase(value: unknown): value is TaskRunErrorPhase {
  return typeof value === "string" && TASK_RUN_ERROR_PHASES.some((candidate) => candidate === value)
}

export function isTaskRunErrorDataV1(value: unknown): value is TaskRunErrorDataV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return (
    data.version === 1 &&
    isTaskRunErrorCode(data.code) &&
    isTaskRunErrorPhase(data.phase) &&
    typeof data.message === "string" &&
    typeof data.retryable === "boolean"
  )
}

export const TASK_TOOL_ERROR_CODES = [
  "invalid-input",
  "permission-denied",
  "not-found",
  "conflict",
  "timeout",
  "network",
  "unavailable",
  "cancelled",
  "execution",
] as const

export type TaskToolErrorCode = (typeof TASK_TOOL_ERROR_CODES)[number]

export type TaskToolErrorDataV1 = {
  code: TaskToolErrorCode
  message: string
  retryable: boolean
  toolCallId: string
  toolName: string
  version: 1
}

export function isTaskToolErrorCode(value: unknown): value is TaskToolErrorCode {
  return typeof value === "string" && TASK_TOOL_ERROR_CODES.some((candidate) => candidate === value)
}

export function isTaskToolErrorDataV1(value: unknown): value is TaskToolErrorDataV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return (
    data.version === 1 &&
    isTaskToolErrorCode(data.code) &&
    typeof data.message === "string" &&
    typeof data.retryable === "boolean" &&
    typeof data.toolCallId === "string" &&
    typeof data.toolName === "string"
  )
}

export type TaskMessageData = {
  "task-error": TaskRunErrorData
  "tool-error": TaskToolErrorDataV1
}

export type TaskRunErrorMessagePart = {
  data: TaskRunErrorData
  id?: string
  type: "data-task-error"
}

export type TaskToolErrorMessagePart = {
  data: TaskToolErrorDataV1
  id?: string
  type: "data-tool-error"
}

export type TaskToolApproval = {
  approved?: boolean
  id: string
  isAutomatic?: boolean
  reason?: string
  signature?: string
}

export type TaskToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied"

export type TaskToolMessagePart = {
  approval?: TaskToolApproval
  errorText?: string
  input?: unknown
  output?: unknown
  preliminary?: boolean
  state: TaskToolState
  title?: string
  toolCallId: string
  toolName?: string
  type: "dynamic-tool" | `tool-${string}`
}

export type TaskMessagePart =
  | { type: "text"; text: string; state?: "streaming" | "done" }
  | { type: "reasoning"; id?: string; text: string; state?: "streaming" | "done" }
  | { type: "file"; filename?: string; mediaType: string; url: string }
  | { type: "source-url"; sourceId: string; url: string; title?: string }
  | {
      type: "source-document"
      sourceId: string
      mediaType: string
      title: string
      filename?: string
    }
  | TaskRunErrorMessagePart
  | TaskToolErrorMessagePart
  | { type: "step-start" }
  | TaskToolMessagePart

export type TaskMessage = {
  id: string
  metadata?: TaskMessageMetadata
  parts: TaskMessagePart[]
  role: "user" | "assistant"
}

export type TaskSessionSummary = {
  createdAt: number
  id: string
  mode: TaskMode
  skillId: TaskSkillId
  status: TaskSessionStatus
  title: string
  updatedAt: number
  workspaceId: string | null
  workspaceName: string | null
}

export type TaskSessionSnapshot = TaskSessionSummary & {
  messages: TaskMessage[]
}

export type TaskSessionSaveInput = {
  id: string
  messages: TaskMessage[]
  mode: TaskMode
  skillId: TaskSkillId
  status: TaskSessionStatus
  title: string
  workspaceId: string | null
}

export type AiChatStartInput = {
  configId: string
  currentDocumentPath?: string
  regenerateMessageId?: string
  messages: TaskMessage[]
  mode: TaskMode
  skillId: TaskSkillId
  modelId: string
  providerId: AiProviderId
  requestId: string
  resumeResearchRequestId?: string
  taskId: string
}

export type AiChatStreamChunk =
  | { type: "start"; messageId?: string }
  | { type: "start-step" }
  | { type: "finish-step" }
  | { type: "reset-step" }
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  | { type: "source-url"; sourceId: string; url: string; title?: string }
  | { type: "source-document"; sourceId: string; mediaType: string; title: string; filename?: string }
  | {
      type: "tool-input-start"
      toolCallId: string
      toolName: string
      title?: string
    }
  | { type: "tool-input-delta"; toolCallId: string; inputTextDelta: string }
  | {
      type: "tool-input-available"
      toolCallId: string
      toolName: string
      input: unknown
      title?: string
    }
  | {
      type: "tool-input-error"
      toolCallId: string
      toolName: string
      input: unknown
      errorText: string
      failure?: TaskToolErrorDataV1
      title?: string
    }
  | { type: "tool-output-available"; toolCallId: string; output: unknown }
  | {
      type: "tool-output-error"
      toolCallId: string
      errorText: string
      failure?: TaskToolErrorDataV1
    }
  | { type: "tool-output-denied"; toolCallId: string }
  | {
      type: "tool-approval-request"
      approvalId: string
      toolCallId: string
      isAutomatic?: boolean
      signature?: string
    }
  | {
      type: "tool-approval-response"
      approvalId: string
      approved: boolean
      reason?: string
    }
  | { type: "finish"; finishReason?: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" }
  | { type: "abort"; reason?: string }
  | { type: "error"; errorText: string; failure?: TaskRunErrorDataV1 }

export type AiChatStreamEvent = {
  chunk: AiChatStreamChunk
  requestId: string
  sequence: number
  taskId: string
}

export type AiChatOperationFailure = {
  error: TaskRunErrorDataV1
  ok: false
}

export type AiChatStartResult = { ok: true } | AiChatOperationFailure

export type AiChatResumeRun = {
  active: boolean
  configId: string
  events: AiChatStreamEvent[]
  modelId: string
  providerId: AiProviderId
  requestId: string
}

export type AiChatResumeResult = { ok: true; run: AiChatResumeRun | null } | AiChatOperationFailure

export type AgentChangeOperation = "create" | "update"
export type AgentChangeStatus = "pending" | "approved" | "rejected" | "applied" | "conflict" | "failed"

export type AgentChangePreview = {
  approvalId: string
  baseContent: string
  baseModifiedAt: number | null
  createdAt: number
  operation: AgentChangeOperation
  path: string
  proposedContent: string
  reason: string
  status: AgentChangeStatus
  toolCallId: string
}

export type AppInfo = {
  name: string
  version: string
  platform: string
}

export type AiDevtoolsOpenResult = { ok: true } | { ok: false; error: string }

export type WorkspaceInfo = {
  id: string
  name: string
  rootPath: string
}

/** 后端无关的项目引用；存储适配器负责把稳定 ID 映射到目录或数据库记录。 */
export type ProjectRef = {
  id: string
  name: string
}

/** 后端无关的可编辑文档引用；正文位置不会穿透到 Agent 工具协议。 */
export type DocumentRef = {
  id: string
  mediaType: "text/markdown"
  projectId: string | null
  title: string
}

/** 一次 Run 与其创建、修改或导入内容之间的稳定产物关系。 */
export type ArtifactRef = {
  documentId: string
  id: string
  relation: "created" | "imported" | "updated"
  runId: string
  taskId: string
}

/** Task 或 Run 对可见资源的显式关联，不包含绝对路径或正文。 */
export type ResourceBinding = {
  id: string
  resourceId: string
  resourceType: "attachment" | "document" | "project"
  role: "context" | "output" | "scope"
  runId: string | null
  taskId: string
}

/** 探索期托管内容库；正文仍以目录中的 Markdown 为事实源。 */
export type ContentLibraryInfo = {
  id: string
  inbox: ProjectRef
  name: string
  rootPath: string
}

/** 可在对话、文档和项目视图之间传递的正式产物摘要。 */
export type TaskArtifact = ArtifactRef & {
  document: DocumentRef
  project: ProjectRef
  relativePath: string
  updatedAt: number
}

export type WorkspaceOperationKind =
  | "create-document"
  | "create-project"
  | "inspect-project"
  | "move-documents"

export type WorkspaceOperationStatus = "applied" | "conflict" | "failed"

/** 不携带正文的领域操作审计摘要。 */
export type WorkspaceOperationSummary = {
  createdAt: number
  id: string
  kind: WorkspaceOperationKind
  runId: string | null
  status: WorkspaceOperationStatus
  taskId: string
}

export type CreateDocumentInput = {
  content: string
  projectId?: string
  reason: string
  title: string
}

export type CreateProjectInput = {
  name: string
}

export type MoveDocumentsInput = {
  documentIds: string[]
  targetProjectId: string
}

export type InspectProjectInput = {
  projectId: string
}

export type ContentLibraryResult = OperationResult<{
  library: ContentLibraryInfo | null
}>

export type WorkspaceDocumentEntry = {
  name: string
  relativePath: string
  modifiedAt: number
  size: number
}

export type WorkspaceDirectoryEntry = {
  name: string
  relativePath: string
}

export type WorkspaceEntryKind = "document" | "directory"

export type DocumentSnapshot = WorkspaceDocumentEntry & {
  content: string
}

export type WorkspaceChangeEvent = {
  paths: string[]
}

export type DocumentWriteResult =
  | { status: "saved"; document: DocumentSnapshot }
  | { status: "conflict"; document: DocumentSnapshot }

export type DesktopApiMethodKind = "invoke" | "send" | "subscribe"

type DesktopApiMethodContract<
  Kind extends DesktopApiMethodKind,
  Channel extends IpcChannel,
  Arguments extends readonly unknown[],
  ReturnValue,
> = {
  arguments: Arguments
  channel: Channel
  kind: Kind
  return: ReturnValue
}

type InvokeMethod<
  Channel extends IpcChannel,
  Arguments extends readonly unknown[],
  Result,
> = DesktopApiMethodContract<"invoke", Channel, Arguments, Promise<Result>>

type SendMethod<Channel extends IpcChannel, Arguments extends readonly unknown[]> = DesktopApiMethodContract<
  "send",
  Channel,
  Arguments,
  void
>

type SubscribeMethod<
  Channel extends IpcChannel,
  EventArguments extends readonly unknown[],
> = DesktopApiMethodContract<"subscribe", Channel, [listener: (...event: EventArguments) => void], () => void>

/**
 * 桌面桥接的唯一类型事实源。
 *
 * 每个成员同时绑定调用方式、IPC 频道、参数元组和返回值，避免 preload、main 与 renderer
 * 分别维护互不关联的签名。这里仅描述契约，不承载 Electron 运行时实现。
 */
export type DesktopApiContract = {
  getAppInfo: InvokeMethod<typeof IPC_CHANNELS.appInfo, [], AppInfo>
  openAiDevtools: InvokeMethod<typeof IPC_CHANNELS.aiDevtoolsOpen, [], AiDevtoolsOpenResult>
  cancelClose: SendMethod<typeof IPC_CHANNELS.appCancelClose, []>
  confirmClose: SendMethod<typeof IPC_CHANNELS.appConfirmClose, []>
  getCurrentWorkspace: InvokeMethod<typeof IPC_CHANNELS.workspaceCurrent, [], WorkspaceInfo | null>
  getCurrentContentLibrary: InvokeMethod<typeof IPC_CHANNELS.contentLibraryCurrent, [], ContentLibraryResult>
  selectContentLibrary: InvokeMethod<typeof IPC_CHANNELS.contentLibrarySelect, [], ContentLibraryResult>
  revokeContentLibrary: InvokeMethod<typeof IPC_CHANNELS.contentLibraryRevoke, [], ContentLibraryResult>
  selectWorkspace: InvokeMethod<typeof IPC_CHANNELS.workspaceSelect, [], WorkspaceInfo | null>
  listRecentWorkspaces: InvokeMethod<typeof IPC_CHANNELS.workspaceRecent, [], WorkspaceInfo[]>
  openRecentWorkspace: InvokeMethod<
    typeof IPC_CHANNELS.workspaceOpenRecent,
    [workspaceId: string],
    WorkspaceInfo
  >
  revealCurrentWorkspace: InvokeMethod<typeof IPC_CHANNELS.workspaceReveal, [], void>
  revealWorkspace: InvokeMethod<typeof IPC_CHANNELS.workspaceRevealRecent, [workspaceId: string], void>
  copyWorkspacePath: InvokeMethod<typeof IPC_CHANNELS.workspaceCopyPath, [workspaceId: string], void>
  removeRecentWorkspace: InvokeMethod<
    typeof IPC_CHANNELS.workspaceRemoveRecent,
    [workspaceId: string],
    boolean
  >
  listWorkspaceDocuments: InvokeMethod<
    typeof IPC_CHANNELS.workspaceListDocuments,
    [],
    WorkspaceDocumentEntry[]
  >
  listWorkspaceDirectories: InvokeMethod<
    typeof IPC_CHANNELS.workspaceListDirectories,
    [],
    WorkspaceDirectoryEntry[]
  >
  readDocument: InvokeMethod<typeof IPC_CHANNELS.documentRead, [relativePath: string], DocumentSnapshot>
  createDocument: InvokeMethod<
    typeof IPC_CHANNELS.documentCreate,
    [parentRelativePath?: string],
    DocumentSnapshot
  >
  createDirectory: InvokeMethod<
    typeof IPC_CHANNELS.workspaceEntryCreateDirectory,
    [parentRelativePath?: string],
    WorkspaceDirectoryEntry
  >
  renameDocument: InvokeMethod<
    typeof IPC_CHANNELS.documentRename,
    [relativePath: string],
    DocumentSnapshot | null
  >
  renameDirectory: InvokeMethod<
    typeof IPC_CHANNELS.workspaceEntryRenameDirectory,
    [relativePath: string],
    WorkspaceDirectoryEntry | null
  >
  deleteWorkspaceEntry: InvokeMethod<
    typeof IPC_CHANNELS.workspaceEntryDelete,
    [relativePath: string, kind: WorkspaceEntryKind],
    boolean
  >
  revealWorkspaceEntry: InvokeMethod<typeof IPC_CHANNELS.workspaceEntryReveal, [relativePath: string], void>
  copyWorkspaceEntryPath: InvokeMethod<
    typeof IPC_CHANNELS.workspaceEntryCopyPath,
    [relativePath: string],
    void
  >
  writeDocument: InvokeMethod<
    typeof IPC_CHANNELS.documentWrite,
    [relativePath: string, content: string, expectedModifiedAt: number],
    DocumentWriteResult
  >
  deleteAiProviderConfig: InvokeMethod<
    typeof IPC_CHANNELS.aiProviderDeleteConfig,
    [configId: string],
    AiProviderConfigDeleteResult
  >
  listAiProviderConfigs: InvokeMethod<typeof IPC_CHANNELS.aiProviderListConfigs, [], AiProviderConfig[]>
  listAiProviderModels: InvokeMethod<
    typeof IPC_CHANNELS.aiProviderListModels,
    [input: AiProviderConnectionInput],
    AiProviderModelListResult
  >
  saveAiProviderConfig: InvokeMethod<
    typeof IPC_CHANNELS.aiProviderSaveConfig,
    [input: AiProviderSaveInput],
    AiProviderConfigResult
  >
  getResearchNetworkMode: InvokeMethod<typeof IPC_CHANNELS.researchNetworkGet, [], ResearchNetworkMode>
  setResearchNetworkMode: InvokeMethod<
    typeof IPC_CHANNELS.researchNetworkSet,
    [mode: ResearchNetworkMode],
    ResearchNetworkMode
  >
  readResearchNotebook: InvokeMethod<
    typeof IPC_CHANNELS.researchNotebookRead,
    [taskId: string, requestId: string],
    TaskResearchNotebook | null
  >
  saveResearchSources: InvokeMethod<
    typeof IPC_CHANNELS.researchSourcesSave,
    [taskId: string, requestId: string, sourceIds: string[]],
    TaskResearchSaveSourcesResult
  >
  listMcpServers: InvokeMethod<typeof IPC_CHANNELS.mcpServerList, [], McpServerConfig[]>
  saveMcpServer: InvokeMethod<typeof IPC_CHANNELS.mcpServerSave, [input: McpServerSaveInput], McpServerResult>
  deleteMcpServer: InvokeMethod<
    typeof IPC_CHANNELS.mcpServerDelete,
    [serverId: string],
    McpServerDeleteResult
  >
  testMcpServer: InvokeMethod<typeof IPC_CHANNELS.mcpServerTest, [serverId: string], McpServerTestResult>
  listUserSkills: InvokeMethod<typeof IPC_CHANNELS.userSkillList, [], UserSkillConfig[]>
  installUserSkill: InvokeMethod<typeof IPC_CHANNELS.userSkillInstall, [], UserSkillInstallResult>
  scanUserSkills: InvokeMethod<typeof IPC_CHANNELS.userSkillScan, [], UserSkillScanResult>
  installScannedUserSkills: InvokeMethod<
    typeof IPC_CHANNELS.userSkillInstallScanned,
    [scanId: string, candidateIds: string[]],
    UserSkillBatchInstallResult
  >
  setUserSkillEnabled: InvokeMethod<
    typeof IPC_CHANNELS.userSkillSetEnabled,
    [skillId: UserTaskSkillId, enabled: boolean],
    UserSkillConfigResult
  >
  deleteUserSkill: InvokeMethod<
    typeof IPC_CHANNELS.userSkillDelete,
    [skillId: UserTaskSkillId],
    UserSkillDeleteResult
  >
  startAiChat: InvokeMethod<typeof IPC_CHANNELS.aiChatStart, [input: AiChatStartInput], AiChatStartResult>
  resumeAiChat: InvokeMethod<typeof IPC_CHANNELS.aiChatResume, [taskId: string], AiChatResumeResult>
  cancelAiChat: SendMethod<typeof IPC_CHANNELS.aiChatCancel, [requestId: string]>
  readTaskRun: InvokeMethod<
    typeof IPC_CHANNELS.taskRunRead,
    [taskId: string, requestId: string],
    TaskRunInspection | null
  >
  readAgentChangePreview: InvokeMethod<
    typeof IPC_CHANNELS.agentChangePreview,
    [taskId: string, approvalId: string],
    AgentChangePreview
  >
  listRecentTasks: InvokeMethod<typeof IPC_CHANNELS.taskListRecent, [], TaskSessionSummary[]>
  listWorkspaceTasks: InvokeMethod<typeof IPC_CHANNELS.taskListWorkspace, [], TaskSessionSummary[]>
  listTaskArtifacts: InvokeMethod<typeof IPC_CHANNELS.taskListArtifacts, [taskId: string], TaskArtifact[]>
  readTask: InvokeMethod<typeof IPC_CHANNELS.taskRead, [taskId: string], TaskSessionSnapshot>
  saveTask: InvokeMethod<typeof IPC_CHANNELS.taskSave, [input: TaskSessionSaveInput], TaskSessionSnapshot>
  renameTask: InvokeMethod<
    typeof IPC_CHANNELS.taskRename,
    [taskId: string, title: string],
    TaskSessionSummary
  >
  deleteTask: InvokeMethod<typeof IPC_CHANNELS.taskDelete, [taskId: string], boolean>
  onAiProviderConfigsChanged: SubscribeMethod<typeof IPC_CHANNELS.aiProviderConfigsChanged, []>
  onMcpServersChanged: SubscribeMethod<typeof IPC_CHANNELS.mcpServersChanged, []>
  onUserSkillsChanged: SubscribeMethod<typeof IPC_CHANNELS.userSkillsChanged, []>
  onAiChatEvent: SubscribeMethod<typeof IPC_CHANNELS.aiChatEvent, [event: AiChatStreamEvent]>
  onWorkspaceChanged: SubscribeMethod<typeof IPC_CHANNELS.workspaceChanged, [event: WorkspaceChangeEvent]>
  onCloseRequested: SubscribeMethod<typeof IPC_CHANNELS.appCloseRequested, []>
}

export type DesktopApiMethod = keyof DesktopApiContract

export type DesktopApiMethodByKind<Kind extends DesktopApiMethodKind> = {
  [Method in DesktopApiMethod]: DesktopApiContract[Method]["kind"] extends Kind ? Method : never
}[DesktopApiMethod]

export type DesktopApiArguments<Method extends DesktopApiMethod> = DesktopApiContract[Method]["arguments"]
export type DesktopApiReturn<Method extends DesktopApiMethod> = DesktopApiContract[Method]["return"]
export type DesktopApiChannel<Method extends DesktopApiMethod> = DesktopApiContract[Method]["channel"]

export type DesktopApiMethodByChannel<
  Channel extends IpcChannel,
  Kind extends DesktopApiMethodKind = DesktopApiMethodKind,
> = {
  [Method in DesktopApiMethodByKind<Kind>]: DesktopApiChannel<Method> extends Channel ? Method : never
}[DesktopApiMethodByKind<Kind>]

export type DesktopApi = {
  readonly [Method in DesktopApiMethod]: (
    ...arguments_: DesktopApiArguments<Method>
  ) => DesktopApiReturn<Method>
}
