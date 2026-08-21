/**
 * [INPUT]: 共享桌面 API 契约与 Electron IPC 渲染器
 * [OUTPUT]: 暴露在 window.tessera 上的冻结窄接口、受限工作区条目操作和关闭保存握手
 * [POS]: 主进程与沙箱渲染层之间的安全桥
 * [DOC]: docs/architecture.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AiChatStartInput,
  AiChatStreamEvent,
  AiProviderConnectionInput,
  AiProviderId,
  AiProviderSaveInput,
  DesktopApi,
  WorkspaceChangeEvent,
  WorkspaceEntryKind,
} from "@tessera/contracts"
import { IPC_CHANNELS } from "@tessera/contracts"
import { contextBridge, ipcRenderer } from "electron"

const api: DesktopApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
  deleteAiProviderConfig: (providerId: AiProviderId) =>
    ipcRenderer.invoke(IPC_CHANNELS.aiProviderDeleteConfig, providerId),
  listAiProviderConfigs: () => ipcRenderer.invoke(IPC_CHANNELS.aiProviderListConfigs),
  listAiProviderModels: (input: AiProviderConnectionInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.aiProviderListModels, input),
  saveAiProviderConfig: (input: AiProviderSaveInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.aiProviderSaveConfig, input),
  startAiChat: (input: AiChatStartInput) => ipcRenderer.invoke(IPC_CHANNELS.aiChatStart, input),
  cancelAiChat: (requestId: string) => ipcRenderer.send(IPC_CHANNELS.aiChatCancel, requestId),
  cancelClose: () => ipcRenderer.send(IPC_CHANNELS.appCancelClose),
  confirmClose: () => ipcRenderer.send(IPC_CHANNELS.appConfirmClose),
  getCurrentWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceCurrent),
  selectWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceSelect),
  listRecentWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceRecent),
  openRecentWorkspace: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceOpenRecent, workspaceId),
  revealCurrentWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceReveal),
  listWorkspaceDocuments: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceListDocuments),
  listWorkspaceDirectories: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceListDirectories),
  readDocument: (relativePath: string) => ipcRenderer.invoke(IPC_CHANNELS.documentRead, relativePath),
  createDocument: (parentRelativePath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.documentCreate, parentRelativePath),
  createDirectory: (parentRelativePath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceEntryCreateDirectory, parentRelativePath),
  renameDocument: (relativePath: string) => ipcRenderer.invoke(IPC_CHANNELS.documentRename, relativePath),
  renameDirectory: (relativePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceEntryRenameDirectory, relativePath),
  deleteWorkspaceEntry: (relativePath: string, kind: WorkspaceEntryKind) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceEntryDelete, relativePath, kind),
  revealWorkspaceEntry: (relativePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceEntryReveal, relativePath),
  copyWorkspaceEntryPath: (relativePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceEntryCopyPath, relativePath),
  writeDocument: (relativePath: string, content: string, expectedModifiedAt: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.documentWrite, relativePath, content, expectedModifiedAt),
  onAiProviderConfigsChanged: (listener: () => void) => {
    const handler = () => listener()
    ipcRenderer.on(IPC_CHANNELS.aiProviderConfigsChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.aiProviderConfigsChanged, handler)
  },
  onAiChatEvent: (listener: (event: AiChatStreamEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, streamEvent: AiChatStreamEvent) =>
      listener(streamEvent)
    ipcRenderer.on(IPC_CHANNELS.aiChatEvent, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.aiChatEvent, handler)
  },
  onWorkspaceChanged: (listener: (event: WorkspaceChangeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, change: WorkspaceChangeEvent) => listener(change)
    ipcRenderer.on(IPC_CHANNELS.workspaceChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.workspaceChanged, handler)
  },
  onCloseRequested: (listener: () => void) => {
    const handler = () => listener()
    ipcRenderer.on(IPC_CHANNELS.appCloseRequested, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.appCloseRequested, handler)
  },
})

contextBridge.exposeInMainWorld("tessera", api)
