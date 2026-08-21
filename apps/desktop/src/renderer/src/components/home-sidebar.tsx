/**
 * [INPUT]: 最近任务、最近工作区与顶层导航回调
 * [OUTPUT]: 工作区之外的一级桌面侧栏，提供新任务、聚合页、最近对话与工作区列表
 * [POS]: Tessera 两级导航中的一级侧栏
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSessionSummary, WorkspaceInfo } from "@tessera/contracts"
import {
  Folder01Icon,
  Home05Icon,
  Message01Icon,
  PanelLeftCloseIcon,
  Settings01Icon,
  TaskAdd01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { TaskContextMenu } from "./task-context-menu"
import { WorkspaceContextMenu } from "./workspace-context-menu"

interface HomeSidebarProps {
  activeItem: "new-task" | "workspaces"
  recentTasks: TaskSessionSummary[]
  workspaces: WorkspaceInfo[]
  onCollapse: () => void
  onNewTask: () => void
  onOpenSettings: () => void
  onOpenTask: (task: TaskSessionSummary) => void
  onOpenWorkspace: (workspaceId: string) => void
  onRenameTask: (taskId: string, title: string) => Promise<boolean>
  onDeleteTask: (taskId: string) => Promise<boolean>
  onRevealWorkspace: (workspaceId: string) => void
  onCopyWorkspacePath: (workspaceId: string) => void
  onRemoveWorkspace: (workspaceId: string) => void
  onShowWorkspaces: () => void
}

function NavigationRow({
  icon,
  label,
  active,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]["icon"]
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium"
      data-active={active || undefined}
      onClick={onClick}
    >
      <Icon icon={icon} size={16} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

export function HomeSidebar({
  activeItem,
  recentTasks,
  workspaces,
  onCollapse,
  onNewTask,
  onOpenSettings,
  onOpenTask,
  onOpenWorkspace,
  onRenameTask,
  onDeleteTask,
  onRevealWorkspace,
  onCopyWorkspacePath,
  onRemoveWorkspace,
  onShowWorkspaces,
}: HomeSidebarProps) {
  return (
    <aside className="flex h-full min-h-0 w-62.5 shrink-0 flex-col bg-sidebar text-sidebar-foreground max-[760px]:w-[240px] max-[760px]:shadow-xl">
      <div className="app-drag-region relative h-12 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="app-no-drag absolute top-3 right-2"
          aria-label="收起侧边栏"
          title="收起侧边栏"
          onClick={onCollapse}
        >
          <Icon icon={PanelLeftCloseIcon} size={14} />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-2">
        <div className="grid gap-0.5">
          <NavigationRow
            icon={TaskAdd01Icon}
            label="新任务"
            active={activeItem === "new-task"}
            onClick={onNewTask}
          />
          <NavigationRow
            icon={Home05Icon}
            label="工作区"
            active={activeItem === "workspaces"}
            onClick={onShowWorkspaces}
          />
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pb-3">
          <section>
            <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">最近任务</p>
            <div className="grid gap-0.5">
              {recentTasks.slice(0, 6).map((task) => (
                <TaskContextMenu
                  key={task.id}
                  task={task}
                  trigger={
                    <button
                      type="button"
                      className="group flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors hover:bg-sidebar-accent"
                      title={`${task.workspaceName ?? "草稿"} · ${task.title}`}
                      onClick={() => onOpenTask(task)}
                    >
                      <Icon icon={Message01Icon} size={14} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      <span className="max-w-18 shrink-0 truncate text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        {task.workspaceName ?? "草稿"}
                      </span>
                    </button>
                  }
                  onOpen={onOpenTask}
                  onRename={onRenameTask}
                  onDelete={onDeleteTask}
                />
              ))}
              {recentTasks.length === 0 ? (
                <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">
                  发送第一条消息后，任务会出现在这里。
                </p>
              ) : null}
            </div>
          </section>

          <section className="mt-5">
            <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">工作区</p>
            <div className="grid gap-0.5">
              {workspaces.slice(0, 10).map((workspace) => (
                <WorkspaceContextMenu
                  key={workspace.id}
                  workspace={workspace}
                  trigger={
                    <button
                      type="button"
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors hover:bg-sidebar-accent"
                      title={workspace.rootPath}
                      onClick={() => onOpenWorkspace(workspace.id)}
                    >
                      <Icon icon={Folder01Icon} size={14} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                    </button>
                  }
                  onOpen={onOpenWorkspace}
                  onReveal={onRevealWorkspace}
                  onCopyPath={onCopyWorkspacePath}
                  onRemove={onRemoveWorkspace}
                />
              ))}
              {workspaces.length === 0 ? (
                <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">还没有打开过工作区。</p>
              ) : null}
            </div>
          </section>
        </div>

        <footer className="-mx-2 flex h-11 shrink-0 items-center border-t border-sidebar-border px-2">
          <span className="min-w-0 flex-1 truncate px-2 text-xs font-medium">Tessera</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="打开设置"
            title="设置"
            onClick={onOpenSettings}
          >
            <Icon icon={Settings01Icon} size={14} />
          </Button>
        </footer>
      </div>
    </aside>
  )
}
