/**
 * [INPUT]: 当前工作区 ID 与预加载层的任务会话 API
 * [OUTPUT]: 带执行模式和 Skill 选择的新任务草稿、工作区/最近任务列表、历史恢复、重命名、删除和幂等保存操作
 * [POS]: 渲染层中工作区任务导航与对话持久化的单一状态入口
 * [DOC]: docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  TaskMessage,
  TaskMode,
  TaskSessionSaveInput,
  TaskSessionStatus,
  TaskSessionSummary,
  TaskSkillId,
} from "@tessera/contracts"
import { useCallback, useEffect, useRef, useState } from "react"

export type ActiveTask = {
  readonly id: string
  readonly messages: TaskMessage[]
  readonly mode: TaskMode
  readonly persisted: boolean
  readonly skillId: TaskSkillId
  readonly status: TaskSessionStatus
  readonly title: string
  readonly workspaceId: string | null
}

function createTaskDraft(
  mode: TaskMode = "chat",
  workspaceId: string | null = null,
  skillId: TaskSkillId = null,
): ActiveTask {
  return {
    id: globalThis.crypto.randomUUID(),
    messages: [],
    mode,
    persisted: false,
    skillId,
    status: "idle",
    title: "新任务",
    workspaceId,
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "任务操作失败，请稍后重试。"
}

function upsertSummary(items: TaskSessionSummary[], summary: TaskSessionSummary) {
  return [summary, ...items.filter((item) => item.id !== summary.id)].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )
}

export function useTasks(workspaceId: string | undefined) {
  const [tasks, setTasks] = useState<TaskSessionSummary[]>([])
  const [recentTasks, setRecentTasks] = useState<TaskSessionSummary[]>([])
  const [activeTask, setActiveTask] = useState<ActiveTask>(createTaskDraft)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const activeTaskRef = useRef(activeTask)
  activeTaskRef.current = activeTask

  const refreshRecentTasks = useCallback(async () => {
    const desktopApi = window.tessera
    if (!desktopApi) return []
    try {
      const nextTasks = await desktopApi.listRecentTasks()
      setRecentTasks(nextTasks)
      return nextTasks
    } catch (cause) {
      setError(errorMessage(cause))
      return []
    }
  }, [])

  const refreshWorkspaceTasks = useCallback(async () => {
    const desktopApi = window.tessera
    if (!desktopApi || !workspaceId) {
      setTasks([])
      return []
    }
    try {
      const nextTasks = await desktopApi.listWorkspaceTasks()
      setTasks(nextTasks)
      return nextTasks
    } catch (cause) {
      setError(errorMessage(cause))
      return []
    }
  }, [workspaceId])

  useEffect(() => {
    const desktopApi = window.tessera
    const requestId = ++requestIdRef.current
    const draft = createTaskDraft("chat", workspaceId ?? null)
    activeTaskRef.current = draft
    setActiveTask(draft)
    setTasks([])
    setError(null)
    if (!desktopApi || !workspaceId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void Promise.all([desktopApi.listWorkspaceTasks(), desktopApi.listRecentTasks()])
      .then(([workspaceTasks, recent]) => {
        if (requestId !== requestIdRef.current) return
        setTasks(workspaceTasks)
        setRecentTasks(recent)
      })
      .catch((cause) => {
        if (requestId === requestIdRef.current) setError(errorMessage(cause))
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [workspaceId])

  useEffect(() => {
    if (workspaceId) return
    void refreshRecentTasks()
  }, [refreshRecentTasks, workspaceId])

  const startNewTask = useCallback(
    (
      mode: TaskMode = "chat",
      nextWorkspaceId: string | null = workspaceId ?? null,
      skillId: TaskSkillId = null,
    ) => {
      requestIdRef.current += 1
      const draft = createTaskDraft(mode, nextWorkspaceId, skillId)
      activeTaskRef.current = draft
      setActiveTask(draft)
      setError(null)
      return draft
    },
    [workspaceId],
  )

  const openTask = useCallback(async (taskId: string) => {
    const desktopApi = window.tessera
    if (!desktopApi) return null
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const snapshot = await desktopApi.readTask(taskId)
      if (requestId !== requestIdRef.current) return null
      const task = {
        id: snapshot.id,
        messages: snapshot.messages,
        mode: snapshot.mode,
        persisted: true,
        skillId: snapshot.skillId,
        status: snapshot.status,
        title: snapshot.title,
        workspaceId: snapshot.workspaceId,
      } satisfies ActiveTask
      activeTaskRef.current = task
      setActiveTask(task)
      return task
    } catch (cause) {
      if (requestId === requestIdRef.current) setError(errorMessage(cause))
      return null
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [])

  const saveTask = useCallback(async (input: TaskSessionSaveInput) => {
    const desktopApi = window.tessera
    if (!desktopApi) return null
    try {
      const snapshot = await desktopApi.saveTask(input)
      const summary: TaskSessionSummary = snapshot
      setTasks((current) => upsertSummary(current, summary))
      setRecentTasks((current) => upsertSummary(current, summary).slice(0, 12))
      if (activeTaskRef.current.id === snapshot.id) {
        setActiveTask((current) => {
          if (current.id !== snapshot.id) return current
          const next = {
            ...current,
            messages: input.messages,
            mode: snapshot.mode,
            persisted: true,
            skillId: snapshot.skillId,
            status: snapshot.status,
            title: snapshot.title,
            workspaceId: snapshot.workspaceId,
          }
          activeTaskRef.current = next
          return next
        })
      }
      setError(null)
      return snapshot
    } catch (cause) {
      setError(errorMessage(cause))
      return null
    }
  }, [])

  const ensureActiveTask = useCallback(
    async (title: string) => {
      const task = activeTaskRef.current
      if (task.persisted) return task
      const snapshot = await saveTask({
        id: task.id,
        messages: task.messages,
        mode: task.mode,
        skillId: task.skillId,
        status: "idle",
        title,
        workspaceId: task.workspaceId,
      })
      return snapshot
    },
    [saveTask],
  )

  const renameTask = useCallback(async (taskId: string, title: string) => {
    const desktopApi = window.tessera
    if (!desktopApi) return false
    try {
      const summary = await desktopApi.renameTask(taskId, title)
      setTasks((current) => upsertSummary(current, summary))
      setRecentTasks((current) => upsertSummary(current, summary).slice(0, 12))
      if (activeTaskRef.current.id === taskId) {
        setActiveTask((current) => {
          if (current.id !== taskId) return current
          const next = { ...current, title: summary.title }
          activeTaskRef.current = next
          return next
        })
      }
      setError(null)
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    }
  }, [])

  const deleteTask = useCallback(async (taskId: string) => {
    const desktopApi = window.tessera
    if (!desktopApi) return false
    try {
      const deleted = await desktopApi.deleteTask(taskId)
      if (!deleted) return false
      setTasks((current) => current.filter((task) => task.id !== taskId))
      setRecentTasks((current) => current.filter((task) => task.id !== taskId))
      if (activeTaskRef.current.id === taskId) {
        requestIdRef.current += 1
        const draft = createTaskDraft("chat", activeTaskRef.current.workspaceId)
        activeTaskRef.current = draft
        setActiveTask(draft)
      }
      setError(null)
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    }
  }, [])

  const persistActiveTask = useCallback(
    (messages: TaskMessage[], status: TaskSessionStatus) => {
      const task = activeTaskRef.current
      if (!task.persisted) return Promise.resolve(null)
      return saveTask({
        id: task.id,
        messages,
        mode: task.mode,
        skillId: task.skillId,
        status,
        title: task.title,
        workspaceId: task.workspaceId,
      })
    },
    [saveTask],
  )

  const setActiveTaskMode = useCallback((mode: TaskMode) => {
    const task = activeTaskRef.current
    if (task.persisted || task.messages.length > 0 || task.mode === mode) return
    const next = { ...task, mode }
    activeTaskRef.current = next
    setActiveTask(next)
  }, [])

  const setActiveTaskSkill = useCallback((skillId: TaskSkillId) => {
    const task = activeTaskRef.current
    if (task.persisted || task.messages.length > 0 || task.skillId === skillId) return
    const next = { ...task, skillId }
    activeTaskRef.current = next
    setActiveTask(next)
  }, [])

  return {
    activeTask,
    error,
    loading,
    tasks,
    recentTasks,
    ensureActiveTask,
    deleteTask,
    openTask,
    persistActiveTask,
    refreshRecentTasks,
    refreshWorkspaceTasks,
    renameTask,
    setActiveTaskMode,
    setActiveTaskSkill,
    startNewTask,
  }
}
