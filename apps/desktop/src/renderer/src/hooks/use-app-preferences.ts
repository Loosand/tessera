/**
 * [INPUT]: 渲染层本地偏好、系统主题变化与偏好更新操作
 * [OUTPUT]: 已校验的应用偏好、主题副作用和类型安全的更新函数
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

export interface AppPreferences {
  defaultEditorMode: DefaultEditorMode
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

const DEFAULT_PREFERENCES: AppPreferences = {
  defaultEditorMode: "rich",
  spellCheck: true,
  theme: "system",
}

function readPreferences(): AppPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "{}") as Partial<AppPreferences>
    return {
      defaultEditorMode:
        value.defaultEditorMode && EDITOR_MODE_VALUES.has(value.defaultEditorMode)
          ? value.defaultEditorMode
          : DEFAULT_PREFERENCES.defaultEditorMode,
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

  const updatePreference = useCallback<UpdateAppPreference>((key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }))
  }, [])

  return { preferences, updatePreference }
}
