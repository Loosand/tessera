/**
 * [INPUT]: Markdown 文档字符数
 * [OUTPUT]: 是否应默认阻止富文本编辑器挂载的性能策略
 * [POS]: 源码模式与富文本模式之间的大文档保护边界
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export const RICH_TEXT_DOCUMENT_CHARACTER_LIMIT = 100_000

export function shouldGuardRichTextEditor(content: string) {
  return content.length >= RICH_TEXT_DOCUMENT_CHARACTER_LIMIT
}
