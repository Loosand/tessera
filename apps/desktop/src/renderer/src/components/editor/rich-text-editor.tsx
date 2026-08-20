/**
 * [INPUT]: Markdown 草稿、文档名称与草稿更新回调
 * [OUTPUT]: TipTap 富文本表面和新的 Markdown 文本
 * [POS]: 编辑器交易与 React 草稿状态之间的同步边界
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { EditorContent, useEditor } from "@tiptap/react"
import { useEffect, useMemo, useRef } from "react"
import { EDITOR_EXTENSIONS } from "./editor-extensions"
import { EditorToolbar } from "./editor-toolbar"
import { joinMarkdownDocument, splitMarkdownDocument } from "./markdown-document"
import { SlashCommandMenu } from "./slash-command-menu"

interface RichTextEditorProps {
  content: string
  documentName: string
  spellCheck: boolean
  onContentChange: (content: string) => void
}

export function RichTextEditor({ content, documentName, spellCheck, onContentChange }: RichTextEditorProps) {
  const documentParts = useMemo(() => splitMarkdownDocument(content), [content])
  const frontmatterRef = useRef(documentParts.frontmatter)
  const lastEmittedContentRef = useRef(content)
  const onContentChangeRef = useRef(onContentChange)

  frontmatterRef.current = documentParts.frontmatter
  onContentChangeRef.current = onContentChange

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: documentParts.body,
    contentType: "markdown",
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        "aria-label": `编辑 ${documentName}`,
        autocapitalize: "sentences",
        class: "rich-text-content",
        spellcheck: String(spellCheck),
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const nextContent = joinMarkdownDocument(frontmatterRef.current, currentEditor.getMarkdown())
      if (nextContent === lastEmittedContentRef.current) return
      lastEmittedContentRef.current = nextContent
      onContentChangeRef.current(nextContent)
    },
  })

  useEffect(() => {
    if (!editor || content === lastEmittedContentRef.current) return
    editor.commands.setContent(documentParts.body, {
      contentType: "markdown",
      emitUpdate: false,
    })
    lastEmittedContentRef.current = content
  }, [content, documentParts.body, editor])

  return (
    <div className="flex min-h-full min-w-0 flex-col pb-5">
      <EditorContent editor={editor} className="min-w-0 flex-1" />
      {editor ? (
        <>
          <SlashCommandMenu editor={editor} />
          <EditorToolbar editor={editor} />
        </>
      ) : null}
    </div>
  )
}
