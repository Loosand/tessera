/**
 * [INPUT]: 冻结的 Agent Markdown 变更预览、AI SDK 审批状态与文件跳转/批准/拒绝回调
 * [OUTPUT]: 复用文档 Markdown 渲染的结果预览、逐行高亮 Diff、冲突信息和人工审批操作
 * [POS]: ChatMessage 写工具 Part 内的人机协作审查表面
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AgentChangePreview } from "@tessera/contracts"
import { EyeIcon, SourceCodeIcon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { diffLines } from "diff"
import { useEffect, useMemo, useState } from "react"
import { ChatMarkdown } from "./chat-markdown"

const MAX_RENDERED_DIFF_LINES = 2_000

type AgentChangeReviewProps = {
  readonly approvalId: string
  readonly canDecide: boolean
  readonly loadPreview: (approvalId: string) => Promise<AgentChangePreview>
  readonly onDecision: (approved: boolean) => void
  readonly onOpenDocument?: ((path: string) => void) | undefined
}

interface DiffRow {
  kind: "added" | "removed" | "unchanged"
  newLine: number | null
  oldLine: number | null
  text: string
}

function segmentLines(value: string) {
  const lines = value.split("\n")
  if (value.endsWith("\n")) lines.pop()
  return lines
}

function createDiffRows(previous: string, next: string) {
  const rows: DiffRow[] = []
  let oldLine = 1
  let newLine = 1
  for (const change of diffLines(previous, next)) {
    const kind = change.added ? "added" : change.removed ? "removed" : "unchanged"
    for (const text of segmentLines(change.value)) {
      rows.push({
        kind,
        oldLine: kind === "added" ? null : oldLine,
        newLine: kind === "removed" ? null : newLine,
        text,
      })
      if (kind !== "added") oldLine += 1
      if (kind !== "removed") newLine += 1
    }
  }
  return rows
}

function DiffView({ preview }: { preview: AgentChangePreview }) {
  const rows = useMemo(
    () => createDiffRows(preview.baseContent, preview.proposedContent),
    [preview.baseContent, preview.proposedContent],
  )
  const visibleRows = rows.slice(0, MAX_RENDERED_DIFF_LINES)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-code-background font-mono text-[11px] leading-5">
      <div className="max-h-96 overflow-auto py-1">
        {visibleRows.map((row, index) => (
          <div
            key={`${row.kind}-${row.oldLine ?? "x"}-${row.newLine ?? "x"}-${index}`}
            className={`grid grid-cols-[3rem_3rem_1.25rem_minmax(0,1fr)] px-2 ${
              row.kind === "added"
                ? "bg-accent/75 text-accent-foreground"
                : row.kind === "removed"
                  ? "bg-destructive/10 text-destructive"
                  : "text-muted-foreground"
            }`}
          >
            <span className="select-none text-right opacity-55">{row.oldLine ?? ""}</span>
            <span className="select-none text-right opacity-55">{row.newLine ?? ""}</span>
            <span className="select-none text-center">
              {row.kind === "added" ? "+" : row.kind === "removed" ? "−" : ""}
            </span>
            <span className="whitespace-pre-wrap break-words">{row.text || " "}</span>
          </div>
        ))}
      </div>
      {rows.length > MAX_RENDERED_DIFF_LINES ? (
        <p className="border-t border-border px-3 py-2 text-muted-foreground">
          Diff 较长，仅展示前 {MAX_RENDERED_DIFF_LINES} 行；批准仍针对完整候选内容。
        </p>
      ) : null}
    </div>
  )
}

export function AgentChangeReview({
  approvalId,
  canDecide,
  loadPreview,
  onDecision,
  onOpenDocument,
}: AgentChangeReviewProps) {
  const [preview, setPreview] = useState<AgentChangePreview | null>(null)
  const [error, setError] = useState("")
  const [view, setView] = useState<"preview" | "diff">("diff")

  useEffect(() => {
    let active = true
    setError("")
    void loadPreview(approvalId)
      .then((result) => {
        if (active) setPreview(result)
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "无法读取变更预览。")
      })
    return () => {
      active = false
    }
  }, [approvalId, loadPreview])

  if (error) {
    return <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
  }
  if (!preview) {
    return <p className="mt-2 rounded-lg bg-muted px-3 py-3 text-xs text-muted-foreground">正在准备 Diff…</p>
  }

  const added = diffLines(preview.baseContent, preview.proposedContent)
    .filter((change) => change.added)
    .reduce((total, change) => total + (change.count ?? 0), 0)
  const removed = diffLines(preview.baseContent, preview.proposedContent)
    .filter((change) => change.removed)
    .reduce((total, change) => total + (change.count ?? 0), 0)

  return (
    <section className="mt-2 overflow-hidden rounded-xl border border-border bg-background text-foreground">
      <div className="flex items-start justify-between gap-3 border-b border-border px-3.5 py-3">
        <div className="min-w-0">
          <button
            type="button"
            className="max-w-full truncate text-left text-sm font-medium underline-offset-3 hover:underline"
            onClick={() => onOpenDocument?.(preview.path)}
          >
            {preview.path}
          </button>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{preview.reason}</p>
        </div>
        <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          {preview.operation === "create" ? "新建文档" : "更新文档"}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 px-3.5 py-2">
        <div className="flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="变更查看方式">
          <label className="cursor-pointer">
            <input
              type="radio"
              name={`agent-change-view-${approvalId}`}
              value="diff"
              checked={view === "diff"}
              onChange={() => setView("diff")}
              className="sr-only"
            />
            <span
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${view === "diff" ? "bg-background shadow-xs" : "text-muted-foreground"}`}
            >
              <Icon icon={SourceCodeIcon} size={12} /> Diff
            </span>
          </label>
          <label className="cursor-pointer">
            <input
              type="radio"
              name={`agent-change-view-${approvalId}`}
              value="preview"
              checked={view === "preview"}
              onChange={() => setView("preview")}
              className="sr-only"
            />
            <span
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${view === "preview" ? "bg-background shadow-xs" : "text-muted-foreground"}`}
            >
              <Icon icon={EyeIcon} size={12} /> 文档预览
            </span>
          </label>
        </div>
        <span className="text-[11px] text-muted-foreground">
          +{added} / −{removed}
        </span>
      </div>

      <div className="px-3.5 pb-3">
        {view === "diff" ? (
          <DiffView preview={preview} />
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border border-border px-4 py-3">
            <ChatMarkdown className="text-sm leading-6">{preview.proposedContent}</ChatMarkdown>
          </div>
        )}
      </div>

      {canDecide && preview.status === "pending" ? (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/35 px-3.5 py-2.5">
          <p className="text-[11px] text-muted-foreground">确认后主进程仍会复核磁盘版本，再原子写入。</p>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" size="xs" onClick={() => onDecision(false)}>
              拒绝
            </Button>
            <Button type="button" size="xs" onClick={() => onDecision(true)}>
              确认更改
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
