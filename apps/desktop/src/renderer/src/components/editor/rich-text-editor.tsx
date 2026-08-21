/**
 * [INPUT]: Markdown 草稿、文档身份、激活状态与草稿同步注册回调
 * [OUTPUT]: TipTap 富文本表面、延迟 Markdown 草稿和同步 flush 能力
 * [POS]: 编辑器本地交易与 React 草稿状态之间的性能边界
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { EditorContent, useEditor } from "@tiptap/react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createEditorContentSyncController, type EditorContentSyncController } from "./editor-content-sync"
import { EDITOR_EXTENSIONS } from "./editor-extensions"
import { EditorToolbar } from "./editor-toolbar"
import { joinMarkdownDocument, splitMarkdownDocument } from "./markdown-document"
import { SlashCommandMenu } from "./slash-command-menu"

interface RichTextEditorProps {
  active: boolean
  content: string
  documentName: string
  documentPath: string
  spellCheck: boolean
  onContentChange: (documentPath: string, content: string) => void
  onFlushPendingEditsReady: (flush: (() => void) | null) => void
}

export function RichTextEditor({
  active,
  content,
  documentName,
  documentPath,
  spellCheck,
  onContentChange,
  onFlushPendingEditsReady,
}: RichTextEditorProps) {
  const [initialDocumentParts] = useState(() => splitMarkdownDocument(content))
  const appliedContentRef = useRef(content)
  const editorDocumentPathRef = useRef(documentPath)
  const frontmatterRef = useRef(initialDocumentParts.frontmatter)
  const onContentChangeRef = useRef(onContentChange)
  const onFlushPendingEditsReadyRef = useRef(onFlushPendingEditsReady)
  const syncControllerRef = useRef<EditorContentSyncController | null>(null)
  if (!syncControllerRef.current) syncControllerRef.current = createEditorContentSyncController()
  const syncController = syncControllerRef.current

  onContentChangeRef.current = onContentChange
  onFlushPendingEditsReadyRef.current = onFlushPendingEditsReady

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: initialDocumentParts.body,
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
      const scheduledDocumentPath = editorDocumentPathRef.current
      const scheduledFrontmatter = frontmatterRef.current
      const previousContent = appliedContentRef.current
      const emitContentChange = onContentChangeRef.current

      syncController.schedule({
        documentPath: scheduledDocumentPath,
        readContent: () => joinMarkdownDocument(scheduledFrontmatter, currentEditor.getMarkdown()),
        onContentChange: (path, nextContent) => {
          if (nextContent === previousContent) return
          if (editorDocumentPathRef.current === path) appliedContentRef.current = nextContent
          emitContentChange(path, nextContent)
        },
      })
    },
  })

  const flushPendingEdits = useCallback(() => {
    syncController.flush()
  }, [syncController])

  useLayoutEffect(() => {
    onFlushPendingEditsReadyRef.current(flushPendingEdits)
    return () => {
      flushPendingEdits()
      onFlushPendingEditsReadyRef.current(null)
    }
  }, [flushPendingEdits])

  useLayoutEffect(() => {
    if (!editor || !active) return
    if (editorDocumentPathRef.current === documentPath && appliedContentRef.current === content) return

    flushPendingEdits()
    const documentParts = splitMarkdownDocument(content)
    editorDocumentPathRef.current = documentPath
    frontmatterRef.current = documentParts.frontmatter
    appliedContentRef.current = content
    editor.commands.setContent(documentParts.body, {
      contentType: "markdown",
      emitUpdate: false,
    })
  }, [active, content, documentPath, editor, flushPendingEdits])

  useEffect(
    () => () => {
      syncController.cancel()
    },
    [syncController],
  )

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
