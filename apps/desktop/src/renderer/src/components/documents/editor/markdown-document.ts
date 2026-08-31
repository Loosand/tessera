/**
 * [INPUT]: 可能包含 YAML frontmatter 的完整 Markdown 文本
 * [OUTPUT]: 可供富文本编辑的正文与可无损带回的 frontmatter
 * [POS]: Markdown 文件格式与 TipTap 文档之间的轻量边界
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export interface MarkdownDocumentParts {
  frontmatter: string | null
  body: string
}

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/

export function splitMarkdownDocument(markdown: string): MarkdownDocumentParts {
  const match = markdown.match(FRONTMATTER_PATTERN)
  if (!match) return { frontmatter: null, body: markdown }

  return {
    frontmatter: match[0].replaceAll("\r\n", "\n"),
    body: markdown.slice(match[0].length).replace(/^(?:\r?\n)+/, ""),
  }
}

export function joinMarkdownDocument(frontmatter: string | null, body: string) {
  if (!frontmatter) return body
  const normalizedBody = body.replace(/^\n+/, "")
  return normalizedBody ? `${frontmatter}\n\n${normalizedBody}` : `${frontmatter}\n`
}
