/**
 * [INPUT]: 每次研究运行冻结的 system/direct 网络模式、Electron Session、公开 http(s) URL 与可取消信号
 * [OUTPUT]: 按所选网络模式先静态请求、必要时经同模式隐藏沙箱浏览器渲染的受限网页 Reader
 * [POS]: 可信研究服务的桌面网络适配层，负责系统代理/直连隔离与 SPA/反爬页面回退而不持有研究领域状态
 * [DOC]: docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { BrowserWindow, type Session, session } from "electron"
import type { ResearchNetworkMode } from "@tessera/contracts"
import {
  ResearchReadError,
  type RestrictedWebRead,
  type RestrictedWebSourceReader,
  assertPublicWebUrl,
  extractReadableWebContent,
  researchReadErrorCode,
  validateReadableWebSource,
} from "./research-service"

const RESEARCH_PARTITION_PREFIX = "tessera-research-reader"
const MAX_REDIRECTS = 5
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const STATIC_TIMEOUT_MS = 25_000
const BROWSER_TIMEOUT_MS = 35_000
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"])
const BLOCKED_RESOURCE_TYPES = new Set(["cspReport", "font", "image", "media", "object", "ping", "webSocket"])

const configuredSessions = new Map<ResearchNetworkMode, Promise<Session>>()

function researchPartition(mode: ResearchNetworkMode) {
  return `${RESEARCH_PARTITION_PREFIX}-${mode}`
}

async function configureResearchSession(mode: ResearchNetworkMode) {
  const value = session.fromPartition(researchPartition(mode), { cache: false })
  await value.setProxy({ mode })
  value.setPermissionCheckHandler(() => false)
  value.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  value.on("will-download", (event) => event.preventDefault())
  value.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    if (BLOCKED_RESOURCE_TYPES.has(details.resourceType)) {
      callback({ cancel: true })
      return
    }
    void assertPublicWebUrl(details.url).then(
      () => callback({ cancel: false }),
      () => callback({ cancel: true }),
    )
  })
  return value
}

function researchSession(mode: ResearchNetworkMode) {
  const configured = configuredSessions.get(mode)
  if (configured) return configured
  const pending = configureResearchSession(mode)
  configuredSessions.set(mode, pending)
  void pending.catch(() => configuredSessions.delete(mode))
  return pending
}

function abortAfter(signal: AbortSignal, timeoutMs: number, timeoutMessage: string) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal.reason)
  signal.addEventListener("abort", onAbort, { once: true })
  if (signal.aborted) controller.abort(signal.reason)
  const timer = setTimeout(
    () => controller.abort(new ResearchReadError(timeoutMessage, "network-timeout")),
    timeoutMs,
  )
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
    },
  }
}

async function responseBody(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0)
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new ResearchReadError("网页正文超过 2 MiB 读取上限。", "content-too-large")
  }
  if (!response.body) throw new ResearchReadError("网页没有返回可读取正文。", "content-invalid")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    bytes += next.value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new ResearchReadError("网页正文超过 2 MiB 读取上限。", "content-too-large")
    }
    chunks.push(next.value)
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

async function readWithSessionFetch(
  value: string,
  signal: AbortSignal,
  networkMode: ResearchNetworkMode,
): Promise<RestrictedWebRead> {
  let url = await assertPublicWebUrl(value)
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const bounded = abortAfter(signal, STATIC_TIMEOUT_MS, "网页静态读取超时。")
    try {
      const response = await (await researchSession(networkMode)).fetch(url.toString(), {
        redirect: "manual",
        signal: bounded.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "User-Agent": "TesseraResearchReader/1.0",
        },
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount >= MAX_REDIRECTS) {
          throw new ResearchReadError("网页重定向次数超过上限。", "redirect-invalid")
        }
        const location = response.headers.get("location")
        if (!location) throw new ResearchReadError("网页返回了没有目标地址的重定向。", "redirect-invalid")
        url = await assertPublicWebUrl(new URL(location, url).toString())
        continue
      }
      if (!response.ok) throw new ResearchReadError(`网页返回 HTTP ${response.status}。`, "http-error")
      const contentType = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0]
        ?.trim()
        .toLocaleLowerCase()
      if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
        throw new ResearchReadError("网页响应不是允许的 HTML 或纯文本。", "unsupported-content")
      }
      const result = extractReadableWebContent(await responseBody(response), contentType, url.toString())
      return validateReadableWebSource(result, { requestedUrl: value })
    } catch (error) {
      if (bounded.signal.aborted && !signal.aborted) {
        throw new ResearchReadError("网页静态读取超时。", "network-timeout", { cause: error })
      }
      throw error
    } finally {
      bounded.dispose()
    }
  }
  throw new ResearchReadError("网页重定向次数超过上限。", "redirect-invalid")
}

function browserFallbackAllowed(error: unknown) {
  return ["browser-failed", "content-invalid", "network-timeout", "unknown"].includes(
    researchReadErrorCode(error),
  )
}

async function readWithSandboxBrowser(
  value: string,
  signal: AbortSignal,
  networkMode: ResearchNetworkMode,
): Promise<RestrictedWebRead> {
  await assertPublicWebUrl(value)
  signal.throwIfAborted()
  await researchSession(networkMode)
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      partition: researchPartition(networkMode),
      sandbox: true,
      spellcheck: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  const bounded = abortAfter(signal, BROWSER_TIMEOUT_MS, "浏览器渲染网页超时。")
  const onAbort = () => {
    if (!window.isDestroyed()) window.webContents.stop()
  }
  bounded.signal.addEventListener("abort", onAbort, { once: true })
  try {
    await Promise.race([
      window.loadURL(value),
      new Promise<never>((_resolve, reject) => {
        bounded.signal.addEventListener(
          "abort",
          () =>
            reject(bounded.signal.reason ?? new ResearchReadError("浏览器渲染网页超时。", "browser-failed")),
          { once: true },
        )
      }),
    ])
    await new Promise<void>((resolve) => setTimeout(resolve, 800))
    bounded.signal.throwIfAborted()
    const finalUrl = (await assertPublicWebUrl(window.webContents.getURL())).toString()
    const page = (await window.webContents.executeJavaScript(`(() => {
      const root = document.querySelector("main, article") || document.body;
      const meta = (key) => document.querySelector('meta[name="' + key + '"],meta[property="' + key + '"]')?.content;
      return {
        title: document.title || meta("og:title") || "",
        author: meta("author") || meta("article:author") || "",
        publishedAt: meta("article:published_time") || meta("date") || "",
        content: (root?.innerText || "").slice(0, 120000),
      };
    })()`)) as { author?: unknown; content?: unknown; publishedAt?: unknown; title?: unknown }
    const content = typeof page.content === "string" ? page.content : ""
    const result = extractReadableWebContent(content, "text/plain", finalUrl)
    const title = typeof page.title === "string" && page.title.trim() ? page.title.trim() : undefined
    const author = typeof page.author === "string" && page.author.trim() ? page.author.trim() : undefined
    const publishedAt =
      typeof page.publishedAt === "string" && page.publishedAt.trim() ? page.publishedAt.trim() : undefined
    return validateReadableWebSource(
      {
        ...result,
        contentType: "text/html",
        ...(title ? { title } : {}),
        ...(author ? { author } : {}),
        ...(publishedAt ? { publishedAt } : {}),
      },
      { requestedUrl: value },
    )
  } catch (error) {
    if (signal.aborted) throw error
    if (researchReadErrorCode(error) !== "unknown") throw error
    throw new ResearchReadError("沙箱浏览器未能提取可核查正文。", "browser-failed", { cause: error })
  } finally {
    bounded.signal.removeEventListener("abort", onAbort)
    bounded.dispose()
    if (!window.isDestroyed()) window.destroy()
  }
}

export function createElectronResearchReader(
  networkMode: ResearchNetworkMode = "system",
): RestrictedWebSourceReader {
  return async (url, signal) => {
    try {
      return await readWithSessionFetch(url, signal, networkMode)
    } catch (error) {
      if (signal.aborted || !browserFallbackAllowed(error)) throw error
      return readWithSandboxBrowser(url, signal, networkMode)
    }
  }
}
