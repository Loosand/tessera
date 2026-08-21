/**
 * [INPUT]: 已校验的编辑器偏好与类型安全的偏好更新操作
 * [OUTPUT]: 带参考/随机搭配和实时预览的 Markdown 主题、编辑行为与呈现设置界面
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
import { Button } from "@tessera/design-system/components/ui/button"
import { NativeSelect } from "@tessera/design-system/components/ui/native-select"
import { Switch } from "@tessera/design-system/components/ui/switch"
import {
  TYPESET_REFERENCE_PRESET,
  type TypesetPreferences,
  createRandomTypesetPreferences,
} from "../hooks/typeset-preferences"
import type { AppPreferences, DefaultEditorMode, UpdateAppPreference } from "../hooks/use-app-preferences"
import { TypesetThemeBuilder } from "./typeset-theme-builder"

interface EditorSettingsProps {
  preferences: AppPreferences
  onUpdatePreference: UpdateAppPreference
}

const EDITOR_MODE_LABELS: Record<DefaultEditorMode, string> = {
  rich: "即时预览编辑",
  source: "Markdown 源码",
}

function PlannedToggle({ label, checked = false }: { label: string; checked?: boolean }) {
  return <Switch checked={checked} disabled aria-label={`${label}，即将支持`} />
}

export function EditorSettings({ preferences, onUpdatePreference }: EditorSettingsProps) {
  const applyTypeset = (nextTypeset: TypesetPreferences) => {
    onUpdatePreference("typesetBodyFont", nextTypeset.typesetBodyFont)
    onUpdatePreference("typesetFlow", nextTypeset.typesetFlow)
    onUpdatePreference("typesetHeadingFont", nextTypeset.typesetHeadingFont)
    onUpdatePreference("typesetLeading", nextTypeset.typesetLeading)
    onUpdatePreference("typesetMeasure", nextTypeset.typesetMeasure)
    onUpdatePreference("typesetMonoFont", nextTypeset.typesetMonoFont)
    onUpdatePreference("typesetSize", nextTypeset.typesetSize)
  }

  return (
    <div className="space-y-9">
      <SettingSection
        title="Markdown 主题"
        description="基于 Typeset 调整字体、阅读节奏和版心；修改会即时保存并应用到编辑器。"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => applyTypeset(TYPESET_REFERENCE_PRESET)}>
              参考预设
            </Button>
            <Button size="sm" onClick={() => applyTypeset(createRandomTypesetPreferences())}>
              随机搭配
            </Button>
          </div>
        }
      >
        <TypesetThemeBuilder preferences={preferences} onUpdatePreference={onUpdatePreference} />
      </SettingSection>

      <SettingSection title="编辑行为" description="控制文档打开方式、输入辅助与 Markdown 结构提示。">
        <SettingRow
          title="默认编辑模式"
          description="打开文档时默认使用的模式；文档顶部仍可使用 ⌘/ 快速切换。"
          control={
            <NativeSelect
              className="w-48"
              value={preferences.defaultEditorMode}
              aria-label="默认编辑模式"
              onChange={(event) => {
                onUpdatePreference("defaultEditorMode", event.currentTarget.value as DefaultEditorMode)
              }}
            >
              {Object.entries(EDITOR_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
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

      <SettingSection title="编辑器呈现" description="配置 Markdown 结构的辅助视觉。">
        <SettingRow
          title="标签美化"
          description="将 Markdown 标签呈现为更易辨认的行内标记；正文仍保持纯 Markdown。"
          control={<PlannedToggle label="标签美化" />}
        />
      </SettingSection>
    </div>
  )
}
