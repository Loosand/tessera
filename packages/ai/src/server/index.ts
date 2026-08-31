/**
 * [INPUT]: AI SDK Chat/Agent 运行时适配器、受信任 RunPolicy、客户端交互/可信研究工具、内容领域、受限工作区/MCP 工具契约与模型目录发现服务
 * [OUTPUT]: @tessera/ai/server 的主进程安全公开入口、研究/内容领域工具集与统一策略解析能力
 * [POS]: AI 包服务端子路径边界
 * [DOC]: docs/architecture/ai-providers.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/mcp.md、docs/architecture/research-workflow.md、docs/architecture/task-navigation.md、docs/architecture/unified-creation-agent.md
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
  aiModelExecutionIssueMessage,
  resolveAiModelExecution,
} from "../routing/model-routing"
export {
  type TaskRunPolicyIssue,
  type TaskRunPolicyResolution,
  resolveTaskRunPolicy,
  taskRunPolicyIssueMessage,
} from "../routing/run-policy"
export { inferAutomaticTaskSkill, inferCompletedResearchFollowUpSkill } from "../routing/intent-routing"
export {
  ContextBudgetExceededError,
  assertTaskContextBudget,
  createTaskContextManifest,
  estimateTextTokens,
  type TaskModelContextLimits,
} from "./context-budget"
export {
  type AiAgentRuntimeOptions,
  type AiSdkAgentRuntimeRequest,
  type ExternalAgentTool,
  type ListWorkspaceFilesInput,
  type ReadonlyWorkspaceAgentTools,
  type ReadWorkspaceFileInput,
  type SearchWorkspaceTextInput,
  type WorkspaceAgentTools,
  type WorkspaceDocumentChangeInput,
  aiSdkAgentRuntime,
  createExternalAgentToolSet,
  streamAiAgent,
} from "./agent-runtime"
export {
  type ResearchAgentTools,
  createResearchToolSet,
  publicResearchToolOutput,
  researchEvidenceBatchInputSchema,
  researchEvidenceToolInputSchema,
  researchEvidenceInputSchema,
  researchFinalizeInputSchema,
  researchRecommendSourcesInputSchema,
  researchReadSourceInputSchema,
} from "./research-tools"
export {
  type ContentDomainAgentTools,
  createContentDomainToolSet,
  createManagedDocumentInputSchema,
  createManagedProjectInputSchema,
  inspectManagedProjectInputSchema,
  moveManagedDocumentsInputSchema,
} from "./content-domain-tools"
export type { AiChatRuntimeInput } from "./chat-runtime"
export { PublicAgentToolError, classifyProviderStreamError } from "./chat-runtime"
export {
  type AiModelDiscoveryOptions,
  AiProviderConnectionError,
  createAiModelCatalogUrl,
  listAiProviderModels,
} from "./model-discovery"
export {
  type CreateAiProviderConfigServiceOptions,
  type AiProviderConfigService,
  type AiProviderConfigStore,
  type AiProviderConfigStoreRecord,
  AiProviderConfigError,
  type AiProviderSecretStorage,
  createAiProviderConfigService,
} from "./provider-config-service"
export {
  createTaskInteractionTools,
  hasRequestedUserInputSinceLastUserMessage,
  publishResearchPlanTool,
  requestUserInputTool,
  taskResearchPlanInputSchema,
  taskResearchPlanOutputSchema,
  taskUserInputRequestSchema,
  taskUserInputResultSchema,
} from "./task-interaction-tools"
export {
  type TaskAgentRunMetrics,
  createTaskAgent,
  taskAgentRunMetrics,
} from "./task-agent"
