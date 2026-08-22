/**
 * [INPUT]: 当前文档、带状态的当前任务/同工作区任务列表、共享任务会话子树与任务切换/关闭操作
 * [OUTPUT]: 带任务身份、选中/运行状态、历史切换和新建入口，承载正常任务对话实现的可访问文档右侧 AI 协作面板
 * [POS]: TaskPage 在文档工作表面中的窄布局容器
 * [DOC]: design.md、docs/architecture.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DocumentSnapshot, TaskSessionStatus } from "@tessera/contracts"
import {
  Add01Icon,
  AiBrain01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@tessera/design-system/components/ui/popover"
import { m, useReducedMotion } from "motion/react"
import React, { type ReactNode, useMemo, useState } from "react"
import { motionSprings } from "../motion"
import { TaskNavigationRow, TaskRunIndicator } from "./task-navigation-row"

export type AgentSidebarTask = Readonly<{
  id: string
  status: TaskSessionStatus
  title: string
}>

type AgentSidebarProps = Readonly<{
  activeTask: AgentSidebarTask
  children: ReactNode
  document: DocumentSnapshot | null
  onClose: () => void
  onNewTask: () => void
  onOpenTask: (taskId: string) => void
  tasks: readonly AgentSidebarTask[]
}>

export function AgentSidebar({
  activeTask,
  children,
  document,
  onClose,
  onNewTask,
  onOpenTask,
  tasks,
}: AgentSidebarProps) {
  const shouldReduceMotion = useReducedMotion()
  const [taskMenuOpen, setTaskMenuOpen] = useState(false)
  const taskOptions = useMemo(
    () => [activeTask, ...tasks.filter((task) => task.id !== activeTask.id)].slice(0, 10),
    [activeTask, tasks],
  )

  return (
    <m.aside
      className="flex h-full min-h-0 w-[380px] shrink-0 flex-col border-l border-border/65 bg-sidebar/70 max-[900px]:absolute max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-10 max-[900px]:shadow-xl max-[600px]:w-[min(380px,calc(100vw-32px))]"
      initial={shouldReduceMotion ? false : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
      transition={shouldReduceMotion ? { duration: 0 } : motionSprings.gentle}
    >
      <header className="flex h-11 shrink-0 items-center border-b border-border/55 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-medium">
          <Icon icon={AiBrain01Icon} size={15} />
          <span className="shrink-0">AI 助手</span>
          {document ? (
            <span className="truncate text-[10px] font-normal text-muted-foreground">{document.name}</span>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭 AI 助手" onClick={onClose}>
          <Icon icon={ArrowRight01Icon} size={15} />
        </Button>
      </header>

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/45 px-2">
        <Popover open={taskMenuOpen} onOpenChange={setTaskMenuOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 min-w-0 flex-1 justify-start gap-2 bg-sidebar-accent/70 px-2 text-sidebar-accent-foreground data-[popup-open]:bg-sidebar-accent"
                aria-label="切换侧栏任务"
                aria-current="page"
                title={activeTask.title}
              />
            }
          >
            <TaskRunIndicator status={activeTask.status} />
            <span className="min-w-0 flex-1 truncate text-left text-xs">{activeTask.title}</span>
            <Icon icon={ArrowDown01Icon} size={12} className="shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="end"
            sideOffset={5}
            className="w-[350px] max-w-[calc(100vw-40px)] rounded-xl border border-border/70 p-1.5 ring-0"
          >
            <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">当前任务与项目历史</div>
            <div className="grid max-h-64 gap-0.5 overflow-y-auto">
              {taskOptions.map((task) => (
                <TaskNavigationRow
                  key={task.id}
                  active={task.id === activeTask.id}
                  className="rounded-lg text-xs"
                  status={task.status}
                  taskTitle={task.title}
                  onClick={() => {
                    setTaskMenuOpen(false)
                    if (task.id !== activeTask.id) onOpenTask(task.id)
                  }}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="新建侧栏任务"
          title="新任务"
          onClick={onNewTask}
        >
          <Icon icon={Add01Icon} size={15} />
        </Button>
      </div>

      <div className="min-h-0 flex-1">{children}</div>
    </m.aside>
  )
}
