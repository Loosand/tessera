/**
 * [INPUT]: AI SDK 单个 text Part 及其流式状态
 * [OUTPUT]: 保留 Part 边界的 Markdown 正文与增量光标
 * [POS]: ChatMessage 内的助手正文呈现单元
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type TextMessagePart = Extract<UIMessage["parts"][number], { type: "text" }>

interface TextPartProps {
  part: TextMessagePart
  streaming: boolean
}

export function TextPart({ part, streaming }: TextPartProps) {
  if (!part.text) return null

  return (
    <div
      className="chat-markdown text-[15px] leading-7 text-foreground"
      data-streaming={streaming || undefined}
      aria-busy={streaming}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline underline-offset-3"
            >
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
        {part.text}
      </ReactMarkdown>
      {streaming ? (
        <span
          className="ml-0.5 inline-block h-[1em] w-px translate-y-0.5 animate-pulse bg-current align-baseline"
          aria-hidden="true"
        />
      ) : null}
    </div>
  )
}
