/**
 * [INPUT]: 当前文档、保存状态、导航能力与顶栏操作
 * [OUTPUT]: 系统重命名入口、文件状态、历史导航和文档工具入口
 * [POS]: 文档详情页的统一窗口顶栏
 * [DOC]: design.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DocumentSnapshot, WorkspaceInfo } from "@tessera/contracts"
import {
  AiBrain01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Edit02Icon,
  File02Icon,
  PanelLeftOpenIcon,
  Settings01Icon,
  SourceCodeIcon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { useState } from "react"
import type { DefaultEditorMode } from "../hooks/use-app-preferences"
import type { WorkspaceSaveStatus } from "../hooks/use-workspace"

interface DocumentHeaderProps {
  workspace: WorkspaceInfo | null
  document: DocumentSnapshot | null
  saveStatus: WorkspaceSaveStatus
  canGoBack: boolean
  canGoForward: boolean
  mode: DefaultEditorMode
  agentOpen: boolean
  sidebarOpen: boolean
  onGoBack: () => void
  onGoForward: () => void
  onModeChange: (mode: DefaultEditorMode) => void
  onToggleAgent: () => void
  onToggleSidebar: () => void
  onOpenSettings: () => void
  onRenameDocument: () => Promise<boolean>
}

const SAVE_STATUS_LABELS: Record<WorkspaceSaveStatus, string> = {
  idle: "",
  dirty: "已编辑",
  saving: "正在保存…",
  saved: "已保存",
  conflict: "外部修改",
  error: "保存失败",
}

function DocumentTitle({
  workspace,
  document,
  saveStatus,
  onRenameDocument,
}: Pick<DocumentHeaderProps, "workspace" | "document" | "saveStatus" | "onRenameDocument">) {
  const [renaming, setRenaming] = useState(false)

  if (!document) {
    return (
      <span className="block max-w-[38vw] truncate text-[13px] font-medium text-muted-foreground">
        {workspace?.name ?? "Tessera"}
      </span>
    )
  }

  const handleRename = async () => {
    if (renaming) return
    setRenaming(true)
    await onRenameDocument()
    setRenaming(false)
  }

  return (
    <button
      type="button"
      className="app-no-drag flex max-w-[42vw] items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors hover:bg-muted disabled:opacity-60"
      aria-label="使用系统面板重命名文档"
      title="文件信息与重命名"
      disabled={renaming}
      onClick={() => void handleRename()}
    >
      <Icon icon={File02Icon} size={14} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{document.name}</span>
      {SAVE_STATUS_LABELS[saveStatus] ? (
        <span
          className="shrink-0 font-normal text-muted-foreground max-[680px]:hidden"
          data-status={saveStatus}
          aria-live="polite"
        >
          — {SAVE_STATUS_LABELS[saveStatus]}
        </span>
      ) : null}
      <Icon icon={ArrowDown01Icon} size={12} className="shrink-0 text-muted-foreground" />
    </button>
  )
}

export function DocumentHeader({
  workspace,
  document,
  saveStatus,
  canGoBack,
  canGoForward,
  mode,
  agentOpen,
  sidebarOpen,
  onGoBack,
  onGoForward,
  onModeChange,
  onToggleAgent,
  onToggleSidebar,
  onOpenSettings,
  onRenameDocument,
}: DocumentHeaderProps) {
  const nextMode = mode === "rich" ? "source" : "rich"
  const modeLabel = mode === "rich" ? "切换到 Markdown 源码" : "切换到即时预览编辑"

  return (
    <header
      className="app-drag-region window-titlebar-leading relative flex h-12 shrink-0 items-center bg-background pr-3"
      data-sidebar-open={sidebarOpen}
    >
      <nav className="app-no-drag flex items-center gap-0.5" aria-label="文档历史">
        {!sidebarOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="展开侧边栏"
            title="展开侧边栏"
            onClick={onToggleSidebar}
          >
            <Icon icon={PanelLeftOpenIcon} size={15} />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="后退"
          title="后退"
          disabled={!canGoBack}
          onClick={onGoBack}
        >
          <Icon icon={ArrowLeft01Icon} size={15} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="前进"
          title="前进"
          disabled={!canGoForward}
          onClick={onGoForward}
        >
          <Icon icon={ArrowRight01Icon} size={15} />
        </Button>
      </nav>

      <div className="pointer-events-none absolute inset-x-0 flex justify-center px-28 max-[700px]:px-20">
        <div className="pointer-events-auto min-w-0">
          <DocumentTitle
            workspace={workspace}
            document={document}
            saveStatus={saveStatus}
            onRenameDocument={onRenameDocument}
          />
        </div>
      </div>

      <div className="app-no-drag ml-auto flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${modeLabel}，快捷键 Command /`}
          title={`${modeLabel}（⌘/）`}
          disabled={!document}
          onClick={() => onModeChange(nextMode)}
        >
          <Icon icon={mode === "rich" ? Edit02Icon : SourceCodeIcon} size={15} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="data-[active=true]:bg-muted"
          data-active={agentOpen || undefined}
          aria-label={agentOpen ? "关闭 AI 助手" : "打开 AI 助手"}
          aria-pressed={agentOpen}
          title="AI 助手"
          onClick={onToggleAgent}
        >
          <Icon icon={AiBrain01Icon} size={15} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="打开设置"
          title="设置"
          onClick={onOpenSettings}
        >
          <Icon icon={Settings01Icon} size={15} />
        </Button>
      </div>
    </header>
  )
}
