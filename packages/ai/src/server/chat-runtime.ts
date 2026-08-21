/**
 * [INPUT]: 已解析的供应商连接、普通对话消息、模型能力开关与中止信号
 * [OUTPUT]: 经裁剪和脱敏的 AI SDK UI 消息增量流
 * [POS]: Electron 主进程与各 AI SDK 供应商之间的普通对话运行时
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AiChatMessage,
  AiChatReasoning,
  AiChatStartInput,
  AiChatStreamChunk,
  AiProviderConnectionInput,
} from "@tessera/contracts"
import { convertToModelMessages, streamText, type UIMessage, type UIMessageChunk } from "ai"
import { createAiSdkChatRuntime } from "./ai-sdk-runtime"

const MAX_MESSAGES = 200
const MAX_TEXT_CHARACTERS = 2_000_000
const MAX_FILE_DATA_URL_CHARACTERS = 12_000_000
const MAX_ERROR_MESSAGE_LENGTH = 320

export interface AiChatRuntimeInput extends AiChatStartInput, AiProviderConnectionInput {}

export interface AiChatRuntimeOptions {
  abortSignal: AbortSignal
  onChunk: (chunk: AiChatStreamChunk) => void
}

function safeErrorMessage(error: unknown, apiKey: string): string {
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

function toUiMessages(messages: readonly AiChatMessage[]): UIMessage[] {
  if (messages.length === 0 || messages.length > MAX_MESSAGES) throw new Error("对话消息数量无效。")
  let textCharacters = 0

  return messages.map((message) => {
    if (!message.id || (message.role !== "user" && message.role !== "assistant")) {
      throw new Error("对话消息格式无效。")
    }
    const parts = message.parts.map((part) => {
      if (part.type === "text") {
        textCharacters += part.text.length
        if (textCharacters > MAX_TEXT_CHARACTERS) throw new Error("当前对话文本过长，请开启新任务。")
        return { type: "text" as const, text: part.text }
      }
      validateDataImage(part.url, part.mediaType)
      return {
        type: "file" as const,
        url: part.url,
        mediaType: part.mediaType,
        ...(part.filename ? { filename: part.filename } : {}),
      }
    })
    return { id: message.id, role: message.role, parts }
  })
}

function reasoningLevel(reasoning: AiChatReasoning) {
  return reasoning === "auto" ? "provider-default" : reasoning
}

function publicChunk(chunk: UIMessageChunk): AiChatStreamChunk | null {
  switch (chunk.type) {
    case "start":
      return { type: "start", ...(chunk.messageId ? { messageId: chunk.messageId } : {}) }
    case "start-step":
    case "finish-step":
      return { type: chunk.type }
    case "text-start":
    case "text-end":
    case "reasoning-start":
    case "reasoning-end":
      return { type: chunk.type, id: chunk.id }
    case "text-delta":
      return { type: chunk.type, id: chunk.id, delta: chunk.delta }
    case "reasoning-delta":
      return null
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
  const originalMessages = toUiMessages(input.messages)
  const result = streamText({
    model: runtime.model,
    messages: await convertToModelMessages(originalMessages),
    ...(runtime.tools ? { tools: runtime.tools } : {}),
    reasoning: reasoningLevel(input.reasoning),
    abortSignal,
    timeout: { totalMs: 120_000, firstChunkMs: 30_000, chunkMs: 45_000 },
  })

  const reasoningIds = new Set<string>()
  for await (const chunk of result.toUIMessageStream({
    originalMessages,
    sendReasoning: true,
    sendSources: true,
    onError: (error) => safeErrorMessage(error, input.apiKey),
  })) {
    if (chunk.type === "reasoning-start") reasoningIds.add(chunk.id)
    if (chunk.type === "reasoning-end" && reasoningIds.delete(chunk.id)) {
      onChunk({ type: "reasoning-delta", id: chunk.id, delta: "已完成思考" })
    }
    const sanitized = publicChunk(chunk)
    if (sanitized) onChunk(sanitized)
  }
}
