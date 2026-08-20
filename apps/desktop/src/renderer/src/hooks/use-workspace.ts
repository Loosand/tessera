/**
 * [INPUT]: 预加载层提供的工作区、文件监听与文档读写 API
 * [OUTPUT]: 当前工作区、文档草稿、冲突状态和安全保存操作
 * [POS]: 渲染层工作区会话的单一状态入口
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DocumentSnapshot, WorkspaceDocumentEntry, WorkspaceInfo } from "@tessera/contracts"
import { useCallback, useEffect, useRef, useState } from "react"

type WorkspaceStatus = "idle" | "loading" | "ready" | "error"
export type WorkspaceSaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error"

interface NavigationState {
  entries: string[]
  index: number
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "工作区操作失败，请稍后重试。"
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceInfo[]>([])
  const [documents, setDocuments] = useState<WorkspaceDocumentEntry[]>([])
  const [activeDocument, setActiveDocument] = useState<DocumentSnapshot | null>(null)
  const [draftContent, setDraftContent] = useState("")
  const [isDirty, setIsDirty] = useState(false)
  const [externalDocument, setExternalDocument] = useState<DocumentSnapshot | null>(null)
  const [status, setStatus] = useState<WorkspaceStatus>("idle")
  const [saveStatus, setSaveStatus] = useState<WorkspaceSaveStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [navigation, setNavigation] = useState<NavigationState>({ entries: [], index: -1 })

  const requestIdRef = useRef(0)
  const workspaceRef = useRef(workspace)
  const activeDocumentRef = useRef(activeDocument)
  const draftContentRef = useRef(draftContent)
  const isDirtyRef = useRef(isDirty)
  const savePromiseRef = useRef<Promise<boolean> | null>(null)
  const navigationRef = useRef(navigation)

  workspaceRef.current = workspace
  activeDocumentRef.current = activeDocument
  draftContentRef.current = draftContent
  isDirtyRef.current = isDirty
  navigationRef.current = navigation

  const commitNavigation = useCallback((nextNavigation: NavigationState) => {
    navigationRef.current = nextNavigation
    setNavigation(nextNavigation)
  }, [])

  const resetNavigation = useCallback(
    (relativePath?: string) => {
      commitNavigation({ entries: relativePath ? [relativePath] : [], index: relativePath ? 0 : -1 })
    },
    [commitNavigation],
  )

  const pushNavigation = useCallback(
    (relativePath: string) => {
      const current = navigationRef.current
      if (current.entries[current.index] === relativePath) return
      const entries = [...current.entries.slice(0, current.index + 1), relativePath].slice(-100)
      commitNavigation({ entries, index: entries.length - 1 })
    },
    [commitNavigation],
  )

  const applyDocument = useCallback((document: DocumentSnapshot | null) => {
    activeDocumentRef.current = document
    draftContentRef.current = document?.content ?? ""
    isDirtyRef.current = false
    setActiveDocument(document)
    setDraftContent(document?.content ?? "")
    setIsDirty(false)
    setExternalDocument(null)
    setSaveStatus(document ? "saved" : "idle")
  }, [])

  const loadDocuments = useCallback(
    async (
      nextWorkspace: WorkspaceInfo,
      preferredPath?: string,
      navigationAction: "reset" | "push" = "reset",
    ) => {
      const desktopApi = window.tessera
      if (!desktopApi) return

      const requestId = ++requestIdRef.current
      workspaceRef.current = nextWorkspace
      setWorkspace(nextWorkspace)
      setStatus("loading")
      setError(null)
      try {
        const nextDocuments = await desktopApi.listWorkspaceDocuments()
        if (requestId !== requestIdRef.current) return

        setDocuments(nextDocuments)
        setStatus("ready")

        const pathToOpen = preferredPath ?? nextDocuments[0]?.relativePath
        if (!pathToOpen) {
          applyDocument(null)
          resetNavigation()
          return
        }
        const document = await desktopApi.readDocument(pathToOpen)
        if (requestId === requestIdRef.current) {
          applyDocument(document)
          if (navigationAction === "push") pushNavigation(document.relativePath)
          else resetNavigation(document.relativePath)
        }
      } catch (cause) {
        if (requestId !== requestIdRef.current) return
        setStatus("error")
        setError(errorMessage(cause))
      }
    },
    [applyDocument, pushNavigation, resetNavigation],
  )

  const saveDocument = useCallback(async () => {
    const desktopApi = window.tessera
    const document = activeDocumentRef.current
    if (!desktopApi || !document || !isDirtyRef.current) return true
    if (savePromiseRef.current) return savePromiseRef.current

    const contentToSave = draftContentRef.current
    setSaveStatus("saving")
    setError(null)
    const promise = desktopApi
      .writeDocument(document.relativePath, contentToSave, document.modifiedAt)
      .then((result) => {
        if (result.status === "conflict") {
          setExternalDocument(result.document)
          setSaveStatus("conflict")
          return false
        }

        if (activeDocumentRef.current?.relativePath === result.document.relativePath) {
          activeDocumentRef.current = result.document
          setActiveDocument(result.document)
          if (draftContentRef.current === contentToSave) {
            isDirtyRef.current = false
            setIsDirty(false)
            setSaveStatus("saved")
          } else {
            setSaveStatus("dirty")
          }
        }
        return true
      })
      .catch((cause) => {
        setSaveStatus("error")
        setError(errorMessage(cause))
        return false
      })
      .finally(() => {
        savePromiseRef.current = null
      })

    savePromiseRef.current = promise
    return promise
  }, [])

  useEffect(() => {
    const desktopApi = window.tessera
    if (!desktopApi) return

    let disposed = false
    void Promise.all([desktopApi.getCurrentWorkspace(), desktopApi.listRecentWorkspaces()])
      .then(([currentWorkspace, recent]) => {
        if (disposed) return
        setRecentWorkspaces(recent)
        if (currentWorkspace) void loadDocuments(currentWorkspace)
      })
      .catch((cause) => {
        if (!disposed) setError(errorMessage(cause))
      })
    return () => {
      disposed = true
      requestIdRef.current += 1
    }
  }, [loadDocuments])

  useEffect(() => {
    if (!isDirty || !activeDocument || saveStatus === "conflict") return
    const timer = window.setTimeout(() => void saveDocument(), 700)
    return () => window.clearTimeout(timer)
  }, [activeDocument, isDirty, saveDocument, saveStatus])

  useEffect(() => {
    const desktopApi = window.tessera
    if (!desktopApi) return

    return desktopApi.onWorkspaceChanged(() => {
      const currentWorkspace = workspaceRef.current
      if (!currentWorkspace) return

      void desktopApi
        .listWorkspaceDocuments()
        .then(async (nextDocuments) => {
          setDocuments(nextDocuments)
          const currentDocument = activeDocumentRef.current
          if (!currentDocument) return

          const stillExists = nextDocuments.some(
            (entry) => entry.relativePath === currentDocument.relativePath,
          )
          if (!stillExists) {
            applyDocument(null)
            return
          }

          const diskDocument = await desktopApi.readDocument(currentDocument.relativePath)
          if (diskDocument.modifiedAt === activeDocumentRef.current?.modifiedAt) return
          if (isDirtyRef.current || savePromiseRef.current) {
            setExternalDocument(diskDocument)
            setSaveStatus("conflict")
            return
          }
          applyDocument(diskDocument)
        })
        .catch((cause) => setError(errorMessage(cause)))
    })
  }, [applyDocument])

  const selectWorkspace = useCallback(async () => {
    const desktopApi = window.tessera
    if (!desktopApi) {
      setError("桌面桥接尚未就绪。")
      return
    }
    if (!(await saveDocument())) return

    try {
      const nextWorkspace = await desktopApi.selectWorkspace()
      if (nextWorkspace) {
        await loadDocuments(nextWorkspace)
        setRecentWorkspaces(await desktopApi.listRecentWorkspaces())
      }
    } catch (cause) {
      setStatus("error")
      setError(errorMessage(cause))
    }
  }, [loadDocuments, saveDocument])

  const openRecentWorkspace = useCallback(
    async (workspaceId: string) => {
      const desktopApi = window.tessera
      if (!desktopApi || workspaceId === workspaceRef.current?.id || !(await saveDocument())) return

      try {
        const nextWorkspace = await desktopApi.openRecentWorkspace(workspaceId)
        await loadDocuments(nextWorkspace)
        setRecentWorkspaces(await desktopApi.listRecentWorkspaces())
      } catch (cause) {
        setError(errorMessage(cause))
      }
    },
    [loadDocuments, saveDocument],
  )

  const revealCurrentWorkspace = useCallback(async () => {
    const desktopApi = window.tessera
    if (!desktopApi || !workspaceRef.current) return
    try {
      await desktopApi.revealCurrentWorkspace()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [])

  const refreshDocuments = useCallback(async () => {
    const desktopApi = window.tessera
    if (!desktopApi || !workspaceRef.current) return
    try {
      setDocuments(await desktopApi.listWorkspaceDocuments())
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [])

  const openDocument = useCallback(
    async (relativePath: string) => {
      const desktopApi = window.tessera
      if (!desktopApi || relativePath === activeDocumentRef.current?.relativePath) return
      if (!(await saveDocument())) return

      const requestId = ++requestIdRef.current
      setError(null)
      try {
        const document = await desktopApi.readDocument(relativePath)
        if (requestId === requestIdRef.current) {
          applyDocument(document)
          pushNavigation(document.relativePath)
        }
      } catch (cause) {
        if (requestId === requestIdRef.current) setError(errorMessage(cause))
      }
    },
    [applyDocument, pushNavigation, saveDocument],
  )

  const navigateHistory = useCallback(
    async (offset: -1 | 1) => {
      const desktopApi = window.tessera
      const current = navigationRef.current
      const nextIndex = current.index + offset
      const relativePath = current.entries[nextIndex]
      if (!desktopApi || !relativePath || !(await saveDocument())) return

      const requestId = ++requestIdRef.current
      setError(null)
      try {
        const document = await desktopApi.readDocument(relativePath)
        if (requestId !== requestIdRef.current) return
        applyDocument(document)
        commitNavigation({ entries: current.entries, index: nextIndex })
      } catch (cause) {
        if (requestId === requestIdRef.current) setError(errorMessage(cause))
      }
    },
    [applyDocument, commitNavigation, saveDocument],
  )

  const createDocument = useCallback(async () => {
    const desktopApi = window.tessera
    const currentWorkspace = workspaceRef.current
    if (!desktopApi || !currentWorkspace || !(await saveDocument())) return

    try {
      const document = await desktopApi.createDocument()
      await loadDocuments(currentWorkspace, document.relativePath, "push")
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [loadDocuments, saveDocument])

  const renameActiveDocument = useCallback(async () => {
    const desktopApi = window.tessera
    const document = activeDocumentRef.current
    if (!desktopApi || !document || !(await saveDocument())) return false

    setError(null)
    try {
      const renamedDocument = await desktopApi.renameDocument(document.relativePath)
      if (!renamedDocument) return false
      const previousPath = document.relativePath
      applyDocument(renamedDocument)
      setDocuments(await desktopApi.listWorkspaceDocuments())

      const current = navigationRef.current
      commitNavigation({
        entries: current.entries.map((path) => (path === previousPath ? renamedDocument.relativePath : path)),
        index: current.index,
      })
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    }
  }, [applyDocument, commitNavigation, saveDocument])

  const updateDraft = useCallback(
    (content: string) => {
      const changed = content !== activeDocumentRef.current?.content
      draftContentRef.current = content
      isDirtyRef.current = changed
      setDraftContent(content)
      setIsDirty(changed)
      if (!externalDocument) setSaveStatus(changed ? "dirty" : "saved")
    },
    [externalDocument],
  )

  const reloadDocument = useCallback(async () => {
    const desktopApi = window.tessera
    const document = activeDocumentRef.current
    if (!desktopApi || !document) return
    try {
      applyDocument(externalDocument ?? (await desktopApi.readDocument(document.relativePath)))
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [applyDocument, externalDocument])

  return {
    workspace,
    recentWorkspaces,
    documents,
    activeDocument,
    draftContent,
    isDirty,
    status,
    saveStatus,
    hasExternalConflict: Boolean(externalDocument),
    canGoBack: navigation.index > 0,
    canGoForward: navigation.index >= 0 && navigation.index < navigation.entries.length - 1,
    error,
    selectWorkspace,
    openRecentWorkspace,
    revealCurrentWorkspace,
    refreshDocuments,
    openDocument,
    goBack: () => navigateHistory(-1),
    goForward: () => navigateHistory(1),
    createDocument,
    renameActiveDocument,
    updateDraft,
    saveDocument,
    reloadDocument,
  }
}
