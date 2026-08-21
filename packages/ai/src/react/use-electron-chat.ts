/**
 * [INPUT]: Electron 窄桥、当前模型选择、联网/思考开关与 AI SDK React 状态机
 * [OUTPUT]: 可独立验证的 ElectronChatTransport 与通过类型化 IPC 消费增量事件的 useChat 封装
 * [POS]: @tessera/ai/react 中连接桌面渲染层与主进程普通对话运行时的 Transport
 * [DOC]: docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { useChat } from "@ai-sdk/react"
import type {
  AiChatMessage,
  AiChatReasoning,
  AiChatStreamEvent,
  AiProviderId,
  DesktopApi,
} from "@tessera/contracts"
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai"
import { useMemo, useRef } from "react"

export type ElectronChatBridge = Pick<DesktopApi, "cancelAiChat" | "onAiChatEvent" | "startAiChat">

export interface UseElectronChatOptions {
  bridge: ElectronChatBridge | undefined
  chatId?: string
  modelId: string
  providerId: AiProviderId
  reasoning: AiChatReasoning
  webSearch: boolean
}

function requestId() {
  return globalThis.crypto.randomUUID()
}

function toAiChatMessages(messages: readonly UIMessage[]): AiChatMessage[] {
  return messages.map((message) => {
    const parts: AiChatMessage["parts"] = []
    for (const part of message.parts) {
      if (part.type === "text") parts.push({ type: "text", text: part.text })
      if (part.type === "file" && message.role === "user") {
        parts.push({
          type: "file",
          url: part.url,
          mediaType: part.mediaType,
          ...(part.filename ? { filename: part.filename } : {}),
        })
      }
    }
    return {
      id: message.id,
      role: message.role === "assistant" ? "assistant" : "user",
      parts,
    }
  })
}

export class ElectronChatTransport implements ChatTransport<UIMessage> {
  constructor(private readonly options: () => UseElectronChatOptions) {}

  async sendMessages({ messages, abortSignal }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]) {
    const options = this.options()
    const bridge = options.bridge
    if (!bridge) throw new Error("桌面 AI 服务不可用。")
    const activeRequestId = requestId()
    let sequence = 0

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        let closed = false
        const close = () => {
          if (closed) return
          closed = true
          unsubscribe()
          abortSignal?.removeEventListener("abort", abort)
          controller.close()
        }
        const abort = () => {
          bridge.cancelAiChat(activeRequestId)
          if (!closed) controller.enqueue({ type: "abort", reason: "用户已停止生成" })
          close()
        }
        const unsubscribe = bridge.onAiChatEvent((event: AiChatStreamEvent) => {
          if (closed || event.requestId !== activeRequestId || event.sequence <= sequence) return
          sequence = event.sequence
          controller.enqueue(event.chunk as UIMessageChunk)
          if (event.chunk.type === "finish" || event.chunk.type === "abort" || event.chunk.type === "error") {
            close()
          }
        })

        abortSignal?.addEventListener("abort", abort, { once: true })
        if (abortSignal?.aborted) {
          abort()
          return
        }

        void bridge
          .startAiChat({
            requestId: activeRequestId,
            providerId: options.providerId,
            modelId: options.modelId,
            reasoning: options.reasoning,
            webSearch: options.webSearch,
            messages: toAiChatMessages(messages),
          })
          .then((result) => {
            if (result.ok || closed) return
            controller.error(new Error(result.error))
            closed = true
            unsubscribe()
            abortSignal?.removeEventListener("abort", abort)
          })
          .catch((error) => {
            if (closed) return
            controller.error(error instanceof Error ? error : new Error("无法开始模型请求。"))
            closed = true
            unsubscribe()
            abortSignal?.removeEventListener("abort", abort)
          })
      },
      cancel: () => bridge.cancelAiChat(activeRequestId),
    })
  }

  async reconnectToStream() {
    return null
  }
}

export function useElectronChat(options: UseElectronChatOptions) {
  const latestOptions = useRef(options)
  latestOptions.current = options
  const fallbackChatId = useMemo(() => `task-${requestId()}`, [])
  const transport = useMemo(() => new ElectronChatTransport(() => latestOptions.current), [])

  return useChat({
    id: options.chatId ?? fallbackChatId,
    transport,
    throttle: 24,
  })
}

export type { UIMessage }
