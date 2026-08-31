/**
 * [INPUT]: 包含 frontmatter、代码围栏与扩展语法的 Markdown 原文
 * [OUTPUT]: 当前富文本 schema 无法保真往返、应留在源码模式的语法清单
 * [POS]: Markdown 兼容性语料与编辑器模式保护之间的静态分析边界
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { splitMarkdownDocument } from "./markdown-document"

export type SourceOnlyMarkdownSyntax = "definition-link" | "footnote" | "raw-html"

function maskRange(value: string, start: number, end: number) {
  return `${value.slice(0, start)}${" ".repeat(end - start)}${value.slice(end)}`
}

function maskInlineCode(line: string) {
  let masked = line
  let cursor = 0

  while (cursor < line.length) {
    if (line[cursor] !== "`") {
      cursor += 1
      continue
    }

    let delimiterLength = 1
    while (line[cursor + delimiterLength] === "`") delimiterLength += 1
    const delimiter = "`".repeat(delimiterLength)
    const closingIndex = line.indexOf(delimiter, cursor + delimiterLength)
    if (closingIndex < 0) {
      cursor += delimiterLength
      continue
    }

    const end = closingIndex + delimiterLength
    masked = maskRange(masked, cursor, end)
    cursor = end
  }

  return masked
}

function maskMarkdownCode(markdown: string) {
  const maskedLines: string[] = []
  let fence: { character: "`" | "~"; length: number } | null = null

  for (const line of markdown.split("\n")) {
    if (fence) {
      const closingPattern = new RegExp(`^[ \\t]{0,3}${fence.character}{${fence.length},}[ \\t]*$`)
      if (closingPattern.test(line)) fence = null
      maskedLines.push(" ".repeat(line.length))
      continue
    }

    const opening = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
    if (opening?.[1]) {
      const character = opening[1][0]
      if (character === "`" || character === "~") {
        fence = { character, length: opening[1].length }
        maskedLines.push(" ".repeat(line.length))
        continue
      }
    }

    if (/^(?: {4}|\t)/.test(line)) {
      maskedLines.push(" ".repeat(line.length))
      continue
    }

    maskedLines.push(maskInlineCode(line))
  }

  return maskedLines.join("\n")
}

export function findSourceOnlyMarkdownSyntax(markdown: string): SourceOnlyMarkdownSyntax[] {
  const { body } = splitMarkdownDocument(markdown)
  const scannable = maskMarkdownCode(body)
  const syntax = new Set<SourceOnlyMarkdownSyntax>()

  if (/(^|[^\\])\[\^[^\]\n]+\]/m.test(scannable)) syntax.add("footnote")
  if (/^[ \t]{0,3}\[(?!\^)[^\]\n]+\]:[ \t]+\S+/m.test(scannable)) syntax.add("definition-link")
  if (
    /(^|[^\\])(?:<!--[\s\S]*?-->|<![A-Za-z][^>]*>|<\?[\s\S]*?\?>|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*?)?\s*\/?>)/m.test(
      scannable,
    )
  ) {
    syntax.add("raw-html")
  }

  return Array.from(syntax)
}
