/**
 * [INPUT]: 绑定 task_run 的研究仓储、公开 http(s) URL、模型选定的问题/证据和可取消工具执行上下文
 * [OUTPUT]: 防 SSRF 的固定地址网页读取、正文与元数据提取、研究计划/来源/证据持久化、真实进度和完整/部分完成门槛
 * [POS]: Electron 主进程持有网络与 SQLite 权限的可信研究领域服务
 * [DOC]: docs/architecture/research-workflow.md、docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { createHash, randomUUID } from "node:crypto"
import { lookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { BlockList, isIP } from "node:net"
import type { IncomingHttpHeaders } from "node:http"
import type { ResearchAgentTools } from "@tessera/ai/server"
import type {
  TaskResearchEvidenceInput,
  TaskResearchFinalizeInput,
  TaskResearchProgress,
  TaskResearchReadSourceOutput,
} from "@tessera/contracts"
import {
  type DatabaseClient,
  findResearchRun,
  finishResearchRun,
  publishResearchPlan,
  saveResearchEvidence,
  saveResearchSource,
  setResearchRunPhase,
} from "@tessera/database"
import { type DefaultTreeAdapterMap, parse } from "parse5"

const MAX_REDIRECTS = 5
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_MODEL_CONTENT_CHARS = 60_000
const REQUEST_TIMEOUT_MS = 15_000
const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"]
const PRIVATE_ADDRESSES = new BlockList()

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE_ADDRESSES.addSubnet(network, prefix, "ipv4")
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  PRIVATE_ADDRESSES.addSubnet(network, prefix, "ipv6")
}

type HtmlNode = DefaultTreeAdapterMap["node"]
type HtmlElement = DefaultTreeAdapterMap["element"]

type RestrictedWebRead = Readonly<{
  author?: string
  charCount: number
  content: string
  contentHash: string
  contentType: string
  finalUrl: string
  publishedAt?: string
  title?: string
  truncated: boolean
}>

export type RestrictedWebSourceReader = (url: string, signal: AbortSignal) => Promise<RestrictedWebRead>

export type DesktopResearchService = ResearchAgentTools &
  Readonly<{
    recordDiscoveredSource: (input: Readonly<{ query?: string; title?: string; url: string }>) => void
  }>

function headerValue(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

export function parsePublicWebUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("网页来源必须是完整的 URL。")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("网页来源只允许 http(s) 协议。")
  }
  if (url.username || url.password) throw new Error("网页来源不能包含账号或密码。")
  if (!url.hostname || url.hostname.length > 253) throw new Error("网页来源主机名无效。")
  url.hash = ""
  return url
}

export function isPublicIpAddress(address: string) {
  const family = isIP(address)
  if (family === 0) return false
  if (family === 4) return !PRIVATE_ADDRESSES.check(address, "ipv4")
  if (address.toLowerCase().startsWith("::ffff:")) {
    const mapped = address.slice("::ffff:".length)
    if (isIP(mapped) === 4) return !PRIVATE_ADDRESSES.check(mapped, "ipv4")
  }
  return !PRIVATE_ADDRESSES.check(address, "ipv6")
}

async function resolvePublicAddresses(url: URL) {
  const literalFamily = isIP(url.hostname)
  if (literalFamily) {
    if (!isPublicIpAddress(url.hostname)) throw new Error("网页来源指向本机、内网或保留地址。")
    return [{ address: url.hostname, family: literalFamily }]
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("网页来源解析到本机、内网或保留地址。")
  }
  return addresses
}

async function requestPinnedUrl(url: URL, signal: AbortSignal) {
  const addresses = await resolvePublicAddresses(url)
  const target = addresses[0]
  if (!target) throw new Error("网页来源没有可用网络地址。")
  signal.throwIfAborted()
  return new Promise<Readonly<{ body: Buffer; headers: IncomingHttpHeaders; statusCode: number }>>(
    (resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        {
          protocol: url.protocol,
          hostname: target.address,
          family: target.family,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          servername: url.protocol === "https:" ? url.hostname : undefined,
          headers: {
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
            "Accept-Encoding": "identity",
            Host: url.host,
            "User-Agent": "TesseraResearchReader/1.0",
          },
          signal,
        },
        (response) => {
          const chunks: Buffer[] = []
          let bytes = 0
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength
            if (bytes > MAX_RESPONSE_BYTES) {
              response.destroy(new Error("网页正文超过 2 MiB 读取上限。"))
              return
            }
            chunks.push(chunk)
          })
          response.on("end", () =>
            resolve({
              body: Buffer.concat(chunks),
              headers: response.headers,
              statusCode: response.statusCode ?? 0,
            }),
          )
          response.on("error", reject)
        },
      )
      request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("网页读取超时。")))
      request.on("error", reject)
      request.end()
    },
  )
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node
}

function elementAttribute(element: HtmlElement, name: string) {
  return element.attrs.find((attribute) => attribute.name.toLowerCase() === name)?.value
}

function textContent(node: HtmlNode): string {
  if ("value" in node && node.nodeName === "#text") return node.value
  if (!("childNodes" in node)) return ""
  return node.childNodes.map(textContent).join(" ")
}

function findElement(node: HtmlNode, names: ReadonlySet<string>): HtmlElement | null {
  if (isElement(node) && names.has(node.tagName.toLowerCase())) return node
  if (!("childNodes" in node)) return null
  for (const child of node.childNodes) {
    const match = findElement(child, names)
    if (match) return match
  }
  return null
}

function collectMetadata(node: HtmlNode, metadata: Map<string, string>) {
  if (isElement(node)) {
    const tag = node.tagName.toLowerCase()
    if (tag === "title" && !metadata.has("title")) metadata.set("title", textContent(node))
    if (tag === "meta") {
      const key = (elementAttribute(node, "property") ?? elementAttribute(node, "name"))?.toLowerCase()
      const value = elementAttribute(node, "content")?.trim()
      if (key && value && !metadata.has(key)) metadata.set(key, value)
    }
  }
  if ("childNodes" in node) for (const child of node.childNodes) collectMetadata(child, metadata)
}

const IGNORED_HTML_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "nav",
  "header",
  "footer",
  "form",
  "button",
])
const CONTENT_BLOCK_ELEMENTS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "blockquote",
  "pre",
  "figcaption",
  "td",
  "th",
])

function normalizeText(value: string) {
  return value
    .replace(/[\t\f\v ]+/gu, " ")
    .replace(/\s*\n\s*/gu, " ")
    .trim()
}

