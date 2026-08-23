/**
 * [INPUT]: Base UI Drawer、设计系统图标与样式工具
 * [OUTPUT]: 从右侧进入、支持焦点约束、Esc/外部点击/滑动关闭的 Sheet 基础组件
 * [POS]: 设计系统的临时详情与辅助操作浮层边界
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"
import { Cancel01Icon } from "@tessera/design-system/components/icons"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { cn } from "@tessera/design-system/lib/utils"

function Sheet({ swipeDirection = "right", ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root swipeDirection={swipeDirection} {...props} />
}

const SheetTrigger = DrawerPrimitive.Trigger
const SheetClose = DrawerPrimitive.Close

type SheetContentProps = DrawerPrimitive.Popup.Props &
  Readonly<{
    container?: DrawerPrimitive.Portal.Props["container"]
  }>

function SheetContent({ children, className, container, ...props }: SheetContentProps) {
  return (
    <DrawerPrimitive.Portal container={container}>
      <DrawerPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/18 backdrop-blur-[1px] transition-opacity duration-200 ease-out data-swiping:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
      <DrawerPrimitive.Viewport className="fixed inset-0 z-50 flex justify-end overflow-hidden">
        <DrawerPrimitive.Popup
          data-slot="sheet-content"
          className={cn(
            "h-full w-[min(420px,calc(100vw-20px))] border-l border-border bg-background text-foreground shadow-[-18px_0_48px_rgb(0_0_0/0.12)] [transform:translateX(var(--drawer-swipe-movement-x))] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] outline-none data-swiping:select-none data-swiping:transition-none data-ending-style:[transform:translateX(100%)] data-starting-style:[transform:translateX(100%)] motion-reduce:transition-none",
            className,
          )}
          {...props}
        >
          <DrawerPrimitive.Content className="relative flex h-full min-h-0 flex-col">
            <DrawerPrimitive.Close
              className="absolute top-4 right-4 z-10 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="关闭详情"
              title="关闭详情"
            >
              <Icon icon={Cancel01Icon} size={15} />
            </DrawerPrimitive.Close>
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  )
}

function SheetTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return <DrawerPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />
}

function SheetDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      className={cn("text-xs leading-5 text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger }
