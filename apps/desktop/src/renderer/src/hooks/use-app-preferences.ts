/**
 * [INPUT]: 渲染层本地偏好、系统主题变化与偏好更新操作
 * [OUTPUT]: 已校验的应用偏好、Typeset/外观样式副作用和类型安全的更新函数
 * [POS]: 不包含文档正文的轻量界面偏好持久化边界
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { useCallback, useEffect, useState } from "react"
import {
  TYPESET_REFERENCE_PRESET,
  type TypesetPreferences,
  createTypesetCssVariables,
  readTypesetPreferences,
} from "./typeset-preferences"

export type ThemePreference = "system" | "light" | "dark"
export type InterfaceFontPreference = "system" | "geist" | "open-sans"
export type DefaultEditorMode = "rich" | "source"
export type CornerRadiusPreference = "sharp" | "default" | "soft"

export interface AppPreferences extends TypesetPreferences {
  cornerRadius: CornerRadiusPreference
  defaultEditorMode: DefaultEditorMode
  interfaceFont: InterfaceFontPreference
  spellCheck: boolean
  theme: ThemePreference
}

export type UpdateAppPreference = <Key extends keyof AppPreferences>(
  key: Key,
  value: AppPreferences[Key],
) => void

const PREFERENCES_STORAGE_KEY = "tessera.preferences.v2"
const LEGACY_PREFERENCES_STORAGE_KEY = "tessera.preferences.v1"
const THEME_VALUES = new Set<ThemePreference>(["system", "light", "dark"])
const INTERFACE_FONT_VALUES = new Set<InterfaceFontPreference>(["system", "geist", "open-sans"])
const EDITOR_MODE_VALUES = new Set<DefaultEditorMode>(["rich", "source"])
const CORNER_RADIUS_VALUES = new Set<CornerRadiusPreference>(["sharp", "default", "soft"])

const CORNER_RADIUS_CSS: Record<CornerRadiusPreference, string> = {
  sharp: "0rem",
  default: "0.4rem",
  soft: "0.75rem",
}

const INTERFACE_FONT_CSS: Record<InterfaceFontPreference, string> = {
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
  geist:
    "'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
  "open-sans":
    "'Open Sans Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
}

const DEFAULT_PREFERENCES: AppPreferences = {
  ...TYPESET_REFERENCE_PRESET,
  cornerRadius: "default",
  defaultEditorMode: "rich",
  interfaceFont: "system",
  spellCheck: true,
  theme: "system",
}

function isPreferenceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readPreferences(): AppPreferences {
  try {
    const serializedPreferences =
      localStorage.getItem(PREFERENCES_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_PREFERENCES_STORAGE_KEY) ??
      "{}"
    const storedValue: unknown = JSON.parse(serializedPreferences)
    const value = isPreferenceRecord(storedValue) ? storedValue : {}
    return {
      ...readTypesetPreferences(value),
      cornerRadius:
        typeof value.cornerRadius === "string" &&
        CORNER_RADIUS_VALUES.has(value.cornerRadius as CornerRadiusPreference)
          ? (value.cornerRadius as CornerRadiusPreference)
          : DEFAULT_PREFERENCES.cornerRadius,
      defaultEditorMode:
        typeof value.defaultEditorMode === "string" &&
        EDITOR_MODE_VALUES.has(value.defaultEditorMode as DefaultEditorMode)
          ? (value.defaultEditorMode as DefaultEditorMode)
          : DEFAULT_PREFERENCES.defaultEditorMode,
      interfaceFont:
        typeof value.interfaceFont === "string" &&
        INTERFACE_FONT_VALUES.has(value.interfaceFont as InterfaceFontPreference)
          ? (value.interfaceFont as InterfaceFontPreference)
          : DEFAULT_PREFERENCES.interfaceFont,
      spellCheck: typeof value.spellCheck === "boolean" ? value.spellCheck : DEFAULT_PREFERENCES.spellCheck,
      theme:
        typeof value.theme === "string" && THEME_VALUES.has(value.theme as ThemePreference)
          ? (value.theme as ThemePreference)
          : DEFAULT_PREFERENCES.theme,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function useAppPreferences() {
  const [preferences, setPreferences] = useState(readPreferences)
  const {
    cornerRadius,
    interfaceFont,
    typesetBodyFont,
    typesetFlow,
    typesetHeadingFont,
    typesetLeading,
    typesetMeasure,
    typesetMonoFont,
    typesetSize,
  } = preferences

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
    rootStyle.setProperty("--radius", CORNER_RADIUS_CSS[cornerRadius])
    rootStyle.setProperty("--font-interface", INTERFACE_FONT_CSS[interfaceFont])
    const typesetPreferences: TypesetPreferences = {
      typesetBodyFont,
      typesetFlow,
      typesetHeadingFont,
      typesetLeading,
      typesetMeasure,
      typesetMonoFont,
      typesetSize,
    }
    for (const [property, value] of Object.entries(createTypesetCssVariables(typesetPreferences))) {
      rootStyle.setProperty(property, value)
    }
  }, [
    cornerRadius,
    interfaceFont,
    typesetBodyFont,
    typesetFlow,
    typesetHeadingFont,
    typesetLeading,
    typesetMeasure,
    typesetMonoFont,
    typesetSize,
  ])

  const updatePreference = useCallback<UpdateAppPreference>((key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }))
  }, [])

  return { preferences, updatePreference }
}
