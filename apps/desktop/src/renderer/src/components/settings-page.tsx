/**
 * [INPUT]: 应用信息、外部工作区/托管内容库摘要、界面偏好、AI/MCP/研究网络/开发期日志安全桥、设置导航操作与共享 Motion 参数
 * [OUTPUT]: 带连续选中态的可搜索分类、外部工作区与探索期托管内容库设置、研究网页系统代理/直连选择、官方 AI SDK 日志入口和独立供应商/MCP 工作区
 * [POS]: 桌面应用的产品级设置视图
 * [DOC]: design.md、docs/architecture/unified-creation-agent.md、docs/architecture/ai-providers.md、docs/architecture/ai-observability.md、docs/architecture/mcp.md、docs/architecture/research-workflow.md
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
  ContentLibraryInfo,
  McpServerConfig,
  McpServerSaveInput,
  McpServerTestResult,
  ResearchNetworkMode,
  WorkspaceInfo,
} from "@tessera/contracts"
import {
  AiBrain01Icon,
  ArrowLeft01Icon,
  Edit02Icon,
  InformationCircleIcon,
  KeyboardIcon,
  Link01Icon,
  Plug01Icon,
  Search01Icon,
  Settings01Icon,
  SourceCodeIcon,
  Sun01Icon,
} from "@tessera/design-system/components/icons"
import { SettingRow } from "@tessera/design-system/components/setting-row"
import { SettingSection } from "@tessera/design-system/components/setting-section"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { Switch } from "@tessera/design-system/components/ui/switch"
import { m } from "motion/react"
import { useEffect, useState } from "react"
import type { AppPreferences, UpdateAppPreference } from "../hooks/use-app-preferences"
import { motionSprings } from "../motion"
import { AppearanceSettings } from "./appearance-settings"
import { EditorSettings } from "./editor-settings"
import { McpSettings } from "./mcp-settings"
import { ShortcutsSettings } from "./shortcuts-settings"

type SettingsSectionId =
  | "general"
  | "appearance"
  | "editor"
  | "shortcuts"
  | "ai"
  | "providers"
  | "mcp"
  | "developer"
  | "about"

type SettingsPageProps = Readonly<{
  appInfo: AppInfo | undefined
  documentCount: number
  preferences: AppPreferences
  workspace: WorkspaceInfo | null
  onBack: () => void
  onSelectWorkspace: () => void
  onUpdatePreference: UpdateAppPreference
}>

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
    id: "mcp",
    label: "MCP",
    description: "外部工具服务器与权限",
    icon: Plug01Icon,
  },
  ...(import.meta.env.DEV
    ? [
        {
          id: "developer" as const,
          label: "开发者",
          description: "AI 运行日志与诊断",
          icon: SourceCodeIcon,
        },
      ]
    : []),
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

async function getResearchNetworkMode(): Promise<ResearchNetworkMode> {
  const desktopApi = window.tessera
  if (!desktopApi) throw new Error("桌面安全桥尚未就绪，请重新打开应用。")
  return desktopApi.getResearchNetworkMode()
}

async function setResearchNetworkMode(mode: ResearchNetworkMode): Promise<ResearchNetworkMode> {
  const desktopApi = window.tessera
  if (!desktopApi) throw new Error("桌面安全桥尚未就绪，请重新打开应用。")
  return desktopApi.setResearchNetworkMode(mode)
}

function subscribeToAiProviderConfigChanges(listener: () => void) {
  return window.tessera?.onAiProviderConfigsChanged(listener) ?? (() => {})
}

async function listMcpServers(): Promise<McpServerConfig[]> {
  const desktopApi = window.tessera
  if (!desktopApi) throw new Error("桌面安全桥尚未就绪，请重新打开应用。")
  return desktopApi.listMcpServers()
}

async function saveMcpServer(input: McpServerSaveInput): Promise<McpServerConfig> {
  const desktopApi = window.tessera
  if (!desktopApi) throw new Error("桌面安全桥尚未就绪，请重新打开应用。")
  const result = await desktopApi.saveMcpServer(input)
  if (!result.ok) throw new Error(result.error)
  return result.server
}

async function deleteMcpServer(serverId: string): Promise<void> {
  const desktopApi = window.tessera
  if (!desktopApi) throw new Error("桌面安全桥尚未就绪，请重新打开应用。")
  const result = await desktopApi.deleteMcpServer(serverId)
  if (!result.ok) throw new Error(result.error)
}

async function testMcpServer(serverId: string): Promise<McpServerTestResult> {
  const desktopApi = window.tessera
  if (!desktopApi) return { ok: false, error: "桌面安全桥尚未就绪，请重新打开应用。" }
  return desktopApi.testMcpServer(serverId)
}

function subscribeToMcpServerChanges(listener: () => void) {
  return window.tessera?.onMcpServersChanged(listener) ?? (() => {})
}

function GeneralSettings({
  workspace,
  documentCount,
  onSelectWorkspace,
}: Pick<SettingsPageProps, "workspace" | "documentCount" | "onSelectWorkspace">) {
  const [library, setLibrary] = useState<ContentLibraryInfo | null>(null)
  const [libraryStatus, setLibraryStatus] = useState("")
  const [libraryBusy, setLibraryBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.tessera
      ?.getCurrentContentLibrary()
      .then((result) => {
        if (cancelled) return
        if (result.ok) setLibrary(result.library)
        else setLibraryStatus(result.error)
      })
      .catch((error) => {
        if (!cancelled) setLibraryStatus(error instanceof Error ? error.message : "读取内容库失败。")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectContentLibrary = async () => {
    const desktopApi = window.tessera
    if (!desktopApi) return
    setLibraryBusy(true)
    setLibraryStatus("")
    try {
      const result = await desktopApi.selectContentLibrary()
      if (!result.ok) throw new Error(result.error)
      setLibrary(result.library)
      setLibraryStatus(result.library ? "内容库已就绪。" : "未更改内容库。")
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : "设置内容库失败。")
    } finally {
      setLibraryBusy(false)
    }
  }

  const revokeContentLibrary = async () => {
    const desktopApi = window.tessera
    if (!desktopApi) return
    setLibraryBusy(true)
    setLibraryStatus("")
    try {
      const result = await desktopApi.revokeContentLibrary()
      if (!result.ok) throw new Error(result.error)
      setLibrary(null)
      setLibraryStatus("已移除授权，目录和 Markdown 文档均未删除。")
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : "移除内容库授权失败。")
    } finally {
      setLibraryBusy(false)
    }
  }

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

      <SettingSection
        title="托管内容库（探索中）"
        description="正式产物默认进入可见的“未归档”目录；正文仍是本地 Markdown，SQLite 只保存关系和运行状态。"
      >
        <SettingRow
          title={library?.name ?? "尚未选择内容库"}
          description={library?.rootPath ?? "选择一个目录承载未归档和由 Agent 创建的独立项目。"}
          control={
            <div className="flex items-center gap-2">
              {library ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={libraryBusy}
                  onClick={() => void revokeContentLibrary()}
                >
                  移除授权
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={libraryBusy}
                onClick={() => void selectContentLibrary()}
              >
                {library ? "更换目录" : "选择目录"}
              </Button>
            </div>
          }
        />
        {libraryStatus ? <p className="text-xs leading-5 text-muted-foreground">{libraryStatus}</p> : null}
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
      <SettingRow
        title="桌面运行时"
        description="用于区分完全复用同一界面的 Electron 与 Tauri 对照壳。"
        control={<span className="text-[13px] text-muted-foreground">{appInfo?.runtime ?? "—"}</span>}
      />
    </SettingSection>
  )
}

function DeveloperSettings() {
  const [opening, setOpening] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const openAiLogs = async () => {
    const desktopApi = window.tessera
    if (!desktopApi) {
      setStatus("桌面安全桥尚未就绪，请重新打开应用。")
      return
    }

    setOpening(true)
    setStatus(null)
    try {
      const result = await desktopApi.openAiDevtools()
      setStatus(result.ok ? "已在浏览器打开 AI SDK DevTools。" : result.error)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "打开 AI 运行日志失败。")
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="space-y-8">
      <SettingSection
        title="AI 运行日志"
        description="使用 AI SDK 官方 DevTools 查看每次 Agent 运行、模型步骤、工具调用、Token 与耗时。"
      >
        <SettingRow
          title="AI SDK DevTools"
          description="日志仅保存在本机开发目录，不在生产包启用；其中可能包含对话与工具输入。"
          control={
            <Button variant="outline" size="sm" disabled={opening} onClick={() => void openAiLogs()}>
              {opening ? "正在启动…" : "打开日志"}
            </Button>
          }
        />
        {status ? <p className="text-xs leading-5 text-muted-foreground">{status}</p> : null}
      </SettingSection>
    </div>
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

        <div className={activeSection === "mcp" ? "min-h-0 flex-1" : "hidden"}>
          <McpSettings
            deleteServer={deleteMcpServer}
            listServers={listMcpServers}
            saveServer={saveMcpServer}
            subscribeToChanges={subscribeToMcpServerChanges}
            testServer={testMcpServer}
          />
        </div>

        <div
          className={
            activeSection === "providers" || activeSection === "mcp"
              ? "hidden"
              : "min-h-0 flex-1 overflow-y-auto"
          }
        >
          <article className="mx-auto w-full max-w-300 px-[clamp(20px,5vw,64px)] pt-10 pb-24">
            <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">设置</p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em]">{activeNavigation.label}</h1>
            <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
              {activeNavigation.description}
            </p>

            <div className="mt-10">
              <div className={activeSection === "ai" ? undefined : "hidden"}>
                <AiSettings
                  getResearchNetworkMode={getResearchNetworkMode}
                  setResearchNetworkMode={setResearchNetworkMode}
                />
              </div>

              {activeSection === "ai" ||
              activeSection === "providers" ||
              activeSection === "mcp" ? null : activeSection === "general" ? (
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
              ) : activeSection === "developer" ? (
                <DeveloperSettings />
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
