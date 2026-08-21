/**
 * [INPUT]: 当前 Markdown 文档、草稿内容、性能/兼容性保护与编辑器同步操作
 * [OUTPUT]: 保活的即时预览/源码编辑器、源码优先保护以及冲突提示
 * [POS]: 工作区主区域的文档编辑编排层
 * [DOC]: design.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DocumentSnapshot } from "@tessera/contracts"
import { Button } from "@tessera/design-system/components/ui/button"
import { Suspense, lazy, useEffect, useState } from "react"
import type { DefaultEditorMode } from "../hooks/use-app-preferences"
import type { RichTextEditorGuard } from "./editor/editor-mode-policy"
import { resolveEditorShortcut } from "./editor/editor-shortcuts"
import { RichTextEditor } from "./editor/rich-text-editor"

const SourceCodeEditor = lazy(() =>
  import("./editor/source-code-editor").then((module) => ({ default: module.SourceCodeEditor })),
)

type DocumentEditorProps = Readonly<{
  document: DocumentSnapshot | null
  content: string
  hasWorkspace: boolean
  isLoading: boolean
  hasExternalConflict: boolean
  richEditorGuard: RichTextEditorGuard | null
  mode: DefaultEditorMode
  spellCheck: boolean
  onSelectWorkspace: () => void
  onAllowGuardedRich: () => void
  onContentChange: (documentPath: string, content: string) => void
  onFlushPendingEditsReady: (flush: (() => void) | null) => void
  onModeChange: (mode: DefaultEditorMode) => void
  onSave: () => Promise<boolean>
  onReload: () => void | Promise<void>
}>

export function DocumentEditor({
  document,
  content,
  hasWorkspace,
  isLoading,
  hasExternalConflict,
  richEditorGuard,
  mode,
  spellCheck,
  onSelectWorkspace,
  onAllowGuardedRich,
  onContentChange,
  onFlushPendingEditsReady,
  onModeChange,
  onSave,
  onReload,
}: DocumentEditorProps) {
  const [richMountedDocumentPath, setRichMountedDocumentPath] = useState<string | null>(null)
  const [sourceMountedDocumentPath, setSourceMountedDocumentPath] = useState<string | null>(null)
  const documentPath = document?.relativePath

  useEffect(() => {
    if (mode === "rich" && documentPath && !richEditorGuard) {
      setRichMountedDocumentPath(documentPath)
    }
  }, [documentPath, mode, richEditorGuard])

  useEffect(() => {
    if (mode === "source" && documentPath) setSourceMountedDocumentPath(documentPath)
  }, [documentPath, mode])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveEditorShortcut(event)
      if (shortcut === "save") {
        event.preventDefault()
        void onSave()
        return
      }
      if (shortcut === "toggle-mode") {
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
    !richEditorGuard && (mode === "rich" || richMountedDocumentPath === document.relativePath)
  const shouldRenderSourceEditor = mode === "source" || sourceMountedDocumentPath === document.relativePath

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

      {richEditorGuard ? (
        <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/45 px-4 py-2 text-xs text-muted-foreground">
          <span>
            {richEditorGuard.kind === "large-document"
              ? "文档较大，已使用 Markdown 源码模式以保持输入流畅。"
              : richEditorGuard.kind === "many-blocks"
                ? "文档区块较多，已使用 Markdown 源码模式以避免打开时卡顿。"
                : "文档包含即时预览暂时无法保真往返的语法，已使用源码模式保护原文。"}
          </span>
          <Button
            variant="outline"
            size="xs"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={onAllowGuardedRich}
          >
            仍使用即时预览
          </Button>
        </div>
      ) : null}

      <div
        className={`min-h-0 min-w-0 flex-1 bg-background ${mode === "source" ? "overflow-hidden" : "overflow-y-auto"}`}
      >
        {shouldRenderSourceEditor ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                正在载入 Markdown 源码编辑器…
              </div>
            }
          >
            <SourceCodeEditor
              active={mode === "source"}
              content={content}
              documentName={document.name}
              documentPath={document.relativePath}
              spellCheck={spellCheck}
              onContentChange={onContentChange}
              onFlushPendingEditsReady={onFlushPendingEditsReady}
            />
          </Suspense>
        ) : null}
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
