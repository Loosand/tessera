/**
 * [INPUT]: 当前任务运行状态、事实活动标签、已收口动作数、可选的本轮单调时钟区间、是否存在可展开过程与现有结构化过程 UI
 * [OUTPUT]: 不读取 reasoning 正文的当前 Progress、像素网格与完成后默认折叠的统一过程区块
 * [POS]: ChatMessage 使用的整轮工作过程反馈模式
 * [DOC]: design.md、docs/architecture/agent-product-feedback-layer.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { ArrowDown01Icon } from "@tessera/design-system/components/icons"
import { LoadingStateGrid } from "@tessera/design-system/components/loading-state"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React, { type ReactNode, useEffect, useRef, useState } from "react"

export type TaskRunTiming = Readonly<{
  completedAt: number | null
  startedAt: number
}>

type TaskWorkTraceProps = Readonly<{
  actionCount?: number
  activityLabel?: string | undefined
  children: ReactNode
  hasDetails: boolean
  running: boolean
  timing: TaskRunTiming | null
}>

function monotonicNow() {
  return typeof performance === "undefined" ? 0 : performance.now()
}

function formatElapsed(elapsedMilliseconds: number) {
  const totalSeconds = Math.max(0, elapsedMilliseconds) / 1_000
  if (totalSeconds < 10) return `${totalSeconds.toFixed(1)}s`
  if (totalSeconds < 60) return `${Math.floor(totalSeconds)}s`
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes}m ${Math.floor(totalSeconds % 60)}s`
}

function useElapsed(timing: TaskRunTiming | null, active: boolean) {
  const fallbackStartedAtRef = useRef(monotonicNow())
  const [now, setNow] = useState(monotonicNow)
  const startedAt = timing?.startedAt ?? fallbackStartedAtRef.current
  const completedAt = timing?.completedAt ?? null

  useEffect(() => {
    if (!active || completedAt !== null) return
    const timer = window.setInterval(() => setNow(monotonicNow()), 100)
    return () => window.clearInterval(timer)
  }, [active, completedAt])

  return Math.max(0, (completedAt ?? now) - startedAt)
}

export function TaskWorkTrace({
  actionCount = 0,
  activityLabel,
  children,
  hasDetails,
  running,
  timing,
}: TaskWorkTraceProps) {
  const [expanded, setExpanded] = useState(running && hasDetails)
  const wasRunningRef = useRef(running)
  const elapsed = useElapsed(timing, running)

  useEffect(() => {
    if (running && !wasRunningRef.current && hasDetails) setExpanded(true)
    if (!running && wasRunningRef.current) setExpanded(false)
    wasRunningRef.current = running
  }, [hasDetails, running])

  const elapsedLabel = timing ? ` · ${formatElapsed(elapsed)}` : ""
  const label = running
    ? `${activityLabel ?? "正在工作"}${elapsedLabel}`
    : `${actionCount > 0 ? `已完成 ${actionCount} 个动作` : "已完成工作"}${elapsedLabel}`
  const header = (
    <>
      <LoadingStateGrid active={running} />
      <span
        className={running ? "tessera-loading-label bg-clip-text text-transparent" : "text-muted-foreground"}
      >
        {label}
      </span>
      {hasDetails ? (
        <Icon
          icon={ArrowDown01Icon}
          size={13}
          className={`shrink-0 transition-transform duration-200 ${expanded ? "" : "-rotate-90"}`}
        />
      ) : null}
    </>
  )

  return (
    <section className="my-3 text-muted-foreground" aria-label="执行过程" aria-busy={running}>
      {hasDetails ? (
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg py-1 text-[13px] font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-2 py-1 text-[13px] font-medium">{header}</div>
      )}

      {hasDetails && expanded ? <div className="mt-1 pl-[22px]">{children}</div> : null}
    </section>
  )
}
