/**
 * [INPUT]: 应用信息、工作区摘要、界面偏好、设置导航操作与共享 Motion 参数
 * [OUTPUT]: 带连续选中态的可搜索分类、独立 AI/供应商入口和紧凑供应商工作区
 * [POS]: 桌面应用的产品级设置视图
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { AiProviderSettings, AiSettings } from "@tessera/ai/react"
import type {
  AiProviderConfig,
  AiProviderConnectionInput,
  AiProviderSaveInput,
  AppInfo,
  WorkspaceInfo,
} from "@tessera/contracts"
import {
  AiBrain01Icon,
  ArrowLeft01Icon,
  Edit02Icon,
  InformationCircleIcon,
  KeyboardIcon,
  Link01Icon,
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
import { m } from "motion/react"
import { useState } from "react"
import type { AppPreferences, UpdateAppPreference } from "../hooks/use-app-preferences"
import { motionSprings } from "../motion"
import { AppearanceSettings } from "./appearance-settings"
import { EditorSettings } from "./editor-settings"
import { ShortcutsSettings } from "./shortcuts-settings"

type SettingsSectionId = "general" | "appearance" | "editor" | "shortcuts" | "ai" | "providers" | "about"

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
    description: "全局可用性与工具权限",
    icon: AiBrain01Icon,
  },
  {
    id: "providers",
    label: "模型供应商",
    description: "远程 API 连接与模型",
    icon: Link01Icon,
  },
  {
    id: "about",
    label: "关于",
    description: "版本与运行环境",
    icon: InformationCircleIcon,
  },
]

async function listAiProviderModels(input: AiProviderConnectionInput) {
  const desktopApi = window.tessera
  if (!desktopApi) throw new Error("桌面安全桥尚未就绪，请重新打开应用。")
  return desktopApi.listAiProviderModels(input)
}

async function listAiProviderConfigs(): Promise<AiProviderConfig[]> {
  const desktopApi = window.tessera
  if (!desktopApi) throw new Error("桌面安全桥尚未就绪，请重新打开应用。")
  return desktopApi.listAiProviderConfigs()
}

async function saveAiProviderConfig(input: AiProviderSaveInput): Promise<AiProviderConfig> {
  const desktopApi = window.tessera
  if (!desktopApi) throw new Error("桌面安全桥尚未就绪，请重新打开应用。")
  const result = await desktopApi.saveAiProviderConfig(input)
  if (!result.ok) throw new Error(result.error)
  return result.config
}

async function deleteAiProviderConfig(configId: string): Promise<void> {
  const desktopApi = window.tessera
  if (!desktopApi) throw new Error("桌面安全桥尚未就绪，请重新打开应用。")
  const result = await desktopApi.deleteAiProviderConfig(configId)
  if (!result.ok) throw new Error(result.error)
}

function subscribeToAiProviderConfigChanges(listener: () => void) {
  return window.tessera?.onAiProviderConfigsChanged(listener) ?? (() => {})
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
          className="mb-5 w-full justify-start gap-2.5 px-3 text-left text-[13px]"
          onClick={onBack}
        >
          <span className="flex size-5 items-center justify-center" aria-hidden="true">
            <Icon icon={ArrowLeft01Icon} size={15} />
          </span>
          <span className="truncate">返回工作区</span>
        </Button>

        <div className="mb-5 grid h-8 grid-cols-[20px_minmax(0,1fr)] items-center gap-2.5 rounded-lg bg-muted/70 px-3 transition-[color,box-shadow] focus-within:bg-background focus-within:ring-3 focus-within:ring-ring/50">
          <span
            className="pointer-events-none flex size-5 items-center justify-center text-muted-foreground"
            aria-hidden="true"
          >
            <Icon icon={Search01Icon} size={14} />
          </span>
          <Input
            type="search"
            className="h-7 min-w-0 rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            placeholder="搜索设置"
            value={navigationFilter}
            onChange={(event) => setNavigationFilter(event.currentTarget.value)}
            aria-label="搜索设置分类"
          />
        </div>

        <p className="px-3 pb-1.5 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          应用
        </p>
        <nav className="space-y-0.5" aria-label="设置分类">
          {filteredNavigation.map((item) => {
            const active = item.id === activeSection
            return (
              <button
                key={item.id}
                type="button"
                className="relative grid h-8 w-full grid-cols-[20px_minmax(0,1fr)] items-center gap-2.5 rounded-md px-3 text-left text-[13px] transition-colors hover:bg-sidebar-accent data-[active=true]:font-medium"
                data-active={active || undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveSection(item.id)}
              >
                {active ? (
                  <m.span
                    className="pointer-events-none absolute inset-0 rounded-md bg-sidebar-accent"
                    layoutId="settings-navigation-active"
                    transition={motionSprings.gentle}
                    aria-hidden="true"
                  />
                ) : null}
                <span
                  className="relative z-10 flex size-5 items-center justify-center text-muted-foreground"
                  aria-hidden="true"
                >
                  <Icon icon={item.icon} size={15} />
                </span>
                <span className="relative z-10 truncate">{item.label}</span>
              </button>
            )
          })}
          {filteredNavigation.length === 0 ? (
            <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">没有匹配的设置分类。</p>
          ) : null}
        </nav>

        <footer className="mt-auto flex h-9 items-center justify-between px-3 text-xs text-muted-foreground">
          <span>Tessera</span>
          <span className="tabular-nums">{appInfo?.version ?? ""}</span>
        </footer>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-sidebar-border bg-background">
        <div className="app-drag-region h-12 shrink-0 border-b border-border/55" />

        <div className={activeSection === "providers" ? "min-h-0 flex-1" : "hidden"}>
          <AiProviderSettings
            deleteConfig={deleteAiProviderConfig}
            listConfigs={listAiProviderConfigs}
            listModels={listAiProviderModels}
            saveConfig={saveAiProviderConfig}
            subscribeToConfigChanges={subscribeToAiProviderConfigChanges}
          />
        </div>

        <div className={activeSection === "providers" ? "hidden" : "min-h-0 flex-1 overflow-y-auto"}>
          <article
            className={`mx-auto w-full px-[clamp(20px,5vw,64px)] pt-10 pb-24 ${activeSection === "editor" ? "max-w-300" : activeSection === "shortcuts" ? "max-w-260" : activeSection === "appearance" ? "max-w-230" : "max-w-205"}`}
          >
            <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">设置</p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em]">{activeNavigation.label}</h1>
            <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
              {activeNavigation.description}
            </p>

            <div className="mt-10">
              <div className={activeSection === "ai" ? undefined : "hidden"}>
                <AiSettings />
              </div>

              {activeSection === "ai" || activeSection === "providers" ? null : activeSection ===
                "general" ? (
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
