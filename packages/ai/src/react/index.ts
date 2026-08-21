/**
 * [INPUT]: AI 设置组件、Electron 任务 React Transport 与版本化消息转换器
 * [OUTPUT]: @tessera/ai/react 的设置组件、消息类型、任务消息转换与 useElectronChat 公开入口
 * [POS]: AI 包的 React 子路径边界
 * [DOC]: design.md、docs/architecture/ai-providers.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export { AiModelIcon, type AiModelIconProps } from "./ai-model-icon"
export { type AiProviderSettingsProps, AiProviderSettings } from "./ai-provider-settings"
export { AiSettings } from "./ai-settings"
export {
  type UIMessage,
  type UseElectronChatOptions,
  toAiChatMessages,
  toTaskMessages,
  toUiMessages,
  useElectronChat,
} from "./use-electron-chat"
