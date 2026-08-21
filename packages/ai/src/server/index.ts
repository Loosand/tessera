/**
 * [INPUT]: AI SDK Chat/Agent 运行时适配器、受限工作区工具契约与模型目录发现服务
 * [OUTPUT]: @tessera/ai/server 的主进程安全公开入口
 * [POS]: AI 包服务端子路径边界
 * [DOC]: docs/architecture/ai-providers.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export {
  type AiChatRuntimeOptions,
  type AiLanguageModelInput,
  type AiSdkChatRuntime,
  createAiSdkChatRuntime,
  createAiSdkLanguageModel,
} from "./ai-sdk-runtime"
export {
  type AiAgentRuntimeOptions,
  type AiSdkAgentRuntimeRequest,
  type ListWorkspaceFilesInput,
  type ReadonlyWorkspaceAgentTools,
  type ReadWorkspaceFileInput,
  type SearchWorkspaceTextInput,
  type WorkspaceAgentTools,
  type WorkspaceDocumentChangeInput,
  aiSdkAgentRuntime,
  streamAiAgent,
} from "./agent-runtime"
export {
  type AiChatRuntimeInput,
  type AiChatRuntimeOptions as AiChatStreamRuntimeOptions,
  streamAiChat,
} from "./chat-runtime"
export {
  type AiModelDiscoveryOptions,
  AiProviderConnectionError,
  createAiModelCatalogUrl,
  listAiProviderModels,
} from "./model-discovery"
export {
  type AiProviderConfigService,
  type AiProviderConfigStore,
  type AiProviderConfigStoreRecord,
  AiProviderConfigError,
  type AiProviderSecretStorage,
  createAiProviderConfigService,
} from "./provider-config-service"
