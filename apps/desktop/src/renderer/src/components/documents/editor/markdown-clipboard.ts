/**
 * [INPUT]: TipTap MarkdownManager、ProseMirror 文档、顶层范围端点与剪贴板写入函数
 * [OUTPUT]: 连续顶层区块的 Markdown 序列化结果与可测试的剪贴板写入状态
 * [POS]: 区块交互和系统剪贴板之间的 Markdown 保真适配层
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { JSONContent } from "@tiptap/core"
import type { MarkdownManager } from "@tiptap/markdown"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { findTopLevelBlockRange } from "./top-level-block-operations"

export type MarkdownClipboardWriteResult = "copied" | "failed" | "invalid-range"

export interface MarkdownClipboardShortcutEvent {
  altKey?: boolean
  ctrlKey?: boolean
  isComposing?: boolean
  key: string
  metaKey?: boolean
  shiftKey?: boolean
}

export function resolveMarkdownClipboardShortcut(
  event: MarkdownClipboardShortcutEvent,
): "copy" | "cut" | null {
  if (event.isComposing || event.altKey || event.shiftKey || (!event.metaKey && !event.ctrlKey)) return null

  const key = event.key.toLocaleLowerCase()
  if (key === "c") return "copy"
  if (key === "x") return "cut"
  return null
}

export function serializeTopLevelBlockRangeToMarkdown(
  markdownManager: MarkdownManager,
  doc: ProseMirrorNode,
  anchorPosition: number,
  headPosition: number,
): string | null {
  const range = findTopLevelBlockRange(doc, anchorPosition, headPosition)
  if (!range) return null

  const content: JSONContent[] = []
  for (let index = range.fromIndex; index <= range.toIndex; index += 1) {
    content.push(doc.child(index).toJSON())
  }
  return markdownManager.serialize({ type: doc.type.name, content })
}

export async function writeTopLevelBlockRangeToClipboard(
  markdownManager: MarkdownManager,
  doc: ProseMirrorNode,
  anchorPosition: number,
  headPosition: number,
  writeText: (markdown: string) => Promise<void>,
): Promise<MarkdownClipboardWriteResult> {
  const markdown = serializeTopLevelBlockRangeToMarkdown(markdownManager, doc, anchorPosition, headPosition)
  if (markdown === null) return "invalid-range"

  try {
    await writeText(markdown)
    return "copied"
  } catch {
    return "failed"
  }
}
