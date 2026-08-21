/**
 * [INPUT]: 系统剪贴板数据、当前 ProseMirror 状态与统一 MarkdownManager
 * [OUTPUT]: 安全 Markdown 识别、结构化粘贴 transaction 与编辑器 paste 处理器
 * [POS]: 系统剪贴板进入富文本 schema 前的兼容性和结构转换边界
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { MarkdownManager } from "@tiptap/markdown"
import { Fragment, Slice } from "@tiptap/pm/model"
import type { EditorState, Transaction } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { findSourceOnlyMarkdownSyntax } from "./markdown-compatibility"

interface MarkdownClipboardData {
  getData: (format: string) => string
  types: ArrayLike<string>
}

const MARKDOWN_MIME_TYPES = ["text/markdown", "text/x-markdown"] as const

export function shouldPasteTextAsMarkdown(value: string) {
  const markdown = value.trim()
  if (!markdown || findSourceOnlyMarkdownSyntax(markdown).length > 0) return false

  return (
    /\n[ \t]*\n/.test(markdown) ||
    /^(?:[ \t]{0,3}(?:#{1,6}[ \t]+|>|[-+*][ \t]+|\d+[.)][ \t]+|`{3,}|~{3,})|(?: {4}|\t)\S)/m.test(markdown) ||
    /^(?:[ \t]{0,3})(?:[-*_][ \t]*){3,}$/m.test(markdown) ||
    /^(?:.+)\n[ \t]*(?:={3,}|-{3,})[ \t]*$/m.test(markdown) ||
    /^[ \t]*\|?.+\|.+\n[ \t]*\|?[ \t]*:?-{3,}/m.test(markdown) ||
    /(?:\*\*|__|~~)[^\n]+(?:\*\*|__|~~)/.test(markdown) ||
    /`[^`\n]+`/.test(markdown) ||
    /!?\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)/.test(markdown)
  )
}

export function readStructuredMarkdownFromClipboard(data: MarkdownClipboardData): string | null {
  for (const type of MARKDOWN_MIME_TYPES) {
    const explicitMarkdown = data.getData(type)
    if (explicitMarkdown && shouldPasteTextAsMarkdown(explicitMarkdown)) return explicitMarkdown
  }

  const types = Array.from(data.types)
  if (types.includes("text/html")) return null
  const plainText = data.getData("text/plain")
  return shouldPasteTextAsMarkdown(plainText) ? plainText : null
}

export function createStructuredMarkdownPasteTransaction(
  state: EditorState,
  markdownManager: MarkdownManager,
  markdown: string,
): Transaction | null {
  try {
    const parsed = markdownManager.parse(markdown)
    if (!parsed.content || parsed.content.length === 0) return null
    const nodes = parsed.content.map((node) => state.schema.nodeFromJSON(node))
    return state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0)).scrollIntoView()
  } catch {
    return null
  }
}

export function handleStructuredMarkdownPaste(
  view: EditorView,
  event: ClipboardEvent,
  markdownManager: MarkdownManager,
) {
  if (!event.clipboardData) return false
  const markdown = readStructuredMarkdownFromClipboard(event.clipboardData)
  if (!markdown) return false
  const transaction = createStructuredMarkdownPasteTransaction(view.state, markdownManager, markdown)
  if (!transaction) return false

  event.preventDefault()
  view.dispatch(transaction)
  return true
}
