/**
 * [INPUT]: Electron 窄桥、内部任务执行模式/创作方式、显式当前文档、模型选择、版本化历史消息、自动联网/思考策略与 AI SDK React 状态机
 * [OUTPUT]: 可独立验证且支持断开重连的 ElectronChatTransport、等待输入识别、完整 UIMessage 往返、问答/审批后自动续轮与通过类型化 IPC 消费增量事件的 useChat 封装
 * [POS]: @tessera/ai/react 中连接桌面渲染层与主进程 Chat/Agent 运行时的 Transport
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { useChat } from "@ai-sdk/react"
import { REQUEST_USER_INPUT_TOOL_NAME } from "@tessera/contracts"
import type {
  AiChatReasoning,
  AiChatStreamEvent,
  AiProviderId,
  DesktopApi,
  TaskMessage,
  TaskMessageMetadata,
  TaskMode,
  TaskSkillId,
  TaskToolMessagePart,
} from "@tessera/contracts"
import {
  type UIMessage as AiSdkUiMessage,
  type UIMessageChunk as AiSdkUiMessageChunk,
  type ChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai"
import { useCallback, useMemo, useRef } from "react"

export type ElectronChatBridge = Pick<
  DesktopApi,
  "cancelAiChat" | "onAiChatEvent" | "resumeAiChat" | "startAiChat"
>

export type UIMessage = AiSdkUiMessage
type UIMessageChunk = AiSdkUiMessageChunk<TaskMessageMetadata>

export type UseElectronChatOptions = {
  bridge: ElectronChatBridge | undefined
  chatId?: string
  configId: string
  currentDocumentPath?: string | undefined
  initialMessages?: TaskMessage[]
  mode: TaskMode
  modelId: string
  providerId: AiProviderId
  reasoning: AiChatReasoning
  skillId: TaskSkillId
  webSearch: boolean
}

function requestId() {
  return globalThis.crypto.randomUUID()
}

export function toAiChatMessages(messages: readonly UIMessage[]): TaskMessage[] {
  return toTaskMessages(messages)
}

type UiMessagePart = UIMessage["parts"][number]
type UiToolPart = Extract<UiMessagePart, { type: "dynamic-tool" | `tool-${string}` }>

function isUiToolPart(part: UiMessagePart): part is UiToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-")
}

function uiToolName(part: UiToolPart) {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length)
}

export function hasPendingTaskUserInput(messages: readonly UIMessage[]) {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(
        (part) =>
          isUiToolPart(part) &&
          uiToolName(part) === REQUEST_USER_INPUT_TOOL_NAME &&
          part.state === "input-available",
      ),
  )
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
        isUiToolPart(part) &&
        uiToolName(part) === REQUEST_USER_INPUT_TOOL_NAME &&
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
    (value.providerId === undefined ||
      value.providerId === "openai-compatible" ||
      value.providerId === "anthropic-compatible" ||
      value.providerId === "deepseek" ||
      value.providerId === "grok" ||
      value.providerId === "openrouter")
  )
}

function toTaskToolPart(part: UiToolPart): TaskToolMessagePart {
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
      } else if (part.type === "step-start") {
        parts.push({ type: "step-start" })
      } else if (isUiToolPart(part)) {
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
  return messages.map((message) => ({ ...message, parts: [...message.parts] })) as UIMessage[]
}

export class ElectronChatTransport implements ChatTransport<UIMessage> {
  private readonly activeRequestIds = new Map<string, string>()

  constructor(private readonly options: () => UseElectronChatOptions) {}

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
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]) {
    const options = this.options()
    const bridge = options.bridge
    if (!bridge) throw new Error("桌面 AI 服务不可用。")
    const activeRequestId = requestId()
    this.activeRequestIds.set(chatId, activeRequestId)
    let sequence = 0
    let detach = () => {}

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
        const abort = () => close()
        detach = close
        const unsubscribe = bridge.onAiChatEvent((event: AiChatStreamEvent) => {
          if (
            closed ||
            event.taskId !== chatId ||
            event.requestId !== activeRequestId ||
            event.sequence <= sequence
          ) {
            return
          }
          sequence = event.sequence
          const chunk =
            event.chunk.type === "start"
              ? {
                  ...event.chunk,
                  messageMetadata: {
                    configId: options.configId,
                    modelId: options.modelId,
                    providerId: options.providerId,
                  } satisfies TaskMessageMetadata,
                }
              : event.chunk
          controller.enqueue(chunk)
          if (event.chunk.type === "finish" || event.chunk.type === "abort" || event.chunk.type === "error") {
            if (this.activeRequestIds.get(chatId) === activeRequestId) this.activeRequestIds.delete(chatId)
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
            configId: options.configId,
            requestId: activeRequestId,
            taskId: chatId,
            ...(options.currentDocumentPath ? { currentDocumentPath: options.currentDocumentPath } : {}),
            mode: options.mode,
            skillId: options.skillId,
            providerId: options.providerId,
            modelId: options.modelId,
            reasoning: options.reasoning,
            webSearch: options.webSearch,
            messages: toAiChatMessages(messages),
          })
          .then((result) => {
            if (result.ok) return
            if (this.activeRequestIds.get(chatId) === activeRequestId) this.activeRequestIds.delete(chatId)
            if (closed) return
            controller.error(new Error(result.error))
            closed = true
            unsubscribe()
            abortSignal?.removeEventListener("abort", abort)
          })
          .catch((error) => {
            if (this.activeRequestIds.get(chatId) === activeRequestId) this.activeRequestIds.delete(chatId)
            if (closed) return
            controller.error(error instanceof Error ? error : new Error("无法开始模型请求。"))
            closed = true
            unsubscribe()
            abortSignal?.removeEventListener("abort", abort)
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
    const bridge = options.bridge
    if (!bridge) throw new Error("桌面 AI 服务不可用。")

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
      throw error
    } finally {
      abortSignal?.removeEventListener("abort", disconnectBeforeResume)
    }
    if (disconnected || abortSignal?.aborted) {
      unsubscribe()
      return null
    }
    if (!result.ok) {
      unsubscribe()
      throw new Error(result.error)
    }
    if (!result.run) {
      unsubscribe()
      return null
    }

    const run = result.run
    this.activeRequestIds.set(chatId, run.requestId)
    let detach = () => {}
    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        let closed = false
        let sequence = 0
        const close = () => {
          if (closed) return
          closed = true
          unsubscribe()
          abortSignal?.removeEventListener("abort", abort)
          controller.close()
        }
        const abort = () => close()
        const consume = (event: AiChatStreamEvent) => {
          if (
            closed ||
            event.taskId !== chatId ||
            event.requestId !== run.requestId ||
            event.sequence <= sequence
          ) {
            return
          }
          sequence = event.sequence
          const chunk =
            event.chunk.type === "start"
              ? {
                  ...event.chunk,
                  messageMetadata: {
                    configId: run.configId,
                    modelId: run.modelId,
                    providerId: run.providerId,
                  } satisfies TaskMessageMetadata,
                }
              : event.chunk
          controller.enqueue(chunk)
          if (event.chunk.type === "finish" || event.chunk.type === "abort" || event.chunk.type === "error") {
            if (this.activeRequestIds.get(chatId) === run.requestId) this.activeRequestIds.delete(chatId)
            close()
          }
        }
        detach = close
        abortSignal?.addEventListener("abort", abort, { once: true })
        acceptLiveEvent = consume
        const replay = [...run.events, ...bufferedEvents].sort(
          (left, right) => left.sequence - right.sequence,
        )
        bufferedEvents = []
        for (const event of replay) consume(event)
        if (!run.active && !closed) close()
        if (abortSignal?.aborted) abort()
      },
      cancel: () => detach(),
    })
  }
}

export function useElectronChat(options: UseElectronChatOptions) {
  const latestOptions = useRef(options)
  latestOptions.current = options
  const fallbackChatId = useMemo(() => `task-${requestId()}`, [])
  const transport = useMemo(() => new ElectronChatTransport(() => latestOptions.current), [])

  const chat = useChat({
    id: options.chatId ?? fallbackChatId,
    ...(options.initialMessages ? { messages: toUiMessages(options.initialMessages) } : {}),
    resume: true,
    sendAutomaticallyWhen: shouldAutomaticallyContinueTask,
    transport,
    throttle: 24,
  })
  const stop = useCallback(async () => {
    transport.cancelActive(chat.id)
    await chat.stop()
  }, [chat, transport])

  return { ...chat, stop }
}
