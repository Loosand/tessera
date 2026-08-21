/**
 * [INPUT]: AI SDK UIMessage、当前回复状态与重新生成回调
 * [OUTPUT]: 用户消息与按原始 Part 顺序组合的助手回复及轻量消息操作
 * [POS]: task-page 的普通对话消息协调层
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import { BrainCircuitIcon, Copy01Icon, Refresh01Icon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { SourcePart } from "./chat-parts/source-part"
import { TextPart } from "./chat-parts/text-part"
import { ToolPart, isToolPart } from "./chat-parts/tool-part"

interface ChatMessageProps {
  isLast: boolean
  message: UIMessage
  onRegenerate: () => void
  running: boolean
}

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}

export function ChatMessage({ isLast, message, onRegenerate, running }: ChatMessageProps) {
  const text = messageText(message)
  const files = message.parts.filter((part) => part.type === "file")
  const reasoning = message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("")
  const assistantStreaming = running && isLast
  let lastTextPartIndex = -1
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    if (message.parts[index]?.type === "text") {
      lastTextPartIndex = index
      break
    }
  }

  if (message.role === "user") {
    return (
      <article className="ml-auto max-w-[min(85%,44rem)]" aria-label="你的消息">
        {files.length > 0 ? (
          <div className="mb-2 flex flex-wrap justify-end gap-2">
            {files.map((file, index) => (
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
      {reasoning ? (
        <div
          className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground"
          aria-label={assistantStreaming ? "模型正在思考" : "模型已完成思考"}
        >
          <Icon icon={BrainCircuitIcon} size={13} />
          {assistantStreaming ? "正在思考…" : "已完成思考"}
        </div>
      ) : null}
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return (
            <TextPart
              key={`${message.id}-text-${index}`}
              part={part}
              streaming={assistantStreaming && index === lastTextPartIndex && part.state !== "done"}
            />
          )
        }
        if (isToolPart(part)) return <ToolPart key={part.toolCallId} part={part} />
        return null
      })}
      {!text && assistantStreaming ? (
        <output className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-current" />
          正在思考…
        </output>
      ) : null}
      <SourcePart parts={message.parts} streaming={assistantStreaming} />

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
