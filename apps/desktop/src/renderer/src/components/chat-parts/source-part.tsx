/**
 * [INPUT]: AI SDK 消息中的 URL/文档来源 Part 与 URL 来源显示策略
 * [OUTPUT]: 可排除已由搜索轨迹消费 URL 的去重轻量来源入口
 * [POS]: ChatMessage 内的来源呈现单元
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"

type MessagePart = UIMessage["parts"][number]
type SourceMessagePart = Extract<MessagePart, { type: "source-document" | "source-url" }>

interface SourcePartProps {
  includeUrlSources?: boolean
  parts: readonly MessagePart[]
  streaming: boolean
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function sourceKey(source: SourceMessagePart) {
  return source.type === "source-url" ? source.url : `${source.sourceId}:${source.filename ?? source.title}`
}

export function SourcePart({ includeUrlSources = true, parts, streaming }: SourcePartProps) {
  const sources = parts.filter(
    (part): part is SourceMessagePart =>
      part.type === "source-document" || (includeUrlSources && part.type === "source-url"),
  )
  const uniqueSources = [...new Map(sources.map((source) => [sourceKey(source), source])).values()]

  if (uniqueSources.length === 0) return null

  return (
    <div className="mt-4 flex flex-wrap gap-2" aria-label="引用来源" aria-busy={streaming}>
      {uniqueSources.map((source, index) => {
        const label = source.type === "source-url" ? source.title || sourceLabel(source.url) : source.title
        const className =
          "max-w-64 truncate rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground"

        return source.type === "source-url" ? (
          <a
            key={sourceKey(source)}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className={`${className} hover:text-foreground`}
          >
            {index + 1}. {label}
          </a>
        ) : (
          <span key={sourceKey(source)} className={className} title={source.filename}>
            {index + 1}. {label}
          </span>
        )
      })}
    </div>
  )
}
