/**
 * [INPUT]: AI/研究网络设置组件、Electron 任务 React Transport 与版本化消息转换器
 * [OUTPUT]: @tessera/ai/react 的设置组件与 Props、消息类型、等待输入/运行失败识别、任务消息转换与 useElectronChat 公开入口
 * [POS]: AI 包的 React 子路径边界
 * [DOC]: design.md、docs/architecture/ai-providers.md、docs/architecture/research-workflow.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export { AiModelIcon, type AiModelIconProps } from "./ai-model-icon"
export { type AiProviderSettingsProps, AiProviderSettings } from "./ai-provider-settings"
export { type AiSettingsProps, AiSettings } from "./ai-settings"
export {
  type UIMessage,
  type UIMessageChunk,
  type UIMessagePart,
  type UIMessageToolPart,
  isUIMessageToolPart,
  uiMessageToolName,
} from "./task-ui-message"
export {
  type UseElectronChatOptions,
  completedToolContinuationMessage,
  hasPendingTaskUserInput,
  hasTaskRunError,
  shouldAutomaticallyContinueTask,
  toAiChatMessages,
  toTaskMessages,
  toUiMessages,
  useElectronChat,
} from "./use-electron-chat"
