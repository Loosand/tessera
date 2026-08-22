/**
 * [INPUT]: 同一助手消息中的 read-web-source、record-research-evidence、finalize-research 标准 Tool Parts
 * [OUTPUT]: 由真实工具结果聚合的阅读、失败、证据、问题覆盖与完成状态卡片
 * [POS]: 研究计划和联网搜索之后的领域进度呈现，不从模型旁白推断状态
 * [DOC]: design.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UIMessage } from "@tessera/ai/react"
import {
  FINALIZE_RESEARCH_TOOL_NAME,
  READ_WEB_SOURCE_TOOL_NAME,
  RECORD_RESEARCH_EVIDENCE_TOOL_NAME,
} from "@tessera/contracts"
import React from "react"

type MessagePart = UIMessage["parts"][number]
type ToolPart = Extract<MessagePart, { type: "dynamic-tool" | `tool-${string}` }>

const RESEARCH_TOOL_NAMES = new Set<string>([
  READ_WEB_SOURCE_TOOL_NAME,
  RECORD_RESEARCH_EVIDENCE_TOOL_NAME,
  FINALIZE_RESEARCH_TOOL_NAME,
])

function toolName(part: ToolPart) {
  return part.type === "dynamic-tool" ? part.toolName : part.type.slice("tool-".length)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function isResearchActivityToolPart(part: MessagePart): part is ToolPart {
  return (
    (part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
    RESEARCH_TOOL_NAMES.has(toolName(part as ToolPart))
  )
}

export type ResearchActivitySummary = Readonly<{
  active: boolean
  evidenceCount: number
  finalizeStatus: "blocked" | "completed" | "partial" | null
  questionCounts: Readonly<{ covered: number; partial: number; pending: number; uncovered: number }> | null
  readCount: number
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
  let readCount = 0
  let unusableCount = 0
  const sources = new Map<
    string,
    { detail?: string; label: string; status: "failed" | "read" | "reading" }
  >()

  for (const part of parts.filter(isResearchActivityToolPart)) {
    const name = toolName(part)
    const output = "output" in part ? record(part.output) : null
    const input = "input" in part ? record(part.input) : null
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
      const status =
        output?.status === "read"
          ? "read"
          : output?.status === "unusable"
            ? "failed"
            : "reading"
      if (status === "read") readCount += 1
      if (status === "failed") unusableCount += 1
      const key = typeof output?.sourceId === "string" ? output.sourceId : url || part.toolCallId
      const detail = status === "failed" && typeof output?.error === "string" ? output.error.slice(0, 160) : undefined
      sources.set(key, { label: label || "网页来源", status, ...(detail ? { detail } : {}) })
    }
    if (name === RECORD_RESEARCH_EVIDENCE_TOOL_NAME && output?.status === "recorded") evidenceCount += 1
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
  return {
    active,
    evidenceCount,
    finalizeStatus,
    questionCounts,
    readCount: sourceCounts?.read ?? readCount,
    sourceCounts,
    sources: [...sources.values()],
    unusableCount: sourceCounts?.unusable ?? unusableCount,
  }
}

const sourceStatusLabels = { reading: "读取中", read: "已阅读", failed: "不可用" } as const

export function ResearchActivityPart({
  parts,
  streaming,
}: Readonly<{ parts: readonly MessagePart[]; streaming: boolean }>) {
  const summary = collectResearchActivity(parts)
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
    </section>
  )
}
