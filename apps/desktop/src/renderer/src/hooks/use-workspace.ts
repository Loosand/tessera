/**
 * [INPUT]: 预加载层提供的工作区、文件监听、窗口关闭与文档读写 API
 * [OUTPUT]: 当前/最近工作区、文件/目录索引、文档草稿、条目与最近列表操作、冲突状态和串行保存操作
 * [POS]: 渲染层工作区会话的单一状态入口
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  DesktopApi,
  DocumentSnapshot,
  WorkspaceDirectoryEntry,
  WorkspaceDocumentEntry,
  WorkspaceEntryKind,
  WorkspaceInfo,
} from "@tessera/contracts"
import { useCallback, useEffect, useRef, useState } from "react"

type WorkspaceStatus = "idle" | "loading" | "ready" | "error"
export type WorkspaceSaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error"

type NavigationState = {
  readonly entries: readonly string[]
  readonly index: number
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "工作区操作失败，请稍后重试。"
}

async function listWorkspaceIndex(desktopApi: DesktopApi) {
  const [documents, directories] = await Promise.all([
    desktopApi.listWorkspaceDocuments(),
    desktopApi.listWorkspaceDirectories(),
  ])
  return { directories, documents }
}

function isEntryOrChild(candidatePath: string, entryPath: string) {
  return candidatePath === entryPath || candidatePath.startsWith(`${entryPath}/`)
}

function remapEntryPath(candidatePath: string, previousPath: string, nextPath: string) {
  if (candidatePath === previousPath) return nextPath
  return candidatePath.startsWith(`${previousPath}/`)
    ? `${nextPath}${candidatePath.slice(previousPath.length)}`
    : candidatePath
}

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceInfo[]>([])
  const [documents, setDocuments] = useState<WorkspaceDocumentEntry[]>([])
  const [directories, setDirectories] = useState<WorkspaceDirectoryEntry[]>([])
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
  const externalDocumentRef = useRef(externalDocument)
  const pendingEditsFlusherRef = useRef<(() => void) | null>(null)
  const saveDrainPromiseRef = useRef<Promise<boolean> | null>(null)
  const navigationRef = useRef(navigation)

  workspaceRef.current = workspace
  activeDocumentRef.current = activeDocument
  draftContentRef.current = draftContent
  isDirtyRef.current = isDirty
  externalDocumentRef.current = externalDocument
  navigationRef.current = navigation

  const flushPendingEdits = useCallback(() => {
    pendingEditsFlusherRef.current?.()
  }, [])

  const registerPendingEditsFlusher = useCallback((flush: (() => void) | null) => {
    pendingEditsFlusherRef.current = flush
  }, [])

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
    externalDocumentRef.current = null
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
        const nextIndex = await listWorkspaceIndex(desktopApi)
        if (requestId !== requestIdRef.current) return

        setDocuments(nextIndex.documents)
        setDirectories(nextIndex.directories)
        setStatus("ready")

        const pathToOpen = preferredPath ?? nextIndex.documents[0]?.relativePath
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

  const saveDocument = useCallback(() => {
    flushPendingEdits()
    if (saveDrainPromiseRef.current) return saveDrainPromiseRef.current

    const drainPromise = (async () => {
      const desktopApi = window.tessera
      if (!desktopApi) return true

      while (isDirtyRef.current) {
        const document = activeDocumentRef.current
        if (!document || externalDocumentRef.current) return false

        const contentToSave = draftContentRef.current
        setSaveStatus("saving")
        setError(null)
        try {
          const result = await desktopApi.writeDocument(
            document.relativePath,
            contentToSave,
            document.modifiedAt,
          )
          if (result.status === "conflict") {
            externalDocumentRef.current = result.document
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
        } catch (cause) {
          setSaveStatus("error")
          setError(errorMessage(cause))
          return false
        }
      }
      return true
    })().finally(() => {
      saveDrainPromiseRef.current = null
    })

    saveDrainPromiseRef.current = drainPromise
    return drainPromise
  }, [flushPendingEdits])

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

    return desktopApi.onCloseRequested(() => {
      void Promise.resolve()
        .then(saveDocument)
        .then((saved) => {
          if (saved) desktopApi.confirmClose()
          else desktopApi.cancelClose()
        })
        .catch((cause) => {
          setError(errorMessage(cause))
          desktopApi.cancelClose()
        })
    })
  }, [saveDocument])

  useEffect(() => {
    const desktopApi = window.tessera
    if (!desktopApi) return

    return desktopApi.onWorkspaceChanged((change) => {
      const currentWorkspace = workspaceRef.current
      if (!currentWorkspace) return

      const currentPath = activeDocumentRef.current?.relativePath
      if (currentPath && change.paths.includes(currentPath)) flushPendingEdits()

      void listWorkspaceIndex(desktopApi)
        .then(async (nextIndex) => {
          setDocuments(nextIndex.documents)
          setDirectories(nextIndex.directories)
          const currentDocument = activeDocumentRef.current
          if (!currentDocument) return

          const stillExists = nextIndex.documents.some(
            (entry) => entry.relativePath === currentDocument.relativePath,
          )
          if (!stillExists) {
            applyDocument(null)
            resetNavigation()
            return
          }

          const diskDocument = await desktopApi.readDocument(currentDocument.relativePath)
          if (diskDocument.modifiedAt === activeDocumentRef.current?.modifiedAt) return
          if (isDirtyRef.current || saveDrainPromiseRef.current) {
            externalDocumentRef.current = diskDocument
            setExternalDocument(diskDocument)
            setSaveStatus("conflict")
            return
          }
          applyDocument(diskDocument)
        })
        .catch((cause) => setError(errorMessage(cause)))
    })
  }, [applyDocument, flushPendingEdits, resetNavigation])

  const selectWorkspace = useCallback(async () => {
    const desktopApi = window.tessera
    if (!desktopApi) {
      setError("桌面桥接尚未就绪。")
      return null
    }
    if (!(await saveDocument())) return null

    try {
      const nextWorkspace = await desktopApi.selectWorkspace()
      if (nextWorkspace) {
        await loadDocuments(nextWorkspace)
        setRecentWorkspaces(await desktopApi.listRecentWorkspaces())
      }
      return nextWorkspace
    } catch (cause) {
      setStatus("error")
      setError(errorMessage(cause))
      return null
    }
  }, [loadDocuments, saveDocument])

  const openRecentWorkspace = useCallback(
    async (workspaceId: string) => {
      const desktopApi = window.tessera
      if (!desktopApi || !(await saveDocument())) return null
      if (workspaceId === workspaceRef.current?.id) return workspaceRef.current

      try {
        const nextWorkspace = await desktopApi.openRecentWorkspace(workspaceId)
        await loadDocuments(nextWorkspace)
        setRecentWorkspaces(await desktopApi.listRecentWorkspaces())
        return nextWorkspace
      } catch (cause) {
        setError(errorMessage(cause))
        return null
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

  const revealWorkspace = useCallback(async (workspaceId: string) => {
    const desktopApi = window.tessera
    if (!desktopApi) return
    try {
      await desktopApi.revealWorkspace(workspaceId)
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [])

  const copyWorkspacePath = useCallback(async (workspaceId: string) => {
    const desktopApi = window.tessera
    if (!desktopApi) return false
    try {
      await desktopApi.copyWorkspacePath(workspaceId)
      setError(null)
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    }
  }, [])

  const removeRecentWorkspace = useCallback(async (workspaceId: string) => {
    const desktopApi = window.tessera
    if (!desktopApi) return false
    try {
      const removed = await desktopApi.removeRecentWorkspace(workspaceId)
      if (removed) setRecentWorkspaces((current) => current.filter((item) => item.id !== workspaceId))
      setError(null)
      return removed
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    }
  }, [])

  const refreshDocuments = useCallback(async () => {
    const desktopApi = window.tessera
    if (!desktopApi || !workspaceRef.current) return
    try {
      const nextIndex = await listWorkspaceIndex(desktopApi)
      setDocuments(nextIndex.documents)
      setDirectories(nextIndex.directories)
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [])

  const openDocument = useCallback(
    async (relativePath: string) => {
      const desktopApi = window.tessera
      if (!desktopApi) return false
      if (relativePath === activeDocumentRef.current?.relativePath) return true
      if (!(await saveDocument())) return false

      const requestId = ++requestIdRef.current
      setError(null)
      try {
        const document = await desktopApi.readDocument(relativePath)
        if (requestId === requestIdRef.current) {
          applyDocument(document)
          pushNavigation(document.relativePath)
          return true
        }
        return false
      } catch (cause) {
        if (requestId === requestIdRef.current) setError(errorMessage(cause))
        return false
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

  const createDocument = useCallback(
    async (parentRelativePath = "") => {
      const desktopApi = window.tessera
      const currentWorkspace = workspaceRef.current
      if (!desktopApi || !currentWorkspace || !(await saveDocument())) return

      try {
        const document = await desktopApi.createDocument(parentRelativePath)
        await loadDocuments(currentWorkspace, document.relativePath, "push")
      } catch (cause) {
        setError(errorMessage(cause))
      }
    },
    [loadDocuments, saveDocument],
  )

  const createDirectory = useCallback(
    async (parentRelativePath = "") => {
      const desktopApi = window.tessera
      if (!desktopApi || !workspaceRef.current || !(await saveDocument())) return null

      setError(null)
      try {
        const directory = await desktopApi.createDirectory(parentRelativePath)
        const nextIndex = await listWorkspaceIndex(desktopApi)
        setDocuments(nextIndex.documents)
        setDirectories(nextIndex.directories)
        return directory
      } catch (cause) {
        setError(errorMessage(cause))
        return null
      }
    },
    [saveDocument],
  )

  const renameDocument = useCallback(
    async (relativePath: string) => {
      const desktopApi = window.tessera
      if (!desktopApi || !(await saveDocument())) return false

      setError(null)
      try {
        const renamedDocument = await desktopApi.renameDocument(relativePath)
        if (!renamedDocument) return false
        if (activeDocumentRef.current?.relativePath === relativePath) applyDocument(renamedDocument)
        const nextIndex = await listWorkspaceIndex(desktopApi)
        setDocuments(nextIndex.documents)
        setDirectories(nextIndex.directories)

        const current = navigationRef.current
        commitNavigation({
          entries: current.entries.map((path) =>
            path === relativePath ? renamedDocument.relativePath : path,
          ),
          index: current.index,
        })
        return true
      } catch (cause) {
        setError(errorMessage(cause))
        return false
      }
    },
    [applyDocument, commitNavigation, saveDocument],
  )

  const renameActiveDocument = useCallback(async () => {
    const document = activeDocumentRef.current
    return document ? renameDocument(document.relativePath) : false
  }, [renameDocument])

  const renameDirectory = useCallback(
    async (relativePath: string) => {
      const desktopApi = window.tessera
      if (!desktopApi || !(await saveDocument())) return false

      setError(null)
      try {
        const renamedDirectory = await desktopApi.renameDirectory(relativePath)
        if (!renamedDirectory) return false

        const currentDocument = activeDocumentRef.current
        if (currentDocument && isEntryOrChild(currentDocument.relativePath, relativePath)) {
          const nextDocumentPath = remapEntryPath(
            currentDocument.relativePath,
            relativePath,
            renamedDirectory.relativePath,
          )
          applyDocument(await desktopApi.readDocument(nextDocumentPath))
        }

        const nextIndex = await listWorkspaceIndex(desktopApi)
        setDocuments(nextIndex.documents)
        setDirectories(nextIndex.directories)
        const current = navigationRef.current
        commitNavigation({
          entries: current.entries.map((path) =>
            remapEntryPath(path, relativePath, renamedDirectory.relativePath),
          ),
          index: current.index,
        })
        return true
      } catch (cause) {
        setError(errorMessage(cause))
        return false
      }
    },
    [applyDocument, commitNavigation, saveDocument],
  )

  const deleteWorkspaceEntry = useCallback(
    async (relativePath: string, kind: WorkspaceEntryKind) => {
      const desktopApi = window.tessera
      if (!desktopApi || !(await saveDocument())) return false

      setError(null)
      try {
        const documentBeforeDelete = activeDocumentRef.current
        const deleted = await desktopApi.deleteWorkspaceEntry(relativePath, kind)
        if (!deleted) return false

        const nextIndex = await listWorkspaceIndex(desktopApi)
        setDocuments(nextIndex.documents)
        setDirectories(nextIndex.directories)

        const activeWasDeleted = Boolean(
          documentBeforeDelete && isEntryOrChild(documentBeforeDelete.relativePath, relativePath),
        )
        if (activeWasDeleted) {
          const fallbackPath = nextIndex.documents[0]?.relativePath
          if (fallbackPath) {
            applyDocument(await desktopApi.readDocument(fallbackPath))
            resetNavigation(fallbackPath)
          } else {
            applyDocument(null)
            resetNavigation()
          }
        } else {
          const current = navigationRef.current
          const entries = current.entries.filter((path) => !isEntryOrChild(path, relativePath))
          const activePath = documentBeforeDelete?.relativePath
          commitNavigation({
            entries,
            index: activePath ? entries.indexOf(activePath) : -1,
          })
        }
        return true
      } catch (cause) {
        setError(errorMessage(cause))
        return false
      }
    },
    [applyDocument, commitNavigation, resetNavigation, saveDocument],
  )

  const revealWorkspaceEntry = useCallback(async (relativePath: string) => {
    const desktopApi = window.tessera
    if (!desktopApi) return
    try {
      await desktopApi.revealWorkspaceEntry(relativePath)
      setError(null)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [])

  const copyWorkspaceEntryPath = useCallback(async (relativePath: string) => {
    const desktopApi = window.tessera
    if (!desktopApi) return false
    try {
      await desktopApi.copyWorkspaceEntryPath(relativePath)
      setError(null)
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    }
  }, [])

  const updateDraft = useCallback((documentPath: string, content: string) => {
    if (documentPath !== activeDocumentRef.current?.relativePath) return
    const changed = content !== activeDocumentRef.current?.content
    draftContentRef.current = content
    isDirtyRef.current = changed
    setDraftContent(content)
    setIsDirty(changed)
    if (!externalDocumentRef.current) setSaveStatus(changed ? "dirty" : "saved")
  }, [])

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
    directories,
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
    revealWorkspace,
    copyWorkspacePath,
    removeRecentWorkspace,
    refreshDocuments,
    openDocument,
    goBack: () => navigateHistory(-1),
    goForward: () => navigateHistory(1),
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
  }
}
