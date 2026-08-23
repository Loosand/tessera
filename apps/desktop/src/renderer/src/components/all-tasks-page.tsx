/**
 * [INPUT]: 当前 Space、活动/归档任务分页读取器、实时任务快照、侧栏状态与任务打开/重命名/置顶/归档/删除操作
 * [OUTPUT]: 可查看当前 Space 活动及已归档历史、每页十条、行尾直接管理且分页栏固定在底部的满高任务管理页面
 * [POS]: 从侧栏最近任务标题进入的持久化任务浏览表面
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSessionSummary } from "@tessera/contracts"
import {
  Archive02Icon,
  ArrowLeft01Icon,
  PanelLeftOpenIcon,
  Settings01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React, { useCallback, useMemo, useState } from "react"
import { type TaskPageLoader, useTaskPage } from "../hooks/use-task-page"
import { TaskContextMenu } from "./task-context-menu"
import { TaskNavigationRow } from "./task-navigation-row"
import { TaskPaginationControls } from "./task-pagination-controls"
import { TaskRowActions } from "./task-row-actions"

const TASK_PAGE_SIZE = 10
const TASK_LOADING_PLACEHOLDERS = ["first", "second", "third", "fourth", "fifth", "sixth"] as const
const TASK_DATE_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export function formatTaskUpdatedAt(updatedAt: number) {
  return TASK_DATE_FORMAT.format(updatedAt)
}

type AllTasksPageProps = Readonly<{
  activeTaskId: string | undefined
  liveTasks: readonly TaskSessionSummary[]
  loadTasksPage: TaskPageLoader
  refreshKey: number
  scopeKey: string
  sidebarOpen: boolean
  spaceName: string
  onDeleteTask: (taskId: string) => Promise<boolean>
  onOpenSettings: () => void
  onOpenTask: (task: TaskSessionSummary) => void
  onRenameTask: (taskId: string, title: string) => Promise<boolean>
  onSetTaskArchived: (taskId: string, archived: boolean) => Promise<boolean>
  onSetTaskPinned: (taskId: string, pinned: boolean) => Promise<boolean>
  onToggleSidebar: () => void
}>

export function AllTasksPage({
  activeTaskId,
  liveTasks,
  loadTasksPage,
  refreshKey,
  scopeKey,
  sidebarOpen,
  spaceName,
  onDeleteTask,
  onOpenSettings,
  onOpenTask,
  onRenameTask,
  onSetTaskArchived,
  onSetTaskPinned,
  onToggleSidebar,
}: AllTasksPageProps) {
  const [showArchived, setShowArchived] = useState(false)
  const loadFilteredPage = useCallback(
    (request: Parameters<TaskPageLoader>[0]) => loadTasksPage({ ...request, archived: showArchived }),
    [loadTasksPage, showArchived],
  )
  const taskPage = useTaskPage({
    loadPage: loadFilteredPage,
    pageSize: TASK_PAGE_SIZE,
    refreshKey,
    scopeKey: `${scopeKey}:${showArchived ? "archived" : "active"}`,
  })
  const liveTasksById = useMemo(() => new Map(liveTasks.map((task) => [task.id, task])), [liveTasks])
  const visibleTasks = taskPage.result.items.map((task) =>
    showArchived ? task : (liveTasksById.get(task.id) ?? task),
  )
  const pageTitle = showArchived ? "已归档" : "全部任务"

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header className="app-drag-region flex h-12 shrink-0 items-center border-b border-border/70 px-3">
        <span className="flex min-w-16 flex-1 justify-start">
          {!sidebarOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="app-no-drag"
              aria-label="展开侧边栏"
              title="展开侧边栏"
              onClick={onToggleSidebar}
            >
              <Icon icon={PanelLeftOpenIcon} size={14} />
            </Button>
          ) : null}
        </span>
        <span className="truncate text-[12px] font-medium">{pageTitle}</span>
        <span className="flex min-w-16 flex-1 justify-end">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="app-no-drag"
            aria-label="打开设置"
            title="设置"
            onClick={onOpenSettings}
          >
            <Icon icon={Settings01Icon} size={14} />
          </Button>
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-8 pt-7 pb-5 max-[760px]:px-4">
          <div className="mx-auto flex w-full max-w-5xl items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{pageTitle}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {spaceName} · {showArchived ? "按归档时间排序" : "置顶优先，其余按最后一次对话更新时间排序"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {taskPage.result.total} 个任务
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 rounded-lg px-2 text-[11px] text-muted-foreground"
                onClick={() => setShowArchived((current) => !current)}
              >
                <Icon icon={showArchived ? ArrowLeft01Icon : Archive02Icon} size={13} />
                {showArchived ? "返回对话" : "已归档"}
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-5 max-[760px]:px-4">
          <div
            className="mx-auto grid w-full max-w-5xl content-start gap-1"
            aria-busy={taskPage.loading || undefined}
          >
            {visibleTasks.map((task) => (
              <TaskContextMenu
                key={task.id}
                task={task}
                trigger={
                  <div
                    className="group/task flex min-w-0 items-center rounded-lg border border-transparent transition-colors hover:bg-muted/55 data-[active=true]:border-border data-[active=true]:bg-muted"
                    data-active={task.id === activeTaskId || undefined}
                  >
                    <TaskNavigationRow
                      active={task.id === activeTaskId}
                      className="min-h-10 min-w-0 flex-1 !bg-transparent px-3"
                      status={task.status}
                      taskTitle={task.title}
                      tooltip={task.title}
                      trailing={
                        <time
                          className="shrink-0 text-[10px] text-muted-foreground tabular-nums"
                          dateTime={new Date(task.updatedAt).toISOString()}
                        >
                          {formatTaskUpdatedAt(task.updatedAt)}
                        </time>
                      }
                      onClick={() => onOpenTask(task)}
                    />
                    <TaskRowActions
                      className="pr-2"
                      task={task}
                      onSetArchived={onSetTaskArchived}
                      onSetPinned={onSetTaskPinned}
                    />
                  </div>
                }
                onOpen={onOpenTask}
                onRename={onRenameTask}
                onDelete={onDeleteTask}
              />
            ))}

            {taskPage.loading && visibleTasks.length === 0
              ? TASK_LOADING_PLACEHOLDERS.map((placeholder) => (
                  <span
                    key={`all-tasks-loading-${placeholder}`}
                    className="h-10 animate-pulse rounded-lg bg-muted/45 motion-reduce:animate-none"
                  />
                ))
              : null}

            {taskPage.error ? (
              <button
                type="button"
                className="rounded-xl border border-destructive/25 bg-destructive/6 px-4 py-5 text-left text-xs text-destructive hover:bg-destructive/10"
                onClick={taskPage.reload}
              >
                {taskPage.error} 点击重试。
              </button>
            ) : null}

            {!taskPage.loading && !taskPage.error && taskPage.result.total === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
                <p className="text-sm font-medium">
                  {showArchived ? "这个 Space 没有已归档任务" : "这个 Space 还没有任务"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {showArchived
                    ? "归档的对话会显示在这里，并可随时恢复。"
                    : "从“新任务”开始一次对话后，会显示在这里。"}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="shrink-0 border-t border-border/70 bg-background px-8 py-3 max-[760px]:px-4">
          <div className="mx-auto w-full max-w-5xl">
            <TaskPaginationControls
              page={taskPage.page}
              total={taskPage.result.total}
              totalPages={taskPage.result.totalPages}
              onPageChange={taskPage.goToPage}
            />
          </div>
        </footer>
      </div>
    </section>
  )
}
