/**
 * [INPUT]: AI 供应商目录、模型事实归一化、请求期端点路由与跨进程供应商标识
 * [OUTPUT]: 与 UI 框架无关的 AI 领域公开 API、模型合并与有效执行能力解析
 * [POS]: @tessera/ai 根入口
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export {
  AI_PROVIDER_DEFINITIONS,
  type AiProviderDefinition,
  type AiProviderDraft,
  type AiProviderDraftUpdate,
  type AiProviderDrafts,
  type AiProviderId,
  type AiProviderModelDraft,
  type AiProviderModelProfileUpdate,
  appendAiProviderModel,
  createInitialAiProviderDrafts,
  matchesAiProvider,
  mergeDiscoveredAiProviderModels,
  updateAiProviderModelProfile,
} from "./catalog/provider-catalog"
export { createUnknownAiModelCapabilities, resolveAiModelCapabilities } from "./catalog/model-capabilities"
export {
  type AiModelExecution,
  type AiModelExecutionIssue,
  type AiModelSearchRoute,
  aiModelExecutionIssueMessage,
  resolveAiModelExecution,
} from "./routing/model-routing"
export {
  type TaskRunPolicyIssue,
  type TaskRunPolicyResolution,
  resolveTaskRunPolicy,
  taskRunPolicyIssueMessage,
} from "./routing/run-policy"
export { inferAutomaticTaskSkill } from "./routing/intent-routing"
