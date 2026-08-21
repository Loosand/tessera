/**
 * [INPUT]: Base UI Tooltip、定位参数与设计系统样式工具
 * [OUTPUT]: 共享延迟、可访问触发器和轻量提示浮层
 * [POS]: 设计系统的高密度控件视觉标签原语
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@tessera/design-system/lib/utils"

const Tooltip = TooltipPrimitive.Root
const TooltipProvider = TooltipPrimitive.Provider
const TooltipTrigger = TooltipPrimitive.Trigger

function TooltipContent({
  className,
  children,
  side = "top",
  sideOffset = 7,
  align = "center",
  alignOffset = 0,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 max-w-64 origin-(--transform-origin) rounded-md bg-foreground px-2 py-1 text-[11px] leading-4 text-background shadow-md transition-[transform,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
