/**
 * [INPUT]: 当前任务运行状态、可选的本轮单调时钟区间、是否存在可展开过程与现有结构化过程 UI
 * [OUTPUT]: “已工作”统一折叠区块和消息流末尾常驻的闪烁“正在处理”状态
 * [POS]: ChatMessage 与 TaskPage 共享的整轮运行反馈模式
 * [DOC]: design.md、docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { ArrowDown01Icon, SparklesIcon } from "@tessera/design-system/components/icons"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React, { type ReactNode, useEffect, useRef, useState } from "react"

export type TaskRunTiming = Readonly<{
  completedAt: number | null
  startedAt: number
}>

type TaskWorkTraceProps = Readonly<{
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

export function TaskWorkTrace({ children, hasDetails, running, timing }: TaskWorkTraceProps) {
  const [expanded, setExpanded] = useState(running && hasDetails)
  const wasRunningRef = useRef(running)
  const elapsed = useElapsed(timing, running)

  useEffect(() => {
    if (running && !wasRunningRef.current && hasDetails) setExpanded(true)
    if (!running && wasRunningRef.current) setExpanded(false)
    wasRunningRef.current = running
  }, [hasDetails, running])

  const label = timing ? `已工作 ${formatElapsed(elapsed)}` : "工作过程"
  const header = (
    <>
      <Icon icon={SparklesIcon} size={15} className="shrink-0" />
      <span>{label}</span>
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

      {hasDetails && expanded ? (
        <div className="mt-1 ml-[7px] border-l border-border pl-[22px]">{children}</div>
      ) : null}
    </section>
  )
}

export function TaskRunStatus() {
  const elapsed = useElapsed(null, true)

  return (
    <output
      className="flex w-fit items-center gap-2 py-1 text-[13px] text-muted-foreground"
      data-slot="task-run-status"
      aria-label="任务仍在处理"
    >
      <span className="relative flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-foreground/8 motion-safe:animate-ping" />
        <Icon icon={SparklesIcon} size={15} className="relative motion-safe:animate-pulse" />
      </span>
      <span aria-hidden="true" className="font-medium">
        正在处理
      </span>
      <span aria-hidden="true" className="font-mono text-[12px] tabular-nums">
        {formatElapsed(elapsed)}
      </span>
    </output>
  )
}
