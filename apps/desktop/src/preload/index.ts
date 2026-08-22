/**
 * [INPUT]: 共享桌面 API 契约与 Electron IPC 渲染器
 * [OUTPUT]: 暴露在 window.tessera 上的冻结窄接口、开发期 AI 日志入口、MCP/用户 Skill 安全配置与扫描安装、可恢复 AI 流、Agent 变更预览、托管内容库/Artifact、受限工作区/任务操作和关闭保存握手
 * [POS]: 主进程与沙箱渲染层之间的安全桥
 * [DOC]: docs/architecture.md、docs/architecture/ai-providers.md、docs/architecture/ai-observability.md、docs/architecture/mcp.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DesktopApi } from "@tessera/contracts"
import { IPC_CHANNELS } from "@tessera/contracts"
import { contextBridge } from "electron"
import { invokeDesktop, sendDesktop, subscribeDesktop } from "./ipc-contract"

const api = Object.freeze({
  getAppInfo: () => invokeDesktop(IPC_CHANNELS.appInfo),
  openAiDevtools: () => invokeDesktop(IPC_CHANNELS.aiDevtoolsOpen),
  deleteAiProviderConfig: (configId) => invokeDesktop(IPC_CHANNELS.aiProviderDeleteConfig, configId),
  listAiProviderConfigs: () => invokeDesktop(IPC_CHANNELS.aiProviderListConfigs),
  listAiProviderModels: (input) => invokeDesktop(IPC_CHANNELS.aiProviderListModels, input),
  saveAiProviderConfig: (input) => invokeDesktop(IPC_CHANNELS.aiProviderSaveConfig, input),
  listMcpServers: () => invokeDesktop(IPC_CHANNELS.mcpServerList),
  saveMcpServer: (input) => invokeDesktop(IPC_CHANNELS.mcpServerSave, input),
  deleteMcpServer: (serverId) => invokeDesktop(IPC_CHANNELS.mcpServerDelete, serverId),
  testMcpServer: (serverId) => invokeDesktop(IPC_CHANNELS.mcpServerTest, serverId),
  listUserSkills: () => invokeDesktop(IPC_CHANNELS.userSkillList),
  installUserSkill: () => invokeDesktop(IPC_CHANNELS.userSkillInstall),
  scanUserSkills: () => invokeDesktop(IPC_CHANNELS.userSkillScan),
  installScannedUserSkills: (scanId, candidateIds) =>
    invokeDesktop(IPC_CHANNELS.userSkillInstallScanned, scanId, candidateIds),
  setUserSkillEnabled: (skillId, enabled) =>
    invokeDesktop(IPC_CHANNELS.userSkillSetEnabled, skillId, enabled),
  deleteUserSkill: (skillId) => invokeDesktop(IPC_CHANNELS.userSkillDelete, skillId),
  startAiChat: (input) => invokeDesktop(IPC_CHANNELS.aiChatStart, input),
  resumeAiChat: (taskId) => invokeDesktop(IPC_CHANNELS.aiChatResume, taskId),
  cancelAiChat: (requestId) => sendDesktop(IPC_CHANNELS.aiChatCancel, requestId),
  readAgentChangePreview: (taskId, approvalId) =>
    invokeDesktop(IPC_CHANNELS.agentChangePreview, taskId, approvalId),
  listRecentTasks: () => invokeDesktop(IPC_CHANNELS.taskListRecent),
  listWorkspaceTasks: () => invokeDesktop(IPC_CHANNELS.taskListWorkspace),
  listTaskArtifacts: (taskId) => invokeDesktop(IPC_CHANNELS.taskListArtifacts, taskId),
  readTask: (taskId) => invokeDesktop(IPC_CHANNELS.taskRead, taskId),
  saveTask: (input) => invokeDesktop(IPC_CHANNELS.taskSave, input),
  renameTask: (taskId, title) => invokeDesktop(IPC_CHANNELS.taskRename, taskId, title),
  deleteTask: (taskId) => invokeDesktop(IPC_CHANNELS.taskDelete, taskId),
  cancelClose: () => sendDesktop(IPC_CHANNELS.appCancelClose),
  confirmClose: () => sendDesktop(IPC_CHANNELS.appConfirmClose),
  getCurrentWorkspace: () => invokeDesktop(IPC_CHANNELS.workspaceCurrent),
  getCurrentContentLibrary: () => invokeDesktop(IPC_CHANNELS.contentLibraryCurrent),
  selectContentLibrary: () => invokeDesktop(IPC_CHANNELS.contentLibrarySelect),
  revokeContentLibrary: () => invokeDesktop(IPC_CHANNELS.contentLibraryRevoke),
  selectWorkspace: () => invokeDesktop(IPC_CHANNELS.workspaceSelect),
  listRecentWorkspaces: () => invokeDesktop(IPC_CHANNELS.workspaceRecent),
  openRecentWorkspace: (workspaceId) => invokeDesktop(IPC_CHANNELS.workspaceOpenRecent, workspaceId),
  revealCurrentWorkspace: () => invokeDesktop(IPC_CHANNELS.workspaceReveal),
  revealWorkspace: (workspaceId) => invokeDesktop(IPC_CHANNELS.workspaceRevealRecent, workspaceId),
  copyWorkspacePath: (workspaceId) => invokeDesktop(IPC_CHANNELS.workspaceCopyPath, workspaceId),
  removeRecentWorkspace: (workspaceId) => invokeDesktop(IPC_CHANNELS.workspaceRemoveRecent, workspaceId),
  listWorkspaceDocuments: () => invokeDesktop(IPC_CHANNELS.workspaceListDocuments),
  listWorkspaceDirectories: () => invokeDesktop(IPC_CHANNELS.workspaceListDirectories),
  readDocument: (relativePath) => invokeDesktop(IPC_CHANNELS.documentRead, relativePath),
  createDocument: (parentRelativePath) => invokeDesktop(IPC_CHANNELS.documentCreate, parentRelativePath),
  createDirectory: (parentRelativePath) =>
    invokeDesktop(IPC_CHANNELS.workspaceEntryCreateDirectory, parentRelativePath),
  renameDocument: (relativePath) => invokeDesktop(IPC_CHANNELS.documentRename, relativePath),
  renameDirectory: (relativePath) => invokeDesktop(IPC_CHANNELS.workspaceEntryRenameDirectory, relativePath),
  deleteWorkspaceEntry: (relativePath, kind) =>
    invokeDesktop(IPC_CHANNELS.workspaceEntryDelete, relativePath, kind),
  revealWorkspaceEntry: (relativePath) => invokeDesktop(IPC_CHANNELS.workspaceEntryReveal, relativePath),
  copyWorkspaceEntryPath: (relativePath) => invokeDesktop(IPC_CHANNELS.workspaceEntryCopyPath, relativePath),
  writeDocument: (relativePath, content, expectedModifiedAt) =>
    invokeDesktop(IPC_CHANNELS.documentWrite, relativePath, content, expectedModifiedAt),
  onAiProviderConfigsChanged: (listener) => subscribeDesktop(IPC_CHANNELS.aiProviderConfigsChanged, listener),
  onMcpServersChanged: (listener) => subscribeDesktop(IPC_CHANNELS.mcpServersChanged, listener),
  onUserSkillsChanged: (listener) => subscribeDesktop(IPC_CHANNELS.userSkillsChanged, listener),
  onAiChatEvent: (listener) => subscribeDesktop(IPC_CHANNELS.aiChatEvent, listener),
  onWorkspaceChanged: (listener) => subscribeDesktop(IPC_CHANNELS.workspaceChanged, listener),
  onCloseRequested: (listener) => subscribeDesktop(IPC_CHANNELS.appCloseRequested, listener),
} satisfies DesktopApi)

contextBridge.exposeInMainWorld("tessera", api)
