/**
 * [INPUT]: 活动状态、进行中/完成文案、图标、可展开内容与标准 section 属性
 * [OUTPUT]: 尊重减少动态效果、键盘可达的 ActivityTrace 过程轨迹容器
 * [POS]: 设计系统中供思考、搜索和工具过程复用的状态反馈模式
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { cn } from "@tessera/design-system/lib/utils"
import React, { type ComponentProps, type ReactNode, useId, useState } from "react"
import { ArrowDown01Icon } from "./icons"
import { Button } from "./ui/button"
import { Icon } from "./ui/icon"

export type ActivityTraceStatus = "active" | "complete" | "error"

export type ActivityTraceProps = Omit<ComponentProps<"section">, "children"> &
  Readonly<{
    activeLabel: string
    children: ReactNode
    defaultExpanded?: boolean
    doneLabel: string
    icon: ReactNode
    status: ActivityTraceStatus
  }>

export function ActivityTrace({
  activeLabel,
  children,
  className,
  defaultExpanded = true,
  doneLabel,
  icon,
  status,
  ...props
}: ActivityTraceProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const contentId = useId()
  const active = status === "active"
  const label = active ? activeLabel : doneLabel

  return (
    <section
      aria-busy={active}
      className={cn("my-3 max-w-2xl text-muted-foreground", className)}
      data-slot="activity-trace"
      {...props}
    >
      <Button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="-ml-1 h-auto gap-2 px-1 py-1 text-[13px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        onClick={() => setExpanded((current) => !current)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span aria-live="polite" className="min-w-0 truncate">
          <span
            className={cn(
              "font-medium",
              active && "tessera-loading-label bg-clip-text text-transparent",
              status === "error" && "text-destructive",
            )}
          >
            {label}
          </span>
        </span>
        <Icon
          aria-hidden="true"
          className={cn(
            "transition-transform duration-200 motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
          icon={ArrowDown01Icon}
          size={14}
        />
      </Button>

      <div
        aria-hidden={!expanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        id={contentId}
        inert={!expanded}
      >
        <div className="overflow-hidden">
          <div className="mt-1 ml-[7px] border-l border-border py-1 pl-[23px]">{children}</div>
        </div>
      </div>
    </section>
  )
}
