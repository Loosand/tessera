/**
 * [INPUT]: 文本选区锚点、AI 编辑状态、快捷动作和受控或非受控的编辑指令
 * [OUTPUT]: 跟随选区定位、支持键盘操作与异步状态呈现的 SelectionActions 浮动操作条
 * [POS]: 设计系统中供编辑器、阅读器和消息内容复用的选区 AI 操作模式
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

"use client"

import { cn } from "@tessera/design-system/lib/utils"
import {
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  ArrowRight01Icon,
  ArrowUp01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Refresh01Icon,
} from "./icons"
import { Button } from "./ui/button"
import { Icon } from "./ui/icon"
import { Input } from "./ui/input"

export type SelectionActionsStatus = "idle" | "thinking" | "streaming" | "result" | "error"

interface SelectionActionsClientRects extends ArrayLike<DOMRectReadOnly> {
  item?(index: number): DOMRectReadOnly | null
}

export interface SelectionActionsAnchor {
  getBoundingClientRect(): DOMRectReadOnly
  getClientRects?(): SelectionActionsClientRects
}

export interface SelectionActionItem {
  ariaLabel?: string
  busyLabel?: ReactNode
  disabled?: boolean
  icon?: ReactNode
  id: string
  label: ReactNode
}

export type SelectionActionsProps = Omit<ComponentProps<"div">, "children" | "onSubmit"> &
  Readonly<{
    actions: readonly SelectionActionItem[]
    activeActionId?: string
    anchor: SelectionActionsAnchor | null
    defaultExpanded?: boolean
    defaultValue?: string
    discardLabel?: ReactNode
    errorLabel?: ReactNode
    keepLabel?: ReactNode
    moreActionsLabel?: string
    onAction: (action: SelectionActionItem) => void
    onDiscard?: (() => void) | undefined
    onExpandedChange?: ((expanded: boolean) => void) | undefined
    onKeep?: (() => void) | undefined
    onOpenChange?: ((open: boolean) => void) | undefined
    onRetry?: ((action: SelectionActionItem | undefined) => void) | undefined
    onSubmit?: ((instruction: string) => void) | undefined
    onValueChange?: ((value: string) => void) | undefined
    open: boolean
    portalContainer?: DocumentFragment | Element | null
    promptLabel?: string
    promptPlaceholder?: string
    retryLabel?: string
    sideOffset?: number
    status: SelectionActionsStatus
    statusLabel?: ReactNode
    value?: string
    viewportPadding?: number
    visibleActionCount?: number
  }>

interface FloatingPosition {
  left: number
  ready: boolean
  top: number
}

const initialPosition: FloatingPosition = { left: 0, ready: false, top: 0 }
const busyStatuses = new Set<SelectionActionsStatus>(["thinking", "streaming"])

function getLastClientRect(anchor: SelectionActionsAnchor, fallback: DOMRectReadOnly) {
  const rects = anchor.getClientRects?.()
  if (!rects || rects.length === 0) return fallback
  return rects.item?.(rects.length - 1) ?? rects[rects.length - 1] ?? fallback
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function SelectionActionButton({
  action,
  onAction,
}: {
  action: SelectionActionItem
  onAction: (action: SelectionActionItem) => void
}) {
  return (
    <Button
      aria-label={action.ariaLabel}
      className="h-7 gap-1 rounded-full px-2.5 text-xs font-normal"
      disabled={action.disabled}
      onClick={() => onAction(action)}
      size="sm"
      type="button"
      variant="ghost"
    >
      {action.icon ? (
        <span aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center">
          {action.icon}
        </span>
      ) : null}
      {action.label}
    </Button>
  )
}

export function SelectionActions({
  "aria-label": ariaLabel = "文本选择操作",
  actions,
  activeActionId,
  anchor,
  className,
  defaultExpanded = false,
  defaultValue = "",
  discardLabel = "放弃",
  errorLabel = "处理失败",
  keepLabel = "保留",
  moreActionsLabel = "显示更多操作",
  onAction,
  onDiscard,
  onExpandedChange,
  onKeep,
  onOpenChange,
  onRetry,
  onSubmit,
  onValueChange,
  open,
  portalContainer,
  promptLabel = "描述修改",
  promptPlaceholder = "描述修改",
  retryLabel = "重试",
  sideOffset = 8,
  status,
  statusLabel,
  style,
  value,
  viewportPadding = 12,
  visibleActionCount = 2,
  ...props
}: SelectionActionsProps) {
  const [mounted, setMounted] = useState(false)
  const [internalValue, setInternalValue] = useState(defaultValue)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [position, setPosition] = useState<FloatingPosition>(initialPosition)
  const [surfaceWidth, setSurfaceWidth] = useState<number | undefined>()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const positionedAnchorRef = useRef<SelectionActionsAnchor | null>(null)
  const extraActionsId = useId()
  const instruction = value ?? internalValue
  const hasInstruction = instruction.trim().length > 0
  const busy = busyStatuses.has(status)
  const activeAction = actions.find((action) => action.id === activeActionId)
  const primaryActions = actions.slice(0, Math.max(0, visibleActionCount))
  const extraActions = actions.slice(primaryActions.length)
  const hasExtraActions = extraActions.length > 0

  const place = useCallback(() => {
    if (!open || !anchor || typeof window === "undefined") return
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null

      try {
        const bounds = anchor.getBoundingClientRect()
        const lastLine = getLastClientRect(anchor, bounds)
        const surface = surfaceRef.current?.getBoundingClientRect()
        const width = surface?.width ?? 0
        const height = surface?.height ?? 36
        const centeredLeft = bounds.left + bounds.width / 2 - width / 2
        const maximumLeft = Math.max(viewportPadding, window.innerWidth - viewportPadding - width)
        const left = clamp(centeredLeft, viewportPadding, maximumLeft)
        const below = lastLine.bottom + sideOffset
        const above = bounds.top - sideOffset - height
        const top =
          below + height <= window.innerHeight - viewportPadding ? below : Math.max(viewportPadding, above)
        const next = { left: Math.round(left), ready: true, top: Math.round(top) }

        setPosition((current) =>
          current.left === next.left && current.ready === next.ready && current.top === next.top
            ? current
            : next,
        )
      } catch {
        setPosition(initialPosition)
      }
    })
  }, [anchor, open, sideOffset, viewportPadding])

  useEffect(() => setMounted(true), [])

  useLayoutEffect(() => {
    if (!open || !anchor) {
      positionedAnchorRef.current = null
      setPosition(initialPosition)
      return
    }

    if (positionedAnchorRef.current !== anchor) {
      positionedAnchorRef.current = anchor
      setPosition(initialPosition)
    }
    place()
  }, [anchor, open, place])

  useEffect(() => {
    if (!open || !anchor || typeof window === "undefined") return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      onOpenChange?.(false)
    }
    const handleViewportChange = () => place()

    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("scroll", handleViewportChange, true)
    document.addEventListener("keydown", handleEscape)
    document.addEventListener("selectionchange", handleViewportChange)

    return () => {
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
      document.removeEventListener("keydown", handleEscape)
      document.removeEventListener("selectionchange", handleViewportChange)
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    }
  }, [anchor, onOpenChange, open, place])

  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === "undefined") return

    const updateWidth = () => {
      const intrinsicWidth = Math.ceil(content.getBoundingClientRect().width) + 8
      const availableWidth = Math.max(0, window.innerWidth - viewportPadding * 2)
      setSurfaceWidth(Math.min(intrinsicWidth, availableWidth))
      place()
    }
    const observer = new ResizeObserver(updateWidth)
    observer.observe(content)
    updateWidth()

    return () => observer.disconnect()
  }, [place, viewportPadding])

  function setInstruction(nextValue: string) {
    setInternalValue(nextValue)
    onValueChange?.(nextValue)
  }

  function setActionsExpanded(nextExpanded: boolean) {
    setExpanded(nextExpanded)
    onExpandedChange?.(nextExpanded)
  }

  function submitInstruction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextInstruction = instruction.trim()
    if (!nextInstruction || !onSubmit) return
    onSubmit(nextInstruction)
  }

  if (!mounted || !open || !anchor) return null

  const target = portalContainer ?? document.body
  const busyLabel = statusLabel ?? activeAction?.busyLabel ?? activeAction?.label ?? "正在处理"

  return createPortal(
    <div
      {...props}
      aria-busy={busy}
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={cn(
        "fixed z-50 h-9 max-w-[calc(100vw-1.5rem)] overflow-x-auto overflow-y-hidden rounded-full bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 [scrollbar-width:none] transition-[width,opacity,transform] duration-300 ease-out motion-reduce:transition-none [&::-webkit-scrollbar]:hidden",
        position.ready ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
        className,
      )}
      data-slot="selection-actions"
      data-status={status}
      ref={surfaceRef}
      role="toolbar"
      style={{ ...style, left: position.left, top: position.top, width: surfaceWidth }}
    >
      <div className="flex w-max min-w-max items-center gap-0.5" ref={contentRef}>
        {busy ? (
          <output className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap px-2.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-border border-t-foreground"
            />
            <span
              className={cn(status === "thinking" && "tessera-loading-label bg-clip-text text-transparent")}
            >
              {busyLabel}…
            </span>
          </output>
        ) : null}

        {status === "result" ? (
          <>
            {onKeep ? (
              <Button className="h-7 rounded-full px-2.5 text-xs" onClick={onKeep} size="sm" type="button">
                <Icon aria-hidden="true" icon={CheckmarkCircle02Icon} size={14} />
                {keepLabel}
              </Button>
            ) : null}
            {onDiscard ? (
              <Button
                className="h-7 rounded-full px-2.5 text-xs font-normal"
                onClick={onDiscard}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Icon aria-hidden="true" icon={CancelCircleIcon} size={14} />
                {discardLabel}
              </Button>
            ) : null}
            {onRetry ? (
              <>
                <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
                <Button
                  aria-label={retryLabel}
                  className="rounded-full"
                  onClick={() => onRetry(activeAction)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Icon aria-hidden="true" icon={Refresh01Icon} size={14} />
                </Button>
              </>
            ) : null}
          </>
        ) : null}

        {status === "error" ? (
          <>
            <span
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap px-2.5 text-xs text-destructive"
              role="alert"
            >
              <Icon aria-hidden="true" icon={CancelCircleIcon} size={14} />
              {statusLabel ?? errorLabel}
            </span>
            {onRetry ? (
              <Button
                className="h-7 rounded-full px-2.5 text-xs font-normal"
                onClick={() => onRetry(activeAction)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Icon aria-hidden="true" icon={Refresh01Icon} size={14} />
                {retryLabel}
              </Button>
            ) : null}
          </>
        ) : null}

        {status === "idle" ? (
          <>
            <div
              aria-hidden={expanded}
              className={cn(
                "min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out motion-reduce:transition-none",
                expanded ? "max-w-0 -translate-x-2 opacity-0" : "max-w-40 translate-x-0 opacity-100",
              )}
              inert={expanded}
            >
              <form className="flex h-7 w-40 items-center" onSubmit={submitInstruction}>
                <Input
                  aria-label={promptLabel}
                  className="h-7 border-0 bg-transparent px-3 text-xs shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder={promptPlaceholder}
                  value={instruction}
                />
              </form>
            </div>

            <div
              aria-hidden={hasInstruction}
              className={cn(
                "flex min-w-0 items-center gap-0.5 overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out motion-reduce:transition-none",
                hasInstruction
                  ? "max-w-0 -translate-x-2 opacity-0"
                  : "max-w-[48rem] translate-x-0 opacity-100",
              )}
              inert={hasInstruction}
            >
              {!expanded && primaryActions.length > 0 ? (
                <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
              ) : null}
              {primaryActions.map((action) => (
                <SelectionActionButton action={action} key={action.id} onAction={onAction} />
              ))}
              {hasExtraActions ? (
                <div
                  aria-hidden={!expanded}
                  className={cn(
                    "flex min-w-0 items-center gap-0.5 overflow-hidden transition-[max-width,opacity] duration-300 ease-out motion-reduce:transition-none",
                    expanded ? "max-w-[36rem] opacity-100" : "max-w-0 opacity-0",
                  )}
                  id={extraActionsId}
                  inert={!expanded}
                >
                  {extraActions.map((action) => (
                    <SelectionActionButton action={action} key={action.id} onAction={onAction} />
                  ))}
                </div>
              ) : null}
              {hasExtraActions ? (
                <>
                  <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
                  <Button
                    aria-controls={extraActionsId}
                    aria-expanded={expanded}
                    aria-label={expanded ? "收起更多操作" : moreActionsLabel}
                    className="rounded-full"
                    onClick={() => setActionsExpanded(!expanded)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "transition-transform duration-300 motion-reduce:transition-none",
                        expanded && "rotate-180",
                      )}
                      icon={ArrowRight01Icon}
                      size={14}
                    />
                  </Button>
                </>
              ) : null}
            </div>

            <div
              aria-hidden={!hasInstruction}
              className={cn(
                "min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out motion-reduce:transition-none",
                hasInstruction ? "max-w-8 scale-100 opacity-100" : "max-w-0 scale-90 opacity-0",
              )}
              inert={!hasInstruction}
            >
              <Button
                aria-label="发送编辑指令"
                className="rounded-full"
                disabled={!onSubmit}
                onClick={() => onSubmit?.(instruction.trim())}
                size="icon-sm"
                type="button"
              >
                <Icon aria-hidden="true" icon={ArrowUp01Icon} size={15} />
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>,
    target,
  )
}
