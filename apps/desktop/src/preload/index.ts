/**
 * [INPUT]: 共享桌面 API 契约与 Electron IPC 渲染器
 * [OUTPUT]: 暴露在 window.tessera 上的冻结窄接口
 * [POS]: 主进程与沙箱渲染层之间的安全桥
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DesktopApi, WorkspaceChangeEvent } from "@tessera/contracts"
import { IPC_CHANNELS } from "@tessera/contracts"
import { contextBridge, ipcRenderer } from "electron"

const api: DesktopApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
  getCurrentWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceCurrent),
  selectWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceSelect),
  listRecentWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceRecent),
  openRecentWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceOpenRecent, workspaceId),
  revealCurrentWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceReveal),
  listWorkspaceDocuments: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceListDocuments),
  readDocument: (relativePath: string) => ipcRenderer.invoke(IPC_CHANNELS.documentRead, relativePath),
  createDocument: () => ipcRenderer.invoke(IPC_CHANNELS.documentCreate),
  renameDocument: (relativePath: string) => ipcRenderer.invoke(IPC_CHANNELS.documentRename, relativePath),
  writeDocument: (relativePath: string, content: string, expectedModifiedAt: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.documentWrite, relativePath, content, expectedModifiedAt),
  onWorkspaceChanged: (listener: (event: WorkspaceChangeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, change: WorkspaceChangeEvent) => listener(change)
    ipcRenderer.on(IPC_CHANNELS.workspaceChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.workspaceChanged, handler)
  },
})

contextBridge.exposeInMainWorld("tessera", api)