function collectContentBlocks(node: HtmlNode, blocks: string[]) {
  if (isElement(node)) {
    const tag = node.tagName.toLowerCase()
    if (IGNORED_HTML_ELEMENTS.has(tag)) return
    if (CONTENT_BLOCK_ELEMENTS.has(tag)) {
      const value = normalizeText(textContent(node))
      if (value.length >= 2 && blocks.at(-1) !== value) blocks.push(value)
      return
    }
  }
  if ("childNodes" in node) for (const child of node.childNodes) collectContentBlocks(child, blocks)
}

export function extractReadableWebContent(body: string, contentType: string, finalUrl: string) {
  if (contentType.startsWith("text/plain")) {
    const blocks = body
      .split(/\n\s*\n/gu)
      .map(normalizeText)
      .filter((value) => value.length >= 2)
    return readableResult(blocks, {}, contentType, finalUrl)
  }
  const document = parse(body)
  const metadata = new Map<string, string>()
  collectMetadata(document, metadata)
  const root =
    findElement(document, new Set(["main"])) ??
    findElement(document, new Set(["article"])) ??
    findElement(document, new Set(["body"])) ??
    document
  const blocks: string[] = []
  collectContentBlocks(root, blocks)
  if (blocks.length === 0) {
    const fallback = normalizeText(textContent(root))
    if (fallback) blocks.push(fallback)
  }
  return readableResult(
    blocks,
    (() => {
      const title = metadata.get("og:title") ?? metadata.get("twitter:title") ?? metadata.get("title")
      const author = metadata.get("author") ?? metadata.get("article:author")
      const publishedAt =
        metadata.get("article:published_time") ??
        metadata.get("date") ??
        metadata.get("datepublished") ??
        metadata.get("pubdate")
      return {
        ...(title ? { title } : {}),
        ...(author ? { author } : {}),
        ...(publishedAt ? { publishedAt } : {}),
      }
    })(),
    contentType,
    finalUrl,
  )
}

