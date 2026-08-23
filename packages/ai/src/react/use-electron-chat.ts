/**
 * [INPUT]: Electron 窄桥、任务是否已持久化、内部任务执行作用域/创作方式、显式当前文档、模型选择、版本化历史消息与 AI SDK React 状态机
 * [OUTPUT]: 不传递能力开关、只为已持久化任务恢复且支持断开重连的 ElectronChatTransport、显式重新生成到研究续跑 provenance 与已完成工具结果续跑的映射、重复过滤/乱序缓冲/缺口失败、取消流安全收口、带 requestId 的版本化消息内引申问题/运行失败、基于 AI SDK 标准 Tool Part 守卫的等待输入识别、完整 UIMessage 往返、问答/审批后自动续轮与类型化 IPC 增量消费
 * [POS]: @tessera/ai/react 中连接桌面渲染层与主进程 Chat/Agent 运行时的 Transport
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { useChat } from "@ai-sdk/react"
import { REQUEST_USER_INPUT_TOOL_NAME, isTaskRunErrorDataV1 } from "@tessera/contracts"
import type {
  AiChatStreamEvent,
  AiProviderId,
  DesktopApi,
  TaskMessage,
  TaskMessageMetadata,
  TaskMode,
  TaskRunErrorData,
  TaskRunErrorDataV1,
  TaskRunErrorPhase,
  TaskSkillId,
  TaskToolErrorDataV1,
  TaskToolMessagePart,
} from "@tessera/contracts"
import {
  type ChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai"
import { useCallback, useMemo, useRef } from "react"
import {
  type UIMessage,
  type UIMessageChunk,
  type UIMessageToolPart,
  isUIMessageToolPart,
  uiMessageToolName,
} from "./task-ui-message"

export type { UIMessage } from "./task-ui-message"

export type ElectronChatBridge = Pick<
  DesktopApi,
  "cancelAiChat" | "onAiChatEvent" | "resumeAiChat" | "startAiChat"
>

export type UseElectronChatOptions = {
  bridge: ElectronChatBridge | undefined
  chatId?: string
  configId: string
  currentDocumentPath?: string | undefined
  initialMessages?: TaskMessage[]
  mode: TaskMode
  modelId: string
  providerId: AiProviderId
  resume?: boolean
  skillId: TaskSkillId
}

function requestId() {
  return globalThis.crypto.randomUUID()
}

export function toAiChatMessages(messages: readonly UIMessage[]): TaskMessage[] {
  return toTaskMessages(messages)
}

export function hasPendingTaskUserInput(messages: readonly UIMessage[]) {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(
        (part) =>
          isUIMessageToolPart(part) &&
          uiMessageToolName(part) === REQUEST_USER_INPUT_TOOL_NAME &&
          part.state === "input-available",
      ),
  )
}

export function hasTaskRunError(messages: readonly UIMessage[]) {
  const message = messages.at(-1)
  return message?.role === "assistant" && message.parts.some((part) => part.type === "data-task-error")
}

export function shouldAutomaticallyContinueTask({ messages }: { messages: UIMessage[] }) {
  if (lastAssistantMessageIsCompleteWithApprovalResponses({ messages })) return true
  if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) return false

  const message = messages.at(-1)
  if (!message || message.role !== "assistant") return false
  const lastStepStartIndex = message.parts.reduce(
    (lastIndex, part, index) => (part.type === "step-start" ? index : lastIndex),
    -1,
  )
  return message.parts
    .slice(lastStepStartIndex + 1)
    .some(
      (part) =>
        isUIMessageToolPart(part) &&
        uiMessageToolName(part) === REQUEST_USER_INPUT_TOOL_NAME &&
        (part.state === "output-available" || part.state === "output-error"),
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isTaskMessageMetadata(value: unknown): value is TaskMessageMetadata {
  if (!isRecord(value)) return false
  return (
    (value.configId === undefined || typeof value.configId === "string") &&
    (value.modelId === undefined || typeof value.modelId === "string") &&
    (value.requestId === undefined || typeof value.requestId === "string") &&
    (value.providerId === undefined ||
      value.providerId === "openai-compatible" ||
      value.providerId === "anthropic-compatible" ||
      value.providerId === "deepseek" ||
      value.providerId === "grok" ||
      value.providerId === "openrouter")
  )
}

function toTaskToolPart(part: UIMessageToolPart): TaskToolMessagePart {
  return {
    type: part.type,
    toolCallId: part.toolCallId,
    state: part.state,
    ...(part.type === "dynamic-tool" ? { toolName: part.toolName } : {}),
    ...(part.title ? { title: part.title } : {}),
    ...(part.input !== undefined ? { input: part.input } : {}),
    ...(part.state === "output-available" ? { output: part.output } : {}),
    ...(part.state === "output-available" && part.preliminary !== undefined
      ? { preliminary: part.preliminary }
      : {}),
    ...(part.providerExecuted !== undefined ? { providerExecuted: part.providerExecuted } : {}),
    ...(part.state === "output-error" ? { errorText: part.errorText } : {}),
    ...(part.approval ? { approval: part.approval } : {}),
  }
}

export function toTaskMessages(
  messages: readonly UIMessage[],
  assistantMetadata?: TaskMessageMetadata,
): TaskMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error("任务消息不能包含系统角色。")
    }
    const parts: TaskMessage["parts"] = []
    for (const part of message.parts) {
      if (part.type === "text") {
        parts.push({ type: "text", text: part.text, ...(part.state ? { state: part.state } : {}) })
      } else if (part.type === "reasoning") {
        parts.push({
          type: "reasoning",
          text: part.text,
          ...(part.id ? { id: part.id } : {}),
          ...(part.state ? { state: part.state } : {}),
        })
      } else if (part.type === "file") {
        parts.push({
          type: "file",
          url: part.url,
          mediaType: part.mediaType,
          ...(part.filename ? { filename: part.filename } : {}),
        })
      } else if (part.type === "source-url") {
        parts.push({
          type: "source-url",
          sourceId: part.sourceId,
          url: part.url,
          ...(part.title ? { title: part.title } : {}),
        })
      } else if (part.type === "source-document") {
        parts.push({
          type: "source-document",
          sourceId: part.sourceId,
          mediaType: part.mediaType,
          title: part.title,
          ...(part.filename ? { filename: part.filename } : {}),
        })
      } else if (part.type === "data-task-error") {
        parts.push({
          type: "data-task-error",
          ...(part.id ? { id: part.id } : {}),
          data: part.data,
        })
      } else if (part.type === "data-follow-up-questions") {
        parts.push({
          type: "data-follow-up-questions",
          ...(part.id ? { id: part.id } : {}),
          data: part.data,
        })
      } else if (part.type === "data-tool-error") {
        parts.push({
          type: "data-tool-error",
          ...(part.id ? { id: part.id } : {}),
          data: part.data,
        })
      } else if (part.type === "step-start") {
        parts.push({ type: "step-start" })
      } else if (isUIMessageToolPart(part)) {
        parts.push(toTaskToolPart(part))
      }
    }

    const snapshot: TaskMessage = {
      id: message.id,
      role: message.role,
      parts,
    }
    const metadata = isTaskMessageMetadata(message.metadata) ? message.metadata : undefined
    const resolvedMetadata = metadata ?? (message.role === "assistant" ? assistantMetadata : undefined)
    if (resolvedMetadata) snapshot.metadata = resolvedMetadata
    return snapshot
  })
}

export function toUiMessages(messages: readonly TaskMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === "data-task-error" ? { ...part, data: normalizeTaskRunError(part.data, "stream") } : part,
    ),
  })) as UIMessage[]
}

function isCompletedTaskToolPart(part: TaskMessage["parts"][number]): part is TaskToolMessagePart {
  if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) return false
  const toolPart = part as TaskToolMessagePart
  return toolPart.state === "output-available" && toolPart.preliminary !== true
}

/** 只保留失败回复中已经完成的工具调用，供下一次模型调用从工具结果之后继续。 */
export function completedToolContinuationMessage(message: TaskMessage | undefined): TaskMessage | null {
  if (!message || message.role !== "assistant") return null
  const failure = message.parts.find((part) => part.type === "data-task-error")
  if (failure?.type !== "data-task-error" || !failure.data.retryable) return null
  const parts = message.parts.filter(
    (part): part is TaskMessage["parts"][number] =>
      part.type === "step-start" || part.type === "data-task-error" || isCompletedTaskToolPart(part),
  )
  if (!parts.some(isCompletedTaskToolPart)) return null
  return {
    id: message.id,
    role: "assistant",
    parts,
    ...(message.metadata ? { metadata: message.metadata } : {}),
  }
}

