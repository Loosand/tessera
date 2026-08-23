/**
 * [INPUT]: 合成 Electron IPC 正文/工具增量事件与 AI SDK React Chat 状态机
 * [OUTPUT]: Transport 按连续序号消费与恢复 reasoning、正文、引申问题、工具和失败 Part，覆盖重复/乱序/缺口、断开/取消和草稿跳过恢复的回归验证
 * [POS]: use-electron-chat Transport 的流式集成测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { Chat } from "@ai-sdk/react"
import type { AiChatStartInput, AiChatStreamChunk, AiChatStreamEvent } from "@tessera/contracts"
import type { UIMessageChunk } from "ai"
import { describe, expect, it, vi } from "vitest"
import {
  type ElectronChatBridge,
  ElectronChatTransport,
  type UIMessage,
  completedToolContinuationMessage,
  hasPendingTaskUserInput,
  shouldAutomaticallyContinueTask,
  toAiChatMessages,
  toTaskMessages,
  toUiMessages,
} from "./use-electron-chat"

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

function assistantReasoning(messages: readonly UIMessage[]) {
  let message: UIMessage | undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      message = messages[index]
      break
    }
  }
  return message?.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("")
}

function assistantError(messages: readonly UIMessage[]) {
  let message: UIMessage | undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      message = messages[index]
      break
    }
  }
  const part = message?.parts.find((candidate) => candidate.type === "data-task-error")
  return part?.type === "data-task-error" ? part.data.message : undefined
}

describe("ElectronChatTransport", () => {
  it("重新生成前保留已完成工具结果，并从工具结果之后继续", async () => {
    let request: AiChatStartInput | undefined
    const bridge: ElectronChatBridge = {
      cancelAiChat: vi.fn(),
      onAiChatEvent: () => () => {},
      resumeAiChat: async () => ({ ok: true, run: null }),
      startAiChat: async (input) => {
        request = input
        return { ok: true }
      },
    }
    const failedMessage = {
      id: "assistant-tools-complete",
      role: "assistant" as const,
      metadata: { requestId: "request-tools-complete" },
      parts: [
        { type: "text" as const, text: "尚未完成的草稿" },
        { type: "step-start" as const },
        {
          type: "tool-web_search" as const,
          toolCallId: "search-1",
          state: "output-available" as const,
          input: { query: "FKJ" },
          output: { results: [{ title: "Official" }] },
          providerExecuted: true,
        },
        {
          type: "data-task-error" as const,
          data: {
            code: "provider-timeout" as const,
            message: "供应商响应超时。",
            phase: "stream" as const,
            retryable: true,
            version: 1 as const,
          },
        },
      ],
    }
    expect(completedToolContinuationMessage(failedMessage)?.parts).toEqual([
      { type: "step-start" },
      expect.objectContaining({
        type: "tool-web_search",
        state: "output-available",
        providerExecuted: true,
      }),
      expect.objectContaining({ type: "data-task-error" }),
    ])

    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-tool-continuation",
      configId: "deepseek",
      mode: "agent",
      skillId: null,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
    }))
    transport.stageRegenerationMessage(failedMessage)
    const stream = await transport.sendMessages({
      chatId: "chat-tool-continuation",
      messageId: failedMessage.id,
      messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "研究 FKJ" }] }],
      trigger: "regenerate-message",
      abortSignal: undefined,
    })

    await vi.waitFor(() => expect(request).toBeDefined())
    expect(request).toMatchObject({
      continueFromMessageId: failedMessage.id,
      regenerateMessageId: failedMessage.id,
      messages: [
        { id: "user-1", role: "user" },
        {
          id: failedMessage.id,
          role: "assistant",
          parts: expect.arrayContaining([
            expect.objectContaining({ type: "tool-web_search", providerExecuted: true }),
          ]),
        },
      ],
    })
    await stream.cancel()
  })

  it("重新生成研究答复时把上一轮 requestId 作为断点续研来源", async () => {
    let request: AiChatStartInput | undefined
    const bridge: ElectronChatBridge = {
      cancelAiChat: vi.fn(),
      onAiChatEvent: () => () => {},
      resumeAiChat: async () => ({ ok: true, run: null }),
      startAiChat: async (input) => {
        request = input
        return { ok: true }
      },
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-research-retry",
      configId: "deepseek",
      initialMessages: [
        {
          id: "assistant-failed",
          role: "assistant",
          metadata: { requestId: "request-failed" },
          parts: [{ type: "text", text: "研究未完成" }],
        },
      ],
      mode: "chat",
      skillId: "research",
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
    }))
    const stream = await transport.sendMessages({
      chatId: "chat-research-retry",
      messageId: "assistant-failed",
      messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "研究 FKJ" }] }],
      trigger: "regenerate-message",
      abortSignal: undefined,
    })

    await vi.waitFor(() => expect(request).toBeDefined())
    expect(request).toMatchObject({
      regenerateMessageId: "assistant-failed",
      resumeResearchRequestId: "request-failed",
    })
    await stream.cancel()
  })

  it("让 AI SDK React 状态机逐段观察 reasoning 与正文增量", async () => {
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
      resumeAiChat: async () => ({ ok: true, run: null }),
      startAiChat: async (input) => {
        request = input
        return { ok: true }
      },
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-test",
      configId: "openai-compatible",
      mode: "chat",
      skillId: "research",
      providerId: "openai-compatible",
      modelId: "test-model",
    }))
    let id = 0
    const chat = new Chat<UIMessage>({
      id: "chat-test",
      generateId: () => `message-${++id}`,
      transport,
    })
    const observedText: string[] = []
    const observedReasoning: string[] = []
    const unregister = chat["~registerMessagesCallback"](() => {
      const text = assistantText(chat.messages)
      if (text !== undefined) observedText.push(text)
      const reasoning = assistantReasoning(chat.messages)
      if (reasoning !== undefined) observedReasoning.push(reasoning)
    })
    const sendPromise = chat.sendMessage({ text: "请回答" })

    await vi.waitFor(() => {
      expect(request).toBeDefined()
      expect(listener).toBeTypeOf("function")
    })
    expect(request).toMatchObject({ taskId: "chat-test", mode: "chat", skillId: "research" })

    const emit = (chunk: AiChatStreamChunk) => {
      if (!request || !listener) throw new Error("测试流尚未建立。")
      listener({ taskId: request.taskId, requestId: request.requestId, sequence: ++sequence, chunk })
    }

    emit({ type: "start", messageId: "assistant-1" })
    emit({ type: "reasoning-start", id: "reasoning-1" })
    emit({ type: "reasoning-delta", id: "reasoning-1", delta: "先检索资料" })
    await vi.waitFor(() => expect(observedReasoning).toContain("先检索资料"))
    emit({ type: "reasoning-end", id: "reasoning-1" })
    emit({
      type: "tool-input-start",
      toolCallId: "tool-call-1",
      toolName: "read-workspace-file",
    })
    emit({
      type: "tool-input-delta",
      toolCallId: "tool-call-1",
      inputTextDelta: '{"path":"README.md"}',
    })
    emit({
      type: "tool-input-available",
      toolCallId: "tool-call-1",
      toolName: "read-workspace-file",
      input: { path: "README.md" },
    })
    emit({
      type: "tool-output-available",
      toolCallId: "tool-call-1",
      output: { path: "README.md", content: "# Tessera" },
    })
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
      metadata: {
        modelId: "test-model",
        providerId: "openai-compatible",
      },
      parts: [
        { type: "reasoning", text: "先检索资料", state: "done" },
        {
          type: "tool-read-workspace-file",
          toolCallId: "tool-call-1",
          state: "output-available",
          input: { path: "README.md" },
          output: { path: "README.md", content: "# Tessera" },
        },
        { type: "text", text: "你好", state: "done" },
      ],
    })
    expect(toTaskMessages(chat.messages).at(-1)?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-read-workspace-file",
          toolCallId: "tool-call-1",
          state: "output-available",
        }),
      ]),
    )
  })

  it("缓冲乱序增量并忽略重复事件，直到序号连续后再交给 AI SDK", async () => {
    let listener: ((event: AiChatStreamEvent) => void) | undefined
    let request: AiChatStartInput | undefined
    const bridge: ElectronChatBridge = {
      cancelAiChat: vi.fn(),
      onAiChatEvent: (nextListener) => {
        listener = nextListener
        return () => {
          listener = undefined
        }
      },
      resumeAiChat: async () => ({ ok: true, run: null }),
      startAiChat: async (input) => {
        request = input
        return { ok: true }
      },
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-out-of-order",
      configId: "deepseek",
      mode: "chat",
      skillId: null,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
    }))
    const stream = await transport.sendMessages({
      chatId: "chat-out-of-order",
      messageId: undefined,
      messages: [],
      trigger: "submit-message",
      abortSignal: undefined,
    })

    await vi.waitFor(() => {
      expect(request).toBeDefined()
      expect(listener).toBeTypeOf("function")
    })
    if (!request || !listener) throw new Error("测试流尚未建立。")
    const activeRequest = request
    const emit = listener
    const event = (sequence: number, chunk: AiChatStreamChunk) => ({
      taskId: activeRequest.taskId,
      requestId: activeRequest.requestId,
      sequence,
      chunk,
    })
    emit(event(1, { type: "start", messageId: "assistant-out-of-order" }))
    emit(event(2, { type: "text-start", id: "text-out-of-order" }))
    emit(event(4, { type: "text-delta", id: "text-out-of-order", delta: "后" }))
    emit(event(4, { type: "text-delta", id: "text-out-of-order", delta: "重复" }))
    emit(event(3, { type: "text-delta", id: "text-out-of-order", delta: "先" }))
    emit(event(5, { type: "text-end", id: "text-out-of-order" }))
    emit(event(6, { type: "finish", finishReason: "stop" }))

    const reader = stream.getReader()
    const chunks: UIMessageChunk[] = []
    while (true) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
    }
    expect(chunks.filter((chunk) => chunk.type === "text-delta")).toEqual([
      { type: "text-delta", id: "text-out-of-order", delta: "先" },
      { type: "text-delta", id: "text-out-of-order", delta: "后" },
    ])
  })

  it("把 IPC 工具失败映射为标准工具 Part 与可持久化 data-tool-error", async () => {
    let listener: ((event: AiChatStreamEvent) => void) | undefined
    let request: AiChatStartInput | undefined
    const bridge: ElectronChatBridge = {
      cancelAiChat: vi.fn(),
      onAiChatEvent: (nextListener) => {
        listener = nextListener
        return () => {
          listener = undefined
        }
      },
      resumeAiChat: async () => ({ ok: true, run: null }),
      startAiChat: async (input) => {
        request = input
        return { ok: true }
      },
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-tool-error",
      configId: "deepseek",
      mode: "chat",
      skillId: "research",
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
    }))
    const stream = await transport.sendMessages({
      chatId: "chat-tool-error",
      messageId: undefined,
      messages: [],
      trigger: "submit-message",
      abortSignal: undefined,
    })

    await vi.waitFor(() => {
      expect(request).toBeDefined()
      expect(listener).toBeTypeOf("function")
    })
    if (!request || !listener) throw new Error("测试流尚未建立。")
    const activeRequest = request
    const emit = listener
    const event = (sequence: number, chunk: AiChatStreamChunk) => ({
      taskId: activeRequest.taskId,
      requestId: activeRequest.requestId,
      sequence,
      chunk,
    })
    emit(event(1, { type: "start", messageId: "assistant-tool-error" }))
    emit(
      event(2, {
        type: "tool-input-available",
        toolCallId: "tool-read",
        toolName: "read-web-source",
        input: { url: "https://example.com" },
      }),
    )
    emit(
      event(3, {
        type: "tool-output-error",
        toolCallId: "tool-read",
        errorText: "连接超时。",
        failure: {
          code: "timeout",
          message: "连接超时。",
          retryable: true,
          toolCallId: "tool-read",
          toolName: "read-web-source",
          version: 1,
        },
      }),
    )
    emit(event(4, { type: "finish", finishReason: "stop" }))

    const reader = stream.getReader()
    const chunks: UIMessageChunk[] = []
    while (true) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
    }
    const dataIndex = chunks.findIndex((chunk) => chunk.type === "data-tool-error")
    const toolIndex = chunks.findIndex((chunk) => chunk.type === "tool-output-error")
    expect(dataIndex).toBeGreaterThan(-1)
    expect(toolIndex).toBeGreaterThan(dataIndex)
    expect(chunks[dataIndex]).toMatchObject({
      type: "data-tool-error",
      data: { code: "timeout", toolCallId: "tool-read", toolName: "read-web-source" },
    })
  })

  it("把运行失败写入助手消息并保留失败前已生成的内容", async () => {
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
      resumeAiChat: async () => ({ ok: true, run: null }),
      startAiChat: async (input) => {
        request = input
        return { ok: true }
      },
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-failed",
      configId: "deepseek",
      mode: "chat",
      skillId: "research",
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
    }))
    const chat = new Chat<UIMessage>({ id: "chat-failed", transport })
    const sendPromise = chat.sendMessage({ text: "请研究" })

    await vi.waitFor(() => {
      expect(request).toBeDefined()
      expect(listener).toBeTypeOf("function")
    })
    const emit = (chunk: AiChatStreamChunk) => {
      if (!request || !listener) throw new Error("测试流尚未建立。")
      listener({ taskId: request.taskId, requestId: request.requestId, sequence: ++sequence, chunk })
    }

    emit({ type: "start", messageId: "assistant-failed" })
    emit({ type: "text-start", id: "text-partial" })
    emit({ type: "text-delta", id: "text-partial", delta: "已经找到一部分资料。" })
    emit({
      type: "error",
      errorText: "供应商连接中断，请稍后重试。",
      failure: {
        code: "network",
        message: "供应商连接中断，请稍后重试。",
        phase: "stream",
        retryable: true,
        version: 1,
      },
    })
    await sendPromise

    expect(chat.status).toBe("error")
    expect(assistantText(chat.messages)).toBe("已经找到一部分资料。")
    expect(assistantError(chat.messages)).toBe("供应商连接中断，请稍后重试。")
    const persisted = toTaskMessages(chat.messages)
    expect(persisted.at(-1)?.parts.at(-1)).toMatchObject({
      type: "data-task-error",
      data: {
        code: "network",
        message: "供应商连接中断，请稍后重试。",
        phase: "stream",
        retryable: true,
        version: 1,
      },
    })
    expect(toUiMessages(persisted).at(-1)?.parts.at(-1)).toMatchObject({
      type: "data-task-error",
    })
  })

  it("模型请求启动失败时也创建可见的助手失败消息", async () => {
    const bridge: ElectronChatBridge = {
      cancelAiChat: vi.fn(),
      onAiChatEvent: () => () => {},
      resumeAiChat: async () => ({ ok: true, run: null }),
      startAiChat: async () => ({
        ok: false,
        error: {
          code: "provider-unavailable",
          message: "模型暂时不可用。",
          phase: "start",
          retryable: true,
          version: 1,
        },
      }),
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-start-failed",
      configId: "deepseek",
      mode: "chat",
      skillId: null,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
    }))
    const chat = new Chat<UIMessage>({ id: "chat-start-failed", transport })

    await chat.sendMessage({ text: "你好" })

    expect(chat.status).toBe("error")
    expect(assistantError(chat.messages)).toBe("模型暂时不可用。")
    expect(chat.messages.at(-1)).toMatchObject({
      role: "assistant",
      metadata: { modelId: "deepseek-v4-flash", providerId: "deepseek" },
    })
  })

  it("在持久化边界保留 reasoning、来源和模型元数据", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant-history",
        role: "assistant",
        parts: [
          { type: "reasoning", id: "reasoning-history", text: "核对来源", state: "done" },
          { type: "text", text: "结论", state: "done" },
          {
            type: "source-url",
            sourceId: "source-history",
            url: "https://example.com/source",
            title: "来源",
          },
          {
            type: "data-follow-up-questions",
            id: "follow-up-history",
            data: {
              version: 1,
              questions: [
                { id: "follow-up-1", prompt: "哪些一手来源值得继续阅读？" },
                { id: "follow-up-2", prompt: "这个结论存在哪些争议？" },
              ],
            },
          },
          {
            type: "data-tool-error",
            id: "tool-error-history",
            data: {
              code: "timeout",
              message: "工具连接超时。",
              retryable: true,
              toolCallId: "tool-history",
              toolName: "read-web-source",
              version: 1,
            },
          },
        ],
      },
    ]

    const persisted = toTaskMessages(messages, {
      providerId: "openrouter",
      modelId: "example/model",
      feedback: { rating: "positive", updatedAt: 1_788_000_000_000 },
    })

    expect(persisted[0]).toMatchObject({
      metadata: {
        providerId: "openrouter",
        modelId: "example/model",
        feedback: { rating: "positive", updatedAt: 1_788_000_000_000 },
      },
      parts: [
        { type: "reasoning", text: "核对来源" },
        { type: "text", text: "结论" },
        { type: "source-url", url: "https://example.com/source" },
        {
          type: "data-follow-up-questions",
          data: {
            version: 1,
            questions: [
              { id: "follow-up-1", prompt: "哪些一手来源值得继续阅读？" },
              { id: "follow-up-2", prompt: "这个结论存在哪些争议？" },
            ],
          },
        },
        { type: "data-tool-error", data: { code: "timeout", toolCallId: "tool-history" } },
      ],
    })
    expect(toUiMessages(persisted)).toMatchObject(messages)
  })

  it("读取旧任务时把纯文本失败升级为版本化运行错误", () => {
    const restored = toUiMessages([
      {
        id: "assistant-legacy-error",
        role: "assistant",
        parts: [
          {
            type: "data-task-error",
            data: { message: "旧版失败。", retryable: false },
          },
        ],
      },
    ])

    expect(restored[0]?.parts[0]).toMatchObject({
      type: "data-task-error",
      data: {
        code: "runtime",
        message: "旧版失败。",
        phase: "stream",
        retryable: false,
        version: 1,
      },
    })
  })

  it("把工具结果和审批响应作为完整 UIMessage 历史发送到下一轮", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant-approval",
        role: "assistant",
        parts: [
          {
            type: "tool-write-workspace-document",
            toolCallId: "tool-write",
            state: "approval-responded",
            input: { operation: "create", path: "notes.md", content: "# Notes\n", reason: "创建" },
            approval: { id: "approval-write", approved: true },
          },
        ],
      },
    ]

    expect(toAiChatMessages(messages)[0]?.parts[0]).toMatchObject({
      type: "tool-write-workspace-document",
      state: "approval-responded",
      approval: { id: "approval-write", approved: true },
    })
  })

  it("识别等待用户回答的客户端工具，并只在回答完整后自动续轮", () => {
    const waitingMessages = [
      {
        id: "assistant-question",
        role: "assistant",
        parts: [
          {
            type: "tool-request-user-input",
            toolCallId: "question-call",
            state: "input-available",
            input: {
              questions: [
                {
                  id: "meaning",
                  kind: "single",
                  prompt: "你指的是哪一个？",
                  options: [
                    { id: "a", label: "选项 A" },
                    { id: "b", label: "选项 B" },
                  ],
                },
              ],
            },
          },
        ],
      },
    ] as UIMessage[]

    expect(hasPendingTaskUserInput(waitingMessages)).toBe(true)
    expect(shouldAutomaticallyContinueTask({ messages: waitingMessages })).toBe(false)

    const answeredMessages = structuredClone(waitingMessages)
    const answeredPart = answeredMessages[0]?.parts[0]
    if (!answeredPart || !("state" in answeredPart)) throw new Error("缺少测试工具 Part。")
    Object.assign(answeredPart, {
      state: "output-available",
      output: {
        status: "answered",
        answers: [{ questionId: "meaning", optionIds: ["a"] }],
      },
    })

    expect(hasPendingTaskUserInput(answeredMessages)).toBe(false)
    expect(shouldAutomaticallyContinueTask({ messages: answeredMessages })).toBe(true)
  })

  it("不会因为普通工具完成而额外发起一轮模型请求", () => {
    const messages = [
      {
        id: "assistant-tool",
        role: "assistant",
        parts: [
          {
            type: "tool-read-workspace-file",
            toolCallId: "read-call",
            state: "output-available",
            input: { path: "README.md" },
            output: { path: "README.md" },
          },
        ],
      },
    ] as UIMessage[]

    expect(shouldAutomaticallyContinueTask({ messages })).toBe(false)
  })

  it("页面断开时只移除订阅，显式停止才取消后台请求", async () => {
    let request: AiChatStartInput | undefined
    const cancelAiChat = vi.fn()
    const bridge: ElectronChatBridge = {
      cancelAiChat,
      onAiChatEvent: () => () => {},
      resumeAiChat: async () => ({ ok: true, run: null }),
      startAiChat: async (input) => {
        request = input
        return { ok: true }
      },
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-detach",
      configId: "deepseek",
      mode: "chat",
      skillId: null,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
    }))
    const abortController = new AbortController()
    const stream = await transport.sendMessages({
      chatId: "chat-detach",
      messageId: undefined,
      messages: [],
      trigger: "submit-message",
      abortSignal: abortController.signal,
    })
    const reader = stream.getReader()

    await vi.waitFor(() => expect(request).toBeDefined())
    abortController.abort()
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expect(cancelAiChat).not.toHaveBeenCalled()

    transport.cancelActive("chat-detach")
    transport.cancelActive("chat-detach")
    expect(cancelAiChat).toHaveBeenCalledOnce()
    expect(cancelAiChat).toHaveBeenCalledWith(request?.requestId)
  })

  it("按序重放后台事件并去除订阅与快照之间的重复增量", async () => {
    const events: AiChatStreamEvent[] = [
      {
        taskId: "chat-resume",
        requestId: "request-resume",
        sequence: 1,
        chunk: { type: "start", messageId: "assistant-resume" },
      },
      {
        taskId: "chat-resume",
        requestId: "request-resume",
        sequence: 2,
        chunk: { type: "text-start", id: "text-resume" },
      },
      {
        taskId: "chat-resume",
        requestId: "request-resume",
        sequence: 3,
        chunk: { type: "text-delta", id: "text-resume", delta: "后台完成" },
      },
      {
        taskId: "chat-resume",
        requestId: "request-resume",
        sequence: 4,
        chunk: { type: "text-end", id: "text-resume" },
      },
      {
        taskId: "chat-resume",
        requestId: "request-resume",
        sequence: 5,
        chunk: { type: "finish", finishReason: "stop" },
      },
    ]
    let listener: ((event: AiChatStreamEvent) => void) | undefined
    const bridge: ElectronChatBridge = {
      cancelAiChat: vi.fn(),
      onAiChatEvent: (nextListener) => {
        listener = nextListener
        return () => {
          listener = undefined
        }
      },
      resumeAiChat: async () => {
        listener?.(events[2] as AiChatStreamEvent)
        return {
          ok: true,
          run: {
            active: false,
            configId: "deepseek",
            events,
            modelId: "deepseek-v4-flash",
            providerId: "deepseek",
            requestId: "request-resume",
          },
        }
      },
      startAiChat: async () => ({ ok: true }),
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-resume",
      configId: "deepseek",
      mode: "chat",
      skillId: null,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      resume: true,
    }))

    const stream = await transport.reconnectToStream({ chatId: "chat-resume" })
    expect(stream).not.toBeNull()
    const chunks: UIMessageChunk[] = []
    if (!stream) throw new Error("恢复流未建立。")
    const reader = stream.getReader()
    while (true) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
    }

    expect(chunks.filter((chunk) => chunk.type === "text-delta")).toEqual([
      { type: "text-delta", id: "text-resume", delta: "后台完成" },
    ])
    expect(chunks[0]).toMatchObject({
      type: "start",
      messageMetadata: { modelId: "deepseek-v4-flash", providerId: "deepseek" },
    })
  })

  it("恢复失败也返回消息内可见的类型化失败流", async () => {
    const bridge: ElectronChatBridge = {
      cancelAiChat: vi.fn(),
      onAiChatEvent: () => () => {},
      resumeAiChat: async () => ({
        ok: false,
        error: {
          code: "resume-failed",
          message: "无法恢复这个任务的生成流。",
          phase: "resume",
          retryable: false,
          version: 1,
        },
      }),
      startAiChat: async () => ({ ok: true }),
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-resume-failed",
      configId: "deepseek",
      mode: "chat",
      skillId: null,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      resume: true,
    }))

    const stream = await transport.reconnectToStream({ chatId: "chat-resume-failed" })
    expect(stream).not.toBeNull()
    if (!stream) throw new Error("失败流未建立。")
    const reader = stream.getReader()
    const chunks: UIMessageChunk[] = []
    while (true) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
    }

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "data-task-error",
          data: expect.objectContaining({ code: "resume-failed", retryable: false }),
        }),
        expect.objectContaining({ type: "error", errorText: "无法恢复这个任务的生成流。" }),
      ]),
    )
  })

  it("已结束运行的恢复事件存在序号缺口时显示失败而不是静默关闭", async () => {
    const bridge: ElectronChatBridge = {
      cancelAiChat: vi.fn(),
      onAiChatEvent: () => () => {},
      resumeAiChat: async () => ({
        ok: true,
        run: {
          active: false,
          configId: "deepseek",
          events: [
            {
              taskId: "chat-resume-gap",
              requestId: "request-resume-gap",
              sequence: 1,
              chunk: { type: "start", messageId: "assistant-resume-gap" },
            },
            {
              taskId: "chat-resume-gap",
              requestId: "request-resume-gap",
              sequence: 3,
              chunk: { type: "finish", finishReason: "stop" },
            },
          ],
          modelId: "deepseek-v4-flash",
          providerId: "deepseek",
          requestId: "request-resume-gap",
        },
      }),
      startAiChat: async () => ({ ok: true }),
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "chat-resume-gap",
      configId: "deepseek",
      mode: "chat",
      skillId: null,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      resume: true,
    }))

    const stream = await transport.reconnectToStream({ chatId: "chat-resume-gap" })
    if (!stream) throw new Error("恢复流未建立。")
    const reader = stream.getReader()
    const chunks: UIMessageChunk[] = []
    while (true) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(result.value)
    }

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "data-task-error",
          data: expect.objectContaining({ code: "resume-failed", retryable: false }),
        }),
      ]),
    )
  })

  it("未持久化草稿不会请求恢复生成流", async () => {
    const resumeAiChat = vi.fn(async () => ({ ok: true as const, run: null }))
    const bridge: ElectronChatBridge = {
      cancelAiChat: vi.fn(),
      onAiChatEvent: () => () => {},
      resumeAiChat,
      startAiChat: async () => ({ ok: true }),
    }
    const transport = new ElectronChatTransport(() => ({
      bridge,
      chatId: "draft-task",
      configId: "deepseek",
      mode: "chat",
      skillId: null,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      resume: false,
    }))

    await expect(transport.reconnectToStream({ chatId: "draft-task" })).resolves.toBeNull()
    expect(resumeAiChat).not.toHaveBeenCalled()
  })
})