function readableResult(
  blocks: readonly string[],
  metadata: Readonly<{ author?: string; publishedAt?: string; title?: string }>,
  contentType: string,
  finalUrl: string,
): RestrictedWebRead {
  const fullContent = blocks.map((block, index) => `[p${index + 1}] ${block}`).join("\n\n")
  if (fullContent.length < 80) throw new Error("网页没有提取到足够的可读正文。")
  const truncated = fullContent.length > MAX_MODEL_CONTENT_CHARS
  const content = fullContent.slice(0, MAX_MODEL_CONTENT_CHARS)
  return {
    finalUrl,
    contentType,
    content,
    charCount: fullContent.length,
    truncated,
    contentHash: `sha256:${createHash("sha256").update(fullContent).digest("hex")}`,
    ...(metadata.title ? { title: normalizeText(metadata.title) } : {}),
    ...(metadata.author ? { author: normalizeText(metadata.author) } : {}),
    ...(metadata.publishedAt ? { publishedAt: metadata.publishedAt.trim() } : {}),
  }
}

export const readRestrictedWebSource: RestrictedWebSourceReader = async (value, signal) => {
  let url = parsePublicWebUrl(value)
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await requestPinnedUrl(url, signal)
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      if (redirectCount >= MAX_REDIRECTS) throw new Error("网页重定向次数超过上限。")
      const location = headerValue(response.headers, "location")
      if (!location) throw new Error("网页返回了没有目标地址的重定向。")
      url = parsePublicWebUrl(new URL(location, url).toString())
      continue
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`网页返回 HTTP ${response.statusCode}。`)
    }
    const encoding = headerValue(response.headers, "content-encoding")?.toLowerCase()
    if (encoding && encoding !== "identity") throw new Error("网页返回了不受支持的压缩格式。")
    const contentType = (headerValue(response.headers, "content-type") ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase()
    if (!contentType || !ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new Error("网页响应不是允许的 HTML 或纯文本。")
    }
    return extractReadableWebContent(response.body.toString("utf8"), contentType, url.toString())
  }
  throw new Error("网页重定向次数超过上限。")
}

function normalizedUrl(value: string) {
  return parsePublicWebUrl(value).toString()
}

function stableSourceId(requestId: string, canonicalUrl: string) {
  return `source-${createHash("sha256").update(`${requestId}\0${canonicalUrl}`).digest("hex").slice(0, 32)}`
}

function requiredRun(client: DatabaseClient, requestId: string) {
  const run = findResearchRun(client, requestId)
  if (!run) throw new Error("研究运行不存在。")
  return run
}

function researchProgress(client: DatabaseClient, requestId: string): TaskResearchProgress {
  const run = requiredRun(client, requestId)
  const questionCounts = { pending: 0, covered: 0, partial: 0, uncovered: 0 }
  for (const question of run.questions) questionCounts[question.status] += 1
  const sourceCounts = { discovered: 0, shortlisted: 0, reading: 0, read: 0, unusable: 0 }
  for (const source of run.sources) sourceCounts[source.status] += 1
  return {
    phase: run.phase,
    planPublished: run.planVersion > 0,
    outcome: run.outcome,
    questionCounts,
    sourceCounts,
    evidenceCount: run.evidence.length,
  }
}

