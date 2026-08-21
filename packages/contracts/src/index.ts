/**
 * [INPUT]: Electron 桌面应用当前需要的跨进程数据、生命周期、工作区条目、AI 配置与流式对话形状
 * [OUTPUT]: IPC 频道、工作区文件操作、AI 模型/配置/对话、关闭握手与桌面 API 类型契约
 * [POS]: 应用和共享包共同依赖的底层契约入口
 * [DOC]: docs/architecture.md、docs/architecture/ai-providers.md
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
  aiChatStart: "ai-chat:start",
} as const

export type AiProviderId = "openai-compatible" | "anthropic-compatible" | "deepseek" | "grok" | "openrouter"

export interface AiProviderConnectionInput {
  apiKey: string
  baseUrl: string
  providerId: AiProviderId
}

export interface AiProviderModel {
  capabilities?: AiModelCapabilities
  capabilitySource?: AiModelCapabilitySource
  contextWindow: number | null
  id: string
  maxOutputTokens: number | null
  name: string | null
  ownedBy: string | null
}

export type AiModelCapabilityState = "supported" | "unsupported" | "unknown"
export type AiModelCapabilitySource = "builtin" | "remote" | "custom" | "unknown"

export interface AiModelCapabilities {
  imageInput: AiModelCapabilityState
  reasoning: AiModelCapabilityState
  search: AiModelCapabilityState
  toolUse: AiModelCapabilityState
}

export interface AiProviderConfiguredModel extends AiProviderModel {
  enabled: boolean
}

export interface AiProviderConfig {
  apiKeyConfigured: boolean
  baseUrl: string
  enabled: boolean
  models: AiProviderConfiguredModel[]
  providerId: AiProviderId
  updatedAt: number
}

export interface AiProviderSaveInput {
  apiKey?: string
  baseUrl: string
  enabled: boolean
  models: AiProviderConfiguredModel[]
  providerId: AiProviderId
  removeApiKey?: boolean
}

export interface AiConfiguredModel extends AiProviderConfiguredModel {
  providerId: AiProviderId
}

export type AiProviderModelListResult = { ok: true; models: AiProviderModel[] } | { ok: false; error: string }

export type AiProviderConfigResult = { ok: true; config: AiProviderConfig } | { ok: false; error: string }
export type AiProviderConfigDeleteResult = { ok: true } | { ok: false; error: string }

export type AiChatReasoning = "auto" | "none" | "low" | "medium" | "high"

export type AiChatMessagePart =
  | { type: "text"; text: string }
  | { type: "file"; filename?: string; mediaType: string; url: string }

export interface AiChatMessage {
  id: string
  parts: AiChatMessagePart[]
  role: "user" | "assistant"
}

export interface AiChatStartInput {
  messages: AiChatMessage[]
  modelId: string
  providerId: AiProviderId
  reasoning: AiChatReasoning
  requestId: string
  webSearch: boolean
}

export type AiChatStreamChunk =
  | { type: "start"; messageId?: string }
  | { type: "start-step" }
  | { type: "finish-step" }
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  | { type: "source-url"; sourceId: string; url: string; title?: string }
  | { type: "source-document"; sourceId: string; mediaType: string; title: string; filename?: string }
  | { type: "finish"; finishReason?: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" }
  | { type: "abort"; reason?: string }
  | { type: "error"; errorText: string }

export interface AiChatStreamEvent {
  chunk: AiChatStreamChunk
  requestId: string
  sequence: number
}

export type AiChatStartResult = { ok: true } | { ok: false; error: string }

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface WorkspaceInfo {
  id: string
  name: string
  rootPath: string
}

export interface WorkspaceDocumentEntry {
  name: string
  relativePath: string
  modifiedAt: number
  size: number
}

export interface WorkspaceDirectoryEntry {
  name: string
  relativePath: string
}

export type WorkspaceEntryKind = "document" | "directory"

export interface DocumentSnapshot extends WorkspaceDocumentEntry {
  content: string
}

export interface WorkspaceChangeEvent {
  paths: string[]
}

export type DocumentWriteResult =
  | { status: "saved"; document: DocumentSnapshot }
  | { status: "conflict"; document: DocumentSnapshot }

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>
  cancelClose(): void
  confirmClose(): void
  getCurrentWorkspace(): Promise<WorkspaceInfo | null>
  selectWorkspace(): Promise<WorkspaceInfo | null>
  listRecentWorkspaces(): Promise<WorkspaceInfo[]>
  openRecentWorkspace(workspaceId: string): Promise<WorkspaceInfo>
  revealCurrentWorkspace(): Promise<void>
  listWorkspaceDocuments(): Promise<WorkspaceDocumentEntry[]>
  listWorkspaceDirectories(): Promise<WorkspaceDirectoryEntry[]>
  readDocument(relativePath: string): Promise<DocumentSnapshot>
  createDocument(parentRelativePath?: string): Promise<DocumentSnapshot>
  createDirectory(parentRelativePath?: string): Promise<WorkspaceDirectoryEntry>
  renameDocument(relativePath: string): Promise<DocumentSnapshot | null>
  renameDirectory(relativePath: string): Promise<WorkspaceDirectoryEntry | null>
  deleteWorkspaceEntry(relativePath: string, kind: WorkspaceEntryKind): Promise<boolean>
  revealWorkspaceEntry(relativePath: string): Promise<void>
  copyWorkspaceEntryPath(relativePath: string): Promise<void>
  writeDocument(
    relativePath: string,
    content: string,
    expectedModifiedAt: number,
  ): Promise<DocumentWriteResult>
  deleteAiProviderConfig(providerId: AiProviderId): Promise<AiProviderConfigDeleteResult>
  listAiProviderConfigs(): Promise<AiProviderConfig[]>
  listAiProviderModels(input: AiProviderConnectionInput): Promise<AiProviderModelListResult>
  saveAiProviderConfig(input: AiProviderSaveInput): Promise<AiProviderConfigResult>
  startAiChat(input: AiChatStartInput): Promise<AiChatStartResult>
  cancelAiChat(requestId: string): void
  onAiProviderConfigsChanged(listener: () => void): () => void
  onAiChatEvent(listener: (event: AiChatStreamEvent) => void): () => void
  onWorkspaceChanged(listener: (event: WorkspaceChangeEvent) => void): () => void
  onCloseRequested(listener: () => void): () => void
}
