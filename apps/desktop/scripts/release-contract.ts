/**
 * [INPUT]: 根包与桌面包版本、Git Tag、发行环境变量
 * [OUTPUT]: 可测试的 macOS Alpha 发行契约校验
 * [POS]: GitHub Release 与 Electron Builder 之间的纯规则层
 * [DOC]: docs/architecture/release.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

const ALPHA_VERSION_PATTERN = /^\d+\.\d+\.\d+-alpha\.\d+$/u

export const RELEASE_SIGNING_ENVIRONMENT_KEYS = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
] as const

export type ReleaseEnvironment = Readonly<Record<string, string | undefined>>

export type AlphaReleaseContractInput = Readonly<{
  desktopVersion: string
  environment: ReleaseEnvironment
  rootVersion: string
  tag: string | undefined
}>

export function collectAlphaReleaseContractErrors(input: AlphaReleaseContractInput): string[] {
  const errors: string[] = []

  if (!ALPHA_VERSION_PATTERN.test(input.desktopVersion)) {
    errors.push(`桌面版本必须使用 x.y.z-alpha.n 格式，当前为 ${input.desktopVersion || "空"}。`)
  }

  if (input.rootVersion !== input.desktopVersion) {
    errors.push(`根包版本 ${input.rootVersion} 与桌面包版本 ${input.desktopVersion} 不一致。`)
  }

  const expectedTag = `v${input.desktopVersion}`
  if (!input.tag) {
    errors.push(`缺少发行 Tag；需要从 ${expectedTag} 触发。`)
  } else if (input.tag !== expectedTag) {
    errors.push(`发行 Tag ${input.tag} 与桌面版本不一致；预期 ${expectedTag}。`)
  }

  const missingEnvironmentKeys = RELEASE_SIGNING_ENVIRONMENT_KEYS.filter(
    (key) => !input.environment[key]?.trim(),
  )
  if (missingEnvironmentKeys.length > 0) {
    errors.push(`缺少正式签名或公证环境变量：${missingEnvironmentKeys.join("、")}。`)
  }

  return errors
}

export function assertAlphaReleaseContract(input: AlphaReleaseContractInput): void {
  const errors = collectAlphaReleaseContractErrors(input)
  if (errors.length > 0) throw new Error(`macOS Alpha 发行预检失败：\n- ${errors.join("\n- ")}`)
}
