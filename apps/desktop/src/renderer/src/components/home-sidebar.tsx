/**
 * [INPUT]: 当前 Space、服务端分页任务读取、作用域任务实时快照、文件索引、最近文件工作区与任务/文件/Skill/Space 操作
 * [OUTPUT]: Eigent 风格内嵌一级侧栏，顶部切换 Space，连续呈现可翻页的当前 Space 任务、全部任务入口与文件树
 * [POS]: Tessera Space 壳层的主导航侧栏
 * [DOC]: design.md、docs/architecture/editor.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  TaskSessionSummary,
  WorkspaceDirectoryEntry,
  WorkspaceDocumentEntry,
  WorkspaceEntryKind,
  WorkspaceInfo,
} from "@tessera/contracts"
import {
  BookOpen01Icon,
  ListViewIcon,
  PanelLeftCloseIcon,
  Settings01Icon,
  TaskAdd01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React, { useMemo } from "react"
import { type TaskPageLoader, useTaskPage } from "../hooks/use-task-page"
import { SpaceFilesSection } from "./space-files-section"
import { SpaceSwitcher } from "./space-switcher"
import { TaskContextMenu } from "./task-context-menu"
import { TaskNavigationRow } from "./task-navigation-row"
import { TaskPaginationControls } from "./task-pagination-controls"

const TASK_LOADING_PLACEHOLDERS = ["first", "second", "third"] as const

type HomeSidebarProps = Readonly<{
  activeItem: "all-tasks" | "new-task" | "skills" | null
  activeTaskId: string | undefined
  activeDocumentPath: string | undefined
  directories: readonly WorkspaceDirectoryEntry[]
  documents: readonly WorkspaceDocumentEntry[]
  tasks: readonly TaskSessionSummary[]
  taskListRevision: number
  workspace: WorkspaceInfo | null
  workspaces: readonly WorkspaceInfo[]
  loadTasksPage: TaskPageLoader
  onCopyWorkspacePath: (workspaceId: string) => void
  onCopyWorkspaceEntryPath: (relativePath: string) => void
  onCreateDirectory: (parentRelativePath?: string) => void
  onCreateDocument: (parentRelativePath?: string) => void
  onCollapse: () => void
  onDeleteWorkspaceEntry: (relativePath: string, kind: WorkspaceEntryKind) => void
  onDeleteTask: (taskId: string) => Promise<boolean>
  onNewTask: () => void
  onOpenDefaultSpace: () => void
  onOpenDocument: (relativePath: string) => void
  onOpenSettings: () => void
  onOpenTask: (task: TaskSessionSummary) => void
  onOpenWorkspace: (workspaceId: string) => void
  onRemoveWorkspace: (workspaceId: string) => void
  onRefreshDocuments: () => void
  onRenameDirectory: (relativePath: string) => void
  onRenameDocument: (relativePath: string) => void
  onRenameTask: (taskId: string, title: string) => Promise<boolean>
  onRevealWorkspace: (workspaceId: string) => void
  onRevealWorkspaceEntry: (relativePath: string) => void
  onSelectWorkspace: () => void
  onShowSkills: () => void
  onShowAllTasks: () => void
}>

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
      className="flex h-8 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[12px] transition-colors hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium"
      data-active={active || undefined}
      onClick={onClick}
    >
      <Icon icon={icon} size={15} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

export function HomeSidebar({
  activeItem,
  activeTaskId,
  activeDocumentPath,
  directories,
  documents,
  loadTasksPage,
  tasks,
  taskListRevision,
  workspace,
  workspaces,
  onCopyWorkspacePath,
  onCopyWorkspaceEntryPath,
  onCreateDirectory,
  onCreateDocument,
  onCollapse,
  onDeleteWorkspaceEntry,
  onDeleteTask,
  onNewTask,
  onOpenDefaultSpace,
  onOpenDocument,
  onOpenSettings,
  onOpenTask,
  onOpenWorkspace,
  onRemoveWorkspace,
  onRefreshDocuments,
  onRenameDirectory,
  onRenameDocument,
  onRenameTask,
  onRevealWorkspace,
  onRevealWorkspaceEntry,
  onSelectWorkspace,
  onShowAllTasks,
  onShowSkills,
}: HomeSidebarProps) {
  const taskPage = useTaskPage({
    loadPage: loadTasksPage,
    pageSize: 6,
    refreshKey: taskListRevision,
    scopeKey: workspace?.id ?? "default-space",
  })
  const liveTasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const visibleTasks = taskPage.result.items.map((task) => liveTasksById.get(task.id) ?? task)

  return (
    <aside className="flex h-full min-h-0 w-62.5 shrink-0 flex-col rounded-2xl border border-sidebar-border/60 bg-sidebar text-sidebar-foreground shadow-[inset_0_1px_0_color-mix(in_oklch,var(--background)_70%,transparent)] max-[760px]:w-[240px] max-[760px]:shadow-xl">
      <div className="app-drag-region relative h-11 shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="app-no-drag absolute top-2.5 right-1.5 rounded-lg"
          aria-label="收起侧边栏"
          title="收起侧边栏"
          onClick={onCollapse}
        >
          <Icon icon={PanelLeftCloseIcon} size={14} />
        </Button>
      </div>
      <div className="flex h-11 shrink-0 items-center gap-1 px-1.5">
        <SpaceSwitcher
          workspace={workspace}
          workspaces={workspaces}
          onCopyWorkspacePath={onCopyWorkspacePath}
          onOpenDefault={onOpenDefaultSpace}
          onOpenWorkspace={onOpenWorkspace}
          onRemoveWorkspace={onRemoveWorkspace}
          onRevealWorkspace={onRevealWorkspace}
          onSelectWorkspace={onSelectWorkspace}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-1.5">
        <div className="grid gap-0.5">
          <NavigationRow
            icon={TaskAdd01Icon}
            label="新任务"
            active={activeItem === "new-task"}
            onClick={onNewTask}
          />
          <NavigationRow
            icon={ListViewIcon}
            label="全部任务"
            active={activeItem === "all-tasks"}
            onClick={onShowAllTasks}
          />
          <NavigationRow
            icon={BookOpen01Icon}
            label="技能"
            active={activeItem === "skills"}
            onClick={onShowSkills}
          />
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pb-3">
          <section>
            <p className="px-2 pb-1 text-[10px] font-medium text-muted-foreground">最近任务</p>
            <div className="grid gap-0.5">
              {visibleTasks.map((task) => (
                <TaskContextMenu
                  key={task.id}
                  task={task}
                  trigger={
                    <TaskNavigationRow
                      active={task.id === activeTaskId}
                      status={task.status}
                      taskTitle={task.title}
                      tooltip={task.title}
                      onClick={() => onOpenTask(task)}
                    />
                  }
                  onOpen={onOpenTask}
                  onRename={onRenameTask}
                  onDelete={onDeleteTask}
                />
              ))}
              {taskPage.loading && visibleTasks.length === 0 ? (
                <div className="grid gap-1 px-2 py-1.5" aria-label="正在读取任务">
                  {TASK_LOADING_PLACEHOLDERS.map((placeholder) => (
                    <span
                      key={`task-loading-${placeholder}`}
                      className="h-5 animate-pulse rounded-md bg-sidebar-accent/60 motion-reduce:animate-none"
                    />
                  ))}
                </div>
              ) : null}
              {taskPage.error ? (
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-2 text-left text-[10px] leading-4 text-destructive hover:bg-destructive/8"
                  onClick={taskPage.reload}
                >
                  {taskPage.error} 点击重试。
                </button>
              ) : null}
              {!taskPage.loading && !taskPage.error && taskPage.result.total === 0 ? (
                <p className="px-2 py-2 text-[11px] leading-5 text-muted-foreground">这里还没有任务。</p>
              ) : null}
            </div>
            {taskPage.result.totalPages > 1 ? (
              <TaskPaginationControls
                compact
                page={taskPage.page}
                total={taskPage.result.total}
                totalPages={taskPage.result.totalPages}
                onPageChange={taskPage.goToPage}
              />
            ) : null}
          </section>

          {workspace ? (
            <SpaceFilesSection
              key={workspace.id}
              activePath={activeDocumentPath}
              directories={directories}
              documents={documents}
              onCopyPath={onCopyWorkspaceEntryPath}
              onCreateDirectory={onCreateDirectory}
              onCreateDocument={onCreateDocument}
              onDeleteEntry={onDeleteWorkspaceEntry}
              onOpenDocument={onOpenDocument}
              onRefresh={onRefreshDocuments}
              onRenameDirectory={onRenameDirectory}
              onRenameDocument={onRenameDocument}
              onReveal={onRevealWorkspaceEntry}
            />
          ) : null}
        </div>

        <footer className="-mx-1.5 flex h-10 shrink-0 items-center border-t border-sidebar-border/70 px-2">
          <span className="min-w-0 flex-1 truncate px-1.5 text-[11px] font-medium">Tessera</span>
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
