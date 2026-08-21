/**
 * [INPUT]: 应用信息、useWorkspace 文档会话与 useTasks 任务导航状态
 * [OUTPUT]: 首页/任务/工作区保活视图、跨工作区任务恢复、平台标题栏安全区与文档主区域
 * [POS]: Tessera 桌面端的顶层产品壳层
 * [DOC]: design.md、docs/architecture.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AppInfo, TaskSessionSummary } from "@tessera/contracts"
import { AnimatePresence, m, useReducedMotion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { type DefaultEditorMode, useAppPreferences } from "../hooks/use-app-preferences"
import { useTasks } from "../hooks/use-tasks"
import { useWorkspace } from "../hooks/use-workspace"
import { motionSprings } from "../motion"
import { AgentSidebar } from "./agent-sidebar"
import { DocumentEditor } from "./document-editor"
import { DocumentHeader } from "./document-header"
import { getRichTextEditorGuard } from "./editor/editor-mode-policy"
import { HomeSidebar } from "./home-sidebar"
import { SettingsPage } from "./settings-page"
import { TaskPage } from "./task-page"
import { WorkspaceHomePage } from "./workspace-home-page"
import { WorkspaceSidebar } from "./workspace-sidebar"

interface AppShellProps {
  appInfo: AppInfo | undefined
}

type PrimaryView = "home" | "task" | "workspace"
type AppView = PrimaryView | "settings"

export function AppShell({ appInfo }: AppShellProps) {
  const [view, setView] = useState<AppView>("home")
  const [settingsReturnView, setSettingsReturnView] = useState<PrimaryView>("home")
  const [pendingTask, setPendingTask] = useState<{
    taskId: string
    workspaceId: string
  } | null>(null)
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
    directories,
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
    revealWorkspace,
    copyWorkspacePath,
    removeRecentWorkspace,
    refreshDocuments,
    openDocument,
    goBack,
    goForward,
    createDocument,
    createDirectory,
    renameDocument,
    renameActiveDocument,
    renameDirectory,
    deleteWorkspaceEntry,
    revealWorkspaceEntry,
    copyWorkspaceEntryPath,
    updateDraft,
    flushPendingEdits,
    registerPendingEditsFlusher,
    saveDocument,
    reloadDocument,
  } = useWorkspace()
  const {
    activeTask,
    error: taskError,
    tasks,
    recentTasks,
    ensureActiveTask,
    openTask,
    persistActiveTask,
    renameTask,
    deleteTask,
    setActiveTaskMode,
    startNewTask,
  } = useTasks(workspace?.id)

  const activeDocumentIdentity = activeDocument
    ? `${workspace?.id ?? "workspace"}:${activeDocument.relativePath}`
    : null
  const [richEditorGuardOverride, setRichEditorGuardOverride] = useState<string | null>(null)
  const detectedRichEditorGuard = activeDocument ? getRichTextEditorGuard(draftContent) : null
  const richEditorGuard =
    activeDocumentIdentity && richEditorGuardOverride !== activeDocumentIdentity
      ? detectedRichEditorGuard
      : null
  const effectiveEditorMode = richEditorGuard ? "source" : editorMode

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

  useEffect(() => {
    if (!pendingTask || workspace?.id !== pendingTask.workspaceId) return
    const taskId = pendingTask.taskId
    setPendingTask(null)
    void openTask(taskId).then((opened) => {
      if (opened) setView("task")
    })
  }, [openTask, pendingTask, workspace?.id])

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

  const createStandaloneTask = useCallback(() => {
    flushPendingEdits()
    setAgentOpen(false)
    startNewTask("chat", null)
    if (compactRef.current) setSidebarOpen(false)
    setView("task")
  }, [flushPendingEdits, startNewTask])

  const createWorkspaceTask = useCallback(() => {
    flushPendingEdits()
    setAgentOpen(false)
    startNewTask("chat", workspace?.id ?? null)
    if (compactRef.current) setSidebarOpen(false)
    setView("task")
  }, [flushPendingEdits, startNewTask, workspace?.id])

  const openWorkspace = useCallback(
    async (workspaceId: string) => {
      flushPendingEdits()
      const nextWorkspace = workspace?.id === workspaceId ? workspace : await openRecentWorkspace(workspaceId)
      if (!nextWorkspace) return
      startNewTask("chat", nextWorkspace.id)
      setAgentOpen(false)
      if (compactRef.current) setSidebarOpen(false)
      setView("task")
    },
    [flushPendingEdits, openRecentWorkspace, startNewTask, workspace],
  )

  const chooseWorkspace = useCallback(async () => {
    const nextWorkspace = await selectWorkspace()
    if (!nextWorkspace) return
    startNewTask("chat", nextWorkspace.id)
    setView("task")
  }, [selectWorkspace, startNewTask])

  const openTaskSummary = useCallback(
    async (task: TaskSessionSummary) => {
      flushPendingEdits()
      setAgentOpen(false)
      if (task.workspaceId && task.workspaceId !== workspace?.id) {
        setPendingTask({ taskId: task.id, workspaceId: task.workspaceId })
        const nextWorkspace = await openRecentWorkspace(task.workspaceId)
        if (!nextWorkspace) setPendingTask(null)
        return
      }
      setPendingTask(null)
      const opened = await openTask(task.id)
      if (!opened) return
      if (compactRef.current) setSidebarOpen(false)
      setView("task")
    },
    [flushPendingEdits, openRecentWorkspace, openTask, workspace?.id],
  )

  const openWorkspaceTask = useCallback(
    async (taskId: string) => {
      const opened = await openTask(taskId)
      if (!opened) return
      if (compactRef.current) setSidebarOpen(false)
      setView("task")
    },
    [openTask],
  )

  const showHome = useCallback(() => {
    flushPendingEdits()
    setAgentOpen(false)
    setView("home")
  }, [flushPendingEdits])

  const showDocument = useCallback(
    async (relativePath: string, line?: number) => {
      if (line) {
        flushPendingEdits()
        setEditorMode("source")
      }
      if (compactRef.current) setSidebarOpen(false)
      setView("workspace")
      const opened = await openDocument(relativePath)
      if (!opened || !line) return
      window.setTimeout(() => {
        const sourceEditor = window.document.querySelector<HTMLTextAreaElement>("[data-source-editor]")
        if (!sourceEditor) return
        const position = sourceEditor.value
          .split(/\r?\n/u)
          .slice(0, Math.max(0, line - 1))
          .reduce((length, currentLine) => length + currentLine.length + 1, 0)
        sourceEditor.focus()
        sourceEditor.setSelectionRange(position, position)
        sourceEditor.scrollTop = Math.max(0, (line - 4) * 24)
      })
    },
    [flushPendingEdits, openDocument],
  )

  const createWorkspaceDocument = useCallback(
    (parentRelativePath = "") => {
      if (compactRef.current) setSidebarOpen(false)
      setView("workspace")
      void createDocument(parentRelativePath)
    },
    [createDocument],
  )

  const createWorkspaceDirectory = useCallback(
    (parentRelativePath = "") => {
      void createDirectory(parentRelativePath)
    },
    [createDirectory],
  )

  const openSettings = useCallback(() => {
    if (view !== "settings") setSettingsReturnView(view)
    setView("settings")
  }, [view])

  const standaloneTask = view === "task" && activeTask.workspaceId === null
  const showHomeSidebar = view === "home" || !workspace || standaloneTask

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
              {showHomeSidebar ? (
                <HomeSidebar
                  activeItem={standaloneTask ? "new-task" : "workspaces"}
                  recentTasks={recentTasks}
                  workspaces={recentWorkspaces}
                  onCollapse={() => setSidebarOpen(false)}
                  onNewTask={createStandaloneTask}
                  onOpenSettings={openSettings}
                  onOpenTask={(task) => void openTaskSummary(task)}
                  onOpenWorkspace={(workspaceId) => void openWorkspace(workspaceId)}
                  onRenameTask={renameTask}
                  onDeleteTask={deleteTask}
                  onRevealWorkspace={(workspaceId) => void revealWorkspace(workspaceId)}
                  onCopyWorkspacePath={(workspaceId) => void copyWorkspacePath(workspaceId)}
                  onRemoveWorkspace={(workspaceId) => void removeRecentWorkspace(workspaceId)}
                  onShowWorkspaces={showHome}
                />
              ) : (
                <WorkspaceSidebar
                  activeSection={view === "task" ? "tasks" : "files"}
                  activeTaskId={view === "task" ? activeTask.id : undefined}
                  workspace={workspace}
                  tasks={tasks}
                  recentWorkspaces={recentWorkspaces}
                  documents={documents}
                  directories={directories}
                  activePath={activeDocument?.relativePath}
                  activeContent={draftContent}
                  onCollapse={() => setSidebarOpen(false)}
                  onGoHome={showHome}
                  onNewTask={createWorkspaceTask}
                  onOpenTask={(taskId) => void openWorkspaceTask(taskId)}
                  onRenameTask={renameTask}
                  onDeleteTask={deleteTask}
                  onSectionChange={(section) => setView(section === "tasks" ? "task" : "workspace")}
                  onSelectWorkspace={() => void chooseWorkspace()}
                  onOpenRecentWorkspace={(workspaceId) => void openWorkspace(workspaceId)}
                  onRevealRecentWorkspace={(workspaceId) => void revealWorkspace(workspaceId)}
                  onCopyWorkspacePath={(workspaceId) => void copyWorkspacePath(workspaceId)}
                  onRemoveRecentWorkspace={(workspaceId) => void removeRecentWorkspace(workspaceId)}
                  onRevealWorkspace={() => void revealCurrentWorkspace()}
                  onRefreshDocuments={() => void refreshDocuments()}
                  onCreateDocument={createWorkspaceDocument}
                  onCreateDirectory={createWorkspaceDirectory}
                  onOpenDocument={showDocument}
                  onRenameDocument={(relativePath) => void renameDocument(relativePath)}
                  onRenameDirectory={(relativePath) => void renameDirectory(relativePath)}
                  onDeleteWorkspaceEntry={(relativePath, kind) =>
                    void deleteWorkspaceEntry(relativePath, kind)
                  }
                  onRevealWorkspaceEntry={(relativePath) => void revealWorkspaceEntry(relativePath)}
                  onCopyWorkspaceEntryPath={(relativePath) => void copyWorkspaceEntryPath(relativePath)}
                  onSelectOutline={selectOutline}
                />
              )}
            </m.div>
          ) : null}
        </AnimatePresence>

        <main
          className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-background ${sidebarOpen && !compact ? "border-l border-sidebar-border" : ""}`}
        >
          <div className={`${view === "home" ? "block" : "hidden"} min-h-0 flex-1`}>
            <WorkspaceHomePage
              recentTasks={recentTasks}
              sidebarOpen={sidebarOpen}
              workspaces={recentWorkspaces}
              onOpenTask={(task) => void openTaskSummary(task)}
              onOpenWorkspace={(workspaceId) => void openWorkspace(workspaceId)}
              onRenameTask={renameTask}
              onDeleteTask={deleteTask}
              onRevealWorkspace={(workspaceId) => void revealWorkspace(workspaceId)}
              onCopyWorkspacePath={(workspaceId) => void copyWorkspacePath(workspaceId)}
              onRemoveWorkspace={(workspaceId) => void removeRecentWorkspace(workspaceId)}
              onSelectWorkspace={() => void chooseWorkspace()}
              onToggleSidebar={() => setSidebarOpen((current) => !current)}
            />
          </div>

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
                richEditorGuard={richEditorGuard}
                mode={effectiveEditorMode}
                spellCheck={preferences.spellCheck}
                onSelectWorkspace={selectWorkspace}
                onAllowGuardedRich={() => {
                  if (activeDocumentIdentity) setRichEditorGuardOverride(activeDocumentIdentity)
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
              key={activeTask.id}
              active={view === "task"}
              currentDocumentPath={activeDocument?.relativePath}
              task={activeTask}
              taskError={taskError}
              sidebarOpen={sidebarOpen}
              workspaceName={workspace?.name ?? null}
              onEnsureTask={ensureActiveTask}
              onPersistTask={persistActiveTask}
              onModeChange={setActiveTaskMode}
              onOpenDocument={showDocument}
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
