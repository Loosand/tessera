/**
 * [INPUT]: 任务标题、会话状态、当前选中态、可选尾部信息与原生按钮属性
 * [OUTPUT]: 带稳定右侧安全区的统一侧栏任务行、明确选中背景与可访问运行中指示器
 * [POS]: 全局侧栏、工作区侧栏和文档 AI 侧栏共享的任务导航模式
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSessionStatus } from "@tessera/contracts"
import { Message01Icon } from "@tessera/design-system/components/icons"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { cn } from "@tessera/design-system/lib/utils"
import React, { type ComponentProps, type ReactNode } from "react"

export function TaskRunIndicator({ status }: Readonly<{ status: TaskSessionStatus }>) {
  if (status !== "running") return null

  return (
    <output
      className="ml-1 flex size-4 shrink-0 items-center justify-center"
      aria-label="正在生成"
      title="正在生成"
    >
      <span
        aria-hidden="true"
        className="size-3 animate-spin rounded-full border-[1.5px] border-sidebar-foreground/20 border-t-sidebar-foreground/75 motion-reduce:animate-none motion-reduce:border-sidebar-foreground/45"
      />
    </output>
  )
}

type TaskNavigationRowProps = Omit<ComponentProps<"button">, "children" | "title"> &
  Readonly<{
    active?: boolean
    status: TaskSessionStatus
    taskTitle: string
    trailing?: ReactNode
    tooltip?: string
  }>

export function TaskNavigationRow({
  active = false,
  className,
  status,
  taskTitle,
  trailing,
  tooltip = taskTitle,
  ...props
}: TaskNavigationRowProps) {
  return (
    <button
      type="button"
      className={cn(
        "group flex min-h-8 w-full items-center gap-2 rounded-md py-0 pl-2 pr-3 text-left text-[12px] transition-colors hover:bg-sidebar-accent/55 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
        className,
      )}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      data-running={status === "running" || undefined}
      title={tooltip}
      {...props}
    >
      <Icon icon={Message01Icon} size={14} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{taskTitle}</span>
      {trailing}
      <TaskRunIndicator status={status} />
    </button>
  )
}
