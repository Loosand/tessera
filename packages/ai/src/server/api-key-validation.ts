/**
 * [INPUT]: 即将持久化或写入供应商鉴权请求头的 API Key
 * [OUTPUT]: 不回显密钥内容的长度与可打印 ASCII 格式校验结果
 * [POS]: @tessera/ai/server 中配置、目录发现与生成运行时共用的密钥边界
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

const MAX_AI_PROVIDER_API_KEY_LENGTH = 16_384

const INVALID_API_KEY_FORMAT_MESSAGE =
  "API Key 格式无效：请只粘贴供应商提供的原始 Key，不要包含中文、空格、换行或说明文字。"

export function aiProviderApiKeyValidationMessage(apiKey: string): string | null {
  if (apiKey.length > MAX_AI_PROVIDER_API_KEY_LENGTH) return "API Key 长度无效。"
  for (const character of apiKey) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 0x21 || codePoint > 0x7e) return INVALID_API_KEY_FORMAT_MESSAGE
  }
  return null
}
