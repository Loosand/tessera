/**
 * [INPUT]: Tessera 任务消息 metadata/data 契约与 AI SDK UIMessage、Tool Part 类型/守卫
 * [OUTPUT]: React 侧统一 UIMessage/Chunk/Part 类型，以及基于 AI SDK 标准守卫的工具 Part 识别和名称读取
 * [POS]: @tessera/ai/react 中持久化任务协议与 AI SDK UI 消息协议的单一类型边界
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskMessageData, TaskMessageMetadata } from "@tessera/contracts"
import {
  type UIMessage as AiSdkUiMessage,
  type UIMessageChunk as AiSdkUiMessageChunk,
  type DynamicToolUIPart,
  type ToolUIPart,
  getToolName,
  isToolUIPart,
} from "ai"

export type UIMessage = AiSdkUiMessage<TaskMessageMetadata, TaskMessageData>
export type UIMessageChunk = AiSdkUiMessageChunk<TaskMessageMetadata, TaskMessageData>
export type UIMessagePart = UIMessage["parts"][number]
export type UIMessageToolPart = ToolUIPart | DynamicToolUIPart

export function isUIMessageToolPart(part: UIMessagePart): part is UIMessageToolPart {
  return isToolUIPart(part)
}

export function uiMessageToolName(part: UIMessageToolPart) {
  return getToolName(part)
}