function validateQuestionIds(run: ReturnType<typeof requiredRun>, questionIds: readonly string[]) {
  const known = new Set(run.questions.map((question) => question.questionId))
  const unique = new Set(questionIds)
  if (unique.size !== questionIds.length || questionIds.some((id) => !known.has(id))) {
    throw new Error("研究工具引用了重复或未知的问题 ID。")
  }
}

export function createDesktopResearchService(
  client: DatabaseClient,
  input: Readonly<{ reader?: RestrictedWebSourceReader; requestId: string }>,
): DesktopResearchService {
  const reader = input.reader ?? readRestrictedWebSource
  const sourceBodies = new Map<string, string>()

  return {
    getProgress: () => researchProgress(client, input.requestId),
    publishPlan: async (plan, context) => {
      context.signal.throwIfAborted()
      const ids = plan.questions.map((question) => question.id)
      if (new Set(ids).size !== ids.length) throw new Error("研究问题 ID 必须唯一。")
      publishResearchPlan(client, {
        requestId: input.requestId,
        objective: plan.objective,
        scope: plan.scope ?? null,
        deliverable: plan.deliverable ?? null,
        questions: plan.questions,
      })
      return { status: "published", questionIds: ids }
    },
    recordDiscoveredSource: (source) => {
      const run = requiredRun(client, input.requestId)
      if (run.planVersion === 0) throw new Error("研究计划发布前不能登记搜索来源。")
      const canonicalUrl = normalizedUrl(source.url)
      saveResearchSource(client, {
        id: stableSourceId(input.requestId, canonicalUrl),
        requestId: input.requestId,
        url: source.url,
        canonicalUrl,
        finalUrl: null,
        title: source.title ?? null,
        author: null,
        publishedAt: null,
        discoveredByQuery: source.query ?? null,
        questionIds: [],
        status: "discovered",
        contentType: null,
        contentHash: null,
        charCount: null,
        truncated: false,
        errorMessage: null,
      })
    },
    readSource: async ({ url, questionIds }, context): Promise<TaskResearchReadSourceOutput> => {
      context.signal.throwIfAborted()
      const run = requiredRun(client, input.requestId)
      if (run.planVersion === 0) throw new Error("研究计划发布前不能读取来源。")
      validateQuestionIds(run, questionIds)
      const canonicalUrl = normalizedUrl(url)
      const sourceId = stableSourceId(input.requestId, canonicalUrl)
      setResearchRunPhase(client, input.requestId, "reading")
      saveResearchSource(client, {
        id: sourceId,
        requestId: input.requestId,
        url,
        canonicalUrl,
        finalUrl: null,
        title: null,
        author: null,
        publishedAt: null,
        discoveredByQuery: null,
        questionIds,
        status: "reading",
        contentType: null,
        contentHash: null,
        charCount: null,
        truncated: false,
        errorMessage: null,
      })
      try {
        const result = await reader(url, context.signal)
        context.signal.throwIfAborted()
        sourceBodies.set(sourceId, result.content)
        saveResearchSource(client, {
          id: sourceId,
          requestId: input.requestId,
          url,
          canonicalUrl,
          finalUrl: result.finalUrl,
          title: result.title ?? null,
          author: result.author ?? null,
          publishedAt: result.publishedAt ?? null,
          discoveredByQuery: null,
          questionIds,
          status: "read",
          contentType: result.contentType,
          contentHash: result.contentHash,
          charCount: result.charCount,
          truncated: result.truncated,
          errorMessage: null,
        })
        return {
          sourceId,
          status: "read",
          finalUrl: result.finalUrl,
          charCount: result.charCount,
          truncated: result.truncated,
          content: result.content,
          contentHash: result.contentHash,
          contentType: result.contentType,
          ...(result.title ? { title: result.title } : {}),
          ...(result.author ? { author: result.author } : {}),
          ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
        }
      } catch (error) {
        if (context.signal.aborted) throw error
        const message = error instanceof Error ? error.message : "网页读取失败。"
        saveResearchSource(client, {
          id: sourceId,
          requestId: input.requestId,
          url,
          canonicalUrl,
          finalUrl: canonicalUrl,
          title: null,
          author: null,
          publishedAt: null,
          discoveredByQuery: null,
          questionIds,
          status: "unusable",
          contentType: null,
          contentHash: null,
          charCount: 0,
          truncated: false,
          errorMessage: message,
        })
        return {
          sourceId,
          status: "unusable",
          finalUrl: canonicalUrl,
          charCount: 0,
          truncated: false,
          error: message,
        }
      }
    },
    recordEvidence: async (evidence: TaskResearchEvidenceInput, context) => {
      context.signal.throwIfAborted()
      const body = sourceBodies.get(evidence.sourceId)
      if (!body) throw new Error("当前运行没有这个来源的可核查正文。")
      const excerpt = normalizeText(evidence.excerpt)
      if (excerpt.length < 8 || !normalizeText(body).includes(excerpt)) {
        throw new Error("证据片段必须逐字来自已读取正文。")
      }
      const record = saveResearchEvidence(client, {
        id: `evidence-${randomUUID()}`,
        requestId: input.requestId,
        sourceId: evidence.sourceId,
        questionId: evidence.questionId,
        relation: evidence.relation,
        claim: evidence.claim,
        excerpt: evidence.excerpt,
        locator: evidence.locator ?? null,
      })
      if (!record) throw new Error("研究证据保存失败。")
      return { evidenceId: record.id, status: "recorded" }
    },
    finalize: async (finalization: TaskResearchFinalizeInput, context) => {
      context.signal.throwIfAborted()
      const run = requiredRun(client, input.requestId)
      const issues: string[] = []
      if (run.planVersion === 0) issues.push("尚未发布研究计划。")
      const expectedIds = run.questions.map((question) => question.questionId)
      const providedIds = finalization.questions.map((question) => question.id)
      if (
        new Set(providedIds).size !== providedIds.length ||
        expectedIds.length !== providedIds.length ||
        expectedIds.some((id) => !providedIds.includes(id))
      ) {
        issues.push("覆盖汇总必须逐一包含计划中的全部研究问题。")
      }
      const readSources = run.sources.filter((source) => source.status === "read")
      const evidenceQuestionIds = new Set(
        run.evidence.flatMap((evidence) => {
          const question = run.questions.find((candidate) => candidate.id === evidence.researchQuestionId)
          return question ? [question.questionId] : []
        }),
      )
      for (const question of finalization.questions) {
        if (question.status === "covered" && !evidenceQuestionIds.has(question.id)) {
          issues.push(`问题 ${question.id} 标记为已覆盖，但没有已登记证据。`)
        }
      }
      if (finalization.outcome === "complete") {
        if (finalization.questions.some((question) => question.status !== "covered")) {
          issues.push("完整完成要求全部研究问题已覆盖。")
        }
        if (readSources.length < 2 || new Set(run.evidence.map((evidence) => evidence.sourceId)).size < 2) {
          issues.push("完整完成至少需要两个已读来源参与交叉核验。")
        }
        if (run.sources.some((source) => source.status === "reading")) {
          issues.push("仍有来源处于读取中。")
        }
      } else {
        if (!context.allowPartial) issues.push("只有运行预算接近上限时才能标记部分完成。")
        if (finalization.limitations.length === 0) issues.push("部分完成必须说明限制和未覆盖内容。")
      }
      if (issues.length > 0) {
        return { status: "blocked", issues, progress: researchProgress(client, input.requestId) }
      }
      setResearchRunPhase(client, input.requestId, "synthesizing")
      finishResearchRun(client, {
        requestId: input.requestId,
        outcome: finalization.outcome,
        limitations: finalization.limitations,
        questions: finalization.questions,
      })
      return {
        status: finalization.outcome === "complete" ? "completed" : "partial",
        progress: researchProgress(client, input.requestId),
      }
    },
  }
}
