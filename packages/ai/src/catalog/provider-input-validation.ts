/**
 * [INPUT]: 来自界面、持久化配置或远端模型目录的 API 根地址与模型 ID
 * [OUTPUT]: 跨配置、目录发现和生成运行时复用的长度、协议与规范化校验结果
 * [POS]: @tessera/ai 中供应商连接与模型身份的无框架输入边界
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

const MAX_BASE_URL_LENGTH = 2_048
const MAX_MODEL_ID_LENGTH = 512

export type AiProviderBaseUrlValidationResult =
  | Readonly<{ baseUrl: string; ok: true; url: URL }>
  | Readonly<{ message: string; ok: false }>

export function validateAiProviderBaseUrl(value: unknown): AiProviderBaseUrlValidationResult {
  const baseUrl = typeof value === "string" ? value.trim() : ""
  if (!baseUrl || baseUrl.length > MAX_BASE_URL_LENGTH) {
    return { message: "请输入有效的 API 地址。", ok: false }
  }

  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return { message: "API 地址必须是完整的 http(s) URL。", ok: false }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { message: "API 地址必须是有效的 http(s) URL。", ok: false }
  }
  if (url.username || url.password) {
    return { message: "API 地址不能包含用户名或密码。", ok: false }
  }
  if (url.search || url.hash) {
    return { message: "API 地址不能包含查询参数或片段。", ok: false }
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/u, "")
  return { baseUrl: normalizedBaseUrl, ok: true, url: new URL(normalizedBaseUrl) }
}

export function normalizeAiProviderModelId(value: unknown): string | null {
  const modelId = typeof value === "string" ? value.trim() : ""
  return modelId && modelId.length <= MAX_MODEL_ID_LENGTH ? modelId : null
}
