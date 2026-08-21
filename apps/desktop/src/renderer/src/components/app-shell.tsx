/**
 * [INPUT]: 应用信息和 useWorkspace 提供的会话状态
 * [OUTPUT]: 保活视图、平台标题栏安全区、Motion 侧栏重排、编辑模式保护与文档主区域
 * [POS]: Tessera 桌面端的顶层产品壳层
 * [DOC]: design.md、docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AppInfo } from "@tessera/contracts"
import { AnimatePresence, m, useReducedMotion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { type DefaultEditorMode, useAppPreferences } from "../hooks/use-app-preferences"
import { useWorkspace } from "../hooks/use-workspace"
import { motionSprings } from "../motion"
import { AgentSidebar } from "./agent-sidebar"
import { DocumentEditor } from "./document-editor"
import { DocumentHeader } from "./document-header"
import { shouldGuardRichTextEditor } from "./editor/editor-mode-policy"
import { SettingsPage } from "./settings-page"
import { TaskPage } from "./task-page"
import { WorkspaceSidebar } from "./workspace-sidebar"

interface AppShellProps {
  appInfo: AppInfo | undefined
}

type PrimaryView = "task" | "workspace"
type AppView = PrimaryView | "settings"

export function AppShell({ appInfo }: AppShellProps) {
  const [view, setView] = useState<AppView>("task")
  const [settingsReturnView, setSettingsReturnView] = useState<PrimaryView>("task")
  const { preferences, updatePreference } = useAppPreferences()
  const [editorMode, setEditorMode] = useState(preferences.defaultEditorMode)
  const [agentOpen, setAgentOpen] = useState(false)
  const [compact, setCompact] = useState(() => window.innerWidth < 760)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 760)
  const shouldReduceMotion = useReducedMotion()
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

  const showTask = useCallback(() => {
    flushPendingEdits()
    setAgentOpen(false)
    if (compactRef.current) setSidebarOpen(false)
    setView("task")
  }, [flushPendingEdits])

  const showDocument = useCallback(
    (relativePath: string) => {
      if (compactRef.current) setSidebarOpen(false)
      setView("workspace")
      void openDocument(relativePath)
    },
    [openDocument],
  )

  const createWorkspaceDocument = useCallback(() => {
    if (compactRef.current) setSidebarOpen(false)
    setView("workspace")
    void createDocument()
  }, [createDocument])

  const openSettings = useCallback(() => {
    setSettingsReturnView(view === "task" ? "task" : "workspace")
    setView("settings")
  }, [view])

  return (
    <>
      <div
        className={`${view === "settings" ? "hidden" : "flex"} relative h-screen min-h-0 bg-sidebar text-foreground`}
        data-platform={appInfo?.platform}
      >
        <AnimatePresence initial={false}>
          {sidebarOpen && compact ? (
            <m.button
              key="sidebar-scrim"
              type="button"
              className="absolute inset-0 z-20 bg-black/12"
              initial={shouldReduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16 }}
              aria-label="收起侧边栏"
              onClick={() => setSidebarOpen(false)}
            />
          ) : null}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {sidebarOpen ? (
            <m.div
              key="workspace-sidebar"
              className={compact ? "absolute inset-y-0 left-0 z-30" : "flex shrink-0 overflow-hidden"}
              initial={
                shouldReduceMotion ? false : compact ? { opacity: 0, x: -18 } : { opacity: 0, width: 0 }
              }
              animate={compact ? { opacity: 1, x: 0 } : { opacity: 1, width: 250 }}
              exit={
                shouldReduceMotion
                  ? { opacity: 0 }
                  : compact
                    ? { opacity: 0, x: -18 }
                    : { opacity: 0, width: 0 }
              }
              transition={shouldReduceMotion ? { duration: 0 } : motionSprings.layout}
            >
              <WorkspaceSidebar
                activeView={view === "task" ? "task" : "workspace"}
                workspace={workspace}
                recentWorkspaces={recentWorkspaces}
                documents={documents}
                activePath={activeDocument?.relativePath}
                activeContent={draftContent}
                onCollapse={() => setSidebarOpen(false)}
                onNewTask={showTask}
                onSelectWorkspace={selectWorkspace}
                onOpenRecentWorkspace={(workspaceId) => void openRecentWorkspace(workspaceId)}
                onRevealWorkspace={() => void revealCurrentWorkspace()}
                onRefreshDocuments={() => void refreshDocuments()}
                onCreateDocument={createWorkspaceDocument}
                onOpenDocument={showDocument}
                onSelectOutline={selectOutline}
              />
            </m.div>
          ) : null}
        </AnimatePresence>

        <main
          className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-background ${sidebarOpen && !compact ? "border-l border-sidebar-border" : ""}`}
        >
          <div className={`${view === "workspace" ? "flex" : "hidden"} min-h-0 flex-1 flex-col`}>
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
              onOpenSettings={openSettings}
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
              <AnimatePresence initial={false}>
                {agentOpen ? (
                  <AgentSidebar
                    key="agent-sidebar"
                    document={activeDocument}
                    onClose={() => setAgentOpen(false)}
                  />
                ) : null}
              </AnimatePresence>
            </div>
          </div>

          <div className={`${view === "task" ? "block" : "hidden"} min-h-0 flex-1`}>
            <TaskPage
              hasWorkspace={Boolean(workspace)}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((current) => !current)}
              onOpenSettings={openSettings}
            />
          </div>
        </main>
      </div>

      <div className={view === "settings" ? "block" : "hidden"}>
        <SettingsPage
          appInfo={appInfo}
          workspace={workspace}
          documentCount={documents.length}
          preferences={preferences}
          onBack={() => setView(settingsReturnView)}
          onSelectWorkspace={selectWorkspace}
          onUpdatePreference={updatePreference}
        />
      </div>
    </>
  )
}
