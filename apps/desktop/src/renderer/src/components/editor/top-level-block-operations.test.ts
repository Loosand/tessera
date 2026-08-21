/**
 * [INPUT]: 顶层区块纯文档变换与最小 ProseMirror schema
 * [OUTPUT]: 单块与连续范围定位、复制、删除、移动和文本块转换的回归测试
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
  deleteTopLevelBlockRange,
  duplicateTopLevelBlock,
  duplicateTopLevelBlockRange,
  findAdjacentTopLevelBlock,
  findTopLevelBlock,
  findTopLevelBlockRange,
  moveTopLevelBlock,
  moveTopLevelBlockRange,
  moveTopLevelBlockRangeTo,
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

function topLevelPosition(state: EditorState, index: number) {
  let position = 0
  for (let current = 0; current < index; current += 1) position += state.doc.child(current).nodeSize
  return position
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

  it("按顶层边界导航相邻块并在文档两端停止", () => {
    const state = createState(paragraph("one"), paragraph("two"), paragraph("three"))
    const secondPos = topLevelPosition(state, 1)

    expect(findAdjacentTopLevelBlock(state.doc, secondPos, "up")).toMatchObject({ index: 0, pos: 0 })
    expect(findAdjacentTopLevelBlock(state.doc, secondPos, "down")).toMatchObject({
      index: 2,
      pos: topLevelPosition(state, 2),
    })
    expect(findAdjacentTopLevelBlock(state.doc, 0, "up")).toBeNull()
    expect(findAdjacentTopLevelBlock(state.doc, topLevelPosition(state, 2), "down")).toBeNull()
  })

  it("复制块并选中新副本", () => {
    const state = createState(paragraph("one"), paragraph("two"))
    const transaction = duplicateTopLevelBlock(state, state.doc.child(0).nodeSize)

    expect(topLevelText(state.apply(requireTransaction(transaction)))).toEqual(["one", "two", "two"])
    expect(transaction?.selection).toBeInstanceOf(NodeSelection)
  })

  it("正向或反向端点都定位为同一段连续顶层范围", () => {
    const state = createState(paragraph("one"), paragraph("two"), paragraph("three"), paragraph("four"))
    const secondPos = topLevelPosition(state, 1)
    const thirdPos = topLevelPosition(state, 2)

    expect(findTopLevelBlockRange(state.doc, secondPos, thirdPos)).toEqual({
      blockCount: 2,
      from: secondPos,
      fromIndex: 1,
      to: topLevelPosition(state, 3),
      toIndex: 2,
    })
    expect(findTopLevelBlockRange(state.doc, thirdPos, secondPos)).toEqual(
      findTopLevelBlockRange(state.doc, secondPos, thirdPos),
    )
  })

  it("复制连续范围且保持原有块顺序", () => {
    const state = createState(paragraph("one"), paragraph("two"), paragraph("three"), paragraph("four"))
    const transaction = duplicateTopLevelBlockRange(
      state,
      topLevelPosition(state, 1),
      topLevelPosition(state, 2),
    )

    expect(topLevelText(state.apply(requireTransaction(transaction)))).toEqual([
      "one",
      "two",
      "three",
      "two",
      "three",
      "four",
    ])
  })

  it("上下移动块且保持一次 transaction", () => {
    const state = createState(paragraph("one"), paragraph("two"), paragraph("three"))
    const secondPos = state.doc.child(0).nodeSize
    const movedUp = moveTopLevelBlock(state, secondPos, "up")
    const movedDown = moveTopLevelBlock(state, secondPos, "down")

    expect(topLevelText(state.apply(requireTransaction(movedUp)))).toEqual(["two", "one", "three"])
    expect(topLevelText(state.apply(requireTransaction(movedDown)))).toEqual(["one", "three", "two"])
  })

  it("把连续范围作为整体上下移动", () => {
    const state = createState(paragraph("one"), paragraph("two"), paragraph("three"), paragraph("four"))
    const secondPos = topLevelPosition(state, 1)
    const thirdPos = topLevelPosition(state, 2)
    const movedUp = moveTopLevelBlockRange(state, secondPos, thirdPos, "up")
    const movedDown = moveTopLevelBlockRange(state, secondPos, thirdPos, "down")

    expect(topLevelText(state.apply(requireTransaction(movedUp)))).toEqual(["two", "three", "one", "four"])
    expect(topLevelText(state.apply(requireTransaction(movedDown)))).toEqual(["one", "four", "two", "three"])
  })

  it("拒绝把连续范围拖进自身或嵌套内容边界", () => {
    const state = createState(paragraph("one"), paragraph("two"), paragraph("three"))
    const secondPos = topLevelPosition(state, 1)
    const thirdPos = topLevelPosition(state, 2)

    expect(moveTopLevelBlockRangeTo(state, secondPos, thirdPos, thirdPos)).toBeNull()
    expect(moveTopLevelBlockRangeTo(state, secondPos, thirdPos, 1)).toBeNull()
  })

  it("删除唯一块时留下可编辑空段落", () => {
    const state = createState(paragraph("only"))
    const transaction = deleteTopLevelBlock(state, 0)
    const nextState = state.apply(requireTransaction(transaction))

    expect(nextState.doc.childCount).toBe(1)
    expect(nextState.doc.firstChild?.type.name).toBe("paragraph")
    expect(nextState.doc.textContent).toBe("")
  })

  it("删除连续范围，并在删除全部顶层块时留下空段落", () => {
    const state = createState(paragraph("one"), paragraph("two"), paragraph("three"))
    const deletedMiddle = deleteTopLevelBlockRange(
      state,
      topLevelPosition(state, 2),
      topLevelPosition(state, 1),
    )
    const deletedAll = deleteTopLevelBlockRange(state, topLevelPosition(state, 0), topLevelPosition(state, 2))

    expect(topLevelText(state.apply(requireTransaction(deletedMiddle)))).toEqual(["one"])
    expect(topLevelText(state.apply(requireTransaction(deletedAll)))).toEqual([""])
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

  it("在真实 Markdown schema 中整体移动列表与引用范围", () => {
    const parsed = markdownManager.parse("开头\n\n- 第一项\n- 第二项\n\n> 引用\n\n结尾")
    const state = EditorState.create({ doc: editorSchema.nodeFromJSON(parsed) })
    const listPos = state.doc.child(0).nodeSize
    const quotePos = listPos + state.doc.child(1).nodeSize
    const transaction = moveTopLevelBlockRange(state, listPos, quotePos, "down")
    const nextState = state.apply(requireTransaction(transaction))
    const markdown = markdownManager.serialize(nextState.doc.toJSON())

    expect(
      Array.from({ length: nextState.doc.childCount }, (_, index) => nextState.doc.child(index).type.name),
    ).toEqual(["paragraph", "paragraph", "bulletList", "blockquote"])
    expect(markdown.indexOf("结尾")).toBeLessThan(markdown.indexOf("- 第一项"))
    expect(markdown.indexOf("- 第一项")).toBeLessThan(markdown.indexOf("> 引用"))
  })
})
