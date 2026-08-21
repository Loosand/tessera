/**
 * [INPUT]: 应用信息、工作区摘要、界面偏好与设置导航操作
 * [OUTPUT]: 可搜索分类并返回工作区的中文设置侧栏和分区内容页
 * [POS]: 桌面应用的产品级设置视图
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { AiProviderSettings } from "@tessera/ai/react"
import type { AppInfo, WorkspaceInfo } from "@tessera/contracts"
import {
  AiBrain01Icon,
  ArrowLeft01Icon,
  Edit02Icon,
  InformationCircleIcon,
  KeyboardIcon,
  Search01Icon,
  Settings01Icon,
  Sun01Icon,
} from "@tessera/design-system/components/icons"
import { SettingRow } from "@tessera/design-system/components/setting-row"
import { SettingSection } from "@tessera/design-system/components/setting-section"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { Switch } from "@tessera/design-system/components/ui/switch"
import { useState } from "react"
import type { AppPreferences, UpdateAppPreference } from "../hooks/use-app-preferences"
import { AppearanceSettings } from "./appearance-settings"
import { EditorSettings } from "./editor-settings"
import { ShortcutsSettings } from "./shortcuts-settings"

type SettingsSectionId = "general" | "appearance" | "editor" | "shortcuts" | "ai" | "about"

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
    description: "主题、形状与界面排版",
    icon: Sun01Icon,
  },
  {
    id: "editor",
    label: "编辑器",
    description: "正文排版、编辑行为与呈现",
    icon: Edit02Icon,
  },
  {
    id: "shortcuts",
    label: "快捷键",
    description: "查看并搜索应用快捷键",
    icon: KeyboardIcon,
  },
  {
    id: "ai",
    label: "AI",
    description: "模型供应商与 API 连接",
    icon: AiBrain01Icon,
  },
  {
    id: "about",
    label: "关于",
    description: "版本与运行环境",
    icon: InformationCircleIcon,
  },
]

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
          control={<span className="text-[13px] tabular-nums text-muted-foreground">{documentCount} 个</span>}
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

function AboutSettings({ appInfo }: Pick<SettingsPageProps, "appInfo">) {
  return (
    <SettingSection title="Tessera" description="本地优先的 Markdown 阅读、编辑与 AI 协作空间。">
      <SettingRow
        title="版本"
        control={<span className="text-[13px] text-muted-foreground">{appInfo?.version ?? "—"}</span>}
      />
      <SettingRow
        title="运行平台"
        description="应用运行时提供的平台标识。"
        control={<span className="text-[13px] text-muted-foreground">{appInfo?.platform ?? "—"}</span>}
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
  const [navigationFilter, setNavigationFilter] = useState("")
  const activeNavigation = SETTINGS_NAVIGATION.find((item) => item.id === activeSection)
  const normalizedNavigationFilter = navigationFilter.trim().toLocaleLowerCase("zh-CN")
  const filteredNavigation = SETTINGS_NAVIGATION.filter((item) => {
    if (!normalizedNavigationFilter) return true
    return `${item.label} ${item.description}`.toLocaleLowerCase("zh-CN").includes(normalizedNavigationFilter)
  })
  if (!activeNavigation) return null

  return (
    <div className="flex h-screen min-h-0 bg-sidebar text-foreground">
      <aside className="flex h-full w-52 shrink-0 flex-col bg-sidebar px-2 pb-2 text-sidebar-foreground lg:w-[260px]">
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

        <div className="relative mb-5 px-1">
          <Icon
            icon={Search01Icon}
            size={14}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            className="h-8 border-transparent bg-muted/70 pl-8 shadow-none focus-visible:bg-background"
            placeholder="搜索设置"
            value={navigationFilter}
            onChange={(event) => setNavigationFilter(event.currentTarget.value)}
            aria-label="搜索设置分类"
          />
        </div>

        <p className="px-2 pb-1.5 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          应用
        </p>
        <nav className="space-y-0.5" aria-label="设置分类">
          {filteredNavigation.map((item) => {
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
          {filteredNavigation.length === 0 ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">没有匹配的设置分类。</p>
          ) : null}
        </nav>

        <footer className="mt-auto flex h-9 items-center justify-between border-t border-sidebar-border px-2 text-xs text-muted-foreground">
          <span>Tessera</span>
          <span className="tabular-nums">{appInfo?.version ?? ""}</span>
        </footer>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-sidebar-border bg-background">
        <div className="app-drag-region h-12 shrink-0 border-b border-border/55" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <article
            className={`mx-auto w-full px-[clamp(20px,5vw,64px)] pt-10 pb-24 ${activeSection === "ai" || activeSection === "shortcuts" ? "max-w-260" : activeSection === "appearance" || activeSection === "editor" ? "max-w-230" : "max-w-205"}`}
          >
            <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">设置</p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em]">{activeNavigation.label}</h1>
            <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
              {activeNavigation.description}
            </p>

            <div className="mt-10">
              <div className={activeSection === "ai" ? undefined : "hidden"}>
                <AiProviderSettings />
              </div>

              {activeSection === "ai" ? null : activeSection === "general" ? (
                <GeneralSettings
                  workspace={workspace}
                  documentCount={documentCount}
                  onSelectWorkspace={onSelectWorkspace}
                />
              ) : activeSection === "appearance" ? (
                <AppearanceSettings preferences={preferences} onUpdatePreference={onUpdatePreference} />
              ) : activeSection === "editor" ? (
                <EditorSettings preferences={preferences} onUpdatePreference={onUpdatePreference} />
              ) : activeSection === "shortcuts" ? (
                <ShortcutsSettings />
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
