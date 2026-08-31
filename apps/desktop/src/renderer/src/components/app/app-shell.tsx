/**
 * [INPUT]: 应用信息、useWorkspace 文档会话与隐式统一 Agent、Artifact、内置/用户创作 Skill 的 useTasks 任务导航状态
 * [OUTPUT]: 默认空间/文件工作区的持久化 Space 壳层、互斥的新任务/历史任务选中态、用户 Skill 管理、渐进加载最近任务与全部任务页、文件树共存的统一侧栏、保活任务/编辑器、独立可调宽文档对话侧栏、Artifact 到文档加同一会话、跨空间恢复和文档主区域
 * [POS]: Tessera 桌面端的顶层产品壳层
 * [DOC]: design.md、docs/architecture.md、docs/architecture/unified-creation-agent.md、docs/architecture/editor.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AppInfo, TaskArtifact, TaskSessionSummary, TaskSkillId } from "@tessera/contracts"
import { AnimatePresence, m, useReducedMotion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { type DefaultEditorMode, useAppPreferences } from "../../hooks/use-app-preferences"
import { useTasks } from "../../hooks/use-tasks"
import { useWorkspace } from "../../hooks/use-workspace"
import { motionSprings } from "../../motion"
import { DocumentEditor } from "../documents/document-editor"
import { DocumentHeader } from "../documents/document-header"
import { getRichTextEditorGuard } from "../documents/editor/editor-mode-policy"
import { requestSourceEditorLine } from "../documents/editor/source-code-editor-state"
import { SettingsPage } from "../settings/settings-page"
import { SkillManagementPage } from "../skills/skill-management-page"
import { TaskPage } from "../tasks/conversation/task-page"
import { AllTasksPage } from "../tasks/navigation/all-tasks-page"
import { AgentSidebar } from "./agent-sidebar"
import { HomeSidebar } from "./home-sidebar"

type AppShellProps = Readonly<{
  appInfo: AppInfo | undefined
}>

type PrimaryView = "skills" | "task" | "tasks" | "workspace"
type AppView = PrimaryView | "settings"

type HomeSidebarSelectionInput = Readonly<{
  activeTaskId: string
  activeTaskPersisted: boolean
  agentOpen: boolean
  view: AppView
}>

export function resolveHomeSidebarSelection(input: HomeSidebarSelectionInput) {
  const draftTaskActive = input.view === "task" && !input.activeTaskPersisted
  const persistedTaskActive = input.activeTaskPersisted && (input.view === "task" || input.agentOpen)
  return {
    activeItem:
      input.view === "skills" ? ("skills" as const) : draftTaskActive ? ("new-task" as const) : null,
    activeTaskId: persistedTaskActive ? input.activeTaskId : undefined,
  }
}

export function AppShell({ appInfo }: AppShellProps) {
  const [view, setView] = useState<AppView>("task")
  const [settingsReturnView, setSettingsReturnView] = useState<PrimaryView>("task")
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
    initialized: workspaceInitialized,
    saveStatus,
    hasExternalConflict,
    canGoBack,
    canGoForward,
    error,
    selectWorkspace,
    openDefaultWorkspace,
    openRecentWorkspace,
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
    listTasksPage,
    tasks,
    taskListRevision,
    ensureActiveTask,
    openTask,
    persistActiveTask,
    renameTask,
    deleteTask,
    setTaskArchived,
    setTaskPinned,
    setActiveTaskSkill,
    startNewTask,
  } = useTasks(workspace?.id)
  const homeSidebarSelection = resolveHomeSidebarSelection({
    activeTaskId: activeTask.id,
    activeTaskPersisted: activeTask.persisted,
    agentOpen,
    view,
  })

  useEffect(() => {
    if (!workspaceInitialized || activeTask.persisted || activeTask.messages.length > 0) return
    const currentSpaceId = workspace?.id ?? null
    if (activeTask.workspaceId !== currentSpaceId) startNewTask(currentSpaceId)
  }, [
    activeTask.messages.length,
    activeTask.persisted,
    activeTask.workspaceId,
    startNewTask,
    workspace?.id,
    workspaceInitialized,
  ])

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

  const changeEditorMode = useCallback(
    (nextMode: DefaultEditorMode) => {
      flushPendingEdits()
      setEditorMode(nextMode)
    },
    [flushPendingEdits],
  )

  const createWorkspaceTask = useCallback(() => {
    flushPendingEdits()
    setAgentOpen(false)
    startNewTask(workspace?.id ?? null)
    if (compactRef.current) setSidebarOpen(false)
    setView("task")
  }, [flushPendingEdits, startNewTask, workspace?.id])

  const toggleAgentSidebar = useCallback(() => {
    if (agentOpen) {
      setAgentOpen(false)
      return
    }
    flushPendingEdits()
    if (workspace && !activeTask.persisted && activeTask.workspaceId !== workspace.id) {
      startNewTask(workspace.id)
    }
    setAgentOpen(true)
  }, [activeTask.persisted, activeTask.workspaceId, agentOpen, flushPendingEdits, startNewTask, workspace])

  const openWorkspace = useCallback(
    async (workspaceId: string) => {
      flushPendingEdits()
      const nextWorkspace = workspace?.id === workspaceId ? workspace : await openRecentWorkspace(workspaceId)
      if (!nextWorkspace) return
      startNewTask(nextWorkspace.id)
      setAgentOpen(false)
      if (compactRef.current) setSidebarOpen(false)
      setView("task")
    },
    [flushPendingEdits, openRecentWorkspace, startNewTask, workspace],
  )

  const chooseWorkspace = useCallback(async () => {
    const nextWorkspace = await selectWorkspace()
    if (!nextWorkspace) return
    startNewTask(nextWorkspace.id)
    setView("task")
  }, [selectWorkspace, startNewTask])

  const openDefaultSpace = useCallback(async () => {
    flushPendingEdits()
    const opened = await openDefaultWorkspace()
    if (!opened) return
    startNewTask(null)
    setAgentOpen(false)
    if (compactRef.current) setSidebarOpen(false)
    setView("task")
  }, [flushPendingEdits, openDefaultWorkspace, startNewTask])

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
      if (!task.workspaceId && workspace) {
        const openedDefault = await openDefaultWorkspace()
        if (!openedDefault) return
      }
      setPendingTask(null)
      const opened = await openTask(task.id)
      if (!opened) return
      if (compactRef.current) setSidebarOpen(false)
      setView("task")
    },
    [flushPendingEdits, openDefaultWorkspace, openRecentWorkspace, openTask, workspace],
  )

  const showSkills = useCallback(() => {
    flushPendingEdits()
    setAgentOpen(false)
    if (compactRef.current) setSidebarOpen(false)
    setView("skills")
  }, [flushPendingEdits])

  const showAllTasks = useCallback(() => {
    flushPendingEdits()
    setAgentOpen(false)
    if (compactRef.current) setSidebarOpen(false)
    setView("tasks")
  }, [flushPendingEdits])

  const createSkillTask = useCallback(
    (skillId: Exclude<TaskSkillId, null | "question-answering">) => {
      flushPendingEdits()
      setAgentOpen(false)
      startNewTask(workspace?.id ?? null, skillId)
      setView("task")
    },
    [flushPendingEdits, startNewTask, workspace?.id],
  )

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
        requestSourceEditorLine(line)
      })
    },
    [flushPendingEdits, openDocument],
  )

  const openTaskArtifact = useCallback(
    async (artifact: TaskArtifact) => {
      flushPendingEdits()
      const project =
        workspace?.id === artifact.project.id ? workspace : await openRecentWorkspace(artifact.project.id)
      if (!project) return
      setView("workspace")
      setAgentOpen(true)
      await openDocument(artifact.relativePath)
    },
    [flushPendingEdits, openDocument, openRecentWorkspace, workspace],
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

  return (
    <>
      <div
        className={`${view === "settings" ? "hidden" : "flex"} relative h-screen min-h-0 gap-1 bg-muted/55 p-1 text-foreground`}
        data-platform={appInfo?.platform}
        data-runtime={appInfo?.runtime}
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
              key="home-sidebar"
              className={compact ? "absolute inset-y-1 left-1 z-30" : "flex shrink-0 overflow-hidden"}
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
              <HomeSidebar
                activeItem={homeSidebarSelection.activeItem}
                activeTaskId={homeSidebarSelection.activeTaskId}
                activeDocumentPath={activeDocument?.relativePath}
                directories={directories}
                documents={documents}
                loadTasksPage={listTasksPage}
                tasks={tasks}
                taskListRevision={taskListRevision}
                workspace={workspace}
                workspaces={recentWorkspaces}
                onCollapse={() => setSidebarOpen(false)}
                onCopyWorkspacePath={(workspaceId) => void copyWorkspacePath(workspaceId)}
                onCopyWorkspaceEntryPath={(relativePath) => void copyWorkspaceEntryPath(relativePath)}
                onCreateDirectory={createWorkspaceDirectory}
                onCreateDocument={createWorkspaceDocument}
                onDeleteTask={deleteTask}
                onDeleteWorkspaceEntry={(relativePath, kind) => void deleteWorkspaceEntry(relativePath, kind)}
                onNewTask={createWorkspaceTask}
                onOpenDefaultSpace={() => void openDefaultSpace()}
                onOpenDocument={showDocument}
                onOpenSettings={openSettings}
                onOpenTask={(task) => void openTaskSummary(task)}
                onOpenWorkspace={(workspaceId) => void openWorkspace(workspaceId)}
                onRemoveWorkspace={(workspaceId) => void removeRecentWorkspace(workspaceId)}
                onRefreshDocuments={() => void refreshDocuments()}
                onRenameDirectory={(relativePath) => void renameDirectory(relativePath)}
                onRenameDocument={(relativePath) => void renameDocument(relativePath)}
                onRenameTask={renameTask}
                onSetTaskArchived={setTaskArchived}
                onSetTaskPinned={setTaskPinned}
                onRevealWorkspace={(workspaceId) => void revealWorkspace(workspaceId)}
                onRevealWorkspaceEntry={(relativePath) => void revealWorkspaceEntry(relativePath)}
                onSelectWorkspace={() => void chooseWorkspace()}
                onShowAllTasks={showAllTasks}
                onShowSkills={showSkills}
              />
            </m.div>
          ) : null}
        </AnimatePresence>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background">
          <div className={`${view === "skills" ? "block" : "hidden"} min-h-0 flex-1`}>
            <SkillManagementPage
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((current) => !current)}
              onUseSkill={createSkillTask}
            />
          </div>

          <div className={`${view === "tasks" ? "block" : "hidden"} min-h-0 flex-1`}>
            <AllTasksPage
              activeTaskId={undefined}
              liveTasks={tasks}
              loadTasksPage={listTasksPage}
              refreshKey={taskListRevision}
              scopeKey={workspace?.id ?? "default-space"}
              sidebarOpen={sidebarOpen}
              spaceName={workspace?.name ?? "默认空间"}
              onDeleteTask={deleteTask}
              onOpenSettings={openSettings}
              onOpenTask={(task) => void openTaskSummary(task)}
              onRenameTask={renameTask}
              onSetTaskArchived={setTaskArchived}
              onSetTaskPinned={setTaskPinned}
              onToggleSidebar={() => setSidebarOpen((current) => !current)}
            />
          </div>

          <div className={`${view === "workspace" ? "flex" : "hidden"} min-h-0 flex-1`}>
            <div className="flex min-w-0 flex-1 flex-col">
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
                onToggleAgent={toggleAgentSidebar}
                onToggleSidebar={() => setSidebarOpen((current) => !current)}
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
              </div>
            </div>

            <AnimatePresence initial={false}>
              {agentOpen ? (
                <AgentSidebar key="agent-sidebar" onClose={() => setAgentOpen(false)}>
                  <TaskPage
                    key={activeTask.id}
                    currentDocument={activeDocument}
                    currentDocumentContent={draftContent}
                    defaultAttachCurrentDocument
                    surface="sidebar"
                    task={activeTask}
                    taskError={taskError}
                    sidebarOpen={sidebarOpen}
                    workspaceName={workspace?.name ?? null}
                    onEnsureTask={ensureActiveTask}
                    onPersistTask={persistActiveTask}
                    onSkillChange={setActiveTaskSkill}
                    onOpenArtifact={(artifact) => void openTaskArtifact(artifact)}
                    onOpenDocument={showDocument}
                    onToggleSidebar={() => setSidebarOpen((current) => !current)}
                    onOpenSettings={openSettings}
                  />
                </AgentSidebar>
              ) : null}
            </AnimatePresence>
          </div>

          <div className={`${view === "task" ? "block" : "hidden"} min-h-0 flex-1`}>
            {view === "workspace" && agentOpen ? null : (
              <TaskPage
                key={activeTask.id}
                currentDocument={activeDocument}
                currentDocumentContent={draftContent}
                task={activeTask}
                taskError={taskError}
                recentTasks={tasks}
                sidebarOpen={sidebarOpen}
                workspaceName={workspace?.name ?? null}
                onEnsureTask={ensureActiveTask}
                onPersistTask={persistActiveTask}
                onSkillChange={setActiveTaskSkill}
                onOpenArtifact={(artifact) => void openTaskArtifact(artifact)}
                onOpenDocument={showDocument}
                onOpenRecentTask={(task) => void openTaskSummary(task)}
                onToggleSidebar={() => setSidebarOpen((current) => !current)}
                onOpenSettings={openSettings}
              />
            )}
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
