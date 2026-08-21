/**
 * [INPUT]: 原生 select 属性、可选前置装饰与设计系统样式工具
 * [OUTPUT]: 保留系统选项菜单行为的单选控件
 * [POS]: 设计系统的原生单选输入与视觉边界
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import UnfoldMoreIcon from "@hugeicons/core-free-icons/UnfoldMoreIcon"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@tessera/design-system/lib/utils"
import type { ComponentProps, ReactNode } from "react"

export interface NativeSelectProps extends Omit<ComponentProps<"select">, "size"> {
  containerClassName?: string
  size?: "sm" | "default"
  startAdornment?: ReactNode
}

export function NativeSelect({
  children,
  className,
  containerClassName,
  disabled,
  size = "default",
  startAdornment,
  ...props
}: NativeSelectProps) {
  return (
    <span
      data-slot="native-select-container"
      className={cn("relative inline-grid w-fit min-w-0", containerClassName)}
    >
      {startAdornment ? (
        <span
          data-slot="native-select-adornment"
          className={cn(
            "pointer-events-none absolute top-1/2 left-2 z-10 flex size-4 -translate-y-1/2 items-center justify-center text-muted-foreground",
            disabled && "opacity-50",
          )}
          aria-hidden="true"
        >
          {startAdornment}
        </span>
      ) : null}
      <select
        data-slot="native-select"
        data-size={size}
        disabled={disabled}
        className={cn(
          "min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-7 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          startAdornment && "pl-7",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <HugeiconsIcon
        icon={UnfoldMoreIcon}
        strokeWidth={2}
        data-slot="native-select-icon"
        className={cn(
          "pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground",
          disabled && "opacity-50",
        )}
        aria-hidden="true"
      />
    </span>
  )
}
