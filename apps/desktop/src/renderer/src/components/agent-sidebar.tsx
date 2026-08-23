/**
 * [INPUT]: 共享任务会话子树与关闭操作
 * [OUTPUT]: 拥有独立精简 Header、可持久化拖拽宽度和键盘分隔条的文档右侧对话面板
 * [POS]: TaskPage 在文档工作表面中的可调宽辅助布局容器
 * [DOC]: design.md、docs/architecture.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { PanelRightCloseIcon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { m, useReducedMotion } from "motion/react"
import React, {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { motionSprings } from "../motion"

export const AGENT_SIDEBAR_DEFAULT_WIDTH = 460
export const AGENT_SIDEBAR_MIN_WIDTH = 380
export const AGENT_SIDEBAR_MAX_WIDTH = 720

const AGENT_SIDEBAR_STORAGE_KEY = "tessera.agent-sidebar-layout.v1"
const AGENT_SIDEBAR_SPLIT_RESERVED_WIDTH = 520
const AGENT_SIDEBAR_OVERLAY_BREAKPOINT = 900
const AGENT_SIDEBAR_VIEWPORT_GUTTER = 32
const AGENT_SIDEBAR_KEYBOARD_STEP = 16

type ResizeSession = Readonly<{
  pointerId: number
  startWidth: number
  startX: number
}>

export function resolveAgentSidebarWidth(width: number, viewportWidth: number) {
  const reservedWidth =
    viewportWidth < AGENT_SIDEBAR_OVERLAY_BREAKPOINT
      ? AGENT_SIDEBAR_VIEWPORT_GUTTER
      : AGENT_SIDEBAR_SPLIT_RESERVED_WIDTH
  const responsiveMaximum = Math.min(AGENT_SIDEBAR_MAX_WIDTH, Math.max(0, viewportWidth - reservedWidth))
  const responsiveMinimum = Math.min(AGENT_SIDEBAR_MIN_WIDTH, responsiveMaximum)
  const candidate = Number.isFinite(width) ? width : AGENT_SIDEBAR_DEFAULT_WIDTH
  return Math.round(Math.min(responsiveMaximum, Math.max(responsiveMinimum, candidate)))
}

function viewportWidth() {
  return typeof window === "undefined" ? 1440 : window.innerWidth
}

function readAgentSidebarWidth() {
  if (typeof localStorage === "undefined") return AGENT_SIDEBAR_DEFAULT_WIDTH
  try {
    const storedValue: unknown = JSON.parse(localStorage.getItem(AGENT_SIDEBAR_STORAGE_KEY) ?? "{}")
    const width =
      typeof storedValue === "object" && storedValue !== null && "width" in storedValue
        ? Reflect.get(storedValue, "width")
        : undefined
    return resolveAgentSidebarWidth(
      typeof width === "number" ? width : AGENT_SIDEBAR_DEFAULT_WIDTH,
      viewportWidth(),
    )
  } catch {
    return resolveAgentSidebarWidth(AGENT_SIDEBAR_DEFAULT_WIDTH, viewportWidth())
  }
}

function rememberAgentSidebarWidth(width: number) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(AGENT_SIDEBAR_STORAGE_KEY, JSON.stringify({ version: 1, width }))
}

type AgentSidebarProps = Readonly<{
  children: ReactNode
  onClose: () => void
}>

export function AgentSidebar({ children, onClose }: AgentSidebarProps) {
  const shouldReduceMotion = useReducedMotion()
  const [preferredWidth, setPreferredWidth] = useState(readAgentSidebarWidth)
  const [currentViewportWidth, setCurrentViewportWidth] = useState(viewportWidth)
  const resizeSessionRef = useRef<ResizeSession | null>(null)
  const widthRef = useRef(preferredWidth)
  const width = resolveAgentSidebarWidth(preferredWidth, currentViewportWidth)

  useEffect(() => {
    const handleViewportResize = () => setCurrentViewportWidth(window.innerWidth)
    window.addEventListener("resize", handleViewportResize)
    return () => window.removeEventListener("resize", handleViewportResize)
  }, [])

  useEffect(
    () => () => {
      document.body.style.removeProperty("cursor")
      document.body.style.removeProperty("user-select")
    },
    [],
  )

  const updateWidth = useCallback(
    (nextWidth: number, persist: boolean) => {
      const resolvedWidth = resolveAgentSidebarWidth(nextWidth, currentViewportWidth)
      widthRef.current = resolvedWidth
      setPreferredWidth(resolvedWidth)
      if (persist) rememberAgentSidebarWidth(resolvedWidth)
    },
    [currentViewportWidth],
  )

  const startResize = useCallback(
    (event: PointerEvent<HTMLHRElement>) => {
      if (event.button !== 0) return
      widthRef.current = width
      resizeSessionRef.current = {
        pointerId: event.pointerId,
        startWidth: width,
        startX: event.clientX,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      event.preventDefault()
    },
    [width],
  )

  const resize = useCallback(
    (event: PointerEvent<HTMLHRElement>) => {
      const session = resizeSessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      updateWidth(session.startWidth + session.startX - event.clientX, false)
    },
    [updateWidth],
  )

  const finishResize = useCallback(() => {
    if (!resizeSessionRef.current) return
    resizeSessionRef.current = null
    document.body.style.removeProperty("cursor")
    document.body.style.removeProperty("user-select")
    rememberAgentSidebarWidth(widthRef.current)
  }, [])

  const resizeWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLHRElement>) => {
      let nextWidth: number | null = null
      if (event.key === "ArrowLeft") nextWidth = width + AGENT_SIDEBAR_KEYBOARD_STEP
      if (event.key === "ArrowRight") nextWidth = width - AGENT_SIDEBAR_KEYBOARD_STEP
      if (event.key === "Home") nextWidth = AGENT_SIDEBAR_MIN_WIDTH
      if (event.key === "End") nextWidth = AGENT_SIDEBAR_MAX_WIDTH
      if (nextWidth === null) return
      event.preventDefault()
      updateWidth(nextWidth, true)
    },
    [updateWidth, width],
  )

  return (
    <m.aside
      className="relative flex h-full min-h-0 min-w-0 shrink-0 flex-col border-l border-border/65 bg-background max-[900px]:absolute max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-10 max-[900px]:shadow-xl"
      style={{ width: `min(${width}px, calc(100vw - ${AGENT_SIDEBAR_VIEWPORT_GUTTER}px))` }}
      data-slot="agent-sidebar"
      initial={shouldReduceMotion ? false : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
      transition={shouldReduceMotion ? { duration: 0 } : motionSprings.gentle}
    >
      <hr
        className="group absolute inset-y-0 left-0 z-20 m-0 w-2 -translate-x-1/2 cursor-col-resize touch-none border-0 bg-transparent outline-none before:absolute before:inset-y-3 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:content-[''] hover:before:bg-foreground/20 focus-visible:before:bg-ring max-[520px]:hidden"
        tabIndex={0}
        aria-label="调整侧边对话宽度"
        aria-orientation="vertical"
        aria-valuemin={Math.min(AGENT_SIDEBAR_MIN_WIDTH, width)}
        aria-valuemax={Math.max(
          width,
          resolveAgentSidebarWidth(AGENT_SIDEBAR_MAX_WIDTH, currentViewportWidth),
        )}
        aria-valuenow={width}
        title="拖动调整宽度，双击恢复默认宽度"
        onDoubleClick={() => updateWidth(AGENT_SIDEBAR_DEFAULT_WIDTH, true)}
        onKeyDown={resizeWithKeyboard}
        onPointerCancel={finishResize}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={finishResize}
      />

      <header
        className="flex h-12 shrink-0 items-center justify-between border-b border-border/45 px-3.5"
        data-slot="agent-sidebar-header"
      >
        <span className="text-[11px] font-medium">侧边对话</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="关闭侧边对话"
          title="关闭侧边对话"
          onClick={onClose}
        >
          <Icon icon={PanelRightCloseIcon} size={15} />
        </Button>
      </header>

      <div className="min-h-0 flex-1">{children}</div>
    </m.aside>
  )
}
