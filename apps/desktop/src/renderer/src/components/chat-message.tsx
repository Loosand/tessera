/**
 * [INPUT]: AI SDK UIMessage、当前回复状态、客户端问答结果、reasoning 生命周期/摘要、变更预览/审批、文件跳转与重新生成回调
 * [OUTPUT]: 用户文本/图片/文档附件与按原始 Part 顺序组合的助手回复、思考阶段/摘要、问答/研究计划、搜索轨迹、工具审查及轻量消息操作
 * [POS]: task-page 的 Chat/Agent 消息协调层
 * [DOC]: design.md、docs/architecture/ai-observability.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import type { AgentChangePreview, TaskUserInputResult } from "@tessera/contracts"
import { Copy01Icon, File02Icon, Refresh01Icon } from "@tessera/design-system/components/icons"
import { LoadingState } from "@tessera/design-system/components/loading-state"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React from "react"
import { ContentOperationPart, isContentOperationToolPart } from "./chat-parts/content-operation-part"
import { ReasoningPart } from "./chat-parts/reasoning-part"
import { ResearchActivityPart, isResearchActivityToolPart } from "./chat-parts/research-activity-part"
import { ResearchPlanPart, isResearchPlanToolPart } from "./chat-parts/research-plan-part"
import { SourcePart } from "./chat-parts/source-part"
import { TaskErrorPart, isTaskErrorPart } from "./chat-parts/task-error-part"
import { TextPart } from "./chat-parts/text-part"
import { ToolPart, isToolPart } from "./chat-parts/tool-part"
import { UserInputPart, isUserInputToolPart } from "./chat-parts/user-input-part"
import { WebSearchPart, isWebSearchToolPart } from "./chat-parts/web-search-part"

type ChatMessageProps = Readonly<{
  isLast: boolean
  message: UIMessage
  loadAgentChangePreview?: ((approvalId: string) => Promise<AgentChangePreview>) | undefined
  onOpenDocument?: ((path: string, line?: number) => void) | undefined
  onRegenerate: () => void
  onToolApproval?: ((approvalId: string, approved: boolean) => void) | undefined
  onUserInput?: ((toolCallId: string, output: TaskUserInputResult) => void | PromiseLike<void>) | undefined
  running: boolean
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

export function ChatMessage({
  isLast,
  loadAgentChangePreview,
  message,
  onOpenDocument,
  onRegenerate,
  onToolApproval,
  onUserInput,
  running,
}: ChatMessageProps) {
  const text = messageText(message)
  const files = message.parts.filter((part) => part.type === "file")
  const imageFiles = files.filter((file) => file.mediaType.startsWith("image/"))
  const documentFiles = files.filter((file) => !file.mediaType.startsWith("image/"))
  const assistantStreaming = running && isLast
  const firstWebSearchIndex = message.parts.findIndex(isWebSearchToolPart)
  const firstContentOperationIndex = message.parts.findIndex(isContentOperationToolPart)
  const firstResearchActivityIndex = message.parts.findIndex(isResearchActivityToolPart)
  const contentOperationParts = message.parts.filter(isContentOperationToolPart)
  const firstEmptyReasoningIndex = message.parts.findIndex(
    (part) => part.type === "reasoning" && !shouldRenderReasoningBody(part),
  )
  const hasReasoningBody = message.parts.some(
    (part) => part.type === "reasoning" && shouldRenderReasoningBody(part),
  )
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
  const hasReasoning = message.parts.some((part) => part.type === "reasoning")

  if (message.role === "user") {
    return (
      <article className="ml-auto max-w-[min(85%,44rem)]" aria-label="你的消息">
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
          <div className="whitespace-pre-wrap rounded-2xl bg-muted px-4 py-3 text-[14px] leading-6 text-foreground">
            {text}
          </div>
        ) : null}
      </article>
    )
  }

  return (
    <article className="group max-w-none" aria-label="AI 回复">
      {message.parts.map((part, index) => {
        const partKey = chatMessagePartKey(message.id, index)
        if (part.type === "reasoning") {
          const hasBody = shouldRenderReasoningBody(part)
          if (!hasBody && (hasReasoningBody || index !== firstEmptyReasoningIndex)) return null
          const streaming = hasBody
            ? assistantStreaming && index === lastReasoningPartIndex && part.state !== "done"
            : assistantStreaming
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
            <TaskErrorPart
              key={partKey}
              part={part}
              onRetry={isLast && !running ? onRegenerate : undefined}
            />
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
            <ResearchActivityPart key={partKey} parts={message.parts} streaming={assistantStreaming} />
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
            />
          )
        }
        return null
      })}
      {!text && !hasReasoning && assistantStreaming ? (
        <LoadingState className="py-2" label="正在思考" />
      ) : null}
      <SourcePart
        includeUrlSources={firstWebSearchIndex === -1}
        parts={message.parts}
        streaming={assistantStreaming}
      />

      {text && !(running && isLast) ? (
        <div className="mt-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="复制回复"
            title="复制"
            onClick={() => void navigator.clipboard.writeText(text)}
          >
            <Icon icon={Copy01Icon} size={13} />
          </Button>
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
