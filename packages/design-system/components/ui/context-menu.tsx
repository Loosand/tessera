/**
 * [INPUT]: Base UI Context Menu 与设计系统样式工具
 * [OUTPUT]: 可组合、可访问的右键菜单基础组件
 * [POS]: 设计系统的上下文命令浮层行为与视觉边界
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import type * as React from "react"

import { cn } from "@tessera/design-system/lib/utils"

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger

function ContextMenuContent({
  className,
  children,
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: ContextMenuPrimitive.Popup.Props &
  Pick<ContextMenuPrimitive.Positioner.Props, "align" | "alignOffset" | "sideOffset">) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "z-50 min-w-52 origin-(--transform-origin) overflow-hidden rounded-[10px] bg-popover p-1 text-popover-foreground shadow-[0_14px_40px_rgb(0_0_0/0.14),0_2px_7px_rgb(0_0_0/0.07)] ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  destructive = false,
  ...props
}: ContextMenuPrimitive.Item.Props & { destructive?: boolean }) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-destructive={destructive || undefined}
      className={cn(
        "flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1 text-[13px] outline-none select-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-40 data-[destructive=true]:text-danger data-[destructive=true]:data-highlighted:bg-danger/10",
        className,
      )}
      {...props}
    />
  )
}

function ContextMenuLabel({ className, ...props }: ContextMenuPrimitive.GroupLabel.Props) {
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-label"
      className={cn("px-2 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

function ContextMenuSeparator({ className, ...props }: ContextMenuPrimitive.Separator.Props) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn("ml-auto shrink-0 text-[11px] tracking-wide text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
}
