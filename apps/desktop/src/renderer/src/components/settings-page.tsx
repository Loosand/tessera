/**
 * [INPUT]: 应用信息、工作区摘要、界面偏好与设置导航操作
 * [OUTPUT]: 可返回工作区的设置侧栏和分区内容页
 * [POS]: 桌面应用的产品级设置视图
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AppInfo, WorkspaceInfo } from "@tessera/contracts"
import {
  ArrowLeft01Icon,
  Edit02Icon,
  InformationCircleIcon,
  Settings01Icon,
  Sun01Icon,
} from "@tessera/design-system/components/icons"
import { SettingRow } from "@tessera/design-system/components/setting-row"
import { SettingSection } from "@tessera/design-system/components/setting-section"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tessera/design-system/components/ui/select"
import { Switch } from "@tessera/design-system/components/ui/switch"
import { useState } from "react"
import type {
  AppPreferences,
  DefaultEditorMode,
  ThemePreference,
  UpdateAppPreference,
} from "../hooks/use-app-preferences"

type SettingsSectionId = "general" | "appearance" | "editor" | "about"

interface SettingsPageProps {
  appInfo: AppInfo | undefined
  documentCount: number
  preferences: AppPreferences
  workspace: WorkspaceInfo | null
  onBack: () => void
  onSelectWorkspace: () => void
  onUpdatePreference: UpdateAppPreference
}

interface SettingsNavigationItem {
  description: string
  icon: Parameters<typeof Icon>[0]["icon"]
  id: SettingsSectionId
  label: string
}

const SETTINGS_NAVIGATION: SettingsNavigationItem[] = [
  {
    id: "general",
    label: "通用",
    description: "工作区与启动信息",
    icon: Settings01Icon,
  },
  {
    id: "appearance",
    label: "外观",
    description: "界面主题",
    icon: Sun01Icon,
  },
  {
    id: "editor",
    label: "编辑器",
    description: "默认模式与输入辅助",
    icon: Edit02Icon,
  },
  {
    id: "about",
    label: "关于",
    description: "版本与运行环境",
    icon: InformationCircleIcon,
  },
]

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
}

const EDITOR_MODE_LABELS: Record<DefaultEditorMode, string> = {
  rich: "即时预览编辑",
  source: "Markdown 源码",
}

function GeneralSettings({
  workspace,
  documentCount,
  onSelectWorkspace,
}: Pick<SettingsPageProps, "workspace" | "documentCount" | "onSelectWorkspace">) {
  return (
    <div className="space-y-8">
      <SettingSection title="工作区" description="管理当前读取和编辑 Markdown 文档的本地文件夹。">
        <SettingRow
          title={workspace?.name ?? "尚未打开工作区"}
          description={workspace?.rootPath ?? "选择一个本地文件夹开始使用 Tessera。"}
          control={
            <Button variant="outline" size="sm" onClick={onSelectWorkspace}>
              {workspace ? "切换文件夹" : "选择文件夹"}
            </Button>
          }
        />
        <SettingRow
          title="Markdown 文档"
          description="当前工作区内可读取的 Markdown 文件数量。"
          control={<span className="text-sm tabular-nums text-muted-foreground">{documentCount} 个</span>}
        />
      </SettingSection>

      <SettingSection title="启动" description="当前版本会在应用启动时恢复最近打开的工作区。">
        <SettingRow
          title="恢复最近工作区"
          description="保持上次工作区路径，不复制或移动其中的文档。"
          control={<Switch checked disabled aria-label="恢复最近工作区" />}
        />
      </SettingSection>
    </div>
  )
}

function AppearanceSettings({
  preferences,
  onUpdatePreference,
}: Pick<SettingsPageProps, "preferences" | "onUpdatePreference">) {
  return (
    <SettingSection title="主题" description="界面主题只影响应用外观，不会修改文档内容。">
      <SettingRow
        title="界面主题"
        description="可以跟随系统外观，或固定使用浅色与深色主题。"
        control={
          <Select
            value={preferences.theme}
            onValueChange={(value) => {
              if (value && THEME_LABELS[value]) onUpdatePreference("theme", value)
            }}
          >
            <SelectTrigger className="w-36" aria-label="界面主题">
              <SelectValue>{(value: ThemePreference) => THEME_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">跟随系统</SelectItem>
              <SelectItem value="light">浅色</SelectItem>
              <SelectItem value="dark">深色</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </SettingSection>
  )
}

function EditorSettings({
  preferences,
  onUpdatePreference,
}: Pick<SettingsPageProps, "preferences" | "onUpdatePreference">) {
  return (
    <div className="space-y-8">
      <SettingSection title="打开方式" description="决定进入文档时默认展示的内容模式。">
        <SettingRow
          title="默认编辑模式"
          description="可在文档顶部切换，也可以使用 ⌘/ 快速切换。"
          control={
            <Select
              value={preferences.defaultEditorMode}
              onValueChange={(value) => {
                if (value && EDITOR_MODE_LABELS[value]) onUpdatePreference("defaultEditorMode", value)
              }}
            >
              <SelectTrigger className="w-40" aria-label="默认编辑模式">
                <SelectValue>{(value: DefaultEditorMode) => EDITOR_MODE_LABELS[value]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rich">即时预览编辑</SelectItem>
                <SelectItem value="source">Markdown 源码</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </SettingSection>

      <SettingSection title="输入辅助" description="控制编辑器提供的本地输入反馈。">
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
    </div>
  )
}

function AboutSettings({ appInfo }: Pick<SettingsPageProps, "appInfo">) {
  return (
    <SettingSection title="Tessera" description="本地优先的 Markdown 阅读、编辑与 AI 协作空间。">
      <SettingRow
        title="版本"
        control={<span className="text-sm text-muted-foreground">{appInfo?.version ?? "—"}</span>}
      />
      <SettingRow
        title="运行平台"
        description="应用运行时提供的平台标识。"
        control={<span className="text-sm text-muted-foreground">{appInfo?.platform ?? "—"}</span>}
      />
    </SettingSection>
  )
}

export function SettingsPage({
  appInfo,
  workspace,
  documentCount,
  preferences,
  onBack,
  onSelectWorkspace,
  onUpdatePreference,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general")
  const activeNavigation = SETTINGS_NAVIGATION.find((item) => item.id === activeSection)
  if (!activeNavigation) return null

  return (
    <div className="flex h-screen min-h-0 bg-sidebar text-foreground">
      <aside className="flex h-full w-[260px] shrink-0 flex-col bg-sidebar px-2 pb-2 text-sidebar-foreground">
        <div className="app-drag-region h-12 shrink-0" />
        <Button
          variant="ghost"
          size="sm"
          className="mb-5 w-full justify-start gap-2 px-2 text-[13px]"
          onClick={onBack}
        >
          <Icon icon={ArrowLeft01Icon} size={15} />
          返回工作区
        </Button>

        <p className="px-2 pb-1.5 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          应用
        </p>
        <nav className="space-y-0.5" aria-label="设置分类">
          {SETTINGS_NAVIGATION.map((item) => {
            const active = item.id === activeSection
            return (
              <button
                key={item.id}
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium"
                data-active={active || undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveSection(item.id)}
              >
                <Icon icon={item.icon} size={15} className="text-muted-foreground" />
                {item.label}
              </button>
            )
          })}
        </nav>

        <footer className="mt-auto flex h-9 items-center justify-between border-t border-sidebar-border px-2 text-xs text-muted-foreground">
          <span>Tessera</span>
          <span className="tabular-nums">{appInfo?.version ?? ""}</span>
        </footer>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-sidebar-border bg-background">
        <div className="app-drag-region h-12 shrink-0 border-b border-border/55" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <article className="mx-auto w-full max-w-205 px-[clamp(32px,7vw,80px)] pt-10 pb-24">
            <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">设置</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">{activeNavigation.label}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{activeNavigation.description}</p>

            <div className="mt-10">
              {activeSection === "general" ? (
                <GeneralSettings
                  workspace={workspace}
                  documentCount={documentCount}
                  onSelectWorkspace={onSelectWorkspace}
                />
              ) : activeSection === "appearance" ? (
                <AppearanceSettings preferences={preferences} onUpdatePreference={onUpdatePreference} />
              ) : activeSection === "editor" ? (
                <EditorSettings preferences={preferences} onUpdatePreference={onUpdatePreference} />
              ) : (
                <AboutSettings appInfo={appInfo} />
              )}
            </div>
          </article>
        </div>
      </main>
    </div>
  )
}
