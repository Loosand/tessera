/**
 * [INPUT]: 最近工作区、最近任务、侧栏状态与打开回调
 * [OUTPUT]: 工作区聚合主页，以及避开 macOS 交通灯的折叠态标题栏入口
 * [POS]: 一级导航的主内容页
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSessionSummary, WorkspaceInfo } from "@tessera/contracts"
import { Folder01Icon, Message01Icon, PanelLeftOpenIcon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { TaskContextMenu } from "./task-context-menu"
import { WorkspaceContextMenu } from "./workspace-context-menu"

interface WorkspaceHomePageProps {
  recentTasks: TaskSessionSummary[]
  sidebarOpen: boolean
  workspaces: WorkspaceInfo[]
  onOpenTask: (task: TaskSessionSummary) => void
  onOpenWorkspace: (workspaceId: string) => void
  onRenameTask: (taskId: string, title: string) => Promise<boolean>
  onDeleteTask: (taskId: string) => Promise<boolean>
  onRevealWorkspace: (workspaceId: string) => void
  onCopyWorkspacePath: (workspaceId: string) => void
  onRemoveWorkspace: (workspaceId: string) => void
  onSelectWorkspace: () => void
  onToggleSidebar: () => void
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" })

function relativeTime(updatedAt: number) {
  const minutes = Math.round((updatedAt - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return RELATIVE_TIME.format(minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return RELATIVE_TIME.format(hours, "hour")
  return RELATIVE_TIME.format(Math.round(hours / 24), "day")
}

export function WorkspaceHomePage({
  recentTasks,
  sidebarOpen,
  workspaces,
  onOpenTask,
  onOpenWorkspace,
  onRenameTask,
  onDeleteTask,
  onRevealWorkspace,
  onCopyWorkspacePath,
  onRemoveWorkspace,
  onSelectWorkspace,
  onToggleSidebar,
}: WorkspaceHomePageProps) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header
        className="app-drag-region window-titlebar-leading relative flex h-12 shrink-0 items-center pr-3"
        data-sidebar-open={sidebarOpen}
      >
        <div className="app-no-drag flex min-w-8 items-center">
          {!sidebarOpen ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="展开侧边栏"
              title="展开侧边栏"
              onClick={onToggleSidebar}
            >
              <Icon icon={PanelLeftOpenIcon} size={15} />
            </Button>
          ) : null}
        </div>
        <span className="pointer-events-none absolute inset-x-0 text-center text-[13px] font-medium">
          工作区
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto w-full max-w-4xl">
          <div className="flex items-end justify-between gap-4 border-b border-border pb-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">工作区</h1>
              <p className="mt-1 text-sm text-muted-foreground">在本地文件与任务之间继续你的工作。</p>
            </div>
            <Button size="sm" onClick={onSelectWorkspace}>
              打开工作区
            </Button>
          </div>

          <section className="mt-8">
            <h2 className="text-sm font-medium">最近任务</h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-border">
              {recentTasks.length > 0 ? (
                recentTasks.slice(0, 8).map((task, index) => (
                  <TaskContextMenu
                    key={task.id}
                    task={task}
                    trigger={
                      <button
                        type="button"
                        className="flex h-11 w-full items-center gap-3 px-3 text-left transition-colors hover:bg-muted/65"
                        data-border={index > 0 || undefined}
                        style={index > 0 ? { borderTop: "1px solid var(--border)" } : undefined}
                        onClick={() => onOpenTask(task)}
                      >
                        <Icon icon={Message01Icon} size={15} className="shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{task.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {task.workspaceName ?? "草稿"}
                        </span>
                        <span className="w-18 shrink-0 text-right text-[11px] text-muted-foreground">
                          {relativeTime(task.updatedAt)}
                        </span>
                      </button>
                    }
                    onOpen={onOpenTask}
                    onRename={onRenameTask}
                    onDelete={onDeleteTask}
                  />
                ))
              ) : (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  还没有任务，可以直接开始对话或进入任意工作区。
                </p>
              )}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-medium">最近工作区</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 max-[800px]:grid-cols-1">
              {workspaces.map((workspace) => (
                <WorkspaceContextMenu
                  key={workspace.id}
                  workspace={workspace}
                  trigger={
                    <button
                      type="button"
                      className="flex min-h-14 items-center gap-3 rounded-lg border border-border px-3 text-left transition-colors hover:bg-muted/65"
                      title={workspace.rootPath}
                      onClick={() => onOpenWorkspace(workspace.id)}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Icon icon={Folder01Icon} size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{workspace.name}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {workspace.rootPath}
                        </span>
                      </span>
                    </button>
                  }
                  onOpen={onOpenWorkspace}
                  onReveal={onRevealWorkspace}
                  onCopyPath={onCopyWorkspacePath}
                  onRemove={onRemoveWorkspace}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
