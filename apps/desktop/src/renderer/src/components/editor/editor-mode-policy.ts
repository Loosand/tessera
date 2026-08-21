/**
 * [INPUT]: Markdown 文档字符数、近似结构密度与富文本保真能力
 * [OUTPUT]: 是否应默认阻止富文本编辑器挂载及对应原因
 * [POS]: 源码模式与富文本模式之间的性能和内容保护边界
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type SourceOnlyMarkdownSyntax, findSourceOnlyMarkdownSyntax } from "./markdown-compatibility"
import { splitMarkdownDocument } from "./markdown-document"

export const RICH_TEXT_DOCUMENT_CHARACTER_LIMIT = 100_000
export const RICH_TEXT_DOCUMENT_BLOCK_LIMIT = 750

export type RichTextEditorGuard =
  | { kind: "large-document" }
  | { estimatedBlocks: number; kind: "many-blocks" }
  | { kind: "source-only-markdown"; syntax: SourceOnlyMarkdownSyntax[] }

const STRUCTURAL_BLOCK_PATTERN =
  /^[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|>|`{3,}|~{3,}|(?:[-+*]|\d{1,9}[.)])[ \t]+|(?:[-*_][ \t]*){3,}$|\|)/

function isDenseTableRow(line: string) {
  const firstPipe = line.indexOf("|")
  return firstPipe >= 0 && line.indexOf("|", firstPipe + 1) >= 0
}

export function estimateMarkdownBlockCount(markdown: string, stopAt = Number.POSITIVE_INFINITY) {
  let blockCount = 0
  let previousLineBlank = true
  let fence: { character: "`" | "~"; length: number } | null = null

  for (const line of markdown.split(/\r?\n/)) {
    if (fence) {
      const closingPattern = new RegExp(`^[ \\t]{0,3}${fence.character}{${fence.length},}[ \\t]*$`)
      if (closingPattern.test(line)) {
        fence = null
        previousLineBlank = true
      }
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      previousLineBlank = true
      continue
    }

    const openingFence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
    const beginsStructuralBlock = STRUCTURAL_BLOCK_PATTERN.test(line) || isDenseTableRow(line)
    if (previousLineBlank || beginsStructuralBlock) blockCount += 1
    if (blockCount >= stopAt) return blockCount

    if (openingFence?.[1]) {
      fence = {
        character: openingFence[1][0] as "`" | "~",
        length: openingFence[1].length,
      }
    }
    previousLineBlank = false
  }

  return blockCount
}

export function getRichTextEditorGuard(content: string): RichTextEditorGuard | null {
  const { body } = splitMarkdownDocument(content)
  if (body.length >= RICH_TEXT_DOCUMENT_CHARACTER_LIMIT) return { kind: "large-document" }

  const estimatedBlocks = estimateMarkdownBlockCount(body, RICH_TEXT_DOCUMENT_BLOCK_LIMIT)
  if (estimatedBlocks >= RICH_TEXT_DOCUMENT_BLOCK_LIMIT) {
    return { estimatedBlocks, kind: "many-blocks" }
  }

  const syntax = findSourceOnlyMarkdownSyntax(content)
  return syntax.length > 0 ? { kind: "source-only-markdown", syntax } : null
}

export function shouldGuardRichTextEditor(content: string) {
  return getRichTextEditorGuard(content) !== null
}
