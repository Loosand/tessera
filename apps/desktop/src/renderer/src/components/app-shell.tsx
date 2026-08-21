/**
 * [INPUT]: 应用信息和 useWorkspace 提供的会话状态
 * [OUTPUT]: 保活的工作区、设置视图、编辑模式保护与文档主区域
 * [POS]: Tessera 桌面端的顶层产品壳层
 * [DOC]: design.md、docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AppInfo } from "@tessera/contracts"
import { useCallback, useEffect, useRef, useState } from "react"
import { type DefaultEditorMode, useAppPreferences } from "../hooks/use-app-preferences"
import { useWorkspace } from "../hooks/use-workspace"
import { AgentSidebar } from "./agent-sidebar"
import { DocumentEditor } from "./document-editor"
import { shouldGuardRichTextEditor } from "./editor/editor-mode-policy"
import { DocumentHeader } from "./document-header"
import { SettingsPage } from "./settings-page"
import { WorkspaceSidebar } from "./workspace-sidebar"

interface AppShellProps {
  appInfo: AppInfo | undefined
}

export function AppShell({ appInfo }: AppShellProps) {
  const [view, setView] = useState<"workspace" | "settings">("workspace")
  const { preferences, updatePreference } = useAppPreferences()
  const [editorMode, setEditorMode] = useState(preferences.defaultEditorMode)
  const [agentOpen, setAgentOpen] = useState(false)
  const [compact, setCompact] = useState(() => window.innerWidth < 760)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 760)
  const compactRef = useRef(compact)
  const {
    workspace,
    recentWorkspaces,
    documents,
    activeDocument,
    draftContent,
    status,
    saveStatus,
    hasExternalConflict,
    canGoBack,
    canGoForward,
    error,
    selectWorkspace,
    openRecentWorkspace,
    revealCurrentWorkspace,
    refreshDocuments,
    openDocument,
    goBack,
    goForward,
    createDocument,
    renameActiveDocument,
    updateDraft,
    flushPendingEdits,
    registerPendingEditsFlusher,
    saveDocument,
    reloadDocument,
  } = useWorkspace()

  const activeDocumentIdentity = activeDocument
    ? `${workspace?.id ?? "workspace"}:${activeDocument.relativePath}`
    : null
  const [largeDocumentRichOverride, setLargeDocumentRichOverride] = useState<string | null>(null)
  const isLargeDocumentGuarded = Boolean(
    activeDocumentIdentity &&
      activeDocument &&
      shouldGuardRichTextEditor(activeDocument.content) &&
      largeDocumentRichOverride !== activeDocumentIdentity,
  )
  const effectiveEditorMode = isLargeDocumentGuarded ? "source" : editorMode

  useEffect(() => {
    flushPendingEdits()
    setEditorMode(preferences.defaultEditorMode)
  }, [flushPendingEdits, preferences.defaultEditorMode])

  useEffect(() => {
    const syncCompactLayout = () => {
      const nextCompact = window.innerWidth < 760
      if (nextCompact === compactRef.current) return
      compactRef.current = nextCompact
      setCompact(nextCompact)
      setSidebarOpen(!nextCompact)
      if (nextCompact) setAgentOpen(false)
    }

    const resizeObserver = new ResizeObserver(syncCompactLayout)
    resizeObserver.observe(window.document.documentElement)
    window.addEventListener("resize", syncCompactLayout)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener("resize", syncCompactLayout)
    }
  }, [])

  const selectOutline = useCallback(
    (index: number, line: number) => {
      if (effectiveEditorMode === "rich") {
        const headings = window.document.querySelectorAll<HTMLElement>(
          ".rich-text-content h1, .rich-text-content h2, .rich-text-content h3, .rich-text-content h4, .rich-text-content h5, .rich-text-content h6",
        )
        headings[index]?.scrollIntoView({ behavior: "smooth", block: "center" })
        return
      }

      const sourceEditor = window.document.querySelector<HTMLTextAreaElement>("[data-source-editor]")
      if (!sourceEditor) return
      const position = sourceEditor.value
        .split(/\r?\n/)
        .slice(0, Math.max(0, line - 1))
        .reduce((length, currentLine) => length + currentLine.length + 1, 0)
      sourceEditor.focus()
      sourceEditor.setSelectionRange(position, position)
      sourceEditor.scrollTop = Math.max(0, (line - 4) * 24)
    },
    [effectiveEditorMode],
  )

  const changeEditorMode = useCallback(
    (nextMode: DefaultEditorMode) => {
      flushPendingEdits()
      setEditorMode(nextMode)
    },
    [flushPendingEdits],
  )

  return (
    <>
      <div
        className={`${view === "settings" ? "hidden" : "flex"} relative h-screen min-h-0 bg-sidebar text-foreground`}
      >
        {sidebarOpen && compact ? (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-black/12"
            aria-label="收起侧边栏"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        {sidebarOpen ? (
          <div className={compact ? "absolute inset-y-0 left-0 z-30" : "flex shrink-0"}>
            <WorkspaceSidebar
              workspace={workspace}
              recentWorkspaces={recentWorkspaces}
              documents={documents}
              activePath={activeDocument?.relativePath}
              activeContent={draftContent}
              version={appInfo?.version}
              onCollapse={() => setSidebarOpen(false)}
              onSelectWorkspace={selectWorkspace}
              onOpenRecentWorkspace={(workspaceId) => void openRecentWorkspace(workspaceId)}
              onRevealWorkspace={() => void revealCurrentWorkspace()}
              onRefreshDocuments={() => void refreshDocuments()}
              onCreateDocument={createDocument}
              onOpenDocument={openDocument}
              onSelectOutline={selectOutline}
            />
          </div>
        ) : null}

        <main
          className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-background ${sidebarOpen && !compact ? "border-l border-sidebar-border" : ""}`}
        >
          <DocumentHeader
            workspace={workspace}
            document={activeDocument}
            saveStatus={saveStatus}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            mode={effectiveEditorMode}
            agentOpen={agentOpen}
            sidebarOpen={sidebarOpen}
            onGoBack={() => void goBack()}
            onGoForward={() => void goForward()}
            onModeChange={changeEditorMode}
            onToggleAgent={() => setAgentOpen((current) => !current)}
            onToggleSidebar={() => setSidebarOpen((current) => !current)}
            onOpenSettings={() => setView("settings")}
            onRenameDocument={renameActiveDocument}
          />

          {error ? (
            <div className="border-b border-destructive/20 bg-destructive/8 px-4 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <div className="relative flex min-h-0 flex-1">
            <DocumentEditor
              document={activeDocument}
              content={draftContent}
              hasWorkspace={Boolean(workspace)}
              isLoading={status === "loading"}
              hasExternalConflict={hasExternalConflict}
              isLargeDocumentGuarded={isLargeDocumentGuarded}
              mode={effectiveEditorMode}
              spellCheck={preferences.spellCheck}
              onSelectWorkspace={selectWorkspace}
              onAllowLargeDocumentRich={() => {
                if (activeDocumentIdentity) setLargeDocumentRichOverride(activeDocumentIdentity)
                setEditorMode("rich")
              }}
              onContentChange={updateDraft}
              onFlushPendingEditsReady={registerPendingEditsFlusher}
              onModeChange={changeEditorMode}
              onSave={saveDocument}
              onReload={reloadDocument}
            />
            {agentOpen ? (
              <AgentSidebar document={activeDocument} onClose={() => setAgentOpen(false)} />
            ) : null}
          </div>
        </main>
      </div>

      <div className={view === "settings" ? "block" : "hidden"}>
        <SettingsPage
          appInfo={appInfo}
          workspace={workspace}
          documentCount={documents.length}
          preferences={preferences}
          onBack={() => setView("workspace")}
          onSelectWorkspace={selectWorkspace}
          onUpdatePreference={updatePreference}
        />
      </div>
    </>
  )
}
