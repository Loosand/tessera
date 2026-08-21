/**
 * [INPUT]: 编辑器快捷键仲裁、统一扩展 schema 与 ProseMirror 历史交易
 * [OUTPUT]: IME 安全快捷键和中文输入撤销/重做的回归保障
 * [POS]: 文档编辑器键盘与历史语义的无 DOM 交互测试
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { Editor, getSchema } from "@tiptap/core"
import { history, redo, undo } from "@tiptap/pm/history"
import { EditorState } from "@tiptap/pm/state"
import { describe, expect, it } from "vitest"
import { EDITOR_EXTENSIONS } from "./editor-extensions"
import { resolveEditorShortcut } from "./editor-shortcuts"

describe("文档编辑器快捷键", () => {
  it("识别 macOS 与其他平台的保存、模式切换快捷键", () => {
    expect(resolveEditorShortcut({ key: "s", metaKey: true, ctrlKey: false })).toBe("save")
    expect(resolveEditorShortcut({ key: "/", metaKey: false, ctrlKey: true })).toBe("toggle-mode")
  })

  it("IME 组合期间不抢占按键", () => {
    expect(resolveEditorShortcut({ key: "/", metaKey: true, ctrlKey: false, isComposing: true })).toBeNull()
  })

  it("把撤销快捷键交还 TipTap 或源码输入表面", () => {
    expect(resolveEditorShortcut({ key: "z", metaKey: true, ctrlKey: false })).toBeNull()

    const editor = new Editor({
      extensions: EDITOR_EXTENSIONS,
      content: { type: "doc", content: [{ type: "paragraph" }] },
    })
    expect(editor.extensionManager.extensions.some((extension) => extension.name === "undoRedo")).toBe(true)
    editor.destroy()
  })
})

describe("中文输入历史", () => {
  it("把一次提交的中文输入作为单步撤销并可重做", () => {
    const schema = getSchema(EDITOR_EXTENSIONS)
    const initialDocument = schema.node("doc", null, [schema.node("paragraph", null, schema.text("初始"))])
    let state = EditorState.create({ doc: initialDocument, plugins: [history()] })

    state = state.apply(state.tr.insertText("中文", 3))
    expect(state.doc.textContent).toBe("初始中文")

    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction)
      }),
    ).toBe(true)
    expect(state.doc.textContent).toBe("初始")
    expect(
      redo(state, (transaction) => {
        state = state.apply(transaction)
      }),
    ).toBe(true)
    expect(state.doc.textContent).toBe("初始中文")
  })
})
