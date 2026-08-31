/**
 * [INPUT]: 结构化 Markdown 粘贴协议、统一编辑器 schema 与剪贴板语料
 * [OUTPUT]: 安全识别、富内容优先和块级 transaction 的回归测试
 * [POS]: Markdown 剪贴板输入端的无 DOM 自动化保障
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { getSchema } from "@tiptap/core"
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state"
import { describe, expect, it } from "vitest"
import { EDITOR_EXTENSIONS, createEditorMarkdownManager } from "./editor-extensions"
import {
  createStructuredMarkdownPasteTransaction,
  readStructuredMarkdownFromClipboard,
  shouldPasteTextAsMarkdown,
} from "./markdown-paste"

const schema = getSchema(EDITOR_EXTENSIONS)
const markdownManager = createEditorMarkdownManager()

function clipboardData(data: Record<string, string>) {
  return {
    getData: (format: string) => data[format] ?? "",
    types: Object.keys(data),
  }
}

function requireTransaction(transaction: Transaction | null) {
  expect(transaction).not.toBeNull()
  if (!transaction) throw new Error("预期生成 Markdown 粘贴 transaction")
  return transaction
}

describe("markdown-paste", () => {
  it.each([
    ["标题", "## 标题"],
    ["列表", "- 第一项\n- 第二项"],
    ["引用", "> 引用"],
    ["代码围栏", "```ts\nconst value = 1\n```"],
    ["表格", "| 名称 | 状态 |\n| --- | --- |\n| Tessera | 好 |"],
    ["多个段落", "第一段\n\n第二段"],
    ["行内格式", "包含 **粗体** 与 [链接](https://example.com)"],
  ])("识别%s Markdown", (_name, markdown) => {
    expect(shouldPasteTextAsMarkdown(markdown)).toBe(true)
  })

  it.each([
    ["普通文本", "只是一段普通文字"],
    ["原始 HTML", "<details>内容</details>"],
    ["脚注", "正文[^1]\n\n[^1]: 注释"],
    ["定义式链接", "[站点][site]\n\n[site]: https://example.com"],
  ])("不接管%s", (_name, markdown) => {
    expect(shouldPasteTextAsMarkdown(markdown)).toBe(false)
  })

  it("网页富内容优先走原生粘贴，显式 Markdown MIME 优先解析", () => {
    expect(
      readStructuredMarkdownFromClipboard(
        clipboardData({ "text/html": "<strong>标题</strong>", "text/plain": "**标题**" }),
      ),
    ).toBeNull()
    expect(
      readStructuredMarkdownFromClipboard(
        clipboardData({
          "text/html": "<strong>标题</strong>",
          "text/markdown": "## 标题",
          "text/plain": "标题",
        }),
      ),
    ).toBe("## 标题")
  })

  it("在段落光标处插入标题和列表块，并保留两侧正文", () => {
    const initialDoc = schema.nodeFromJSON(markdownManager.parse("前后"))
    const state = EditorState.create({
      doc: initialDoc,
      selection: TextSelection.create(initialDoc, 2),
    })
    const transaction = createStructuredMarkdownPasteTransaction(
      state,
      markdownManager,
      "## 标题\n\n- 第一项\n- 第二项",
    )
    const nextState = state.apply(requireTransaction(transaction))

    expect(
      Array.from({ length: nextState.doc.childCount }, (_, index) => ({
        text: nextState.doc.child(index).textContent,
        type: nextState.doc.child(index).type.name,
      })),
    ).toEqual([
      { text: "前", type: "paragraph" },
      { text: "标题", type: "heading" },
      { text: "第一项第二项", type: "bulletList" },
      { text: "后", type: "paragraph" },
    ])
  })
})
