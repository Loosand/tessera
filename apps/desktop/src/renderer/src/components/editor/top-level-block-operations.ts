/**
 * [INPUT]: ProseMirror 文档状态、顶层块位置与目标操作
 * [OUTPUT]: 顶层块定位、复制、删除、移动和文本块转换 transaction
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

export function duplicateTopLevelBlock(state: EditorState, position: number): Transaction | null {
  const block = findTopLevelBlockAtStart(state.doc, position)
  if (!block) return null

  const duplicatePos = block.pos + block.node.nodeSize
  const transaction = state.tr.insert(duplicatePos, block.node)
  return selectBlock(transaction, duplicatePos)
}

export function selectTopLevelBlock(state: EditorState, position: number): Transaction | null {
  const block = findTopLevelBlockAtStart(state.doc, position)
  if (!block) return null
  return selectBlock(state.tr, block.pos)
}

export function deleteTopLevelBlock(state: EditorState, position: number): Transaction | null {
  const block = findTopLevelBlockAtStart(state.doc, position)
  if (!block) return null

  if (state.doc.childCount === 1) {
    const paragraph = state.schema.nodes.paragraph?.create()
    if (!paragraph) return null
    const transaction = state.tr.replaceWith(block.pos, block.pos + block.node.nodeSize, paragraph)
    return transaction.setSelection(Selection.near(transaction.doc.resolve(1))).scrollIntoView()
  }

  const transaction = state.tr.delete(block.pos, block.pos + block.node.nodeSize)
  const selectionPos = Math.min(block.pos, transaction.doc.content.size)
  return transaction.setSelection(Selection.near(transaction.doc.resolve(selectionPos))).scrollIntoView()
}

export function moveTopLevelBlock(
  state: EditorState,
  position: number,
  direction: "down" | "up",
): Transaction | null {
  const block = findTopLevelBlockAtStart(state.doc, position)
  if (!block) return null

  if (direction === "up") {
    if (block.index === 0) return null
    const previous = state.doc.child(block.index - 1)
    return moveTopLevelBlockTo(state, block.pos, block.pos - previous.nodeSize)
  }

  if (block.index >= state.doc.childCount - 1) return null
  const next = state.doc.child(block.index + 1)
  return moveTopLevelBlockTo(state, block.pos, block.pos + block.node.nodeSize + next.nodeSize)
}

export function moveTopLevelBlockTo(
  state: EditorState,
  sourcePosition: number,
  targetPosition: number,
): Transaction | null {
  const block = findTopLevelBlockAtStart(state.doc, sourcePosition)
  if (!block || targetPosition < 0 || targetPosition > state.doc.content.size) return null

  const sourceEnd = block.pos + block.node.nodeSize
  if (targetPosition >= block.pos && targetPosition <= sourceEnd) return null

  const insertPos = targetPosition > sourceEnd ? targetPosition - block.node.nodeSize : targetPosition
  const transaction = state.tr.delete(block.pos, sourceEnd).insert(insertPos, block.node)
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
