/**
 * [INPUT]: 持久化的未知偏好值、旧版编辑器排版字段与本地字体目录
 * [OUTPUT]: 已校验的 Typeset 偏好、参考/随机预设、控件范围和 CSS 变量映射
 * [POS]: Markdown 主题设置、实时预览与编辑器运行时之间的纯数据协议
 * [DOC]: design.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export type TypesetProportionalFontPreference =
  | "system-sans"
  | "geist"
  | "open-sans"
  | "space-grotesk"
  | "montserrat"
  | "nunito-sans"
  | "outfit"
  | "oxanium"
  | "lora"
  | "system-serif"

export type TypesetMonoFontPreference = "system-mono" | "jetbrains-mono"

export interface TypesetPreferences {
  typesetBodyFont: TypesetProportionalFontPreference
  typesetFlow: number
  typesetHeadingFont: TypesetProportionalFontPreference
  typesetLeading: number
  typesetMeasure: number
  typesetMonoFont: TypesetMonoFontPreference
  typesetSize: number
}

export const TYPESET_PROPORTIONAL_FONT_OPTIONS = [
  { id: "system-sans", label: "系统无衬线" },
  { id: "geist", label: "Geist" },
  { id: "open-sans", label: "Open Sans" },
  { id: "space-grotesk", label: "Space Grotesk" },
  { id: "montserrat", label: "Montserrat" },
  { id: "nunito-sans", label: "Nunito Sans" },
  { id: "outfit", label: "Outfit" },
  { id: "oxanium", label: "Oxanium" },
  { id: "lora", label: "Lora" },
  { id: "system-serif", label: "系统衬线" },
] as const satisfies readonly { id: TypesetProportionalFontPreference; label: string }[]

export const TYPESET_MONO_FONT_OPTIONS = [
  { id: "system-mono", label: "系统等宽" },
  { id: "jetbrains-mono", label: "JetBrains Mono" },
] as const satisfies readonly { id: TypesetMonoFontPreference; label: string }[]

export const TYPESET_LIMITS = {
  flow: { max: 2.5, min: 0.75, step: 0.05 },
  leading: { max: 2.2, min: 1.4, step: 0.05 },
  measure: { max: 120, min: 45, step: 1 },
  size: { max: 24, min: 12, step: 1 },
} as const

export const TYPESET_REFERENCE_PRESET: TypesetPreferences = {
  typesetBodyFont: "oxanium",
  typesetFlow: 1,
  typesetHeadingFont: "nunito-sans",
  typesetLeading: 1.9,
  typesetMeasure: 70,
  typesetMonoFont: "jetbrains-mono",
  typesetSize: 18,
}

export const TYPESET_PROPORTIONAL_FONT_CSS: Record<TypesetProportionalFontPreference, string> = {
  geist:
    "'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
  lora: "'Lora Variable', 'Songti SC', 'STSong', 'Noto Serif CJK SC', Georgia, ui-serif, serif",
  montserrat:
    "'Montserrat Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
  "nunito-sans":
    "'Nunito Sans Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
  "open-sans":
    "'Open Sans Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
  outfit:
    "'Outfit Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
  oxanium:
    "'Oxanium Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
  "space-grotesk":
    "'Space Grotesk Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
  "system-sans":
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
  "system-serif": "ui-serif, 'Songti SC', 'STSong', 'Noto Serif CJK SC', Georgia, serif",
}

export const TYPESET_MONO_FONT_CSS: Record<TypesetMonoFontPreference, string> = {
  "jetbrains-mono":
    "'JetBrains Mono Variable', 'SFMono-Regular', Consolas, 'Liberation Mono', ui-monospace, monospace",
  "system-mono": "'SFMono-Regular', Consolas, 'Liberation Mono', ui-monospace, monospace",
}

const PROPORTIONAL_FONT_VALUES = new Set<TypesetProportionalFontPreference>(
  TYPESET_PROPORTIONAL_FONT_OPTIONS.map((option) => option.id),
)
const MONO_FONT_VALUES = new Set<TypesetMonoFontPreference>(
  TYPESET_MONO_FONT_OPTIONS.map((option) => option.id),
)
const LEGACY_MEASURE: Record<string, number> = {
  compact: 64,
  comfortable: 80,
  wide: 104,
}
const LEGACY_TYPESET_FALLBACK = {
  flow: 1.25,
  leading: 1.75,
  measure: 80,
  size: 16,
} as const

const RANDOM_TYPESET_FONT_PAIRS = [
  { body: "oxanium", heading: "nunito-sans" },
  { body: "outfit", heading: "lora" },
  { body: "space-grotesk", heading: "montserrat" },
  { body: "open-sans", heading: "outfit" },
  { body: "nunito-sans", heading: "geist" },
  { body: "geist", heading: "space-grotesk" },
] as const satisfies readonly {
  body: TypesetProportionalFontPreference
  heading: TypesetProportionalFontPreference
}[]
const RANDOM_TYPESET_SIZES = [14, 15, 16, 17, 18] as const
const RANDOM_TYPESET_LEADING = [1.6, 1.7, 1.75, 1.8, 1.9] as const
const RANDOM_TYPESET_FLOW = [1, 1.1, 1.25, 1.5, 1.75] as const
const RANDOM_TYPESET_MEASURE = [64, 70, 76, 80, 90] as const
const RANDOM_TYPESET_MONO = ["system-mono", "jetbrains-mono"] as const

function pickRandom<const Values extends readonly [unknown, ...unknown[]]>(
  values: Values,
  random: () => number,
): Values[number] {
  const sampledValue = random()
  const normalizedValue = Number.isFinite(sampledValue) ? Math.min(0.999_999, Math.max(0, sampledValue)) : 0
  return values[Math.floor(normalizedValue * values.length)] ?? values[0]
}

function readNumber(value: unknown, limits: { max: number; min: number; step: number }, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < limits.min || value > limits.max) {
    return fallback
  }
  const precision = limits.step < 1 ? 2 : 0
  return Number(value.toFixed(precision))
}

function hasNewTypesetPreference(value: Record<string, unknown>) {
  return Object.keys(TYPESET_REFERENCE_PRESET).some((key) => key in value)
}

function hasLegacyTypesetPreference(value: Record<string, unknown>) {
  return "editorFont" in value || "editorFontSize" in value || "editorWidth" in value
}

function readProportionalFont(value: unknown, fallback: TypesetProportionalFontPreference) {
  return typeof value === "string" && PROPORTIONAL_FONT_VALUES.has(value as TypesetProportionalFontPreference)
    ? (value as TypesetProportionalFontPreference)
    : fallback
}

function readMonoFont(value: unknown, fallback: TypesetMonoFontPreference) {
  return typeof value === "string" && MONO_FONT_VALUES.has(value as TypesetMonoFontPreference)
    ? (value as TypesetMonoFontPreference)
    : fallback
}

function migrateLegacyTypesetPreferences(value: Record<string, unknown>): TypesetPreferences {
  const proportionalFont = value.editorFont === "serif" ? "system-serif" : "system-sans"
  return {
    typesetBodyFont: proportionalFont,
    typesetFlow: LEGACY_TYPESET_FALLBACK.flow,
    typesetHeadingFont: proportionalFont,
    typesetLeading: LEGACY_TYPESET_FALLBACK.leading,
    typesetMeasure:
      typeof value.editorWidth === "string"
        ? (LEGACY_MEASURE[value.editorWidth] ?? LEGACY_TYPESET_FALLBACK.measure)
        : LEGACY_TYPESET_FALLBACK.measure,
    typesetMonoFont: "system-mono",
    typesetSize: readNumber(value.editorFontSize, TYPESET_LIMITS.size, LEGACY_TYPESET_FALLBACK.size),
  }
}

export function readTypesetPreferences(value: Record<string, unknown>): TypesetPreferences {
  if (!hasNewTypesetPreference(value) && hasLegacyTypesetPreference(value)) {
    return migrateLegacyTypesetPreferences(value)
  }

  return {
    typesetBodyFont: readProportionalFont(value.typesetBodyFont, TYPESET_REFERENCE_PRESET.typesetBodyFont),
    typesetFlow: readNumber(value.typesetFlow, TYPESET_LIMITS.flow, TYPESET_REFERENCE_PRESET.typesetFlow),
    typesetHeadingFont: readProportionalFont(
      value.typesetHeadingFont,
      TYPESET_REFERENCE_PRESET.typesetHeadingFont,
    ),
    typesetLeading: readNumber(
      value.typesetLeading,
      TYPESET_LIMITS.leading,
      TYPESET_REFERENCE_PRESET.typesetLeading,
    ),
    typesetMeasure: readNumber(
      value.typesetMeasure,
      TYPESET_LIMITS.measure,
      TYPESET_REFERENCE_PRESET.typesetMeasure,
    ),
    typesetMonoFont: readMonoFont(value.typesetMonoFont, TYPESET_REFERENCE_PRESET.typesetMonoFont),
    typesetSize: readNumber(value.typesetSize, TYPESET_LIMITS.size, TYPESET_REFERENCE_PRESET.typesetSize),
  }
}

export function createRandomTypesetPreferences(random: () => number = Math.random): TypesetPreferences {
  const fontPair = pickRandom(RANDOM_TYPESET_FONT_PAIRS, random)
  return {
    typesetBodyFont: fontPair.body,
    typesetFlow: pickRandom(RANDOM_TYPESET_FLOW, random),
    typesetHeadingFont: fontPair.heading,
    typesetLeading: pickRandom(RANDOM_TYPESET_LEADING, random),
    typesetMeasure: pickRandom(RANDOM_TYPESET_MEASURE, random),
    typesetMonoFont: pickRandom(RANDOM_TYPESET_MONO, random),
    typesetSize: pickRandom(RANDOM_TYPESET_SIZES, random),
  }
}

export function createTypesetCssVariables(preferences: TypesetPreferences): Record<string, string> {
  return {
    "--editor-font-size": `${preferences.typesetSize}px`,
    "--editor-measure": `${preferences.typesetMeasure}ch`,
    "--editor-typeset-flow": `${preferences.typesetFlow}em`,
    "--editor-typeset-font-body": TYPESET_PROPORTIONAL_FONT_CSS[preferences.typesetBodyFont],
    "--editor-typeset-font-heading": TYPESET_PROPORTIONAL_FONT_CSS[preferences.typesetHeadingFont],
    "--editor-typeset-font-mono": TYPESET_MONO_FONT_CSS[preferences.typesetMonoFont],
    "--editor-typeset-leading": String(preferences.typesetLeading),
    "--editor-typeset-size": `${preferences.typesetSize}px`,
    "--font-content": TYPESET_PROPORTIONAL_FONT_CSS[preferences.typesetBodyFont],
  }
}
