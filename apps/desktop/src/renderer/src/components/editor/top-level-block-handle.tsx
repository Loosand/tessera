/**
 * [INPUT]: 当前 TipTap Editor、编辑表面激活状态、设计系统原语与共享 Motion 参数
 * [OUTPUT]: 支持连续多选、Markdown 剪贴板与键盘导航的单一浮动块手柄、拖动指示和操作菜单
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
  ClipboardCopyIcon,
  CopyPlusIcon,
  Delete02Icon,
  Drag01Icon,
  ParagraphIcon,
  ScissorIcon,
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
import { resolveMarkdownClipboardShortcut, writeTopLevelBlockRangeToClipboard } from "./markdown-clipboard"
import {
  type TextBlockKind,
  deleteTopLevelBlockRange,
  duplicateTopLevelBlockRange,
  findAdjacentTopLevelBlock,
  findTopLevelBlock,
  findTopLevelBlockAtStart,
  findTopLevelBlockRange,
  moveTopLevelBlockRange,
  moveTopLevelBlockRangeTo,
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

interface BlockSelection {
  anchorPos: number
  headPos: number
}

type ClipboardNotice = "copied" | "cut-stale" | "failed"

interface DragGesture {
  dragging: boolean
  extendSelection: boolean
  pointerId: number
  sourceAnchorPos: number
  sourceFrom: number
  sourceHeadPos: number
  sourceTo: number
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
  const [blockSelection, setBlockSelection] = useState<BlockSelection | null>(null)
  const [clipboardNotice, setClipboardNotice] = useState<ClipboardNotice | null>(null)
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
      setBlockSelection(null)
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

    const clearBlockSelection = () => setBlockSelection(null)

    editorDom.addEventListener("pointermove", handlePointerMove)
    editorDom.addEventListener("pointerleave", handlePointerLeave)
    editorDom.addEventListener("pointerdown", clearBlockSelection)
    window.addEventListener("resize", refreshAnchor)
    window.addEventListener("scroll", refreshAnchor, true)
    return () => {
      editorDom.removeEventListener("pointermove", handlePointerMove)
      editorDom.removeEventListener("pointerleave", handlePointerLeave)
      editorDom.removeEventListener("pointerdown", clearBlockSelection)
      window.removeEventListener("resize", refreshAnchor)
      window.removeEventListener("scroll", refreshAnchor, true)
      if (pointerFrame) cancelAnimationFrame(pointerFrame)
    }
  }, [editor, editorActive, readAnchor])

  useEffect(() => {
    if (!blockSelection) return
    const range = findTopLevelBlockRange(editor.state.doc, blockSelection.anchorPos, blockSelection.headPos)
    if (!range || range.blockCount < 2) return

    const selectedElements: HTMLElement[] = []
    let position = range.from
    for (let index = range.fromIndex; index <= range.toIndex; index += 1) {
      const nodeDom = editor.view.nodeDOM(position)
      if (nodeDom instanceof HTMLElement) {
        nodeDom.dataset.blockRangeSelected = "true"
        selectedElements.push(nodeDom)
      }
      position += editor.state.doc.child(index).nodeSize
    }

    return () => {
      for (const element of selectedElements) delete element.dataset.blockRangeSelected
    }
  }, [blockSelection, editor])

  useEffect(() => {
    const clearOnDocumentChange = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) setBlockSelection(null)
    }
    editor.on("transaction", clearOnDocumentChange)
    return () => {
      editor.off("transaction", clearOnDocumentChange)
    }
  }, [editor])

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
    setClipboardNotice(null)
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

  const dispatchAtSelection = useCallback(
    (
      createTransaction: (
        anchorPosition: number,
        headPosition: number,
      ) => ReturnType<typeof selectTopLevelBlock>,
    ) => {
      if (!anchor) return
      const selection = blockSelection ?? { anchorPos: anchor.pos, headPos: anchor.pos }
      const transaction = createTransaction(selection.anchorPos, selection.headPos)
      if (!transaction) return
      editor.view.dispatch(transaction)
      setBlockSelection(null)
      setMenuOpen(false)
      setAnchor(null)
      requestAnimationFrame(() => editor.view.focus())
    },
    [anchor, blockSelection, editor],
  )

  const applyBlockSelection = useCallback(
    (selection: BlockSelection) => {
      setBlockSelection(selection)
      const transaction = selectTopLevelBlock(editor.state, selection.headPos)
      if (transaction) editor.view.dispatch(transaction)
    },
    [editor],
  )

  const writeSelectionToClipboard = useCallback(
    async (operation: "copy" | "cut") => {
      if (!anchor && !blockSelection) return
      if (!editor.markdown) {
        setClipboardNotice("failed")
        setMenuOpen(true)
        return
      }
      const selection = blockSelection ?? (anchor ? { anchorPos: anchor.pos, headPos: anchor.pos } : null)
      if (!selection) return
      const sourceDoc = editor.state.doc
      const result = await writeTopLevelBlockRangeToClipboard(
        editor.markdown,
        sourceDoc,
        selection.anchorPos,
        selection.headPos,
        (markdown) => navigator.clipboard.writeText(markdown),
      )

      if (result !== "copied") {
        setClipboardNotice("failed")
        setMenuOpen(true)
        return
      }
      if (operation === "copy") {
        setClipboardNotice(menuOpen ? "copied" : null)
        return
      }
      if (editor.state.doc !== sourceDoc) {
        setClipboardNotice("cut-stale")
        setMenuOpen(true)
        return
      }

      const transaction = deleteTopLevelBlockRange(editor.state, selection.anchorPos, selection.headPos)
      if (!transaction) {
        setClipboardNotice("cut-stale")
        setMenuOpen(true)
        return
      }
      editor.view.dispatch(transaction)
      setBlockSelection(null)
      setClipboardNotice(null)
      setMenuOpen(false)
      setAnchor(null)
      requestAnimationFrame(() => editor.view.focus())
    },
    [anchor, blockSelection, editor, menuOpen],
  )

  useEffect(() => {
    if (!blockSelection) return

    const handleDocumentClipboardShortcut = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        (handleRef.current?.contains(target) || menuRef.current?.contains(target))
      )
        return
      const clipboardShortcut = resolveMarkdownClipboardShortcut(event)
      if (!clipboardShortcut) return
      event.preventDefault()
      void writeSelectionToClipboard(clipboardShortcut)
    }

    document.addEventListener("keydown", handleDocumentClipboardShortcut, true)
    return () => {
      document.removeEventListener("keydown", handleDocumentClipboardShortcut, true)
    }
  }, [blockSelection, writeSelectionToClipboard])

  const selectAnchor = useCallback(
    (extendSelection = false) => {
      if (!anchor) return
      applyBlockSelection({
        anchorPos: extendSelection && blockSelection ? blockSelection.anchorPos : anchor.pos,
        headPos: anchor.pos,
      })
    },
    [anchor, applyBlockSelection, blockSelection],
  )

  const navigateAnchor = useCallback(
    (direction: "down" | "up", extendSelection: boolean) => {
      if (!anchor) return
      const nextBlock = findAdjacentTopLevelBlock(editor.state.doc, anchor.pos, direction)
      if (!nextBlock) return
      const nextAnchor = readAnchor(nextBlock.pos)
      if (!nextAnchor) return
      setAnchor(nextAnchor)
      setMenuOpen(false)
      applyBlockSelection({
        anchorPos: extendSelection && blockSelection ? blockSelection.anchorPos : nextBlock.pos,
        headPos: nextBlock.pos,
      })
      requestAnimationFrame(() => handleRef.current?.focus())
    },
    [anchor, applyBlockSelection, blockSelection, editor, readAnchor],
  )

  const selectedRange = blockSelection
    ? findTopLevelBlockRange(editor.state.doc, blockSelection.anchorPos, blockSelection.headPos)
    : null

  const updateDropTarget = useCallback(
    (clientX: number, clientY: number, sourceFrom: number, sourceTo: number) => {
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
      if (targetPos >= sourceFrom && targetPos <= sourceTo) {
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
        const transaction = moveTopLevelBlockRangeTo(
          editor.state,
          gesture.sourceAnchorPos,
          gesture.sourceHeadPos,
          dropTargetRef.current.pos,
        )
        if (transaction) editor.view.dispatch(transaction)
      } else if (!gesture.dragging) {
        selectAnchor(gesture.extendSelection)
        setMenuOpen((open) => !open)
      }

      dragGestureRef.current = null
      dropTargetRef.current = null
      setDragging(false)
      setDropTarget(null)
      if (gesture.dragging) {
        setBlockSelection(null)
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

  const selectedBlockCount = selectedRange?.blockCount ?? 1
  const canTransform =
    selectedBlockCount === 1 && (anchor.node.type.name === "heading" || anchor.node.type.name === "paragraph")
  const blockLabel =
    selectedBlockCount > 1 ? `${selectedBlockCount} 个区块` : (BLOCK_LABELS[anchor.node.type.name] ?? "区块")
  const canMoveUp = (selectedRange?.fromIndex ?? anchor.index) > 0
  const canMoveDown = (selectedRange?.toIndex ?? anchor.index) < editor.state.doc.childCount - 1
  const copyMarkdownLabel = selectedBlockCount > 1 ? "复制所选区块的 Markdown" : "复制 Markdown"
  const cutLabel = selectedBlockCount > 1 ? `剪切 ${selectedBlockCount} 个区块` : "剪切区块"
  const duplicateLabel = selectedBlockCount > 1 ? "创建所选区块的副本" : "创建副本"
  const deleteLabel = selectedBlockCount > 1 ? `删除 ${selectedBlockCount} 个区块` : "删除区块"
  const normalizedQuery = menuQuery.trim().toLocaleLowerCase()
  const matchesQuery = (label: string) =>
    !normalizedQuery || label.toLocaleLowerCase().includes(normalizedQuery)
  const matchingTransforms = canTransform
    ? TEXT_BLOCK_KINDS.filter(({ label }) => matchesQuery(`转换为${label}`))
    : []
  const menuLeft = Math.max(8, Math.min(anchor.left + 30, window.innerWidth - 264))
  const menuTop = Math.max(8, Math.min(anchor.top, window.innerHeight - 406))
  const transformPanelLeft = menuLeft + 252 + 198 > window.innerWidth ? -198 : 258
  const hasMatchingAction = [copyMarkdownLabel, cutLabel, duplicateLabel, "上移", "下移", deleteLabel].some(
    matchesQuery,
  )

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
        aria-label={`${blockLabel}操作；方向键导航，Shift 加方向键扩展选择`}
        aria-expanded={menuOpen}
        data-dragging={dragging || undefined}
        className="fixed z-50 flex size-6 touch-none items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[dragging=true]:cursor-grabbing data-[dragging=true]:bg-muted data-[dragging=true]:text-foreground"
        style={{ left: anchor.left, top: anchor.top }}
        onKeyDown={(event) => {
          const clipboardShortcut = resolveMarkdownClipboardShortcut(event)
          if (clipboardShortcut) {
            event.preventDefault()
            void writeSelectionToClipboard(clipboardShortcut)
            return
          }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault()
            navigateAnchor(event.key === "ArrowUp" ? "up" : "down", event.shiftKey)
            return
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "d") {
            event.preventDefault()
            dispatchAtSelection((anchorPosition, headPosition) =>
              duplicateTopLevelBlockRange(editor.state, anchorPosition, headPosition),
            )
            return
          }
          if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault()
            dispatchAtSelection((anchorPosition, headPosition) =>
              deleteTopLevelBlockRange(editor.state, anchorPosition, headPosition),
            )
            return
          }
          if (event.key === "Escape") {
            setBlockSelection(null)
            setMenuOpen(false)
            return
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            selectAnchor(event.shiftKey)
            setMenuOpen((open) => !open)
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          const sourceSelection =
            event.shiftKey && blockSelection
              ? { anchorPos: blockSelection.anchorPos, headPos: anchor.pos }
              : selectedRange &&
                  blockSelection &&
                  anchor.index >= selectedRange.fromIndex &&
                  anchor.index <= selectedRange.toIndex
                ? blockSelection
                : { anchorPos: anchor.pos, headPos: anchor.pos }
          const sourceRange = findTopLevelBlockRange(
            editor.state.doc,
            sourceSelection.anchorPos,
            sourceSelection.headPos,
          )
          if (!sourceRange) return
          dragGestureRef.current = {
            dragging: false,
            extendSelection: event.shiftKey,
            pointerId: event.pointerId,
            sourceAnchorPos: sourceSelection.anchorPos,
            sourceFrom: sourceRange.from,
            sourceHeadPos: sourceSelection.headPos,
            sourceTo: sourceRange.to,
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
            applyBlockSelection({
              anchorPos: gesture.sourceAnchorPos,
              headPos: gesture.sourceHeadPos,
            })
          }
          updateDropTarget(event.clientX, event.clientY, gesture.sourceFrom, gesture.sourceTo)
        }}
        onPointerUp={(event) => finishDrag(event.pointerId)}
        onPointerCancel={(event) => cancelDrag(event.pointerId)}
      >
        <Icon icon={Drag01Icon} size={15} strokeWidth={2} />
      </button>
      {menuOpen ? (
        <m.section
          ref={menuRef}
          aria-label={`${blockLabel}菜单`}
          className="fixed z-50 max-h-[calc(100vh-16px)] w-[252px] overflow-y-auto rounded-[10px] bg-popover p-1 text-popover-foreground shadow-[0_14px_40px_rgb(0_0_0/0.14),0_2px_7px_rgb(0_0_0/0.07)] ring-1 ring-foreground/10"
          style={{ left: menuLeft, top: menuTop }}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.985, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : motionSprings.gentle}
          onKeyDown={(event) => {
            const clipboardShortcut = resolveMarkdownClipboardShortcut(event)
            if (!clipboardShortcut) return
            event.preventDefault()
            void writeSelectionToClipboard(clipboardShortcut)
          }}
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
              onKeyDown={(event) => {
                const clipboardShortcut = resolveMarkdownClipboardShortcut(event)
                if (clipboardShortcut && event.currentTarget.value.length === 0) {
                  event.preventDefault()
                  void writeSelectionToClipboard(clipboardShortcut)
                }
                event.stopPropagation()
              }}
              placeholder="搜索操作…"
              aria-label="搜索区块操作"
              autoFocus
              className="h-8 rounded-md pl-7 text-xs shadow-none focus-visible:ring-2"
            />
          </div>
          {clipboardNotice ? (
            <div
              role={clipboardNotice === "failed" ? "alert" : "status"}
              className={`mx-1 mb-1.5 rounded-md px-2 py-1.5 text-[11px] ${clipboardNotice === "failed" ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground"}`}
            >
              {clipboardNotice === "copied"
                ? "已复制为 Markdown"
                : clipboardNotice === "cut-stale"
                  ? "已复制，但文档已变化，未执行剪切"
                  : "无法写入系统剪贴板"}
            </div>
          ) : null}
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
          {matchesQuery(copyMarkdownLabel) ? (
            <BlockMenuButton
              icon={ClipboardCopyIcon}
              label={copyMarkdownLabel}
              trailing="⌘C"
              onClick={() => void writeSelectionToClipboard("copy")}
            />
          ) : null}
          {matchesQuery(cutLabel) ? (
            <BlockMenuButton
              icon={ScissorIcon}
              label={cutLabel}
              trailing="⌘X"
              onClick={() => void writeSelectionToClipboard("cut")}
            />
          ) : null}
          {matchesQuery(duplicateLabel) ? (
            <BlockMenuButton
              icon={CopyPlusIcon}
              label={duplicateLabel}
              trailing="⌘D"
              onClick={() =>
                dispatchAtSelection((anchorPosition, headPosition) =>
                  duplicateTopLevelBlockRange(editor.state, anchorPosition, headPosition),
                )
              }
            />
          ) : null}
          {matchesQuery("上移") ? (
            <BlockMenuButton
              icon={ArrowUp01Icon}
              label="上移"
              disabled={!canMoveUp}
              onClick={() =>
                dispatchAtSelection((anchorPosition, headPosition) =>
                  moveTopLevelBlockRange(editor.state, anchorPosition, headPosition, "up"),
                )
              }
            />
          ) : null}
          {matchesQuery("下移") ? (
            <BlockMenuButton
              icon={ArrowDown01Icon}
              label="下移"
              disabled={!canMoveDown}
              onClick={() =>
                dispatchAtSelection((anchorPosition, headPosition) =>
                  moveTopLevelBlockRange(editor.state, anchorPosition, headPosition, "down"),
                )
              }
            />
          ) : null}
          {matchesQuery(deleteLabel) ? (
            <>
              <div className="my-1 border-t border-border" />
              <BlockMenuButton
                destructive
                icon={Delete02Icon}
                label={deleteLabel}
                onClick={() =>
                  dispatchAtSelection((anchorPosition, headPosition) =>
                    deleteTopLevelBlockRange(editor.state, anchorPosition, headPosition),
                  )
                }
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
