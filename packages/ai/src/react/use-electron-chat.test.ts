/**
 * [INPUT]: 合成 Electron IPC 增量事件与 AI SDK React Chat 状态机
 * [OUTPUT]: Transport 按顺序把 start 到 finish 的正文增量提交给消息消费者的回归验证
 * [POS]: use-electron-chat Transport 的流式集成测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { Chat } from "@ai-sdk/react"
import type { AiChatStartInput, AiChatStreamChunk, AiChatStreamEvent } from "@tessera/contracts"
import type { UIMessage } from "ai"
import { describe, expect, it, vi } from "vitest"
import { type ElectronChatBridge, ElectronChatTransport } from "./use-electron-chat"

function assistantText(messages: readonly UIMessage[]) {
  let message: UIMessage | undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      message = messages[index]
      break
    }
  }
  return message?.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}

describe("ElectronChatTransport", () => {
  it("让 AI SDK React 状态机逐段观察正文增量", async () => {
    let listener: ((event: AiChatStreamEvent) => void) | undefined
    let request: AiChatStartInput | undefined
    let sequence = 0
    const bridge: ElectronChatBridge = {
      cancelAiChat: vi.fn(),
      onAiChatEvent: (nextListener) => {
        listener = nextListener
        return () => {
          listener = undefined
        }
      },
      startAiChat: async (input) => {
        request = input
        return { ok: true }
      },
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-test",
      providerId: "openai-compatible",
      modelId: "test-model",
      reasoning: "auto",
      webSearch: false,
    }))
    let id = 0
    const chat = new Chat<UIMessage>({
      id: "chat-test",
      generateId: () => `message-${++id}`,
      transport,
    })
    const observedText: string[] = []
    const unregister = chat["~registerMessagesCallback"](() => {
      const text = assistantText(chat.messages)
      if (text !== undefined) observedText.push(text)
    })
    const sendPromise = chat.sendMessage({ text: "请回答" })

    await vi.waitFor(() => {
      expect(request).toBeDefined()
      expect(listener).toBeTypeOf("function")
    })

    const emit = (chunk: AiChatStreamChunk) => {
      if (!request || !listener) throw new Error("测试流尚未建立。")
      listener({ requestId: request.requestId, sequence: ++sequence, chunk })
    }

    emit({ type: "start", messageId: "assistant-1" })
    emit({ type: "text-start", id: "text-1" })
    emit({ type: "text-delta", id: "text-1", delta: "你" })
    await vi.waitFor(() => expect(observedText).toContain("你"))

    emit({ type: "text-delta", id: "text-1", delta: "好" })
    await vi.waitFor(() => expect(observedText).toContain("你好"))

    emit({ type: "text-end", id: "text-1" })
    emit({ type: "finish", finishReason: "stop" })
    await sendPromise
    unregister()

    expect(observedText.indexOf("你")).toBeLessThan(observedText.indexOf("你好"))
    expect(chat.status).toBe("ready")
    expect(chat.messages.at(-1)).toMatchObject({
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "你好", state: "done" }],
    })
  })
})
