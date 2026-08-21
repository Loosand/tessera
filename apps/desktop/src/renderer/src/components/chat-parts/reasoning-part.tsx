/**
 * [INPUT]: AI SDK 单个 reasoning Part 及当前回复流式状态
 * [OUTPUT]: 可展开、计时并渲染 Markdown 语义的模型思考过程块
 * [POS]: ChatMessage 内按原始 Part 顺序呈现的 reasoning 单元
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import { ArrowDown01Icon, BrainCircuitIcon } from "@tessera/design-system/components/icons"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { useEffect, useRef, useState } from "react"
import { ChatMarkdown } from "./chat-markdown"

type ReasoningMessagePart = Extract<UIMessage["parts"][number], { type: "reasoning" }>

interface ReasoningPartProps {
  part: ReasoningMessagePart
  streaming: boolean
}

function reasoningLabel(streaming: boolean, elapsedSeconds: number) {
  if (streaming) return elapsedSeconds > 0 ? `思考中 ${elapsedSeconds} 秒` : "思考中"
  return elapsedSeconds > 0 ? `思考了 ${elapsedSeconds} 秒` : "思考完成"
}

export function ReasoningPart({ part, streaming }: ReasoningPartProps) {
  const [expanded, setExpanded] = useState(true)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
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

  return (
    <section className="my-3 text-muted-foreground" aria-busy={streaming}>
      <button
        type="button"
        className="flex items-center gap-2 rounded-md py-1 text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
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
        <div className="mt-2 ml-[7px] border-l border-border pl-[23px]">
          <ChatMarkdown compact className="text-[13px] leading-6 text-muted-foreground/90">
            {part.text || (streaming ? "正在生成思考过程…" : "模型未返回可展示的思考文本。")}
          </ChatMarkdown>
        </div>
      ) : null}
    </section>
  )
}
