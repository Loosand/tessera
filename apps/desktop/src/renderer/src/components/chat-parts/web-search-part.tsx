/**
 * [INPUT]: AI SDK provider-executed web_search Tool Part、同消息 URL 来源、回复流式状态与 HTTPS favicon 资源
 * [OUTPUT]: 兼容标准 action/sources 与旧结果数组、聚合真实查询和打开页面的可展开限高联网检索轨迹
 * [POS]: ChatMessage 内替代通用工具行与尾部来源胶囊的搜索过程单元
 * [DOC]: design.md、docs/architecture/ai-providers.md
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
import { ActivityTrace, type ActivityTraceStatus } from "@tessera/design-system/components/activity-trace"
import { AiWebBrowsingIcon, Link01Icon, Search01Icon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React, { useMemo, useState } from "react"

type MessagePart = UIMessagePart
type ToolMessagePart = UIMessageToolPart

type WebSearchPartProps = {
  readonly parts: readonly MessagePart[]
  readonly streaming: boolean
}

type WebSearchResult = {
  readonly pageAge?: string
  readonly title?: string
  readonly url: string
}

export type WebSearchTraceData = {
  readonly errorText?: string
  readonly queries: readonly string[]
  readonly results: readonly WebSearchResult[]
  readonly searchCount: number
  readonly working: boolean
}

const COLLAPSED_RESULT_COUNT = 5

export function isWebSearchToolPart(part: MessagePart): part is ToolMessagePart {
  return isUIMessageToolPart(part) && uiMessageToolName(part) === "web_search"
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function inputQuery(part: ToolMessagePart) {
  if (!("input" in part) || !isUnknownRecord(part.input)) return ""
  const query = part.input.query
  return typeof query === "string" ? query.trim() : ""
}

function cleanQuery(value: unknown) {
  if (typeof value !== "string") return ""
  const query = value.trim()
  return query.startsWith("ws_call_id=") ? "" : query
}

function safeWebUrl(value: unknown) {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    if (url.hash.startsWith("#ws_call_id=")) url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function collectQueries(queries: Set<string>, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const query = cleanQuery(item)
      if (query) queries.add(query)
    }
    return
  }

  const query = cleanQuery(value)
  if (query) queries.add(query)
}

function collectOutput(output: unknown, queries: Set<string>, results: Map<string, WebSearchResult>) {
  if (Array.isArray(output)) {
    for (const value of output) {
      const result = resultFromUnknown(value)
      if (result) mergeResult(results, result)
    }
    return
  }
  if (!isUnknownRecord(output)) return

  const action = output.action
  if (isUnknownRecord(action)) {
    if (action.type === "search") {
      collectQueries(queries, action.queries)
      collectQueries(queries, action.query)
    } else if (action.type === "openPage" || action.type === "findInPage") {
      const url = safeWebUrl(action.url)
      if (url) mergeResult(results, { url })
    }
  }

  if (!Array.isArray(output.sources)) return
  for (const source of output.sources) {
    if (!isUnknownRecord(source) || source.type !== "url") continue
    const url = safeWebUrl(source.url)
    if (url) mergeResult(results, { url })
  }
}

function resultFromUnknown(value: unknown): WebSearchResult | null {
  if (!isUnknownRecord(value)) return null
  const record = value
  const url = safeWebUrl(record.url)
  if (!url) return null
  return {
    url,
    ...(typeof record.title === "string" && record.title.trim() ? { title: record.title.trim() } : {}),
    ...(typeof record.pageAge === "string" && record.pageAge.trim()
      ? { pageAge: record.pageAge.trim() }
      : {}),
  }
}

function mergeResult(results: Map<string, WebSearchResult>, result: WebSearchResult) {
  const current = results.get(result.url)
  results.set(result.url, {
    url: result.url,
    ...(current?.title || result.title ? { title: current?.title ?? result.title } : {}),
    ...(current?.pageAge || result.pageAge ? { pageAge: current?.pageAge ?? result.pageAge } : {}),
  })
}

export function collectWebSearchTrace(parts: readonly MessagePart[]): WebSearchTraceData {
  const queries = new Set<string>()
  const results = new Map<string, WebSearchResult>()
  let working = false
  let errorText = ""
  let searchCount = 0

  for (const part of parts) {
    if (isWebSearchToolPart(part)) {
      searchCount += 1
      const query = inputQuery(part)
      if (query) queries.add(query)
      if (part.state === "input-streaming" || part.state === "input-available") working = true
      if (part.state === "output-error") errorText ||= part.errorText
      if (part.state === "output-available") collectOutput(part.output, queries, results)
      continue
    }

    if (part.type === "source-url") {
      const url = safeWebUrl(part.url)
      if (url) mergeResult(results, { url, ...(part.title ? { title: part.title } : {}) })
    }
  }

  return {
    queries: [...queries],
    results: [...results.values()],
    searchCount,
    working,
    ...(errorText ? { errorText } : {}),
  }
}

function sourceLabel(result: WebSearchResult) {
  if (result.title) return result.title
  try {
    return new URL(result.url).hostname
  } catch {
    return result.url
  }
}

function sourceHost(result: WebSearchResult) {
  try {
    return new URL(result.url).hostname.replace(/^www\./u, "")
  } catch {
    return ""
  }
}

export function faviconUrls(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl)
    const remoteFallback = `https://a.favicon.im/${encodeURIComponent(url.hostname)}?larger=true`
    return url.protocol === "https:" ? [`${url.origin}/favicon.ico`, remoteFallback] : [remoteFallback]
  } catch {
    return []
  }
}

function SourceFavicon({ result }: { result: WebSearchResult }) {
  const candidates = useMemo(() => faviconUrls(result.url), [result.url])
  const [candidateIndex, setCandidateIndex] = useState(0)
  const candidate = candidates[candidateIndex]

  if (!candidate) {
    return (
      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon icon={Link01Icon} size={9} />
      </span>
    )
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className="size-3.5 shrink-0 rounded-[3px] bg-muted object-contain"
      decoding="async"
      loading="lazy"
      onError={() => setCandidateIndex((current) => current + 1)}
      referrerPolicy="no-referrer"
      src={candidate}
    />
  )
}

function completedLabel(queryCount: number, resultCount: number) {
  if (queryCount === 0) return resultCount > 0 ? `联网搜索完成 · ${resultCount} 个来源` : "联网搜索完成"
  return `已搜索 ${queryCount} 次${resultCount > 0 ? ` · ${resultCount} 个来源` : ""}`
}

export function WebSearchPart({ parts, streaming }: WebSearchPartProps) {
  const [showAll, setShowAll] = useState(false)
  const trace = useMemo(() => collectWebSearchTrace(parts), [parts])
  const active = streaming && trace.working
  const status: ActivityTraceStatus = active ? "active" : trace.errorText ? "error" : "complete"
  const visibleResults = showAll ? trace.results : trace.results.slice(0, COLLAPSED_RESULT_COUNT)
  const hiddenResultCount = trace.results.length - visibleResults.length

  return (
    <ActivityTrace
      activeLabel="正在联网搜索"
      doneLabel={trace.errorText ? "联网搜索失败" : completedLabel(trace.searchCount, trace.results.length)}
      icon={<Icon icon={AiWebBrowsingIcon} size={15} />}
      status={status}
    >
      <section aria-label="联网搜索过程" className="max-h-64 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        <div className="flex flex-col gap-1">
          {trace.queries.map((query) => (
            <div className="flex min-h-7 items-center gap-2 rounded-md px-1.5 py-0.5" key={query}>
              <Icon className="shrink-0 text-muted-foreground" icon={Search01Icon} size={14} />
              <span className="min-w-0 truncate text-[12.5px] text-foreground">{query}</span>
            </div>
          ))}

          {visibleResults.map((result) => (
            <a
              className="flex min-h-7 items-center gap-2 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={result.url}
              key={result.url}
              rel="noreferrer"
              target="_blank"
            >
              <SourceFavicon result={result} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                {sourceLabel(result)}
              </span>
              <span className="max-w-40 shrink-0 truncate text-[11.5px] text-muted-foreground">
                {result.pageAge || sourceHost(result)}
              </span>
            </a>
          ))}

          {trace.errorText ? (
            <p className="px-1.5 py-1 text-xs leading-5 text-destructive">{trace.errorText}</p>
          ) : null}

          {hiddenResultCount > 0 ? (
            <Button
              className="ml-1 w-fit text-xs text-muted-foreground"
              onClick={() => setShowAll(true)}
              size="xs"
              type="button"
              variant="ghost"
            >
              查看其余 {hiddenResultCount} 个来源
            </Button>
          ) : null}
        </div>
      </section>
    </ActivityTrace>
  )
}
