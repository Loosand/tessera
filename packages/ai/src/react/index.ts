/**
 * [INPUT]: AI 设置 React 组件
 * [OUTPUT]: @tessera/ai/react 公开组件入口
 * [POS]: AI 包的 React 子路径边界
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export { type AiProviderSettingsProps, AiProviderSettings } from "./ai-provider-settings"
export { AiSettings } from "./ai-settings"
