/**
 * [INPUT]: 设置分组标题、说明、内容和标准 section 属性
 * [OUTPUT]: 具有统一标题节奏与内容容器的 SettingSection 组件
 * [POS]: 设置页面用于组织相关选项的模式组件
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { cn } from "@tessera/design-system/lib/utils"
import type { ComponentProps, ReactNode } from "react"

export interface SettingSectionProps extends ComponentProps<"section"> {
  title: string
  description?: string
  action?: ReactNode
}

export function SettingSection({
  title,
  description,
  action,
  className,
  children,
  ...props
}: SettingSectionProps) {
  return (
    <section className={cn("space-y-3", className)} {...props}>
      <header className="flex min-h-11 items-end justify-between gap-6 px-1">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
        {children}
      </div>
    </section>
  )
}
