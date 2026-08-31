/**
 * [INPUT]: ProseMirror 文档状态、顶层块位置与目标操作
 * [OUTPUT]: 顶层块与连续范围定位、复制、删除、移动和文本块转换 transaction
 * [POS]: 区块交互层的纯文档变换，不读取 DOM 或 React 状态
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { type EditorState, NodeSelection, Selection, type Transaction } from "@tiptap/pm/state"

export interface TopLevelBlock {
  index: number
  node: ProseMirrorNode
  pos: number
}

export interface TopLevelBlockRange {
  blockCount: number
  from: number
  fromIndex: number
  to: number
  toIndex: number
}

export type TextBlockKind = "heading-1" | "heading-2" | "heading-3" | "paragraph"

export function findTopLevelBlock(doc: ProseMirrorNode, position: number): TopLevelBlock | null {
  if (position < 0 || position > doc.content.size || doc.childCount === 0) return null

  let pos = 0
  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index)
    const end = pos + node.nodeSize
    if (position < end || (position === end && index === doc.childCount - 1)) return { index, node, pos }
    pos = end
  }

  return null
}

export function findTopLevelBlockAtStart(doc: ProseMirrorNode, position: number): TopLevelBlock | null {
  const block = findTopLevelBlock(doc, position)
  return block?.pos === position ? block : null
}

export function findAdjacentTopLevelBlock(
  doc: ProseMirrorNode,
  position: number,
  direction: "down" | "up",
): TopLevelBlock | null {
  const block = findTopLevelBlockAtStart(doc, position)
  if (!block) return null
  const nextIndex = block.index + (direction === "up" ? -1 : 1)
  if (nextIndex < 0 || nextIndex >= doc.childCount) return null

  let nextPosition = 0
  for (let index = 0; index < nextIndex; index += 1) nextPosition += doc.child(index).nodeSize
  return { index: nextIndex, node: doc.child(nextIndex), pos: nextPosition }
}

export function findTopLevelBlockRange(
  doc: ProseMirrorNode,
  anchorPosition: number,
  headPosition: number,
): TopLevelBlockRange | null {
  const anchor = findTopLevelBlockAtStart(doc, anchorPosition)
  const head = findTopLevelBlockAtStart(doc, headPosition)
  if (!anchor || !head) return null

  const first = anchor.index <= head.index ? anchor : head
  const last = anchor.index <= head.index ? head : anchor
  return {
    blockCount: last.index - first.index + 1,
    from: first.pos,
    fromIndex: first.index,
    to: last.pos + last.node.nodeSize,
    toIndex: last.index,
  }
}

export function duplicateTopLevelBlock(state: EditorState, position: number): Transaction | null {
  return duplicateTopLevelBlockRange(state, position, position)
}

export function duplicateTopLevelBlockRange(
  state: EditorState,
  anchorPosition: number,
  headPosition: number,
): Transaction | null {
  const range = findTopLevelBlockRange(state.doc, anchorPosition, headPosition)
  if (!range) return null

  const duplicatePos = range.to
  const content = state.doc.slice(range.from, range.to).content
  const transaction = state.tr.insert(duplicatePos, content)
  return selectBlock(transaction, duplicatePos)
}

export function selectTopLevelBlock(state: EditorState, position: number): Transaction | null {
  const block = findTopLevelBlockAtStart(state.doc, position)
  if (!block) return null
  return selectBlock(state.tr, block.pos)
}

export function deleteTopLevelBlock(state: EditorState, position: number): Transaction | null {
  return deleteTopLevelBlockRange(state, position, position)
}

export function deleteTopLevelBlockRange(
  state: EditorState,
  anchorPosition: number,
  headPosition: number,
): Transaction | null {
  const range = findTopLevelBlockRange(state.doc, anchorPosition, headPosition)
  if (!range) return null

  if (range.blockCount === state.doc.childCount) {
    const paragraph = state.schema.nodes.paragraph?.create()
    if (!paragraph) return null
    const transaction = state.tr.replaceWith(range.from, range.to, paragraph)
    return transaction.setSelection(Selection.near(transaction.doc.resolve(1))).scrollIntoView()
  }

  const transaction = state.tr.delete(range.from, range.to)
  const selectionPos = Math.min(range.from, transaction.doc.content.size)
  return transaction.setSelection(Selection.near(transaction.doc.resolve(selectionPos))).scrollIntoView()
}

export function moveTopLevelBlock(
  state: EditorState,
  position: number,
  direction: "down" | "up",
): Transaction | null {
  return moveTopLevelBlockRange(state, position, position, direction)
}

export function moveTopLevelBlockRange(
  state: EditorState,
  anchorPosition: number,
  headPosition: number,
  direction: "down" | "up",
): Transaction | null {
  const range = findTopLevelBlockRange(state.doc, anchorPosition, headPosition)
  if (!range) return null

  if (direction === "up") {
    if (range.fromIndex === 0) return null
    const previous = state.doc.child(range.fromIndex - 1)
    return moveTopLevelBlockRangeTo(state, anchorPosition, headPosition, range.from - previous.nodeSize)
  }

  if (range.toIndex >= state.doc.childCount - 1) return null
  const next = state.doc.child(range.toIndex + 1)
  return moveTopLevelBlockRangeTo(state, anchorPosition, headPosition, range.to + next.nodeSize)
}

export function moveTopLevelBlockTo(
  state: EditorState,
  sourcePosition: number,
  targetPosition: number,
): Transaction | null {
  return moveTopLevelBlockRangeTo(state, sourcePosition, sourcePosition, targetPosition)
}

export function moveTopLevelBlockRangeTo(
  state: EditorState,
  anchorPosition: number,
  headPosition: number,
  targetPosition: number,
): Transaction | null {
  const range = findTopLevelBlockRange(state.doc, anchorPosition, headPosition)
  if (
    !range ||
    targetPosition < 0 ||
    targetPosition > state.doc.content.size ||
    !isTopLevelBoundary(state.doc, targetPosition)
  )
    return null

  if (targetPosition >= range.from && targetPosition <= range.to) return null

  const content = state.doc.slice(range.from, range.to).content
  const insertPos = targetPosition > range.to ? targetPosition - content.size : targetPosition
  const transaction = state.tr.delete(range.from, range.to).insert(insertPos, content)
  return selectBlock(transaction, insertPos)
}

export function transformTextTopLevelBlock(
  state: EditorState,
  position: number,
  kind: TextBlockKind,
): Transaction | null {
  const block = findTopLevelBlockAtStart(state.doc, position)
  if (!block || !block.node.isTextblock) return null

  const type = kind === "paragraph" ? state.schema.nodes.paragraph : state.schema.nodes.heading
  if (!type) return null
  const attrs = kind === "paragraph" ? undefined : { level: Number(kind.at(-1)) }
  if (block.node.type === type && (kind === "paragraph" || block.node.attrs.level === attrs?.level))
    return null

  const transaction = state.tr.setNodeMarkup(block.pos, type, attrs, block.node.marks)
  return selectBlock(transaction, block.pos)
}

function selectBlock(transaction: Transaction, position: number) {
  return transaction.setSelection(NodeSelection.create(transaction.doc, position)).scrollIntoView()
}

function isTopLevelBoundary(doc: ProseMirrorNode, position: number) {
  if (position === 0 || position === doc.content.size) return true
  return findTopLevelBlockAtStart(doc, position) !== null
}