function localTaskRunFailure(
  message: string,
  phase: TaskRunErrorPhase,
  code: TaskRunErrorDataV1["code"] = "transport",
  retryable = true,
): TaskRunErrorDataV1 {
  return { code, message, phase, retryable, version: 1 }
}

function normalizeTaskRunError(data: TaskRunErrorData, fallbackPhase: TaskRunErrorPhase): TaskRunErrorDataV1 {
  return isTaskRunErrorDataV1(data)
    ? data
    : localTaskRunFailure(data.message, fallbackPhase, "runtime", data.retryable)
}

function toolErrorDataChunk(failure: TaskToolErrorDataV1): UIMessageChunk {
  return {
    type: "data-tool-error",
    id: `tool-error-${failure.toolCallId}`,
    data: failure,
  }
}

class OrderedAiChatEventBuffer {
  private lastSequence = 0
  private readonly pending = new Map<number, AiChatStreamEvent>()

  constructor(
    private readonly taskId: string,
    private readonly requestId: string,
  ) {}

  push(event: AiChatStreamEvent) {
    if (
      event.taskId !== this.taskId ||
      event.requestId !== this.requestId ||
      event.sequence <= this.lastSequence ||
      this.pending.has(event.sequence)
    ) {
      return []
    }
    this.pending.set(event.sequence, event)
    const ready: AiChatStreamEvent[] = []
    while (true) {
      const nextSequence = this.lastSequence + 1
      const next = this.pending.get(nextSequence)
      if (!next) return ready
      this.pending.delete(nextSequence)
      this.lastSequence = nextSequence
      ready.push(next)
    }
  }

