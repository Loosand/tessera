/**
 * [INPUT]: AI SDK 单个 reasoning 生命周期/摘要 Part 及当前回复流式状态
 * [OUTPUT]: 始终可见的真实思考阶段；有摘要时以无时间线布局展开、计时、限高滚动并渲染 Markdown，无摘要时不伪造正文
 * [POS]: ChatMessage 内按原始 Part 顺序呈现的 reasoning 单元
 * [DOC]: design.md、docs/architecture/ai-observability.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import { ArrowDown01Icon, BrainCircuitIcon } from "@tessera/design-system/components/icons"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React, { useEffect, useRef, useState } from "react"
import { ChatMarkdown } from "./chat-markdown"

type ReasoningMessagePart = Extract<UIMessage["parts"][number], { type: "reasoning" }>

type ReasoningPartProps = {
  readonly part: ReasoningMessagePart
  readonly streaming: boolean
}

function reasoningLabel(streaming: boolean, elapsedSeconds: number) {
  if (streaming) return elapsedSeconds > 0 ? `思考中 ${elapsedSeconds} 秒` : "思考中"
  return elapsedSeconds > 0 ? `思考了 ${elapsedSeconds} 秒` : "思考完成"
}

export function ReasoningPart({ part, streaming }: ReasoningPartProps) {
  const [expanded, setExpanded] = useState(true)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const contentRef = useRef<HTMLElement>(null)
  const followTailRef = useRef(true)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (startedAtRef.current === null) startedAtRef.current = performance.now()
    const updateElapsed = () => {
      const startedAt = startedAtRef.current
      if (startedAt === null) return
      setElapsedSeconds(Math.max(0, Math.floor((performance.now() - startedAt) / 1_000)))
    }
    updateElapsed()
    if (!streaming) return

    const timer = window.setInterval(updateElapsed, 1_000)
    return () => window.clearInterval(timer)
  }, [streaming])

  useEffect(() => {
    const content = contentRef.current
    const markdown = content?.firstElementChild
    if (!content || !markdown || !expanded || !streaming) return

    const followTail = () => {
      if (followTailRef.current) content.scrollTop = content.scrollHeight
    }
    followTail()
    const observer = new ResizeObserver(followTail)
    observer.observe(markdown)
    return () => observer.disconnect()
  }, [expanded, streaming])

  const toggleExpanded = () => {
    setExpanded((current) => {
      if (!current) followTailRef.current = true
      return !current
    })
  }

  const hasBody = part.text.trim().length > 0

  if (!hasBody) {
    return (
      <section aria-busy={streaming} aria-label="模型思考阶段" className="my-3 text-muted-foreground">
        <div className="flex items-center gap-2 py-1 text-sm">
          <Icon icon={BrainCircuitIcon} size={15} />
          <span>{reasoningLabel(streaming, elapsedSeconds)}</span>
        </div>
      </section>
    )
  }

  return (
    <section className="my-3 text-muted-foreground" aria-busy={streaming}>
      <button
        type="button"
        className="flex items-center gap-2 rounded-md py-1 text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        onClick={toggleExpanded}
      >
        <Icon icon={BrainCircuitIcon} size={15} />
        <span>{reasoningLabel(streaming, elapsedSeconds)}</span>
        <Icon
          icon={ArrowDown01Icon}
          size={14}
          className={`transition-transform duration-200 ${expanded ? "" : "-rotate-90"}`}
        />
      </button>
      {expanded ? (
        <div className="mt-2 pl-[23px]">
          <section
            aria-label="模型思考过程"
            className="max-h-48 overflow-y-auto pr-2 [scrollbar-gutter:stable] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onScroll={(event) => {
              const content = event.currentTarget
              followTailRef.current = content.scrollHeight - content.scrollTop - content.clientHeight <= 24
            }}
            ref={contentRef}
          >
            <ChatMarkdown compact className="text-[13px] leading-6 text-muted-foreground/90">
              {part.text}
            </ChatMarkdown>
          </section>
        </div>
      ) : null}
    </section>
  )
}
