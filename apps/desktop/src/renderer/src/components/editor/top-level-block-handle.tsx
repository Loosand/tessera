/**
 * [INPUT]: 当前 TipTap Editor、编辑表面激活状态、设计系统原语与共享 Motion 参数
 * [OUTPUT]: 单一浮动块手柄、顶层拖动指示与可检索块操作菜单
 * [POS]: 富文本编辑器的动态区块 chrome，不创建第二套内容状态
 * [DOC]: design.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Copy01Icon,
  Delete02Icon,
  Drag01Icon,
  ParagraphIcon,
  Search01Icon,
} from "@tessera/design-system/components/icons"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { m, useReducedMotion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motionSprings } from "../../motion"
import {
  type TextBlockKind,
  deleteTopLevelBlock,
  duplicateTopLevelBlock,
  findTopLevelBlock,
  findTopLevelBlockAtStart,
  moveTopLevelBlock,
  moveTopLevelBlockTo,
  selectTopLevelBlock,
  transformTextTopLevelBlock,
} from "./top-level-block-operations"

interface TopLevelBlockHandleProps {
  active: boolean
  editor: Editor
}

interface BlockAnchor {
  index: number
  left: number
  node: ProseMirrorNode
  pos: number
  top: number
}

interface DropTarget {
  left: number
  pos: number
  top: number
  width: number
}

interface DragGesture {
  dragging: boolean
  pointerId: number
  sourcePos: number
  startX: number
  startY: number
}

const BLOCK_LABELS: Record<string, string> = {
  blockquote: "引用",
  bulletList: "无序列表",
  codeBlock: "代码块",
  heading: "标题",
  horizontalRule: "分隔线",
  orderedList: "有序列表",
  paragraph: "正文",
  table: "表格",
  taskList: "任务列表",
}

const TEXT_BLOCK_KINDS: Array<{ kind: TextBlockKind; label: string }> = [
  { kind: "paragraph", label: "正文" },
  { kind: "heading-1", label: "一级标题" },
  { kind: "heading-2", label: "二级标题" },
  { kind: "heading-3", label: "三级标题" },
]

export function TopLevelBlockHandle({ active: editorActive, editor }: TopLevelBlockHandleProps) {
  const shouldReduceMotion = useReducedMotion()
  const [anchor, setAnchor] = useState<BlockAnchor | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [dragging, setDragging] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuQuery, setMenuQuery] = useState("")
  const [transformOpen, setTransformOpen] = useState(false)
  const dragGestureRef = useRef<DragGesture | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)
  const handleRef = useRef<HTMLButtonElement | null>(null)
  const menuOpenRef = useRef(menuOpen)
  const menuRef = useRef<HTMLElement | null>(null)

  menuOpenRef.current = menuOpen
  dropTargetRef.current = dropTarget

  const readAnchor = useCallback(
    (position: number): BlockAnchor | null => {
      const block = findTopLevelBlockAtStart(editor.state.doc, position)
      if (!block) return null
      const nodeDom = editor.view.nodeDOM(block.pos)
      if (!(nodeDom instanceof HTMLElement)) return null
      const rect = nodeDom.getBoundingClientRect()
      return {
        index: block.index,
        left: Math.max(8, rect.left - 30),
        node: block.node,
        pos: block.pos,
        top: rect.top + Math.max(0, Math.min(6, (rect.height - 24) / 2)),
      }
    },
    [editor],
  )

  useEffect(() => {
    if (!editorActive) {
      setAnchor(null)
      setMenuOpen(false)
      return
    }

    const editorDom = editor.view.dom
    let pointerFrame = 0
    let pendingPointerPosition: { left: number; top: number } | null = null

    const handlePointerMove = (event: PointerEvent) => {
      if (dragGestureRef.current || menuOpenRef.current) return
      const target = event.target
      if (
        target instanceof Node &&
        (handleRef.current?.contains(target) || menuRef.current?.contains(target))
      )
        return
      pendingPointerPosition = { left: event.clientX, top: event.clientY }
      if (pointerFrame) return
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0
        const pointerPosition = pendingPointerPosition
        pendingPointerPosition = null
        if (!pointerPosition || dragGestureRef.current || menuOpenRef.current) return

        const hit = editor.view.posAtCoords(pointerPosition)
        if (!hit) return
        const block = findTopLevelBlock(editor.state.doc, hit.pos)
        if (!block) return
        const nextAnchor = readAnchor(block.pos)
        if (!nextAnchor) return
        setAnchor((current) => {
          if (
            current?.pos === nextAnchor.pos &&
            current.left === nextAnchor.left &&
            current.top === nextAnchor.top
          )
            return current
          return nextAnchor
        })
      })
    }

    const handlePointerLeave = (event: PointerEvent) => {
      if (dragGestureRef.current || menuOpenRef.current) return
      const related = event.relatedTarget
      if (
        related instanceof Node &&
        (handleRef.current?.contains(related) || menuRef.current?.contains(related))
      )
        return
      if (pointerFrame) cancelAnimationFrame(pointerFrame)
      pointerFrame = 0
      pendingPointerPosition = null
      setAnchor(null)
    }

    const refreshAnchor = () => {
      setAnchor((current) => (current ? readAnchor(current.pos) : null))
    }

    editorDom.addEventListener("pointermove", handlePointerMove)
    editorDom.addEventListener("pointerleave", handlePointerLeave)
    window.addEventListener("resize", refreshAnchor)
    window.addEventListener("scroll", refreshAnchor, true)
    return () => {
      editorDom.removeEventListener("pointermove", handlePointerMove)
      editorDom.removeEventListener("pointerleave", handlePointerLeave)
      window.removeEventListener("resize", refreshAnchor)
      window.removeEventListener("scroll", refreshAnchor, true)
      if (pointerFrame) cancelAnimationFrame(pointerFrame)
    }
  }, [editor, editorActive, readAnchor])

  useEffect(() => {
    if (!menuOpen) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        (handleRef.current?.contains(target) || menuRef.current?.contains(target))
      )
        return
      setMenuOpen(false)
      setAnchor(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setMenuOpen(false)
      editor.view.focus()
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer, true)
    document.addEventListener("keydown", closeOnEscape, true)
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true)
      document.removeEventListener("keydown", closeOnEscape, true)
    }
  }, [editor, menuOpen])

  useEffect(() => {
    if (menuOpen) return
    setMenuQuery("")
    setTransformOpen(false)
  }, [menuOpen])

  const dispatchAtAnchor = useCallback(
    (createTransaction: (position: number) => ReturnType<typeof selectTopLevelBlock>) => {
      if (!anchor) return
      const transaction = createTransaction(anchor.pos)
      if (!transaction) return
      editor.view.dispatch(transaction)
      setMenuOpen(false)
      setAnchor(null)
      requestAnimationFrame(() => editor.view.focus())
    },
    [anchor, editor],
  )

  const selectAnchor = useCallback(() => {
    if (!anchor) return
    const transaction = selectTopLevelBlock(editor.state, anchor.pos)
    if (transaction) editor.view.dispatch(transaction)
  }, [anchor, editor])

  const updateDropTarget = useCallback(
    (clientX: number, clientY: number, sourcePos: number) => {
      const hit = editor.view.posAtCoords({ left: clientX, top: clientY })
      if (!hit) {
        dropTargetRef.current = null
        setDropTarget(null)
        return
      }
      const block = findTopLevelBlock(editor.state.doc, hit.pos)
      if (!block) return
      const nodeDom = editor.view.nodeDOM(block.pos)
      if (!(nodeDom instanceof HTMLElement)) return

      const rect = nodeDom.getBoundingClientRect()
      const targetPos = clientY < rect.top + rect.height / 2 ? block.pos : block.pos + block.node.nodeSize
      const source = findTopLevelBlockAtStart(editor.state.doc, sourcePos)
      if (!source || (targetPos >= source.pos && targetPos <= source.pos + source.node.nodeSize)) {
        dropTargetRef.current = null
        setDropTarget(null)
        return
      }

      const nextDropTarget = {
        left: rect.left,
        pos: targetPos,
        top: targetPos === block.pos ? rect.top - 2 : rect.bottom,
        width: rect.width,
      }
      dropTargetRef.current = nextDropTarget
      setDropTarget(nextDropTarget)
    },
    [editor],
  )

  const finishDrag = useCallback(
    (pointerId: number) => {
      const gesture = dragGestureRef.current
      if (!gesture || gesture.pointerId !== pointerId) return
      if (gesture.dragging && dropTargetRef.current) {
        const transaction = moveTopLevelBlockTo(editor.state, gesture.sourcePos, dropTargetRef.current.pos)
        if (transaction) editor.view.dispatch(transaction)
      } else if (!gesture.dragging) {
        selectAnchor()
        setMenuOpen((open) => !open)
      }

      dragGestureRef.current = null
      dropTargetRef.current = null
      setDragging(false)
      setDropTarget(null)
      if (gesture.dragging) {
        setAnchor(null)
        requestAnimationFrame(() => editor.view.focus())
      }
    },
    [editor, selectAnchor],
  )

  const cancelDrag = useCallback((pointerId: number) => {
    const gesture = dragGestureRef.current
    if (!gesture || gesture.pointerId !== pointerId) return
    dragGestureRef.current = null
    dropTargetRef.current = null
    setDragging(false)
    setDropTarget(null)
  }, [])

  if (!editorActive || !anchor) return null

  const canTransform = anchor.node.type.name === "heading" || anchor.node.type.name === "paragraph"
  const blockLabel = BLOCK_LABELS[anchor.node.type.name] ?? "区块"
  const canMoveUp = anchor.index > 0
  const canMoveDown = anchor.index < editor.state.doc.childCount - 1
  const normalizedQuery = menuQuery.trim().toLocaleLowerCase()
  const matchesQuery = (label: string) =>
    !normalizedQuery || label.toLocaleLowerCase().includes(normalizedQuery)
  const matchingTransforms = canTransform
    ? TEXT_BLOCK_KINDS.filter(({ label }) => matchesQuery(`转换为${label}`))
    : []
  const menuLeft = Math.max(8, Math.min(anchor.left + 30, window.innerWidth - 264))
  const menuTop = Math.max(8, Math.min(anchor.top, window.innerHeight - 326))
  const transformPanelLeft = menuLeft + 252 + 198 > window.innerWidth ? -198 : 258
  const hasMatchingAction = ["复制区块", "上移", "下移", "删除区块"].some(matchesQuery)

  return createPortal(
    <>
      {dropTarget ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 h-0.5 rounded-full bg-primary shadow-[0_0_0_1px_color-mix(in_srgb,var(--background)_70%,transparent)]"
          style={{ left: dropTarget.left, top: dropTarget.top, width: dropTarget.width }}
        />
      ) : null}
      <button
        ref={handleRef}
        type="button"
        aria-label={`${blockLabel}区块操作`}
        aria-expanded={menuOpen}
        data-dragging={dragging || undefined}
        className="fixed z-50 flex size-6 touch-none items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[dragging=true]:cursor-grabbing data-[dragging=true]:bg-muted data-[dragging=true]:text-foreground"
        style={{ left: anchor.left, top: anchor.top }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          selectAnchor()
          setMenuOpen((open) => !open)
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          dragGestureRef.current = {
            dragging: false,
            pointerId: event.pointerId,
            sourcePos: anchor.pos,
            startX: event.clientX,
            startY: event.clientY,
          }
        }}
        onPointerMove={(event) => {
          const gesture = dragGestureRef.current
          if (!gesture || gesture.pointerId !== event.pointerId) return
          if (
            !gesture.dragging &&
            Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 5
          )
            return
          if (!gesture.dragging) {
            gesture.dragging = true
            setDragging(true)
            setMenuOpen(false)
            selectAnchor()
          }
          updateDropTarget(event.clientX, event.clientY, gesture.sourcePos)
        }}
        onPointerUp={(event) => finishDrag(event.pointerId)}
        onPointerCancel={(event) => cancelDrag(event.pointerId)}
      >
        <Icon icon={Drag01Icon} size={15} strokeWidth={2} />
      </button>
      {menuOpen ? (
        <m.section
          ref={menuRef}
          aria-label={`${blockLabel}区块菜单`}
          className="fixed z-50 w-[252px] rounded-[10px] bg-popover p-1 text-popover-foreground shadow-[0_14px_40px_rgb(0_0_0/0.14),0_2px_7px_rgb(0_0_0/0.07)] ring-1 ring-foreground/10"
          style={{ left: menuLeft, top: menuTop }}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.985, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : motionSprings.gentle}
        >
          <div className="relative m-1 mb-1.5">
            <Icon
              icon={Search01Icon}
              size={14}
              className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={menuQuery}
              onChange={(event) => {
                setMenuQuery(event.currentTarget.value)
                setTransformOpen(false)
              }}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="搜索操作…"
              aria-label="搜索区块操作"
              autoFocus
              className="h-8 rounded-md pl-7 text-xs shadow-none focus-visible:ring-2"
            />
          </div>
          <div className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground">{blockLabel}</div>
          {canTransform && !normalizedQuery ? (
            <div className="relative">
              <BlockMenuButton
                icon={ParagraphIcon}
                label="转换为"
                trailing={<Icon icon={ArrowRight01Icon} size={13} />}
                ariaExpanded={transformOpen}
                ariaHasPopup="menu"
                onClick={() => setTransformOpen(true)}
                onMouseEnter={() => setTransformOpen(true)}
              />
              {transformOpen ? (
                <m.div
                  className="absolute top-0 z-10 w-48 rounded-[10px] bg-popover p-1 shadow-[0_14px_40px_rgb(0_0_0/0.14),0_2px_7px_rgb(0_0_0/0.07)] ring-1 ring-foreground/10"
                  style={{ left: transformPanelLeft }}
                  initial={
                    shouldReduceMotion
                      ? false
                      : { opacity: 0, scale: 0.985, x: transformPanelLeft < 0 ? 4 : -4 }
                  }
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  transition={shouldReduceMotion ? { duration: 0 } : motionSprings.gentle}
                  onMouseLeave={() => setTransformOpen(false)}
                >
                  <div className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground">转换为</div>
                  {TEXT_BLOCK_KINDS.map(({ kind, label }) => (
                    <TransformMenuButton
                      key={kind}
                      kind={kind}
                      label={label}
                      onClick={() =>
                        dispatchAtAnchor((position) =>
                          transformTextTopLevelBlock(editor.state, position, kind),
                        )
                      }
                    />
                  ))}
                </m.div>
              ) : null}
            </div>
          ) : null}
          {normalizedQuery && matchingTransforms.length > 0 ? (
            <div className="border-b border-border pb-1">
              <div className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground">转换</div>
              {matchingTransforms.map(({ kind, label }) => (
                <TransformMenuButton
                  key={kind}
                  kind={kind}
                  label={label}
                  onClick={() =>
                    dispatchAtAnchor((position) => transformTextTopLevelBlock(editor.state, position, kind))
                  }
                />
              ))}
            </div>
          ) : null}
          {matchesQuery("复制区块") ? (
            <BlockMenuButton
              icon={Copy01Icon}
              label="复制区块"
              onClick={() => dispatchAtAnchor((position) => duplicateTopLevelBlock(editor.state, position))}
            />
          ) : null}
          {matchesQuery("上移") ? (
            <BlockMenuButton
              icon={ArrowUp01Icon}
              label="上移"
              disabled={!canMoveUp}
              onClick={() => dispatchAtAnchor((position) => moveTopLevelBlock(editor.state, position, "up"))}
            />
          ) : null}
          {matchesQuery("下移") ? (
            <BlockMenuButton
              icon={ArrowDown01Icon}
              label="下移"
              disabled={!canMoveDown}
              onClick={() =>
                dispatchAtAnchor((position) => moveTopLevelBlock(editor.state, position, "down"))
              }
            />
          ) : null}
          {matchesQuery("删除区块") ? (
            <>
              <div className="my-1 border-t border-border" />
              <BlockMenuButton
                destructive
                icon={Delete02Icon}
                label="删除区块"
                onClick={() => dispatchAtAnchor((position) => deleteTopLevelBlock(editor.state, position))}
              />
            </>
          ) : null}
          {!hasMatchingAction && matchingTransforms.length === 0 ? (
            <div className="px-2 py-5 text-center text-xs text-muted-foreground">没有匹配的操作</div>
          ) : null}
        </m.section>
      ) : null}
    </>,
    document.body,
  )
}

interface BlockMenuButtonProps {
  ariaExpanded?: boolean
  ariaHasPopup?: React.AriaAttributes["aria-haspopup"]
  destructive?: boolean
  disabled?: boolean
  icon: Parameters<typeof Icon>[0]["icon"]
  label: string
  onClick: () => void
  onMouseEnter?: () => void
  trailing?: React.ReactNode
}

function BlockMenuButton({
  ariaExpanded,
  ariaHasPopup,
  destructive,
  disabled,
  icon,
  label,
  onClick,
  onMouseEnter,
  trailing,
}: BlockMenuButtonProps) {
  return (
    <button
      type="button"
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      disabled={disabled}
      className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35 data-[destructive=true]:text-danger data-[destructive=true]:hover:bg-danger/10"
      data-destructive={destructive || undefined}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-current">
        <Icon icon={icon} size={15} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? <span className="ml-auto text-muted-foreground">{trailing}</span> : null}
    </button>
  )
}

interface TransformMenuButtonProps {
  kind: TextBlockKind
  label: string
  onClick: () => void
}

function TransformMenuButton({ kind, label, onClick }: TransformMenuButtonProps) {
  return (
    <button
      type="button"
      className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
    >
      <span className="flex size-5 shrink-0 items-center justify-center font-mono text-[11px] text-muted-foreground">
        {kind === "paragraph" ? "T" : `H${kind.at(-1)}`}
      </span>
      <span>{label}</span>
    </button>
  )
}
