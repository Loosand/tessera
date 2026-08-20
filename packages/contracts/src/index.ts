/**
 * [INPUT]: Electron 桌面应用当前需要的跨进程数据形状
 * [OUTPUT]: IPC 频道、应用信息与桌面 API 类型契约
 * [POS]: 应用和共享包共同依赖的底层契约入口
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export const IPC_CHANNELS = {
  appInfo: "app:info",
  workspaceCurrent: "workspace:current",
  workspaceSelect: "workspace:select",
  workspaceRecent: "workspace:recent",
  workspaceOpenRecent: "workspace:open-recent",
  workspaceReveal: "workspace:reveal",
  workspaceListDocuments: "workspace:list-documents",
  workspaceChanged: "workspace:changed",
  documentRead: "document:read",
  documentCreate: "document:create",
  documentRename: "document:rename",
  documentWrite: "document:write",
} as const

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface WorkspaceInfo {
  id: string
  name: string
  rootPath: string
}

export interface WorkspaceDocumentEntry {
  name: string
  relativePath: string
  modifiedAt: number
  size: number
}

export interface DocumentSnapshot extends WorkspaceDocumentEntry {
  content: string
}

export interface WorkspaceChangeEvent {
  paths: string[]
}

export type DocumentWriteResult =
  | { status: "saved"; document: DocumentSnapshot }
  | { status: "conflict"; document: DocumentSnapshot }

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>
  getCurrentWorkspace(): Promise<WorkspaceInfo | null>
  selectWorkspace(): Promise<WorkspaceInfo | null>
  listRecentWorkspaces(): Promise<WorkspaceInfo[]>
  openRecentWorkspace(workspaceId: string): Promise<WorkspaceInfo>
  revealCurrentWorkspace(): Promise<void>
  listWorkspaceDocuments(): Promise<WorkspaceDocumentEntry[]>
  readDocument(relativePath: string): Promise<DocumentSnapshot>
  createDocument(): Promise<DocumentSnapshot>
  renameDocument(relativePath: string): Promise<DocumentSnapshot | null>
  writeDocument(
    relativePath: string,
    content: string,
    expectedModifiedAt: number,
  ): Promise<DocumentWriteResult>
  onWorkspaceChanged(listener: (event: WorkspaceChangeEvent) => void): () => void
}
