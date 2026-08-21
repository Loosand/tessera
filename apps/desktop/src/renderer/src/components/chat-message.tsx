/**
 * [INPUT]: AI SDK UIMessage、当前回复状态与重新生成回调
 * [OUTPUT]: 用户图片/文本、模型思考、Markdown 正文、来源和轻量消息操作
 * [POS]: task-page 的普通对话消息呈现层
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
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

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

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function ChatMessage({ isLast, message, onRegenerate, running }: ChatMessageProps) {
  const text = messageText(message)
  const files = message.parts.filter((part) => part.type === "file")
  const reasoning = message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("")
  const sources = message.parts.filter((part) => part.type === "source-url")

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
        <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="模型已完成思考">
          <Icon icon={BrainCircuitIcon} size={13} />
          已完成思考
        </div>
      ) : null}
      {text ? (
        <div className="chat-markdown text-[15px] leading-7 text-foreground">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, ...props }) => (
                <a {...props} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-3">
                  {children}
                </a>
              ),
              blockquote: ({ children }) => (
                <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground">
                  {children}
                </blockquote>
              ),
              code: ({ children, className, ...props }) => (
                <code
                  {...props}
                  className={`${className ?? ""} rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] break-words`}
                >
                  {children}
                </code>
              ),
              h1: ({ children }) => <h1 className="mt-7 mb-3 text-xl font-semibold">{children}</h1>,
              h2: ({ children }) => <h2 className="mt-6 mb-2 text-lg font-semibold">{children}</h2>,
              h3: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold">{children}</h3>,
              li: ({ children }) => <li className="my-1 pl-1">{children}</li>,
              ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
              p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
              pre: ({ children }) => (
                <pre className="my-4 overflow-x-auto rounded-xl bg-muted p-4 text-[13px] leading-6 [&_code]:bg-transparent [&_code]:p-0">
                  {children}
                </pre>
              ),
              table: ({ children }) => (
                <div className="my-4 overflow-x-auto rounded-lg ring-1 ring-border">
                  <table className="w-full border-collapse text-sm">{children}</table>
                </div>
              ),
              td: ({ children }) => <td className="border-t border-border px-3 py-2">{children}</td>,
              th: ({ children }) => <th className="bg-muted px-3 py-2 text-left font-medium">{children}</th>,
              ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      ) : running && isLast ? (
        <div className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground" role="status">
          <span className="size-1.5 animate-pulse rounded-full bg-current" />
          正在思考…
        </div>
      ) : null}

      {sources.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="引用来源">
          {sources.map((source, index) => (
            <a
              key={source.sourceId}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="max-w-64 truncate rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {index + 1}. {source.title || sourceLabel(source.url)}
            </a>
          ))}
        </div>
      ) : null}

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
