/**
 * [INPUT]: 当前 Markdown 文档、草稿内容、模式保护与编辑器同步操作
 * [OUTPUT]: 保活的即时预览/源码编辑器、大文档保护以及冲突提示
 * [POS]: 工作区主区域的文档编辑编排层
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DocumentSnapshot } from "@tessera/contracts"
import { Button } from "@tessera/design-system/components/ui/button"
import { useEffect, useState } from "react"
import type { DefaultEditorMode } from "../hooks/use-app-preferences"
import { RichTextEditor } from "./editor/rich-text-editor"

interface DocumentEditorProps {
  document: DocumentSnapshot | null
  content: string
  hasWorkspace: boolean
  isLoading: boolean
  hasExternalConflict: boolean
  isLargeDocumentGuarded: boolean
  mode: DefaultEditorMode
  spellCheck: boolean
  onSelectWorkspace: () => void
  onAllowLargeDocumentRich: () => void
  onContentChange: (documentPath: string, content: string) => void
  onFlushPendingEditsReady: (flush: (() => void) | null) => void
  onModeChange: (mode: DefaultEditorMode) => void
  onSave: () => Promise<boolean>
  onReload: () => void | Promise<void>
}

export function DocumentEditor({
  document,
  content,
  hasWorkspace,
  isLoading,
  hasExternalConflict,
  isLargeDocumentGuarded,
  mode,
  spellCheck,
  onSelectWorkspace,
  onAllowLargeDocumentRich,
  onContentChange,
  onFlushPendingEditsReady,
  onModeChange,
  onSave,
  onReload,
}: DocumentEditorProps) {
  const [richMountedDocumentPath, setRichMountedDocumentPath] = useState<string | null>(null)
  const documentPath = document?.relativePath

  useEffect(() => {
    if (mode === "rich" && documentPath && !isLargeDocumentGuarded) {
      setRichMountedDocumentPath(documentPath)
    }
  }, [documentPath, isLargeDocumentGuarded, mode])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void onSave()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault()
        onModeChange(mode === "rich" ? "source" : "rich")
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [mode, onModeChange, onSave])

  if (isLoading && !document) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        正在读取工作区…
      </div>
    )
  }

  if (!hasWorkspace) {
    return (
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="max-w-sm text-center">
          <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            本地优先阅读空间
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">从你的文档开始</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            打开一个包含 Markdown 的本地文件夹，Tessera 会直接读取它，不需要导入或迁移。
          </p>
          <Button className="mt-5" onClick={onSelectWorkspace}>
            打开工作区
          </Button>
        </div>
      </div>
    )
  }

  if (!document) {
    return (
      <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-muted-foreground">
        新建一个文档，或从侧栏选择已有文档。
      </div>
    )
  }

  const shouldRenderRichEditor =
    !isLargeDocumentGuarded && (mode === "rich" || richMountedDocumentPath === document.relativePath)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {hasExternalConflict ? (
        <div className="flex items-center justify-between gap-4 border-b border-amber-500/20 bg-amber-500/8 px-4 py-2 text-xs text-amber-800">
          <span>磁盘上的文档已发生变化。为避免覆盖外部修改，自动保存已暂停。</span>
          <Button variant="outline" size="xs" className="h-6 shrink-0 px-2 text-[11px]" onClick={onReload}>
            重新载入磁盘版本
          </Button>
        </div>
      ) : null}

      {isLargeDocumentGuarded ? (
        <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/45 px-4 py-2 text-xs text-muted-foreground">
          <span>文档较大，已使用 Markdown 源码模式以保持输入流畅。</span>
          <Button
            variant="outline"
            size="xs"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={onAllowLargeDocumentRich}
          >
            仍使用即时预览
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background">
        <textarea
          data-source-editor
          className={`${mode === "source" ? "block" : "hidden"} mx-auto min-h-full w-full max-w-205 resize-none border-0 bg-transparent px-[clamp(24px,6vw,64px)] pt-12 pb-[40vh] font-mono text-[13px] leading-6 text-foreground outline-none`}
          aria-label={`编辑 ${document.name} 源码`}
          value={content}
          onChange={(event) => onContentChange(document.relativePath, event.currentTarget.value)}
          spellCheck={spellCheck}
        />
        {shouldRenderRichEditor ? (
          <div className={mode === "rich" ? "min-h-full" : "hidden"}>
            <RichTextEditor
              active={mode === "rich"}
              content={content}
              documentName={document.name}
              documentPath={document.relativePath}
              spellCheck={spellCheck}
              onContentChange={onContentChange}
              onFlushPendingEditsReady={onFlushPendingEditsReady}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
