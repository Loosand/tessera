/**
 * [INPUT]: TipTap 基础扩展、任务列表、Tessera GFM 表格与官方 Markdown 扩展
 * [OUTPUT]: Tessera 富文本编辑器唯一的基础 schema 与同配置 MarkdownManager 工厂
 * [POS]: 所有富文本编辑实例共享的扩展组合入口
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { TableKit } from "@tiptap/extension-table"
import TaskItem from "@tiptap/extension-task-item"
import TaskList from "@tiptap/extension-task-list"
import { Markdown, MarkdownManager } from "@tiptap/markdown"
import StarterKit from "@tiptap/starter-kit"
import { MarkdownTable } from "./markdown-table"

const MARKED_OPTIONS = {
  breaks: false,
  gfm: true,
} as const

export const EDITOR_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: {
      autolink: true,
      defaultProtocol: "https",
      openOnClick: false,
    },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: false }),
  MarkdownTable.configure({
    renderWrapper: true,
    resizable: false,
  }),
  Markdown.configure({
    markedOptions: MARKED_OPTIONS,
  }),
]

export function createEditorMarkdownManager() {
  return new MarkdownManager({
    extensions: EDITOR_EXTENSIONS,
    markedOptions: MARKED_OPTIONS,
  })
}
