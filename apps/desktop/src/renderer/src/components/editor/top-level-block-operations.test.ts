/**
 * [INPUT]: 顶层区块纯文档变换与最小 ProseMirror schema
 * [OUTPUT]: 定位、复制、删除、移动和文本块转换的回归测试
 * [POS]: 区块 transaction 的无 DOM 自动化保障
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { getSchema } from "@tiptap/core"
import { MarkdownManager } from "@tiptap/markdown"
import { Schema } from "@tiptap/pm/model"
import { EditorState, NodeSelection, type Transaction } from "@tiptap/pm/state"
import { describe, expect, it } from "vitest"
import { EDITOR_EXTENSIONS } from "./editor-extensions"
import {
  deleteTopLevelBlock,
  duplicateTopLevelBlock,
  findTopLevelBlock,
  moveTopLevelBlock,
  transformTextTopLevelBlock,
} from "./top-level-block-operations"

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: { attrs: { level: { default: 1 } }, content: "inline*", group: "block" },
    blockquote: { content: "block+", group: "block" },
    text: { group: "inline" },
  },
})

const editorSchema = getSchema(EDITOR_EXTENSIONS)
const markdownManager = new MarkdownManager({
  extensions: EDITOR_EXTENSIONS,
  markedOptions: { breaks: false, gfm: true },
})

function paragraph(text: string) {
  return schema.node("paragraph", null, text ? schema.text(text) : undefined)
}

function createState(...nodes: ReturnType<typeof paragraph>[]) {
  return EditorState.create({ doc: schema.node("doc", null, nodes) })
}

function topLevelText(state: EditorState) {
  return Array.from({ length: state.doc.childCount }, (_, index) => state.doc.child(index).textContent)
}

function requireTransaction(transaction: Transaction | null) {
  expect(transaction).not.toBeNull()
  if (!transaction) throw new Error("预期生成区块 transaction")
  return transaction
}

describe("top-level-block-operations", () => {
  it("从嵌套位置定位所属顶层块", () => {
    const quote = schema.node("blockquote", null, [paragraph("inside")])
    const state = createState(paragraph("before"), quote, paragraph("after"))
    const quotePos = state.doc.child(0).nodeSize

    expect(findTopLevelBlock(state.doc, quotePos + 2)).toMatchObject({ index: 1, node: quote, pos: quotePos })
  })

  it("复制块并选中新副本", () => {
    const state = createState(paragraph("one"), paragraph("two"))
    const transaction = duplicateTopLevelBlock(state, state.doc.child(0).nodeSize)

    expect(topLevelText(state.apply(requireTransaction(transaction)))).toEqual(["one", "two", "two"])
    expect(transaction?.selection).toBeInstanceOf(NodeSelection)
  })

  it("上下移动块且保持一次 transaction", () => {
    const state = createState(paragraph("one"), paragraph("two"), paragraph("three"))
    const secondPos = state.doc.child(0).nodeSize
    const movedUp = moveTopLevelBlock(state, secondPos, "up")
    const movedDown = moveTopLevelBlock(state, secondPos, "down")

    expect(topLevelText(state.apply(requireTransaction(movedUp)))).toEqual(["two", "one", "three"])
    expect(topLevelText(state.apply(requireTransaction(movedDown)))).toEqual(["one", "three", "two"])
  })

  it("删除唯一块时留下可编辑空段落", () => {
    const state = createState(paragraph("only"))
    const transaction = deleteTopLevelBlock(state, 0)
    const nextState = state.apply(requireTransaction(transaction))

    expect(nextState.doc.childCount).toBe(1)
    expect(nextState.doc.firstChild?.type.name).toBe("paragraph")
    expect(nextState.doc.textContent).toBe("")
  })

  it("在正文和标题之间转换并保留文本", () => {
    const state = createState(paragraph("title"))
    const toHeading = transformTextTopLevelBlock(state, 0, "heading-2")
    const headingState = state.apply(requireTransaction(toHeading))
    const toParagraph = transformTextTopLevelBlock(headingState, 0, "paragraph")
    const paragraphState = headingState.apply(requireTransaction(toParagraph))

    expect(headingState.doc.firstChild?.type.name).toBe("heading")
    expect(headingState.doc.firstChild?.attrs.level).toBe(2)
    expect(paragraphState.doc.firstChild?.type.name).toBe("paragraph")
    expect(paragraphState.doc.textContent).toBe("title")
  })

  it("在真实 Markdown schema 中移动列表且保持可序列化", () => {
    const parsed = markdownManager.parse("开头\n\n- 第一项\n- 第二项\n\n> 引用")
    const state = EditorState.create({ doc: editorSchema.nodeFromJSON(parsed) })
    const listPos = state.doc.child(0).nodeSize
    const transaction = moveTopLevelBlock(state, listPos, "down")
    const nextState = state.apply(requireTransaction(transaction))
    const markdown = markdownManager.serialize(nextState.doc.toJSON())

    expect(nextState.doc.child(1).type.name).toBe("blockquote")
    expect(nextState.doc.child(2).type.name).toBe("bulletList")
    expect(markdown.indexOf("> 引用")).toBeLessThan(markdown.indexOf("- 第一项"))
  })
})
