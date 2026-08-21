/**
 * [INPUT]: DeepSeek 官方 Anthropic 兼容端点返回的 JSON 或 SSE Response
 * [OUTPUT]: 仅修正 Web Search 错误结果形状的 fetch 中间件与可测试归一化函数
 * [POS]: DeepSeek Anthropic 兼容协议进入 @ai-sdk/anthropic Schema 前的供应商兼容边界
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

type FetchImplementation = typeof globalThis.fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSingleWebSearchError(value: unknown): value is [Record<string, unknown>] {
  return (
    Array.isArray(value) &&
    value.length === 1 &&
    isRecord(value[0]) &&
    value[0].type === "web_search_tool_result_error"
  )
}

/**
 * DeepSeek 会把 Anthropic 定义为单个对象的 Web Search 错误包进数组。
 * 只修正这一种已知差异，成功结果数组与其他供应商内容保持原样。
 */
export function normalizeDeepSeekAnthropicPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeDeepSeekAnthropicPayload)
  if (!isRecord(value)) return value

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeDeepSeekAnthropicPayload(entry)]),
  )
  if (normalized.type === "web_search_tool_result" && isSingleWebSearchError(normalized.content)) {
    normalized.content = normalized.content[0]
  }
  return normalized
}

function normalizedHeaders(response: Response) {
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  headers.delete("content-encoding")
  return headers
}

function normalizeSseLine(line: string) {
  const carriageReturn = line.endsWith("\r") ? "\r" : ""
  const content = carriageReturn ? line.slice(0, -1) : line
  const match = /^(\s*data:\s?)(.*)$/u.exec(content)
  const prefix = match?.[1]
  const payload = match?.[2]
  if (!prefix || payload === undefined || payload === "[DONE]") return line

  try {
    return `${prefix}${JSON.stringify(normalizeDeepSeekAnthropicPayload(JSON.parse(payload)))}${carriageReturn}`
  } catch {
    return line
  }
}

function normalizeSseResponse(response: Response) {
  if (!response.body) return response

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffered = ""
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffered += decoder.decode(chunk, { stream: true })
        const lines = buffered.split("\n")
        buffered = lines.pop() ?? ""
        for (const line of lines) controller.enqueue(encoder.encode(`${normalizeSseLine(line)}\n`))
      },
      flush(controller) {
        buffered += decoder.decode()
        if (buffered) controller.enqueue(encoder.encode(normalizeSseLine(buffered)))
      },
    }),
  )
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: normalizedHeaders(response),
  })
}

async function normalizeJsonResponse(response: Response) {
  const raw = await response.text()
  let body = raw
  try {
    body = JSON.stringify(normalizeDeepSeekAnthropicPayload(JSON.parse(raw)))
  } catch {
    // 畸形 JSON 仍交给上层 SDK 产生标准错误，避免在兼容层隐藏真实失败。
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: normalizedHeaders(response),
  })
}

/** 仅用于 DeepSeek 官方 `/anthropic` 端点，不作为通用响应修复器。 */
export function createDeepSeekAnthropicFetch(
  fetchImplementation: FetchImplementation = (input, init) => globalThis.fetch(input, init),
): FetchImplementation {
  return async (input, init) => {
    const response = await fetchImplementation(input, init)
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    if (contentType.includes("text/event-stream")) return normalizeSseResponse(response)
    if (contentType.includes("application/json")) return normalizeJsonResponse(response)
    return response
  }
}
