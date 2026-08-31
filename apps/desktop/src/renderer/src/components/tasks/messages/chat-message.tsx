/**
 * [INPUT]: AI SDK UIMessage、当前回复状态/计时、客户端问答结果、reasoning 生命周期/摘要、变更预览/审批、文件跳转、引申问题带入、本地反馈、运行解释读取与重新生成回调
 * [OUTPUT]: 用户文本/附件、正式回答前统一“已工作”过程、问答/审批/失败边界、回答后引申问题、可持久化赞踩、工具审查及按需运行解释等轻量消息操作
 * [POS]: task-page 的 Chat/Agent 消息协调层
 * [DOC]: design.md、docs/architecture/ai-observability.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import type {
  AgentChangePreview,
  TaskMessageFeedbackRating,
  TaskResearchNotebook,
  TaskResearchSaveSourcesResult,
  TaskRunInspection,
  TaskUserInputResult,
} from "@tessera/contracts"
import {
  Copy01Icon,
  File02Icon,
  Refresh01Icon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Tick02Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React from "react"
import { ContentOperationPart, isContentOperationToolPart } from "./chat-parts/content-operation-part"
import { FollowUpQuestionsPart, isFollowUpQuestionsPart } from "./chat-parts/follow-up-questions-part"
import { ReasoningPart } from "./chat-parts/reasoning-part"
import { ResearchActivityPart, isResearchActivityToolPart } from "./chat-parts/research-activity-part"
import { ResearchPlanPart, isResearchPlanToolPart } from "./chat-parts/research-plan-part"
import { SourcePart } from "./chat-parts/source-part"
import { TaskErrorPart, isTaskErrorPart } from "./chat-parts/task-error-part"
import { type TaskRunTiming, TaskWorkTrace } from "./chat-parts/task-run-activity"
import { TextPart } from "./chat-parts/text-part"
import { ToolPart, isToolPart } from "./chat-parts/tool-part"
import { UserInputPart, isUserInputToolPart } from "./chat-parts/user-input-part"
import { WebSearchPart, isWebSearchToolPart } from "./chat-parts/web-search-part"
import { RunInspectionPopover } from "./run-inspection-popover"

type ChatMessageProps = Readonly<{
  isLast: boolean
  message: UIMessage
  loadAgentChangePreview?: ((approvalId: string) => Promise<AgentChangePreview>) | undefined
  onFeedback?: ((messageId: string, rating: TaskMessageFeedbackRating | null) => void) | undefined
  onOpenDocument?: ((path: string, line?: number) => void) | undefined
  onRegenerate: () => void
  onUseFollowUpQuestion?: ((prompt: string) => void) | undefined
  onReadTaskRun?: ((requestId: string) => Promise<TaskRunInspection | null>) | undefined
  onReadResearchNotebook?: ((requestId: string) => Promise<TaskResearchNotebook | null>) | undefined
  onSaveResearchRecommendations?:
    | ((requestId: string, sourceIds: string[]) => Promise<TaskResearchSaveSourcesResult>)
    | undefined
  onToolApproval?: ((approvalId: string, approved: boolean) => void) | undefined
  onUserInput?: ((toolCallId: string, output: TaskUserInputResult) => void | PromiseLike<void>) | undefined
  running: boolean
  runTiming?: TaskRunTiming | null
}>

type MessagePart = UIMessage["parts"][number]

export type AssistantPartLayout = Readonly<{
  answerStartIndex: number
  workPartIndexes: readonly number[]
}>

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}

export function chatMessagePartKey(messageId: string, index: number) {
  return `${messageId}-part-${index}`
}

export function shouldRenderReasoningBody(part: { text: string }) {
  return part.text.trim().length > 0
}

function isInteractiveToolPart(part: MessagePart) {
  if (!isToolPart(part)) return false
  const hasInteractiveState =
    part.state === "approval-requested" ||
    part.state === "approval-responded" ||
    part.state === "output-denied"
  return hasInteractiveState || isUserInputToolPart(part) || isContentOperationToolPart(part)
}

function isAutomaticWorkPart(part: MessagePart) {
  if (part.type === "reasoning") return true
  if (isResearchPlanToolPart(part) || isWebSearchToolPart(part) || isResearchActivityToolPart(part)) {
    return true
  }
  return isToolPart(part) && !isInteractiveToolPart(part)
}

export function resolveAssistantPartLayout(parts: readonly MessagePart[]): AssistantPartLayout {
  let lastAutomaticWorkIndex = -1
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part && isAutomaticWorkPart(part)) {
      lastAutomaticWorkIndex = index
      break
    }
  }

  if (lastAutomaticWorkIndex === -1) {
    return { answerStartIndex: -1, workPartIndexes: [] }
  }

  const answerStartIndex = parts.findIndex(
    (part, index) => index > lastAutomaticWorkIndex && part.type === "text" && part.text.trim().length > 0,
  )
  const workPartIndexes: number[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!part) continue
    if (isAutomaticWorkPart(part)) {
      workPartIndexes.push(index)
      continue
    }
    if (
      part.type === "text" &&
      part.text.trim().length > 0 &&
      index < (answerStartIndex === -1 ? parts.length : answerStartIndex)
    ) {
      workPartIndexes.push(index)
    }
  }

  return { answerStartIndex, workPartIndexes }
}

export function ChatMessage({
  isLast,
  loadAgentChangePreview,
  message,
  onFeedback,
  onOpenDocument,
  onRegenerate,
  onReadTaskRun,
  onReadResearchNotebook,
  onSaveResearchRecommendations,
  onToolApproval,
  onUserInput,
  onUseFollowUpQuestion,
  running,
  runTiming = null,
}: ChatMessageProps) {
  const text = messageText(message)
  const [copied, setCopied] = React.useState(false)
  const copyResetTimerRef = React.useRef<number | null>(null)
  const files = message.parts.filter((part) => part.type === "file")
  const imageFiles = files.filter((file) => file.mediaType.startsWith("image/"))
  const documentFiles = files.filter((file) => !file.mediaType.startsWith("image/"))
  const assistantStreaming = running && isLast
  const feedbackRating = message.metadata?.feedback?.rating ?? null
  const runRequestId = message.metadata?.requestId
  const firstWebSearchIndex = message.parts.findIndex(isWebSearchToolPart)
  const firstContentOperationIndex = message.parts.findIndex(isContentOperationToolPart)
  const firstResearchActivityIndex = message.parts.findIndex(isResearchActivityToolPart)
  const followUpQuestionsPart = message.parts.find(isFollowUpQuestionsPart)
  const contentOperationParts = message.parts.filter(isContentOperationToolPart)
  const { workPartIndexes } = resolveAssistantPartLayout(message.parts)
  const workPartIndexSet = new Set(workPartIndexes)
  const firstWorkPartIndex = workPartIndexes[0] ?? -1
  const workHasDetails = workPartIndexes.some((index) => {
    const part = message.parts[index]
    return part?.type !== "reasoning" || shouldRenderReasoningBody(part)
  })
  const [persistedRunTiming, setPersistedRunTiming] = React.useState<TaskRunTiming | null>(null)
  let lastTextPartIndex = -1
  let lastReasoningPartIndex = -1
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index]
    if (lastTextPartIndex === -1 && part?.type === "text") {
      lastTextPartIndex = index
    }
    if (lastReasoningPartIndex === -1 && part?.type === "reasoning") {
      lastReasoningPartIndex = index
    }
    if (lastTextPartIndex !== -1 && lastReasoningPartIndex !== -1) break
  }
  const workTiming = runTiming ?? persistedRunTiming

  React.useEffect(() => {
    let disposed = false
    if (runTiming || assistantStreaming || firstWorkPartIndex === -1 || !runRequestId || !onReadTaskRun) {
      setPersistedRunTiming(null)
      return () => {
        disposed = true
      }
    }

    void onReadTaskRun(runRequestId)
      .then((inspection) => {
        if (disposed || !inspection) return
        const completedAt =
          inspection.completedAt ??
          (inspection.timing.durationMs === null
            ? inspection.startedAt
            : inspection.startedAt + inspection.timing.durationMs)
        setPersistedRunTiming({ startedAt: inspection.startedAt, completedAt })
      })
      .catch(() => {
        if (!disposed) setPersistedRunTiming(null)
      })

    return () => {
      disposed = true
    }
  }, [assistantStreaming, firstWorkPartIndex, onReadTaskRun, runRequestId, runTiming])

  React.useEffect(
    () => () => {
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
    },
    [],
  )

  const copyResponse = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        copyResetTimerRef.current = null
      }, 2_000)
    } catch {
      setCopied(false)
    }
  }, [text])

  if (message.role === "user") {
    return (
      <article className="w-full" aria-label="你的消息" data-message-role="user">
        {documentFiles.length > 0 ? (
          <div className="mb-2 flex flex-wrap justify-end gap-2">
            {documentFiles.map((file, index) => (
              <div
                key={`${file.filename ?? file.mediaType}-${index}`}
                className="flex max-w-64 items-center gap-2 rounded-lg bg-muted px-2.5 py-2 text-left"
              >
                <Icon icon={File02Icon} size={14} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium">
                    {file.filename ?? "Markdown 文档"}
                  </span>
                  <span className="block text-[9px] text-muted-foreground">对话上下文</span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {imageFiles.length > 0 ? (
          <div className="mb-2 flex flex-wrap justify-end gap-2">
            {imageFiles.map((file, index) => (
              <img
                key={`${file.url.slice(0, 48)}-${index}`}
                className="max-h-64 max-w-64 rounded-xl object-cover ring-1 ring-foreground/10"
                src={file.url}
                alt={file.filename || "上传图片"}
              />
            ))}
          </div>
        ) : null}
        {text ? (
          <div className="whitespace-pre-wrap rounded-[18px] bg-muted/75 px-4 py-2.5 text-[14px] leading-6 text-foreground">
            {text}
          </div>
        ) : null}
      </article>
    )
  }

  const renderAssistantPart = (part: MessagePart, index: number, insideWorkTrace = false) => {
    const partKey = chatMessagePartKey(message.id, index)
    if (part.type === "reasoning") {
      const hasBody = shouldRenderReasoningBody(part)
      if (!hasBody && insideWorkTrace) return null
      const streaming = assistantStreaming && index === lastReasoningPartIndex && part.state !== "done"
      return <ReasoningPart key={partKey} part={part} streaming={streaming} />
    }
    if (part.type === "text") {
      return (
        <TextPart
          key={partKey}
          part={part}
          streaming={assistantStreaming && index === lastTextPartIndex && part.state !== "done"}
          onOpenWorkspaceReference={onOpenDocument}
        />
      )
    }
    if (isTaskErrorPart(part)) {
      return (
        <TaskErrorPart key={partKey} part={part} onRetry={isLast && !running ? onRegenerate : undefined} />
      )
    }
    if (isUserInputToolPart(part)) {
      return <UserInputPart key={partKey} part={part} onSubmit={onUserInput} />
    }
    if (isResearchPlanToolPart(part)) {
      return <ResearchPlanPart key={partKey} part={part} streaming={assistantStreaming} />
    }
    if (isWebSearchToolPart(part)) {
      return index === firstWebSearchIndex ? (
        <WebSearchPart key={partKey} parts={message.parts} streaming={assistantStreaming} />
      ) : null
    }
    if (isResearchActivityToolPart(part)) {
      return index === firstResearchActivityIndex ? (
        <ResearchActivityPart
          key={partKey}
          parts={message.parts}
          streaming={assistantStreaming}
          onReadNotebook={onReadResearchNotebook}
          onSaveRecommendations={onSaveResearchRecommendations}
        />
      ) : null
    }
    if (isContentOperationToolPart(part)) {
      return index === firstContentOperationIndex ? (
        <ContentOperationPart
          key={partKey}
          parts={contentOperationParts}
          loadAgentChangePreview={loadAgentChangePreview}
          onOpenDocument={onOpenDocument}
          onToolApproval={onToolApproval}
        />
      ) : null
    }
    if (isToolPart(part)) {
      return (
        <ToolPart
          key={partKey}
          part={part}
          loadAgentChangePreview={loadAgentChangePreview}
          onOpenDocument={onOpenDocument}
          onToolApproval={onToolApproval}
          showInputDetails={!insideWorkTrace}
        />
      )
    }
    return null
  }

  return (
    <article className="group w-full max-w-none" aria-label="AI 回复" data-message-role="assistant">
      {message.parts.map((part, index) => {
        if (index === firstWorkPartIndex) {
          return (
            <TaskWorkTrace
              key={`${message.id}-work-trace`}
              hasDetails={workHasDetails}
              running={assistantStreaming}
              timing={workTiming}
            >
              {workPartIndexes.map((workIndex) => {
                const workPart = message.parts[workIndex]
                return workPart ? renderAssistantPart(workPart, workIndex, true) : null
              })}
            </TaskWorkTrace>
          )
        }
        if (workPartIndexSet.has(index)) return null
        return renderAssistantPart(part, index)
      })}
      <SourcePart
        includeUrlSources={firstWebSearchIndex === -1}
        parts={message.parts}
        streaming={assistantStreaming}
      />
      {followUpQuestionsPart ? (
        <FollowUpQuestionsPart
          part={followUpQuestionsPart}
          onSelect={assistantStreaming ? undefined : onUseFollowUpQuestion}
        />
      ) : null}

      {(text || runRequestId) && !(running && isLast) ? (
        <div className="mt-3 flex min-h-7 items-center gap-1 text-muted-foreground">
          {text ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="复制回复"
              title={copied ? "已复制" : "复制"}
              onClick={() => void copyResponse()}
            >
              <Icon icon={copied ? Tick02Icon : Copy01Icon} size={13} />
            </Button>
          ) : null}
          {text && onFeedback ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="赞：这条回复有帮助"
                aria-pressed={feedbackRating === "positive"}
                title="有帮助（仅保存在本机）"
                className={feedbackRating === "positive" ? "bg-muted text-foreground" : undefined}
                onClick={() => onFeedback(message.id, feedbackRating === "positive" ? null : "positive")}
              >
                <Icon icon={ThumbsUpIcon} size={13} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="踩：这条回复没有帮助"
                aria-pressed={feedbackRating === "negative"}
                title="没有帮助（仅保存在本机）"
                className={feedbackRating === "negative" ? "bg-muted text-foreground" : undefined}
                onClick={() => onFeedback(message.id, feedbackRating === "negative" ? null : "negative")}
              >
                <Icon icon={ThumbsDownIcon} size={13} />
              </Button>
            </>
          ) : null}
          {runRequestId && onReadTaskRun ? (
            <RunInspectionPopover requestId={runRequestId} onRead={onReadTaskRun} />
          ) : null}
          {isLast ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="重新生成回复"
              title="重新生成"
              onClick={onRegenerate}
            >
              <Icon icon={Refresh01Icon} size={13} />
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
