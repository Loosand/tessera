/**
 * [INPUT]: 已校验的编辑器偏好与类型安全的偏好更新操作
 * [OUTPUT]: 中文编辑器排版、行为与呈现设置界面
 * [POS]: 设置页的编辑器分区内容组件
 * [DOC]: design.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { SettingRow } from "@tessera/design-system/components/setting-row"
import { SettingSection } from "@tessera/design-system/components/setting-section"
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
  DefaultEditorMode,
  EditorFontPreference,
  EditorWidthPreference,
  UpdateAppPreference,
} from "../hooks/use-app-preferences"

interface EditorSettingsProps {
  preferences: AppPreferences
  onUpdatePreference: UpdateAppPreference
}

const EDITOR_MODE_LABELS: Record<DefaultEditorMode, string> = {
  rich: "即时预览编辑",
  source: "Markdown 源码",
}

const EDITOR_FONT_LABELS: Record<EditorFontPreference, string> = {
  sans: "系统无衬线",
  serif: "系统衬线",
}

const EDITOR_WIDTH_LABELS: Record<EditorWidthPreference, string> = {
  compact: "紧凑",
  comfortable: "舒适",
  wide: "宽幅",
}

function PlannedToggle({ label, checked = false }: { label: string; checked?: boolean }) {
  return <Switch checked={checked} disabled aria-label={`${label}，即将支持`} />
}

export function EditorSettings({ preferences, onUpdatePreference }: EditorSettingsProps) {
  return (
    <div className="space-y-9">
      <SettingSection title="编辑器排版" description="单独调整正文阅读字体和字号，不影响应用界面。">
        <SettingRow
          title="正文字体"
          description="应用于即时预览与渲染后的正文；Markdown 源码仍使用等宽字体。"
          control={
            <Select
              value={preferences.editorFont}
              onValueChange={(value) => {
                if (value && EDITOR_FONT_LABELS[value]) onUpdatePreference("editorFont", value)
              }}
            >
              <SelectTrigger className="w-48" aria-label="编辑器正文字体">
                <SelectValue>{(value: EditorFontPreference) => EDITOR_FONT_LABELS[value]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sans">系统无衬线</SelectItem>
                <SelectItem value="serif">系统衬线</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          title="编辑器字号"
          description="调整即时预览与 Markdown 源码的基础阅读字号，可设置为 12–24 像素。"
          control={
            <div className="flex items-center gap-2">
              <Input
                className="w-20 tabular-nums"
                type="number"
                min={12}
                max={24}
                step={1}
                value={preferences.editorFontSize}
                aria-label="编辑器字号"
                onChange={(event) => {
                  const nextValue = Number(event.currentTarget.value)
                  if (!Number.isFinite(nextValue)) return
                  onUpdatePreference("editorFontSize", Math.min(24, Math.max(12, Math.round(nextValue))))
                }}
              />
              <span className="text-xs text-muted-foreground">px</span>
            </div>
          }
        />
      </SettingSection>

      <SettingSection title="编辑行为" description="控制文档打开方式、输入辅助与 Markdown 结构提示。">
        <SettingRow
          title="默认编辑模式"
          description="打开文档时默认使用的模式；文档顶部仍可使用 ⌘/ 快速切换。"
          control={
            <Select
              value={preferences.defaultEditorMode}
              onValueChange={(value) => {
                if (value && EDITOR_MODE_LABELS[value]) onUpdatePreference("defaultEditorMode", value)
              }}
            >
              <SelectTrigger className="w-48" aria-label="默认编辑模式">
                <SelectValue>{(value: DefaultEditorMode) => EDITOR_MODE_LABELS[value]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rich">即时预览编辑</SelectItem>
                <SelectItem value="source">Markdown 源码</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          title="浮动目录"
          description="在正文旁显示当前文档的标题目录；当前可从工作区侧栏查看大纲。"
          control={<PlannedToggle label="浮动目录" checked />}
        />
        <SettingRow
          title="显示 Frontmatter"
          description="编辑时在文档顶部呈现 YAML 元数据；关闭后仍会保留原始内容。"
          control={<PlannedToggle label="显示 Frontmatter" />}
        />
        <SettingRow
          title="标题级别标记"
          description="在标题旁显示 H1–H6 层级，帮助辨认长文结构。"
          control={<PlannedToggle label="标题级别标记" />}
        />
        <SettingRow
          title="彩色标题"
          description="用分级语义色区分 H1–H6；色板选择与可访问性校验尚未接入。"
          control={<PlannedToggle label="彩色标题" />}
        />
        <SettingRow
          title="可折叠标题"
          description="在编辑与阅读时折叠某个标题下的内容。"
          control={<PlannedToggle label="可折叠标题" />}
        />
        <SettingRow
          title="可折叠列表"
          description="在嵌套列表旁显示折叠控件，收起当前分支。"
          control={<PlannedToggle label="可折叠列表" />}
        />
        <SettingRow
          title="拼写检查"
          description="使用 Chromium 的拼写检查能力标记可能的拼写问题。"
          control={
            <Switch
              checked={preferences.spellCheck}
              onCheckedChange={(checked) => onUpdatePreference("spellCheck", checked)}
              aria-label="拼写检查"
            />
          }
        />
      </SettingSection>

      <SettingSection title="编辑器呈现" description="选择文档在写作表面中的宽度和辅助视觉。">
        <SettingRow
          title="正文宽度"
          description="紧凑适合专注写作，舒适兼顾中文阅读，宽幅适合表格与复杂材料。"
          control={
            <Select
              value={preferences.editorWidth}
              onValueChange={(value) => {
                if (value && EDITOR_WIDTH_LABELS[value]) onUpdatePreference("editorWidth", value)
              }}
            >
              <SelectTrigger className="w-48" aria-label="编辑器正文宽度">
                <SelectValue>{(value: EditorWidthPreference) => EDITOR_WIDTH_LABELS[value]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compact">紧凑</SelectItem>
                <SelectItem value="comfortable">舒适</SelectItem>
                <SelectItem value="wide">宽幅</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingRow
          title="标签美化"
          description="将 Markdown 标签呈现为更易辨认的行内标记；正文仍保持纯 Markdown。"
          control={<PlannedToggle label="标签美化" />}
        />
      </SettingSection>
    </div>
  )
}
