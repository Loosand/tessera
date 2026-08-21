/**
 * [INPUT]: 已校验的应用外观偏好与类型安全的偏好更新操作
 * [OUTPUT]: 中文主题、形状、全局字体与自定义主题设置界面
 * [POS]: 设置页的外观分区内容组件
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { SettingRow } from "@tessera/design-system/components/setting-row"
import { SettingSection } from "@tessera/design-system/components/setting-section"
import { Button } from "@tessera/design-system/components/ui/button"
import { Input } from "@tessera/design-system/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tessera/design-system/components/ui/select"
import { Switch } from "@tessera/design-system/components/ui/switch"
import type {
  AppPreferences,
  CornerRadiusPreference,
  InterfaceFontPreference,
  ThemePreference,
  UpdateAppPreference,
} from "../hooks/use-app-preferences"

interface AppearanceSettingsProps {
  preferences: AppPreferences
  onUpdatePreference: UpdateAppPreference
}

const THEME_OPTIONS = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
] as const satisfies readonly { id: ThemePreference; label: string }[]

const INTERFACE_FONT_LABELS: Record<InterfaceFontPreference, string> = {
  system: "系统默认",
  geist: "Geist",
  "open-sans": "Open Sans",
}

const CORNER_OPTIONS = [
  { id: "sharp", label: "硬朗", radiusClassName: "rounded-none" },
  { id: "default", label: "默认", radiusClassName: "rounded-md" },
  { id: "soft", label: "柔和", radiusClassName: "rounded-xl" },
] as const satisfies readonly {
  id: CornerRadiusPreference
  label: string
  radiusClassName: string
}[]

function ThemePreview({ mode }: { mode: ThemePreference }) {
  const lightPreview = (
    <span className="flex h-13 flex-1 flex-col gap-1 rounded-sm border border-black/8 bg-white p-2">
      <span className="flex gap-1">
        <span className="size-1.5 rounded-full bg-red-300" />
        <span className="size-1.5 rounded-full bg-amber-300" />
        <span className="size-1.5 rounded-full bg-green-300" />
      </span>
      <span className="mt-1 h-1 w-8 rounded-full bg-neutral-200" />
      <span className="h-1 w-5 rounded-full bg-neutral-200" />
    </span>
  )
  const darkPreview = (
    <span className="flex h-13 flex-1 flex-col gap-1 rounded-sm border border-white/8 bg-neutral-900 p-2">
      <span className="flex gap-1">
        <span className="size-1.5 rounded-full bg-red-400/70" />
        <span className="size-1.5 rounded-full bg-amber-400/70" />
        <span className="size-1.5 rounded-full bg-green-400/70" />
      </span>
      <span className="mt-1 h-1 w-8 rounded-full bg-neutral-600" />
      <span className="h-1 w-5 rounded-full bg-neutral-600" />
    </span>
  )

  return (
    <span className="flex h-15 w-full items-center justify-center gap-1 rounded-lg bg-muted/70 p-1.5">
      {mode === "system" || mode === "light" ? lightPreview : null}
      {mode === "system" || mode === "dark" ? darkPreview : null}
    </span>
  )
}

function ThemeModePicker({
  value,
  onChange,
}: {
  value: ThemePreference
  onChange: (value: ThemePreference) => void
}) {
  return (
    <fieldset className="grid w-[min(100%,390px)] grid-cols-3 gap-1 rounded-xl border border-border bg-muted/45 p-1.5">
      <legend className="sr-only">界面明暗模式</legend>
      {THEME_OPTIONS.map((option) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            className="min-w-0 rounded-lg border border-transparent p-1.5 text-center transition-colors hover:bg-background/65 data-[selected=true]:border-border data-[selected=true]:bg-background data-[selected=true]:shadow-xs"
            data-selected={selected || undefined}
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
          >
            <ThemePreview mode={option.id} />
            <span className="mt-1.5 block truncate text-xs font-medium">{option.label}</span>
          </button>
        )
      })}
    </fieldset>
  )
}

function CornerRadiusPicker({
  value,
  onChange,
}: {
  value: CornerRadiusPreference
  onChange: (value: CornerRadiusPreference) => void
}) {
  return (
    <fieldset className="grid w-[min(100%,390px)] grid-cols-3 gap-1 rounded-xl border border-border bg-muted/45 p-1.5">
      <legend className="sr-only">界面圆角风格</legend>
      {CORNER_OPTIONS.map((option) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            className="min-w-0 rounded-lg border border-transparent p-1.5 text-center transition-colors hover:bg-background/65 data-[selected=true]:border-border data-[selected=true]:bg-background data-[selected=true]:shadow-xs"
            data-selected={selected || undefined}
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
          >
            <span
              className={`mx-auto flex h-13 max-w-24 flex-col gap-1 border border-border bg-background p-2 shadow-xs ${option.radiusClassName}`}
            >
              <span className="h-1 w-full rounded-full bg-muted-foreground/20" />
              <span className="h-1 w-3/5 rounded-full bg-muted-foreground/20" />
              <span className="mt-auto ml-auto h-1.5 w-7 rounded-full bg-muted-foreground" />
            </span>
            <span className="mt-1.5 block truncate text-xs font-medium">{option.label}</span>
          </button>
        )
      })}
    </fieldset>
  )
}

export function AppearanceSettings({ preferences, onUpdatePreference }: AppearanceSettingsProps) {
  return (
    <div className="space-y-9">
      <SettingSection title="主题" description="分别控制界面的明暗模式与主题配色。">
        <SettingRow
          title="界面模式"
          description="跟随系统外观，或固定使用浅色、深色模式。"
          className="grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,390px)]"
          control={
            <ThemeModePicker
              value={preferences.theme}
              onChange={(value) => onUpdatePreference("theme", value)}
            />
          }
        />
        <SettingRow
          title="浅色主题"
          description="更多内置与自定义配色将在主题系统接入后开放。"
          control={
            <Select value="tessera" disabled>
              <SelectTrigger className="w-48" aria-label="浅色主题">
                <SelectValue>{() => "Tessera 浅色"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tessera">Tessera 浅色</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          title="深色主题"
          description="当前使用 Tessera 的默认深色语义色板。"
          control={
            <Select value="tessera-dark" disabled>
              <SelectTrigger className="w-48" aria-label="深色主题">
                <SelectValue>{() => "Tessera 深色"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tessera-dark">Tessera 深色</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          title="半透明侧边栏"
          description="根据桌面背景呈现轻微透色；平台材质能力接入后开放。"
          control={<Switch checked={false} disabled aria-label="半透明侧边栏，即将支持" />}
        />
      </SettingSection>

      <SettingSection title="自定义主题" description="通过 JSON 色板扩展浅色与深色主题；当前先提供操作入口。">
        <SettingRow
          title="主题模板"
          description="从 Tessera 默认语义色板开始编辑名称与颜色值。"
          control={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled title="自定义主题即将支持">
                复制模板
              </Button>
              <Button variant="outline" size="sm" disabled title="自定义主题即将支持">
                保存文件
              </Button>
            </div>
          }
        />
        <SettingRow
          title="导入主题"
          description="选择编辑后的 JSON 文件；导入、校验与差异预览尚未接入。"
          control={
            <Button variant="outline" size="sm" disabled title="自定义主题即将支持">
              选择文件
            </Button>
          }
        />
      </SettingSection>

      <SettingSection title="形状" description="选择面板、按钮与输入控件的圆角风格。">
        <SettingRow
          title="界面圆角"
          description="此偏好会立即应用到设置页与工作区的设计系统组件。"
          className="grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,390px)]"
          control={
            <CornerRadiusPicker
              value={preferences.cornerRadius}
              onChange={(value) => onUpdatePreference("cornerRadius", value)}
            />
          }
        />
      </SettingSection>

      <SettingSection title="界面排版" description="控制导航、菜单、设置与无衬线正文的基础字体。">
        <SettingRow
          title="界面字体"
          description="切换后立即应用到应用界面；正文使用无衬线字体时会一并跟随。"
          control={
            <Select
              value={preferences.interfaceFont}
              onValueChange={(value) => {
                if (value && INTERFACE_FONT_LABELS[value]) onUpdatePreference("interfaceFont", value)
              }}
            >
              <SelectTrigger className="w-48" aria-label="界面字体">
                <SelectValue>{(value: InterfaceFontPreference) => INTERFACE_FONT_LABELS[value]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">系统默认</SelectItem>
                <SelectItem value="geist">Geist</SelectItem>
                <SelectItem value="open-sans">Open Sans</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          title="等宽字体"
          description="用于 Markdown 源码、行内代码、代码块与开发者界面。"
          control={
            <Select value="system-mono" disabled>
              <SelectTrigger className="w-48" aria-label="等宽字体">
                <SelectValue>{() => "系统等宽"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system-mono">系统等宽</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          title="界面字号"
          description="界面字号暂时固定，后续会与密度设置一同开放。"
          control={
            <Input className="w-20 tabular-nums" type="number" value={14} disabled aria-label="界面字号" />
          }
        />
      </SettingSection>
    </div>
  )
}
