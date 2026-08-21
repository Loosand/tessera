/**
 * [INPUT]: 渲染层本地偏好、系统主题变化与偏好更新操作
 * [OUTPUT]: 已校验的应用偏好、外观与编辑器样式副作用和类型安全的更新函数
 * [POS]: 不包含文档正文的轻量界面偏好持久化边界
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { useCallback, useEffect, useState } from "react"

export type ThemePreference = "system" | "light" | "dark"
export type DefaultEditorMode = "rich" | "source"
export type CornerRadiusPreference = "sharp" | "default" | "soft"
export type EditorFontPreference = "sans" | "serif"
export type EditorWidthPreference = "compact" | "comfortable" | "wide"

export interface AppPreferences {
  cornerRadius: CornerRadiusPreference
  defaultEditorMode: DefaultEditorMode
  editorFont: EditorFontPreference
  editorFontSize: number
  editorWidth: EditorWidthPreference
  spellCheck: boolean
  theme: ThemePreference
}

export type UpdateAppPreference = <Key extends keyof AppPreferences>(
  key: Key,
  value: AppPreferences[Key],
) => void

const PREFERENCES_STORAGE_KEY = "tessera.preferences.v1"
const THEME_VALUES = new Set<ThemePreference>(["system", "light", "dark"])
const EDITOR_MODE_VALUES = new Set<DefaultEditorMode>(["rich", "source"])
const CORNER_RADIUS_VALUES = new Set<CornerRadiusPreference>(["sharp", "default", "soft"])
const EDITOR_FONT_VALUES = new Set<EditorFontPreference>(["sans", "serif"])
const EDITOR_WIDTH_VALUES = new Set<EditorWidthPreference>(["compact", "comfortable", "wide"])

const CORNER_RADIUS_CSS: Record<CornerRadiusPreference, string> = {
  sharp: "0rem",
  default: "0.4rem",
  soft: "0.75rem",
}

const EDITOR_FONT_CSS: Record<EditorFontPreference, string> = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  serif: "ui-serif, 'Songti SC', 'STSong', 'Noto Serif CJK SC', Georgia, serif",
}

const EDITOR_WIDTH_CSS: Record<EditorWidthPreference, string> = {
  compact: "760px",
  comfortable: "900px",
  wide: "1200px",
}

const DEFAULT_PREFERENCES: AppPreferences = {
  cornerRadius: "default",
  defaultEditorMode: "rich",
  editorFont: "sans",
  editorFontSize: 16,
  editorWidth: "comfortable",
  spellCheck: true,
  theme: "system",
}

function readEditorFontSize(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 12 && value <= 24
    ? Math.round(value)
    : DEFAULT_PREFERENCES.editorFontSize
}

function readPreferences(): AppPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "{}") as Partial<AppPreferences>
    return {
      cornerRadius:
        value.cornerRadius && CORNER_RADIUS_VALUES.has(value.cornerRadius)
          ? value.cornerRadius
          : DEFAULT_PREFERENCES.cornerRadius,
      defaultEditorMode:
        value.defaultEditorMode && EDITOR_MODE_VALUES.has(value.defaultEditorMode)
          ? value.defaultEditorMode
          : DEFAULT_PREFERENCES.defaultEditorMode,
      editorFont:
        value.editorFont && EDITOR_FONT_VALUES.has(value.editorFont)
          ? value.editorFont
          : DEFAULT_PREFERENCES.editorFont,
      editorFontSize: readEditorFontSize(value.editorFontSize),
      editorWidth:
        value.editorWidth && EDITOR_WIDTH_VALUES.has(value.editorWidth)
          ? value.editorWidth
          : DEFAULT_PREFERENCES.editorWidth,
      spellCheck: typeof value.spellCheck === "boolean" ? value.spellCheck : DEFAULT_PREFERENCES.spellCheck,
      theme: value.theme && THEME_VALUES.has(value.theme) ? value.theme : DEFAULT_PREFERENCES.theme,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function useAppPreferences() {
  const [preferences, setPreferences] = useState(readPreferences)

  useEffect(() => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  }, [preferences])

  useEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
    const applyTheme = () => {
      const dark = preferences.theme === "dark" || (preferences.theme === "system" && systemTheme.matches)
      document.documentElement.classList.toggle("dark", dark)
    }

    applyTheme()
    if (preferences.theme !== "system") return
    systemTheme.addEventListener("change", applyTheme)
    return () => systemTheme.removeEventListener("change", applyTheme)
  }, [preferences.theme])

  useEffect(() => {
    const rootStyle = document.documentElement.style
    rootStyle.setProperty("--radius", CORNER_RADIUS_CSS[preferences.cornerRadius])
    rootStyle.setProperty("--font-content", EDITOR_FONT_CSS[preferences.editorFont])
    rootStyle.setProperty("--editor-font-size", `${preferences.editorFontSize}px`)
    rootStyle.setProperty("--editor-max-width", EDITOR_WIDTH_CSS[preferences.editorWidth])
  }, [preferences.cornerRadius, preferences.editorFont, preferences.editorFontSize, preferences.editorWidth])

  const updatePreference = useCallback<UpdateAppPreference>((key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }))
  }, [])

  return { preferences, updatePreference }
}
