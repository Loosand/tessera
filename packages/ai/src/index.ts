/**
 * [INPUT]: AI 供应商目录、配置模型与跨进程供应商标识
 * [OUTPUT]: 与 UI 框架无关的 AI 领域公开 API 和模型合并能力
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
  type AiProviderDrafts,
  type AiProviderId,
  type AiProviderModelDraft,
  appendAiProviderModel,
  createInitialAiProviderDrafts,
  matchesAiProvider,
  mergeDiscoveredAiProviderModels,
} from "./provider-catalog"
export { createUnknownAiModelCapabilities, resolveAiModelCapabilities } from "./model-capabilities"
