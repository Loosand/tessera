/**
 * [INPUT]: 设置项标题、说明、右侧控件与标准 div 属性
 * [OUTPUT]: 统一栅格、分隔线和控件对齐的 SettingRow 组件
 * [POS]: SettingSection 内呈现单个设置项的模式组件
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { cn } from "@tessera/design-system/lib/utils"
import type { ComponentProps, ReactNode } from "react"

export interface SettingRowProps extends ComponentProps<"div"> {
  title: string
  description?: string
  control?: ReactNode
}

export function SettingRow({ title, description, control, className, children, ...props }: SettingRowProps) {
  return (
    <div
      className={cn(
        "grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-8 border-b border-border px-5 py-4 last:border-b-0",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p>
        ) : null}
        {children}
      </div>
      {control ? <div className="shrink-0">{control}</div> : null}
    </div>
  )
}