  hasGap() {
    return this.pending.size > 0
  }
}

export class ElectronChatTransport implements ChatTransport<UIMessage> {
  private readonly activeRequestIds = new Map<string, string>()
  private readonly messageRequestIds = new Map<string, string>()
  private readonly stagedRegenerationMessages = new Map<string, TaskMessage>()

  constructor(private readonly options: () => UseElectronChatOptions) {}

  stageRegenerationMessage(message: TaskMessage) {
    this.stagedRegenerationMessages.set(message.id, message)
  }

  private runErrorChunks(
    requestId: string,
    failure: TaskRunErrorDataV1,
    metadata?: TaskMessageMetadata,
  ): UIMessageChunk[] {
    return [
      ...(metadata ? [{ type: "start" as const, messageMetadata: metadata }] : []),
      {
        type: "data-task-error",
        id: `task-error-${requestId}`,
        data: failure,
      },
      { type: "error", errorText: failure.message },
    ]
  }

  private errorStream(requestId: string, failure: TaskRunErrorDataV1, metadata?: TaskMessageMetadata) {
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        for (const chunk of this.runErrorChunks(requestId, failure, metadata)) controller.enqueue(chunk)
        controller.close()
      },
    })
  }

  cancelActive(chatId: string) {
    const activeRequestId = this.activeRequestIds.get(chatId)
    const bridge = this.options().bridge
    if (!activeRequestId || !bridge) return
    this.activeRequestIds.delete(chatId)
    bridge.cancelAiChat(activeRequestId)
  }

  async sendMessages({
    chatId,
    messages,
    abortSignal,
    trigger,
    messageId,
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]) {
    const options = this.options()
    const bridge = options.bridge
    const activeRequestId = requestId()
    const regeneratedMessage =
      trigger === "regenerate-message" && messageId
        ? (this.stagedRegenerationMessages.get(messageId) ??
          options.initialMessages?.find(
            (message) => message.id === messageId && message.role === "assistant",
          ))
        : undefined
    if (messageId) this.stagedRegenerationMessages.delete(messageId)
    const continuationMessage = completedToolContinuationMessage(regeneratedMessage)
    const resumeResearchRequestId =
      trigger === "regenerate-message" && options.skillId === "research" && messageId
        ? (this.messageRequestIds.get(messageId) ?? regeneratedMessage?.metadata?.requestId)
        : undefined
    const metadata = {
      configId: options.configId,
      modelId: options.modelId,
      providerId: options.providerId,
      requestId: activeRequestId,
    } satisfies TaskMessageMetadata
    if (!bridge) {
      return this.errorStream(activeRequestId, localTaskRunFailure("桌面 AI 服务不可用。", "start"), metadata)
    }
    this.activeRequestIds.set(chatId, activeRequestId)
    const orderedEvents = new OrderedAiChatEventBuffer(chatId, activeRequestId)
    let detach = () => {}

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        let closed = false
        let unsubscribe = () => {}
        const cleanup = () => {
          if (closed) return
          closed = true
          unsubscribe()
          abortSignal?.removeEventListener("abort", abort)
        }
        const close = () => {
          if (closed) return
          cleanup()
          controller.close()
        }
        const abort = () => close()
        detach = cleanup
        unsubscribe = bridge.onAiChatEvent((event: AiChatStreamEvent) => {
          if (closed) return
          for (const readyEvent of orderedEvents.push(event)) {
            if (readyEvent.chunk.type === "start" && readyEvent.chunk.messageId) {
              this.messageRequestIds.set(readyEvent.chunk.messageId, activeRequestId)
            }
            const chunk =
              readyEvent.chunk.type === "start"
                ? {
                    ...readyEvent.chunk,
                    messageMetadata: metadata,
                  }
                : readyEvent.chunk
            if (readyEvent.chunk.type === "error") {
              const failure =
                readyEvent.chunk.failure ??
                localTaskRunFailure(readyEvent.chunk.errorText, "stream", "runtime")
              for (const errorChunk of this.runErrorChunks(activeRequestId, failure)) {
                controller.enqueue(errorChunk)
              }
            } else {
              if (
                (readyEvent.chunk.type === "tool-input-error" ||
                  readyEvent.chunk.type === "tool-output-error") &&
                readyEvent.chunk.failure
              ) {
                controller.enqueue(toolErrorDataChunk(readyEvent.chunk.failure))
              }
              controller.enqueue(chunk)
            }
            if (
              readyEvent.chunk.type === "finish" ||
              readyEvent.chunk.type === "abort" ||
              readyEvent.chunk.type === "error"
            ) {
              if (this.activeRequestIds.get(chatId) === activeRequestId) {
                this.activeRequestIds.delete(chatId)
              }
              close()
              break
            }
          }
        })

        abortSignal?.addEventListener("abort", abort, { once: true })
        if (abortSignal?.aborted) {
          abort()
          return
        }

        void bridge
          .startAiChat({
            configId: options.configId,
            requestId: activeRequestId,
            taskId: chatId,
            ...(options.currentDocumentPath ? { currentDocumentPath: options.currentDocumentPath } : {}),
            mode: options.mode,
            skillId: options.skillId,
            providerId: options.providerId,
            modelId: options.modelId,
            messages: [...toAiChatMessages(messages), ...(continuationMessage ? [continuationMessage] : [])],
            ...(continuationMessage ? { continueFromMessageId: continuationMessage.id } : {}),
            ...(trigger === "regenerate-message" && messageId ? { regenerateMessageId: messageId } : {}),
            ...(resumeResearchRequestId ? { resumeResearchRequestId } : {}),
          })
          .then((result) => {
            if (result.ok) return
            if (this.activeRequestIds.get(chatId) === activeRequestId) this.activeRequestIds.delete(chatId)
            if (closed) return
            for (const chunk of this.runErrorChunks(activeRequestId, result.error, metadata)) {
              controller.enqueue(chunk)
            }
            close()
          })
          .catch((error) => {
            if (this.activeRequestIds.get(chatId) === activeRequestId) this.activeRequestIds.delete(chatId)
            if (closed) return
            const message = error instanceof Error ? error.message : "无法开始模型请求。"
            for (const chunk of this.runErrorChunks(
              activeRequestId,
              localTaskRunFailure(message, "start"),
              metadata,
            )) {
              controller.enqueue(chunk)
            }
            close()
          })
      },
      cancel: () => detach(),
    })
  }

  async reconnectToStream({
    chatId,
    abortSignal,
  }: Parameters<ChatTransport<UIMessage>["reconnectToStream"]>[0]) {
    const options = this.options()
    if (options.resume !== true) return null
    const bridge = options.bridge
    const fallbackMetadata = {
      configId: options.configId,
      modelId: options.modelId,
      providerId: options.providerId,
    } satisfies TaskMessageMetadata
    if (!bridge) {
      return this.errorStream(
        requestId(),
        localTaskRunFailure("桌面 AI 服务不可用。", "resume"),
        fallbackMetadata,
      )
    }

    let bufferedEvents: AiChatStreamEvent[] = []
    let acceptLiveEvent: ((event: AiChatStreamEvent) => void) | null = null
    let disconnected = false
    const unsubscribe = bridge.onAiChatEvent((event) => {
      if (event.taskId !== chatId) return
      if (acceptLiveEvent) acceptLiveEvent(event)
      else bufferedEvents.push(event)
    })
    const disconnectBeforeResume = () => {
      disconnected = true
      unsubscribe()
    }
    abortSignal?.addEventListener("abort", disconnectBeforeResume, { once: true })

    let result: Awaited<ReturnType<ElectronChatBridge["resumeAiChat"]>>
    try {
      result = await bridge.resumeAiChat(chatId)
    } catch (error) {
      unsubscribe()
      if (disconnected || abortSignal?.aborted) return null
      const message = error instanceof Error ? error.message : "无法恢复这个任务的生成流。"
      return this.errorStream(requestId(), localTaskRunFailure(message, "resume"), fallbackMetadata)
    } finally {
      abortSignal?.removeEventListener("abort", disconnectBeforeResume)
    }
    if (disconnected || abortSignal?.aborted) {
      unsubscribe()
      return null
    }
    if (!result.ok) {
      unsubscribe()
      return this.errorStream(requestId(), result.error, fallbackMetadata)
    }
    if (!result.run) {
      unsubscribe()
      return null
    }

    const run = result.run
    this.activeRequestIds.set(chatId, run.requestId)
    const orderedEvents = new OrderedAiChatEventBuffer(chatId, run.requestId)
    let detach = () => {}
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        let closed = false
        let receivedStart = false
        let receivedTerminal = false
        const cleanup = () => {
          if (closed) return
          closed = true
          unsubscribe()
          abortSignal?.removeEventListener("abort", abort)
        }
        const close = () => {
          if (closed) return
          cleanup()
          controller.close()
        }
        const abort = () => close()
        const consume = (event: AiChatStreamEvent) => {
          if (closed) return
          for (const readyEvent of orderedEvents.push(event)) {
            const chunk =
              readyEvent.chunk.type === "start"
                ? {
                    ...readyEvent.chunk,
                    messageMetadata: {
                      configId: run.configId,
                      modelId: run.modelId,
                      providerId: run.providerId,
                      requestId: run.requestId,
                    } satisfies TaskMessageMetadata,
                  }
                : readyEvent.chunk
            if (readyEvent.chunk.type === "start") receivedStart = true
            if (readyEvent.chunk.type === "error") {
              const failure =
                readyEvent.chunk.failure ??
                localTaskRunFailure(readyEvent.chunk.errorText, "stream", "runtime")
              for (const errorChunk of this.runErrorChunks(run.requestId, failure)) {
                controller.enqueue(errorChunk)
              }
            } else {
              if (
                (readyEvent.chunk.type === "tool-input-error" ||
                  readyEvent.chunk.type === "tool-output-error") &&
                readyEvent.chunk.failure
              ) {
                controller.enqueue(toolErrorDataChunk(readyEvent.chunk.failure))
              }
              controller.enqueue(chunk)
            }
            if (
              readyEvent.chunk.type === "finish" ||
              readyEvent.chunk.type === "abort" ||
              readyEvent.chunk.type === "error"
            ) {
              receivedTerminal = true
              if (this.activeRequestIds.get(chatId) === run.requestId) {
                this.activeRequestIds.delete(chatId)
              }
              close()
              break
            }
          }
        }
        detach = cleanup
        abortSignal?.addEventListener("abort", abort, { once: true })
        acceptLiveEvent = consume
        const replay = [...run.events, ...bufferedEvents].sort(
          (left, right) => left.sequence - right.sequence,
        )
        bufferedEvents = []
        for (const event of replay) consume(event)
        if (!run.active && !closed && (!receivedTerminal || orderedEvents.hasGap())) {
          const failure = localTaskRunFailure(
            "恢复到的生成事件不完整，请从当前对话继续或重试。",
            "resume",
            "resume-failed",
            false,
          )
          const metadata = receivedStart
            ? undefined
            : ({
                configId: run.configId,
                modelId: run.modelId,
                providerId: run.providerId,
                requestId: run.requestId,
              } satisfies TaskMessageMetadata)
          for (const errorChunk of this.runErrorChunks(run.requestId, failure, metadata)) {
            controller.enqueue(errorChunk)
          }
          if (this.activeRequestIds.get(chatId) === run.requestId) {
            this.activeRequestIds.delete(chatId)
          }
          close()
        } else if (!run.active && !closed) {
          close()
        }
        if (abortSignal?.aborted) abort()
      },
      cancel: () => detach(),
    })
  }
}

