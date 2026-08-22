/**
 * [INPUT]: 类型化 AI 连接配置、可选目录鉴权、供应商模型目录 HTTP 响应与可注入 fetch
 * [OUTPUT]: 支持公共目录与鉴权目录、经校验去重并提取模态/能力/限额远端信号的模型目录以及可安全展示的连接错误
 * [POS]: @tessera/ai/server 的供应商模型发现适配层
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  type AiModelCapabilities,
  type AiProviderConnectionInput,
  type AiProviderId,
  type AiProviderModel,
  isAiProviderId,
} from "@tessera/contracts"

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_BASE_URL_LENGTH = 2_048
const MAX_API_KEY_LENGTH = 16_384
const MAX_ERROR_MESSAGE_LENGTH = 320
const MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024
const INFERENCE_PATH_SUFFIXES = ["/chat/completions", "/responses", "/response", "/messages"] as const

export type AiModelDiscoveryOptions = {
  fetch?: typeof fetch
  timeoutMs?: number
}

export class AiProviderConnectionError extends Error {
  constructor(
    message: string,
    readonly code: "catalog-unsupported" | "request-failed" = "request-failed",
  ) {
    super(message)
  }

  override readonly name = "AiProviderConnectionError"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function validateConnection(input: AiProviderConnectionInput) {
  if (!isRecord(input) || !isAiProviderId(input.providerId)) {
    throw new AiProviderConnectionError("不支持这个 AI 供应商。")
  }

  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : ""
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : ""
  const configId = typeof input.configId === "string" ? input.configId.trim() : ""
  if (!configId || configId.length > 128) throw new AiProviderConnectionError("连接 ID 无效。")
  if (apiKey.length > MAX_API_KEY_LENGTH) throw new AiProviderConnectionError("API Key 长度无效。")
  if (!baseUrl || baseUrl.length > MAX_BASE_URL_LENGTH) {
    throw new AiProviderConnectionError("请输入有效的 API 地址。")
  }

  let parsedBaseUrl: URL
  try {
    parsedBaseUrl = new URL(baseUrl)
  } catch {
    throw new AiProviderConnectionError("API 地址必须是完整的 http(s) URL。")
  }
  if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") {
    throw new AiProviderConnectionError("API 地址只支持 http 或 https 协议。")
  }
  if (parsedBaseUrl.username || parsedBaseUrl.password) {
    throw new AiProviderConnectionError("API 地址不能包含用户名或密码。")
  }
  if (parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new AiProviderConnectionError("API 地址不能包含查询参数或片段。")
  }

  return { apiKey, baseUrl: parsedBaseUrl, configId, providerId: input.providerId }
}

export function createAiModelCatalogUrl(providerId: AiProviderId, baseUrl: string): string {
  const connection = validateConnection({ configId: providerId, providerId, baseUrl, apiKey: "" })
  const url = new URL(connection.baseUrl)
  let normalizedPath = url.pathname.replace(/\/+$/u, "")
  const lowercasePath = normalizedPath.toLocaleLowerCase()
  const inferenceSuffix = INFERENCE_PATH_SUFFIXES.find((suffix) => lowercasePath.endsWith(suffix))
  if (inferenceSuffix) normalizedPath = normalizedPath.slice(0, -inferenceSuffix.length)

  if (!normalizedPath.toLocaleLowerCase().endsWith("/models")) {
    const hasVersionPath = /\/v\d+(?:beta)?$/iu.test(normalizedPath)
    const isOfficialDeepSeekRoot =
      providerId === "deepseek" &&
      url.hostname === "api.deepseek.com" &&
      (normalizedPath === "" || normalizedPath === "/")
    const prefix = hasVersionPath || isOfficialDeepSeekRoot ? normalizedPath : `${normalizedPath}/v1`
    normalizedPath = `${prefix}/models`
  }
  url.pathname = normalizedPath.replace(/\/{2,}/gu, "/")
  if (providerId === "anthropic-compatible" && !url.searchParams.has("limit")) {
    url.searchParams.set("limit", "1000")
  }
  return url.toString()
}

type AuthKind = "anthropic" | "bearer"

function createHeaders(authKind: AuthKind, apiKey: string): Headers {
  const headers = new Headers({ accept: "application/json", "content-type": "application/json" })
  if (authKind === "anthropic") {
    if (apiKey) headers.set("x-api-key", apiKey)
    headers.set("anthropic-version", "2023-06-01")
  } else if (apiKey) {
    headers.set("authorization", `Bearer ${apiKey}`)
  }
  return headers
}

function authAttempts(providerId: AiProviderId, baseUrl: URL, apiKey: string): AuthKind[] {
  if (providerId !== "anthropic-compatible") return ["bearer"]
  if (!apiKey) return ["anthropic"]
  return baseUrl.hostname === "api.anthropic.com" ? ["anthropic"] : ["bearer", "anthropic"]
}

function modelCandidates(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body
  if (!isRecord(body)) return null
  if (Array.isArray(body.data)) return body.data
  if (Array.isArray(body.models)) return body.models
  return null
}

function positiveInteger(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  }
  return null
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase())
}

function remoteCapabilities(candidate: Record<string, unknown>): AiModelCapabilities | null {
  const architecture = isRecord(candidate.architecture) ? candidate.architecture : null
  const inputModalities = stringArray(
    architecture?.input_modalities ?? architecture?.inputModalities ?? candidate.input_modalities,
  )
  const supportedParameters = stringArray(candidate.supported_parameters ?? candidate.supportedParameters)
  if (!inputModalities && !supportedParameters) return null

  return {
    functionCall: supportedParameters?.some((parameter) =>
      ["tools", "tool_choice", "function_call", "functions"].includes(parameter),
    )
      ? "supported"
      : "unknown",
    reasoning: supportedParameters?.some((parameter) =>
      ["reasoning", "reasoning_effort", "include_reasoning"].includes(parameter),
    )
      ? "supported"
      : "unknown",
    structuredOutput: supportedParameters?.some((parameter) =>
      ["response_format", "structured_outputs", "json_schema"].includes(parameter),
    )
      ? "supported"
      : "unknown",
  }
}

function normalizeModels(body: unknown): AiProviderModel[] {
  const candidates = modelCandidates(body)
  if (!candidates) throw new AiProviderConnectionError("供应商返回了无法识别的模型列表格式。")

  const models: AiProviderModel[] = []
  const knownIds = new Set<string>()
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const id = optionalString(candidate.id)
    if (!id || knownIds.has(id)) continue
    knownIds.add(id)
    const topProvider = isRecord(candidate.top_provider) ? candidate.top_provider : null
    const capabilities = remoteCapabilities(candidate)
    const architecture = isRecord(candidate.architecture) ? candidate.architecture : null
    const inputModalities = stringArray(
      architecture?.input_modalities ?? architecture?.inputModalities ?? candidate.input_modalities,
    )?.filter((modality): modality is "audio" | "image" | "text" | "video" | "vector" =>
      ["audio", "image", "text", "video", "vector"].includes(modality),
    )
    models.push({
      ...(capabilities
        ? {
            capabilities,
            capabilitySources: {
              functionCall: "remote" as const,
              reasoning: "remote" as const,
              structuredOutput: "remote" as const,
            },
          }
        : {}),
      id,
      ...(inputModalities?.length
        ? { fieldSources: { inputModalities: "remote" as const }, inputModalities }
        : {}),
      name: optionalString(candidate.name) ?? optionalString(candidate.display_name),
      ownedBy: optionalString(candidate.owned_by),
      contextWindow: positiveInteger(
        candidate.context_length,
        candidate.inputTokenLimit,
        candidate.max_input_tokens,
        topProvider?.context_length,
      ),
      maxOutputTokens: positiveInteger(
        candidate.max_output_tokens,
        candidate.max_tokens,
        candidate.outputTokenLimit,
        topProvider?.max_completion_tokens,
      ),
    })
  }
  return models
}

function responseErrorMessage(body: unknown, fallback: string): string {
  if (!isRecord(body)) return fallback
  if (typeof body.error === "string" && body.error.trim()) return body.error.trim()
  const nestedError = isRecord(body.error) ? body.error : null
  return optionalString(nestedError?.message) ?? optionalString(body.message) ?? fallback
}

async function readLimitedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new AiProviderConnectionError("供应商模型列表响应过大。")
  }
  if (!response.body) return ""

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let totalBytes = 0
  let text = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new AiProviderConnectionError("供应商模型列表响应过大。")
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

type DiscoveryFailure = {
  message: string
  status: number | null
}

function preferredFailure(failures: readonly DiscoveryFailure[]): DiscoveryFailure | null {
  return (
    [...failures].reverse().find((failure) => failure.status !== 404 && failure.status !== 405) ??
    failures.at(-1) ??
    null
  )
}

function redactErrorMessage(message: string, apiKey: string): string {
  const redacted = apiKey ? message.split(apiKey).join("[已隐藏]") : message
  return redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

export async function listAiProviderModels(
  input: AiProviderConnectionInput,
  options: AiModelDiscoveryOptions = {},
): Promise<AiProviderModel[]> {
  const connection = validateConnection(input)
  const endpoint = createAiModelCatalogUrl(connection.providerId, connection.baseUrl.toString())
  const controller = new AbortController()
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const failures: DiscoveryFailure[] = []
    let emptyResult: AiProviderModel[] | null = null

    for (const authKind of authAttempts(connection.providerId, connection.baseUrl, connection.apiKey)) {
      let response: Response
      try {
        response = await (options.fetch ?? globalThis.fetch)(endpoint, {
          method: "GET",
          headers: createHeaders(authKind, connection.apiKey),
          redirect: "error",
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) throw error
        const detail = error instanceof Error ? error.message : "未知网络错误"
        failures.push({
          status: null,
          message: `无法连接供应商：${redactErrorMessage(detail, connection.apiKey)}`,
        })
        continue
      }

      const responseText = await readLimitedResponse(response)
      let body: unknown = null
      if (responseText) {
        try {
          body = JSON.parse(responseText)
        } catch {
          if (response.ok) {
            failures.push({ status: response.status, message: "供应商返回的模型列表不是有效 JSON。" })
            continue
          }
        }
      }

      if (!response.ok) {
        const fallback = `模型目录请求失败（HTTP ${response.status}）。`
        failures.push({
          status: response.status,
          message: redactErrorMessage(responseErrorMessage(body, fallback), connection.apiKey),
        })
        continue
      }

      try {
        const models = normalizeModels(body)
        if (models.length > 0) return models
        emptyResult = models
      } catch (error) {
        failures.push({
          status: response.status,
          message: error instanceof Error ? error.message : "供应商返回了无法识别的模型列表格式。",
        })
      }
    }

    if (emptyResult) return emptyResult
    const failure = preferredFailure(failures)
    if (failure?.status === 404 || failure?.status === 405) {
      throw new AiProviderConnectionError(
        "此兼容端点未提供模型目录；这不影响推理，请手动添加模型 ID。",
        "catalog-unsupported",
      )
    }
    throw new AiProviderConnectionError(failure?.message ?? "请求供应商模型列表失败。")
  } catch (error) {
    if (error instanceof AiProviderConnectionError) throw error
    if (controller.signal.aborted) {
      throw new AiProviderConnectionError(`连接供应商超时（${timeoutMs}ms）。`)
    }
    const detail = error instanceof Error ? error.message : "未知网络错误"
    throw new AiProviderConnectionError(`无法连接供应商：${redactErrorMessage(detail, connection.apiKey)}`)
  } finally {
    clearTimeout(timeout)
  }
}
