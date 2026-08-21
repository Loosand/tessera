/**
 * [INPUT]: 工具调用条目、AI SDK 工具状态、可选展开详情与文件变更摘要
 * [OUTPUT]: 数据驱动、键盘可达且支持悬浮 Diff 预览的 ToolChips 过程组件
 * [POS]: 设计系统中供单条或聚合工具调用复用的紧凑过程呈现模式
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { cn } from "@tessera/design-system/lib/utils"
import React, { type ComponentProps, type ReactNode, useEffect, useId, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowDown01Icon } from "./icons"
import { Button } from "./ui/button"
import { Icon } from "./ui/icon"

export type ToolChipStatus =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied"

export type ToolChipDiffLineTone = "context" | "added" | "removed"

export interface ToolChipDiffLine {
  text: string
  tone: ToolChipDiffLineTone
}

export interface ToolChipDiff {
  additions: number
  deletions: number
  file: string
  id: string
  lines?: readonly ToolChipDiffLine[]
}

export interface ToolChipItem {
  defaultExpanded?: boolean
  details?: ReactNode
  icon?: ReactNode
  id: string
  label: ReactNode
  meta?: ReactNode
  status: ToolChipStatus
  statusLabel: string
}

export type ToolChipsProps = Omit<ComponentProps<"section">, "children"> &
  Readonly<{
    defaultExpanded?: boolean
    diffs?: readonly ToolChipDiff[]
    items: readonly ToolChipItem[]
    moreDiffCount?: number
    onMoreDiffsClick?: (() => void) | undefined
    summary?: ReactNode
  }>

interface DiffPreviewState {
  diff: ToolChipDiff
  left: number
  top: number
}

const activeStatuses = new Set<ToolChipStatus>(["input-streaming", "input-available", "approval-responded"])

function statusClassName(status: ToolChipStatus) {
  if (status === "output-error" || status === "output-denied") return "text-destructive"
  if (status === "output-available") return "text-foreground"
  return "text-muted-foreground"
}

function ToolChipRowContent({ item, expanded }: { item: ToolChipItem; expanded: boolean }) {
  const expandable = item.details !== undefined && item.details !== null
  const active = activeStatuses.has(item.status)

  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center text-foreground/75"
      >
        {item.icon}
      </span>
      <span className="min-w-0 truncate font-medium text-foreground/85">{item.label}</span>
      {item.meta ? (
        <span className="min-w-0 truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {item.meta}
        </span>
      ) : null}
      <span
        aria-live="polite"
        className={cn(
          "ml-auto max-w-40 shrink-0 truncate text-[11px]",
          statusClassName(item.status),
          active && "tessera-loading-label bg-clip-text text-transparent",
        )}
        title={item.statusLabel}
      >
        {item.statusLabel}
      </span>
      {expandable ? (
        <Icon
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
          icon={ArrowDown01Icon}
          size={13}
        />
      ) : null}
    </>
  )
}

function DiffPreview({ preview }: { preview: DiffPreviewState }) {
  const lines = preview.diff.lines ?? []

  return (
    <div
      className="fixed z-50 w-[min(25rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
      role="tooltip"
      style={{ left: preview.left, top: preview.top }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <span className="min-w-0 truncate font-mono text-[11px] text-popover-foreground">
          {preview.diff.file}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          +{preview.diff.additions} / −{preview.diff.deletions}
        </span>
      </div>
      {lines.length > 0 ? (
        <div className="max-h-64 overflow-auto bg-code-background py-1 font-mono text-[10px] leading-5">
          {lines.map((line, index) => (
            <div
              className={cn(
                "grid grid-cols-[1.25rem_minmax(0,1fr)] px-2",
                line.tone === "added" && "bg-accent/75 text-accent-foreground",
                line.tone === "removed" && "bg-destructive/10 text-destructive",
                line.tone === "context" && "text-muted-foreground",
              )}
              key={`${preview.diff.id}-${line.tone}-${index}`}
            >
              <span className="select-none text-center opacity-60">
                {line.tone === "added" ? "+" : line.tone === "removed" ? "−" : ""}
              </span>
              <span className="whitespace-pre-wrap break-words">{line.text || " "}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">没有提供行级预览。</p>
      )}
    </div>
  )
}

export function ToolChips({
  className,
  defaultExpanded = true,
  diffs = [],
  items,
  moreDiffCount = 0,
  onMoreDiffsClick,
  summary,
  ...props
}: ToolChipsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [expandedRows, setExpandedRows] = useState(
    () => new Set(items.filter((item) => item.defaultExpanded).map((item) => item.id)),
  )
  const [preview, setPreview] = useState<DiffPreviewState | null>(null)
  const contentId = useId()
  const busy = items.some((item) => activeStatuses.has(item.status))
  const showContent = summary === undefined || expanded

  useEffect(() => {
    const idsToExpand = items.filter((item) => item.defaultExpanded).map((item) => item.id)
    if (idsToExpand.length === 0) return

    setExpandedRows((current) => {
      const next = new Set(current)
      let changed = false
      for (const id of idsToExpand) {
        if (next.has(id)) continue
        next.add(id)
        changed = true
      }
      return changed ? next : current
    })
  }, [items])

  function toggleRow(id: string) {
    setExpandedRows((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function showDiffPreview(diff: ToolChipDiff, element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const width = Math.min(400, viewportWidth - 24)
    const estimatedHeight = Math.min(300, 72 + (diff.lines?.length ?? 0) * 20)
    const left = Math.max(12, Math.min(viewportWidth - width - 12, rect.left + rect.width / 2 - width / 2))
    const above = rect.top - estimatedHeight - 8
    const top = above >= 12 ? above : Math.min(viewportHeight - estimatedHeight - 12, rect.bottom + 8)
    setPreview({ diff, left, top: Math.max(12, top) })
  }

  const content = (
    <div
      aria-hidden={!showContent}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none",
        showContent ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      id={contentId}
      inert={!showContent}
    >
      <div className="overflow-hidden">
        <div className={cn("space-y-1", summary && "mt-1 ml-[7px] border-l border-border py-1 pl-[22px]")}>
          {items.map((item) => {
            const rowExpanded = expandedRows.has(item.id)
            const expandable = item.details !== undefined && item.details !== null
            const rowContent = <ToolChipRowContent expanded={rowExpanded} item={item} />

            return (
              <div data-state={item.status} key={item.id}>
                {expandable ? (
                  <Button
                    aria-expanded={rowExpanded}
                    className="group/tool-chip h-auto w-full justify-start gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/70"
                    onClick={() => toggleRow(item.id)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {rowContent}
                  </Button>
                ) : (
                  <div className="flex min-h-7 items-center gap-2 px-2 py-1.5 text-xs">{rowContent}</div>
                )}

                {expandable ? (
                  <div
                    aria-hidden={!rowExpanded}
                    className={cn(
                      "grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none",
                      rowExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                    )}
                    inert={!rowExpanded}
                  >
                    <div className="overflow-hidden">
                      <div className="ml-8 border-l border-border px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                        {item.details}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}

          {diffs.length > 0 || moreDiffCount > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 px-2 pt-1">
              {diffs.map((diff) => (
                <button
                  aria-expanded={preview?.diff.id === diff.id}
                  aria-label={`${diff.file}，增加 ${diff.additions} 行，删除 ${diff.deletions} 行`}
                  className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  key={diff.id}
                  onBlur={() => setPreview(null)}
                  onFocus={(event) => showDiffPreview(diff, event.currentTarget)}
                  onMouseEnter={(event) => showDiffPreview(diff, event.currentTarget)}
                  onMouseLeave={() => setPreview(null)}
                  type="button"
                >
                  <span className="inline-block max-w-36 truncate align-bottom">{diff.file}</span>
                  <span className="ml-1.5">+{diff.additions}</span>
                  <span className="ml-1 text-destructive">−{diff.deletions}</span>
                </button>
              ))}
              {moreDiffCount > 0 ? (
                <Button
                  className="h-6 px-2 text-[10px] text-muted-foreground"
                  disabled={!onMoreDiffsClick}
                  onClick={onMoreDiffsClick}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  另有 {moreDiffCount} 个文件
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )

  return (
    <section
      {...props}
      aria-busy={busy}
      className={cn("my-3 max-w-2xl text-muted-foreground", className)}
      data-slot="tool-chips"
    >
      {summary !== undefined ? (
        <Button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="-ml-1 h-auto gap-2 px-1 py-1 text-[13px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          onClick={() => setExpanded((current) => !current)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span className="font-medium text-foreground/85">{summary}</span>
          <Icon
            aria-hidden="true"
            className={cn(
              "transition-transform duration-200 motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
            icon={ArrowDown01Icon}
            size={14}
          />
        </Button>
      ) : null}
      {content}
      {preview && typeof document !== "undefined"
        ? createPortal(<DiffPreview preview={preview} />, document.body)
        : null}
    </section>
  )
}