export function useElectronChat(options: UseElectronChatOptions) {
  const latestOptions = useRef(options)
  latestOptions.current = options
  const resumeOnMount = useRef(options.resume === true).current
  const fallbackChatId = useMemo(() => `task-${requestId()}`, [])
  const transport = useMemo(() => new ElectronChatTransport(() => latestOptions.current), [])

  const chat = useChat({
    id: options.chatId ?? fallbackChatId,
    ...(options.initialMessages ? { messages: toUiMessages(options.initialMessages) } : {}),
    resume: resumeOnMount,
    sendAutomaticallyWhen: shouldAutomaticallyContinueTask,
    transport,
    throttle: 24,
  })
  const stop = useCallback(async () => {
    transport.cancelActive(chat.id)
    await chat.stop()
  }, [chat, transport])

  const regenerate = useCallback(
    async (requestOptions: Parameters<typeof chat.regenerate>[0] = {}) => {
      const target = requestOptions.messageId
        ? chat.messages.find((message) => message.id === requestOptions.messageId)
        : [...chat.messages].reverse().find((message) => message.role === "assistant")
      if (target?.role === "assistant") {
        const snapshot = toTaskMessages([target])[0]
        if (snapshot) transport.stageRegenerationMessage(snapshot)
      }
      await chat.regenerate(requestOptions)
    },
    [chat, transport],
  )

  return { ...chat, regenerate, stop }
}
