/**
 * [INPUT]: 同一助手消息中的 read-web-source、record-research-evidence、recommend-research-sources、finalize-research 标准 Tool Parts，以及研究笔记读取/来源保存回调
 * [OUTPUT]: 由真实工具结果聚合的阅读、失败、证据、问题覆盖、增量笔记、来源选择保存与完成状态卡片
 * [POS]: 研究计划和联网搜索之后的领域进度呈现，不从模型旁白推断状态
 * [DOC]: design.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  type UIMessagePart,
  type UIMessageToolPart,
  isUIMessageToolPart,
  uiMessageToolName,
} from "@tessera/ai/react"
import {
  FINALIZE_RESEARCH_TOOL_NAME,
  READ_WEB_SOURCE_TOOL_NAME,
  RECOMMEND_RESEARCH_SOURCES_TOOL_NAME,
  RECORD_RESEARCH_EVIDENCE_TOOL_NAME,
  type TaskResearchNotebook,
  type TaskResearchSaveSourcesResult,
} from "@tessera/contracts"
import { Button } from "@tessera/design-system/components/ui/button"
import React, { useEffect, useRef, useState } from "react"
import { TextPart } from "./text-part"

type MessagePart = UIMessagePart
type ToolPart = UIMessageToolPart

const RESEARCH_TOOL_NAMES = new Set<string>([
  READ_WEB_SOURCE_TOOL_NAME,
  RECORD_RESEARCH_EVIDENCE_TOOL_NAME,
  RECOMMEND_RESEARCH_SOURCES_TOOL_NAME,
  FINALIZE_RESEARCH_TOOL_NAME,
])

function toolName(part: ToolPart) {
  return uiMessageToolName(part)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function isResearchActivityToolPart(part: MessagePart): part is ToolPart {
  return isUIMessageToolPart(part) && RESEARCH_TOOL_NAMES.has(toolName(part))
}

export type ResearchActivitySummary = Readonly<{
  active: boolean
  evidenceCount: number
  finalizeStatus: "blocked" | "completed" | "partial" | null
  questionCounts: Readonly<{ covered: number; partial: number; pending: number; uncovered: number }> | null
  readCount: number
  recommendations: readonly Readonly<{
    finalUrl: string
    reason: string
    saved: boolean
    sourceId: string
    title: string
  }>[]
  requestId: string | null
  sourceCounts: Readonly<{
    discovered: number
    read: number
    reading: number
    shortlisted: number
    unusable: number
  }> | null
  sources: readonly Readonly<{
    detail?: string
    label: string
    status: "failed" | "read" | "reading"
  }>[]
  unusableCount: number
}>

export function collectResearchActivity(parts: readonly MessagePart[]): ResearchActivitySummary {
  let active = false
  let evidenceCount = 0
  let finalizeStatus: ResearchActivitySummary["finalizeStatus"] = null
  let questionCounts: ResearchActivitySummary["questionCounts"] = null
  let sourceCounts: ResearchActivitySummary["sourceCounts"] = null
  let requestId: string | null = null
  const recommendations = new Map<
    string,
    { finalUrl: string; reason: string; saved: boolean; sourceId: string; title: string }
  >()
  const sources = new Map<string, { detail?: string; label: string; status: "failed" | "read" | "reading" }>()

  for (const part of parts.filter(isResearchActivityToolPart)) {
    const name = toolName(part)
    const output = "output" in part ? record(part.output) : null
    const input = "input" in part ? record(part.input) : null
    if (typeof output?.requestId === "string") requestId = output.requestId
    if (
      ["input-streaming", "input-available", "approval-requested", "approval-responded"].includes(part.state)
    ) {
      active = true
    }
    if (name === READ_WEB_SOURCE_TOOL_NAME) {
      // SDK/供应商级工具错误不是已经尝试过的网页，不能伪装成一个“不可用来源”。
      if (part.state === "output-error") continue
      let label = typeof output?.title === "string" ? output.title : ""
      const url =
        typeof output?.finalUrl === "string"
          ? output.finalUrl
          : typeof input?.url === "string"
            ? input.url
            : ""
      if (!label && url) {
        try {
          label = new URL(url).hostname
        } catch {
          label = url
        }
      }
      const status = output?.status === "read" ? "read" : output?.status === "unusable" ? "failed" : "reading"
      const key = typeof output?.sourceId === "string" ? output.sourceId : url || part.toolCallId
      const detail =
        status === "failed" && typeof output?.error === "string" ? output.error.slice(0, 160) : undefined
      sources.set(key, { label: label || "网页来源", status, ...(detail ? { detail } : {}) })
    }
    if (name === RECORD_RESEARCH_EVIDENCE_TOOL_NAME && output?.status === "recorded") evidenceCount += 1
    if (name === RECOMMEND_RESEARCH_SOURCES_TOOL_NAME && output?.status === "recommended") {
      if (typeof output.requestId === "string") requestId = output.requestId
      if (Array.isArray(output.recommendations)) {
        for (const value of output.recommendations) {
          const recommendation = record(value)
          if (
            typeof recommendation?.sourceId !== "string" ||
            typeof recommendation.finalUrl !== "string" ||
            typeof recommendation.reason !== "string"
          ) {
            continue
          }
          recommendations.set(recommendation.sourceId, {
            sourceId: recommendation.sourceId,
            finalUrl: recommendation.finalUrl,
            reason: recommendation.reason,
            saved: recommendation.saved === true,
            title: typeof recommendation.title === "string" ? recommendation.title : recommendation.finalUrl,
          })
        }
      }
    }
    if (name === FINALIZE_RESEARCH_TOOL_NAME) {
      if (output?.status === "blocked" || output?.status === "completed" || output?.status === "partial") {
        finalizeStatus = output.status
      }
      const progress = record(output?.progress)
      const rawQuestions = record(progress?.questionCounts)
      const rawSources = record(progress?.sourceCounts)
      if (rawQuestions) {
        questionCounts = {
          pending: Number(rawQuestions.pending ?? 0),
          covered: Number(rawQuestions.covered ?? 0),
          partial: Number(rawQuestions.partial ?? 0),
          uncovered: Number(rawQuestions.uncovered ?? 0),
        }
      }
      if (rawSources) {
        sourceCounts = {
          discovered: Number(rawSources.discovered ?? 0),
          shortlisted: Number(rawSources.shortlisted ?? 0),
          reading: Number(rawSources.reading ?? 0),
          read: Number(rawSources.read ?? 0),
          unusable: Number(rawSources.unusable ?? 0),
        }
      }
      if (typeof progress?.evidenceCount === "number") evidenceCount = progress.evidenceCount
    }
  }
  const sourceValues = [...sources.values()]
  return {
    active,
    evidenceCount,
    finalizeStatus,
    questionCounts,
    readCount: sourceCounts?.read ?? sourceValues.filter((source) => source.status === "read").length,
    recommendations: [...recommendations.values()],
    requestId,
    sourceCounts,
    sources: sourceValues,
    unusableCount:
      sourceCounts?.unusable ?? sourceValues.filter((source) => source.status === "failed").length,
  }
}

const sourceStatusLabels = { reading: "读取中", read: "已阅读", failed: "不可用" } as const

export function ResearchActivityPart({
  onReadNotebook,
  onSaveRecommendations,
  parts,
  streaming,
}: Readonly<{
  onReadNotebook?: ((requestId: string) => Promise<TaskResearchNotebook | null>) | undefined
  onSaveRecommendations?:
    | ((requestId: string, sourceIds: string[]) => Promise<TaskResearchSaveSourcesResult>)
    | undefined
  parts: readonly MessagePart[]
  streaming: boolean
}>) {
  const summary = collectResearchActivity(parts)
  const mountedRef = useRef(false)
  const [notebook, setNotebook] = useState<TaskResearchNotebook | null>(null)
  const [notebookVisible, setNotebookVisible] = useState(false)
  const [notebookLoading, setNotebookLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  const [unselectedSourceIds, setUnselectedSourceIds] = useState<ReadonlySet<string>>(() => new Set())
  const [savedSourceIds, setSavedSourceIds] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const selectedSourceIds = summary.recommendations
    .filter(
      (recommendation) =>
        !recommendation.saved &&
        !savedSourceIds.has(recommendation.sourceId) &&
        !unselectedSourceIds.has(recommendation.sourceId),
    )
    .map((recommendation) => recommendation.sourceId)
  const finalLabel =
    summary.finalizeStatus === "completed"
      ? "研究完成"
      : summary.finalizeStatus === "partial"
        ? "部分完成"
        : summary.finalizeStatus === "blocked"
          ? "等待补证"
          : summary.active || streaming
            ? "研究中"
            : "已暂停"
  const questionTotal = summary.questionCounts
    ? Object.values(summary.questionCounts).reduce((total, count) => total + count, 0)
    : 0
  const discoveredTotal = summary.sourceCounts
    ? Object.values(summary.sourceCounts).reduce((total, count) => total + count, 0)
    : null

  const toggleNotebook = async () => {
    if (notebook) {
      setNotebookVisible((visible) => !visible)
      return
    }
    if (!summary.requestId || !onReadNotebook || notebookLoading) return
    setNotebookLoading(true)
    setNotice("")
    try {
      const nextNotebook = await onReadNotebook(summary.requestId)
      if (!mountedRef.current) return
      setNotebook(nextNotebook)
      setNotebookVisible(Boolean(nextNotebook))
      if (!nextNotebook) setNotice("研究笔记暂时不可用。")
    } catch (error) {
      if (mountedRef.current) setNotice(error instanceof Error ? error.message : "读取研究笔记失败。")
    } finally {
      if (mountedRef.current) setNotebookLoading(false)
    }
  }

  const saveRecommendations = async () => {
    if (!summary.requestId || !onSaveRecommendations || selectedSourceIds.length === 0 || saving) return
    setSaving(true)
    setNotice("")
    try {
      const result = await onSaveRecommendations(summary.requestId, selectedSourceIds)
      if (!mountedRef.current) return
      if (!result.ok) {
        setNotice(result.error)
        return
      }
      setSavedSourceIds((current) => new Set([...current, ...result.savedSourceIds]))
      setNotice(result.artifact ? `已保存为「${result.artifact.document.title}」。` : "来源已经保存。")
    } catch (error) {
      if (mountedRef.current) setNotice(error instanceof Error ? error.message : "保存研究来源失败。")
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  return (
    <section
      className="my-3 rounded-xl border border-border bg-card/70 px-3.5 py-3 text-xs"
      aria-label="研究进度"
      aria-busy={summary.active || streaming}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-foreground">研究进度</p>
        <span className="text-[11px] text-muted-foreground">{finalLabel}</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
        {discoveredTotal === null ? "" : `已发现 ${discoveredTotal} 个来源 · `}已阅读 {summary.readCount}{" "}
        个来源
        {summary.unusableCount > 0 ? ` · ${summary.unusableCount} 个不可用` : ""} · 已登记{" "}
        {summary.evidenceCount} 条证据
        {summary.questionCounts ? ` · 覆盖 ${summary.questionCounts.covered}/${questionTotal} 个问题` : ""}
      </p>
      {summary.sources.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {summary.sources.map((source, index) => (
            <li key={`${source.label}-${index}`} className="flex min-w-0 items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-foreground/80">{source.label}</span>
                {source.detail ? (
                  <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                    {source.detail}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {sourceStatusLabels[source.status]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {summary.recommendations.length > 0 ? (
        <div className="mt-3 border-t border-border/70 pt-3">
          <p className="font-medium text-foreground">推荐保存的来源</p>
          <ul className="mt-2 space-y-2">
            {summary.recommendations.map((recommendation) => {
              const saved = recommendation.saved || savedSourceIds.has(recommendation.sourceId)
              const checked = saved || !unselectedSourceIds.has(recommendation.sourceId)
              return (
                <li key={recommendation.sourceId} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-3.5 accent-foreground"
                    aria-label={`选择保存 ${recommendation.title}`}
                    checked={checked}
                    disabled={saved || saving}
                    onChange={(event) =>
                      setUnselectedSourceIds((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.delete(recommendation.sourceId)
                        else next.add(recommendation.sourceId)
                        return next
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <a
                      className="block truncate text-foreground/85 underline-offset-2 hover:underline"
                      href={recommendation.finalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {recommendation.title}
                    </a>
                    <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                      {recommendation.reason}
                    </span>
                  </span>
                  {saved ? <span className="shrink-0 text-[10px] text-muted-foreground">已保存</span> : null}
                </li>
              )
            })}
          </ul>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {onSaveRecommendations ? (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                disabled={selectedSourceIds.length === 0 || saving}
                onClick={() => void saveRecommendations()}
              >
                {saving
                  ? "保存中…"
                  : `保存所选来源${selectedSourceIds.length > 0 ? `（${selectedSourceIds.length}）` : ""}`}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {onReadNotebook && summary.requestId ? (
        <div className={summary.recommendations.length > 0 ? "mt-2" : "mt-3 border-t border-border/70 pt-3"}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={notebookLoading}
            aria-expanded={notebookVisible}
            onClick={() => void toggleNotebook()}
          >
            {notebookLoading ? "读取笔记中…" : notebookVisible ? "收起研究笔记" : "查看研究笔记"}
          </Button>
        </div>
      ) : null}
      {notebookVisible && notebook ? (
        <div className="mt-3 max-h-96 overflow-auto rounded-lg bg-muted/60 px-3 py-2.5">
          <TextPart part={{ type: "text", text: notebook.markdown, state: "done" }} streaming={false} />
        </div>
      ) : null}
      {notice ? (
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground" aria-live="polite">
          {notice}
        </p>
      ) : null}
    </section>
  )
}
