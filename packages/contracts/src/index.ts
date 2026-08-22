/**
 * [INPUT]: Electron 桌面应用当前需要的跨进程数据、生命周期、工作区条目、AI 模型事实/端点绑定、任务运行与 Agent 变更审批形状
 * [OUTPUT]: IPC 频道、工作区文件操作、模型能力/任务创作方式/可恢复流式运行、客户端问答/研究计划工具、Agent Diff 审批、关闭握手与可推导的桌面 API 类型契约
 * [POS]: 应用和共享包共同依赖的底层契约入口
 * [DOC]: docs/architecture.md、docs/architecture/ai-providers.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
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
  aiChatCancel: "ai-chat:cancel",
  aiChatEvent: "ai-chat:event",
  aiChatResume: "ai-chat:resume",
  aiChatStart: "ai-chat:start",
  agentChangePreview: "agent-change:preview",
  taskListRecent: "task:list-recent",
  taskListWorkspace: "task:list-workspace",
  taskRead: "task:read",
  taskSave: "task:save",
  taskRename: "task:rename",
  taskDelete: "task:delete",
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
export type TaskSkillId = (typeof TASK_SKILL_IDS)[number] | null
export type TaskSessionStatus = "idle" | "running" | "waiting-input" | "completed" | "failed" | "cancelled"

export const REQUEST_USER_INPUT_TOOL_NAME = "request-user-input" as const
export const PUBLISH_RESEARCH_PLAN_TOOL_NAME = "publish-research-plan" as const

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

export type TaskMessageMetadata = {
  configId?: string
  modelId?: string
  providerId?: AiProviderId
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
  messages: TaskMessage[]
  mode: TaskMode
  skillId: TaskSkillId
  modelId: string
  providerId: AiProviderId
  reasoning: AiChatReasoning
  requestId: string
  taskId: string
  webSearch: boolean
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
      title?: string
    }
  | { type: "tool-output-available"; toolCallId: string; output: unknown }
  | { type: "tool-output-error"; toolCallId: string; errorText: string }
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
  | { type: "error"; errorText: string }

export type AiChatStreamEvent = {
  chunk: AiChatStreamChunk
  requestId: string
  sequence: number
  taskId: string
}

export type AiChatStartResult = OperationResult

export type AiChatResumeRun = {
  active: boolean
  configId: string
  events: AiChatStreamEvent[]
  modelId: string
  providerId: AiProviderId
  requestId: string
}

export type AiChatResumeResult = OperationResult<{ run: AiChatResumeRun | null }>

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

export type WorkspaceInfo = {
  id: string
  name: string
  rootPath: string
}

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
  cancelClose: SendMethod<typeof IPC_CHANNELS.appCancelClose, []>
  confirmClose: SendMethod<typeof IPC_CHANNELS.appConfirmClose, []>
  getCurrentWorkspace: InvokeMethod<typeof IPC_CHANNELS.workspaceCurrent, [], WorkspaceInfo | null>
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
  startAiChat: InvokeMethod<typeof IPC_CHANNELS.aiChatStart, [input: AiChatStartInput], AiChatStartResult>
  resumeAiChat: InvokeMethod<typeof IPC_CHANNELS.aiChatResume, [taskId: string], AiChatResumeResult>
  cancelAiChat: SendMethod<typeof IPC_CHANNELS.aiChatCancel, [requestId: string]>
  readAgentChangePreview: InvokeMethod<
    typeof IPC_CHANNELS.agentChangePreview,
    [taskId: string, approvalId: string],
    AgentChangePreview
  >
  listRecentTasks: InvokeMethod<typeof IPC_CHANNELS.taskListRecent, [], TaskSessionSummary[]>
  listWorkspaceTasks: InvokeMethod<typeof IPC_CHANNELS.taskListWorkspace, [], TaskSessionSummary[]>
  readTask: InvokeMethod<typeof IPC_CHANNELS.taskRead, [taskId: string], TaskSessionSnapshot>
  saveTask: InvokeMethod<typeof IPC_CHANNELS.taskSave, [input: TaskSessionSaveInput], TaskSessionSnapshot>
  renameTask: InvokeMethod<
    typeof IPC_CHANNELS.taskRename,
    [taskId: string, title: string],
    TaskSessionSummary
  >
  deleteTask: InvokeMethod<typeof IPC_CHANNELS.taskDelete, [taskId: string], boolean>
  onAiProviderConfigsChanged: SubscribeMethod<typeof IPC_CHANNELS.aiProviderConfigsChanged, []>
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
