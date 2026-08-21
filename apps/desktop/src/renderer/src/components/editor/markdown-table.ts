/**
 * [INPUT]: TipTap 表格 JSON、Markdown 渲染帮助器与单元格对齐属性
 * [OUTPUT]: 可稳定往返包含管道符、行内代码和多段内容的 GFM 表格扩展
 * [POS]: 官方 Table schema 与 Tessera Markdown 保真契约之间的序列化适配层
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { JSONContent, MarkdownRendererHelpers } from "@tiptap/core"
import { Table } from "@tiptap/extension-table"

type TableAlignment = "center" | "left" | "right" | null

interface MarkdownTableCell {
  alignment: TableAlignment
  header: boolean
  text: string
}

function escapeTableCellPipes(value: string) {
  let escaped = ""

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character !== "|") {
      escaped += character
      continue
    }

    let precedingBackslashes = 0
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
      precedingBackslashes += 1
    }
    if (precedingBackslashes % 2 === 0) escaped += "\\"
    escaped += character
  }

  return escaped
}

function normalizeTableCellContent(cell: JSONContent, helpers: MarkdownRendererHelpers) {
  const rendered = (cell.content ?? [])
    .map((child) => helpers.renderChildren(child))
    .join("<br>")
    .replace(/[ \t]*\r?\n[ \t]*/g, "<br>")
    .replace(/\s+/g, " ")
    .trim()

  return escapeTableCellPipes(rendered)
}

function readAlignment(cell: JSONContent): TableAlignment {
  const alignment = cell.attrs?.align
  return alignment === "center" || alignment === "left" || alignment === "right" ? alignment : null
}

function renderAlignment(width: number, alignment: TableAlignment) {
  const dashes = "-".repeat(Math.max(3, width))
  if (alignment === "left") return `:${dashes}`
  if (alignment === "right") return `${dashes}:`
  if (alignment === "center") return `:${dashes}:`
  return dashes
}

function renderMarkdownTable(node: JSONContent, helpers: MarkdownRendererHelpers) {
  const rows: MarkdownTableCell[][] = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => ({
      alignment: readAlignment(cell),
      header: cell.type === "tableHeader",
      text: normalizeTableCellContent(cell, helpers),
    })),
  )
  const columnCount = rows.reduce((largest, row) => Math.max(largest, row.length), 0)
  if (columnCount === 0) return ""

  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(3, ...rows.map((row) => row[columnIndex]?.text.length ?? 0)),
  )
  const alignments = Array.from<TableAlignment>({ length: columnCount }).fill(null)
  for (const row of rows) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      alignments[columnIndex] ??= row[columnIndex]?.alignment ?? null
    }
  }

  const headerRow = rows[0] ?? []
  const hasHeader = headerRow.some((cell) => cell.header)
  const pad = (value: string, columnIndex: number) => value.padEnd(columnWidths[columnIndex] ?? 3, " ")
  const renderRow = (row: MarkdownTableCell[]) =>
    `| ${Array.from({ length: columnCount }, (_, index) => pad(row[index]?.text ?? "", index)).join(" | ")} |\n`

  let markdown = "\n"
  markdown += renderRow(hasHeader ? headerRow : [])
  markdown += `| ${columnWidths.map((width, index) => renderAlignment(width, alignments[index] ?? null)).join(" | ")} |\n`
  for (const row of hasHeader ? rows.slice(1) : rows) markdown += renderRow(row)
  return markdown
}

export const MarkdownTable = Table.extend({
  renderMarkdown: (node, helpers) => renderMarkdownTable(node, helpers),
})
