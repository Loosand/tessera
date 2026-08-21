/**
 * [INPUT]: 已解析的供应商连接、任务消息、可选 Skill、客户端交互/研究计划工具、普通对话能力开关与 AI SDK UIMessageChunk
 * [OUTPUT]: 注入当前 Skill instructions、可暂停等待用户并发布研究计划的普通 Chat 流，以及 Chat/Agent 共用的输入校验、错误脱敏和公开增量裁剪
 * [POS]: Electron 主进程与各 AI SDK 供应商之间的普通对话运行时及共享流边界
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-providers.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AiChatReasoning,
  AiChatStartInput,
  AiChatStreamChunk,
  AiProviderConnectionInput,
  TaskMessage,
} from "@tessera/contracts"
import {
  type UIMessage,
  type UIMessageChunk,
  convertToModelMessages,
  isStepCount,
  streamText,
  validateUIMessages,
} from "ai"
import { createAiSdkChatRuntime } from "./ai-sdk-runtime"
import { buildTaskSkillInstructions } from "./skill-instructions"
import { createTaskInteractionTools } from "./task-interaction-tools"

const MAX_MESSAGES = 200
const MAX_TEXT_CHARACTERS = 2_000_000
const MAX_FILE_DATA_URL_CHARACTERS = 12_000_000
const MAX_ERROR_MESSAGE_LENGTH = 320

export type AiChatRuntimeInput = AiChatStartInput & AiProviderConnectionInput

export type AiChatRuntimeOptions = {
  abortSignal: AbortSignal
  onChunk: (chunk: AiChatStreamChunk) => void | Promise<void>
}

export type UiMessageValidationOptions<Message extends UIMessage> = Omit<
  Parameters<typeof validateUIMessages<Message>>[0],
  "messages"
>

export function safeErrorMessage(error: unknown, apiKey: string): string {
  const fallback = "模型请求失败，请检查供应商配置、模型状态与网络连接。"
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback
  const withoutKey = apiKey ? message.split(apiKey).join("[已隐藏]") : message
  const withoutAuthorization = withoutKey.replace(
    /(?:authorization|api[-_ ]?key)\s*[:=]\s*\S+/giu,
    "$1: [已隐藏]",
  )
  return withoutAuthorization.slice(0, MAX_ERROR_MESSAGE_LENGTH) || fallback
}

function validateDataImage(url: string, mediaType: string) {
  if (!mediaType.startsWith("image/") || !url.startsWith(`data:${mediaType};base64,`)) {
    throw new Error("当前仅支持通过本地上传加入图片。")
  }
  if (url.length > MAX_FILE_DATA_URL_CHARACTERS) throw new Error("单张图片不能超过 8 MB。")
}

export async function toUiMessages<Message extends UIMessage = UIMessage>(
  messages: readonly TaskMessage[],
  options?: UiMessageValidationOptions<Message>,
): Promise<Message[]> {
  if (messages.length === 0 || messages.length > MAX_MESSAGES) throw new Error("对话消息数量无效。")
  let textCharacters = 0

  for (const message of messages) {
    if (!message.id || (message.role !== "user" && message.role !== "assistant")) {
      throw new Error("对话消息格式无效。")
    }
    for (const part of message.parts) {
      if (part.type === "text") {
        textCharacters += part.text.length
        if (textCharacters > MAX_TEXT_CHARACTERS) throw new Error("当前对话文本过长，请开启新任务。")
      }
      if (part.type === "file") validateDataImage(part.url, part.mediaType)
    }
  }
  return validateUIMessages<Message>({ messages, ...options })
}

export function reasoningLevel(reasoning: AiChatReasoning) {
  return reasoning === "auto" ? "provider-default" : reasoning
}

export function publicChunk(chunk: UIMessageChunk): AiChatStreamChunk | null {
  switch (chunk.type) {
    case "start":
      return { type: "start", ...(chunk.messageId ? { messageId: chunk.messageId } : {}) }
    case "start-step":
    case "finish-step":
    case "reset-step":
      return { type: chunk.type }
    case "text-start":
    case "text-end":
    case "reasoning-start":
    case "reasoning-end":
      return { type: chunk.type, id: chunk.id }
    case "text-delta":
      return { type: chunk.type, id: chunk.id, delta: chunk.delta }
    case "reasoning-delta":
      return { type: chunk.type, id: chunk.id, delta: chunk.delta }
    case "source-url":
      return {
        type: "source-url",
        sourceId: chunk.sourceId,
        url: chunk.url,
        ...(chunk.title ? { title: chunk.title } : {}),
      }
    case "source-document":
      return {
        type: "source-document",
        sourceId: chunk.sourceId,
        mediaType: chunk.mediaType,
        title: chunk.title,
        ...(chunk.filename ? { filename: chunk.filename } : {}),
      }
    case "tool-input-start":
      return {
        type: "tool-input-start",
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        ...(chunk.title ? { title: chunk.title } : {}),
      }
    case "tool-input-delta":
      return {
        type: "tool-input-delta",
        toolCallId: chunk.toolCallId,
        inputTextDelta: chunk.inputTextDelta,
      }
    case "tool-input-available":
      return {
        type: "tool-input-available",
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
        ...(chunk.title ? { title: chunk.title } : {}),
      }
    case "tool-input-error":
      return {
        type: "tool-input-error",
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
        errorText: chunk.errorText,
        ...(chunk.title ? { title: chunk.title } : {}),
      }
    case "tool-output-available":
      return {
        type: "tool-output-available",
        toolCallId: chunk.toolCallId,
        output: chunk.output,
      }
    case "tool-output-error":
      return {
        type: "tool-output-error",
        toolCallId: chunk.toolCallId,
        errorText: chunk.errorText,
      }
    case "tool-output-denied":
      return { type: "tool-output-denied", toolCallId: chunk.toolCallId }
    case "tool-approval-request":
      return {
        type: "tool-approval-request",
        approvalId: chunk.approvalId,
        toolCallId: chunk.toolCallId,
        ...(chunk.isAutomatic !== undefined ? { isAutomatic: chunk.isAutomatic } : {}),
        ...(chunk.signature ? { signature: chunk.signature } : {}),
      }
    case "tool-approval-response":
      return {
        type: "tool-approval-response",
        approvalId: chunk.approvalId,
        approved: chunk.approved,
        ...(chunk.reason ? { reason: chunk.reason } : {}),
      }
    case "finish":
      return {
        type: "finish",
        ...(chunk.finishReason ? { finishReason: chunk.finishReason } : {}),
      }
    case "abort":
      return { type: "abort", ...(chunk.reason ? { reason: chunk.reason } : {}) }
    case "error":
      return { type: "error", errorText: chunk.errorText }
    default:
      return null
  }
}

export async function streamAiChat(
  input: AiChatRuntimeInput,
  { abortSignal, onChunk }: AiChatRuntimeOptions,
): Promise<void> {
  const runtime = createAiSdkChatRuntime(input, { webSearch: input.webSearch })
  const tools = { ...(runtime.tools ?? {}), ...createTaskInteractionTools(input.skillId) }
  const originalMessages = await toUiMessages(input.messages, { tools })
  const instructions = await buildTaskSkillInstructions(input.skillId)
  const result = streamText({
    model: runtime.model,
    messages: await convertToModelMessages(originalMessages, { tools }),
    ...(instructions ? { instructions } : {}),
    tools,
    reasoning: reasoningLevel(input.reasoning),
    stopWhen: isStepCount(input.skillId === "research" ? 8 : 4),
    abortSignal,
    timeout: { totalMs: 120_000, firstChunkMs: 30_000, chunkMs: 45_000 },
  })

  for await (const chunk of result.toUIMessageStream({
    originalMessages,
    sendReasoning: true,
    sendSources: true,
    onError: (error) => safeErrorMessage(error, input.apiKey),
  })) {
    const sanitized = publicChunk(chunk)
    if (sanitized) await onChunk(sanitized)
  }
}
