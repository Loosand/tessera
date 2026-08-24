/**
 * [INPUT]: @tessera/contracts 的桌面 API 方法、频道、参数和返回值关联，以及宿主提供的 invoke/send/subscribe 传输
 * [OUTPUT]: 平台无关的 DesktopApiTransport 契约、规范化可选参数与冻结的完整 DesktopApi
 * [POS]: Electron preload、Tauri bridge 等桌面宿主共同复用的窄接口组装层
 * [DOC]: docs/architecture/tauri-parity.md、docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  DesktopApi,
  DesktopApiArguments,
  DesktopApiChannel,
  DesktopApiMethodByChannel,
  DesktopApiMethodByKind,
  DesktopApiReturn,
} from "@tessera/contracts"
import { IPC_CHANNELS } from "@tessera/contracts"

type InvokeMethod = DesktopApiMethodByKind<"invoke">
type InvokeChannel = DesktopApiChannel<InvokeMethod>
type InvokeMethodFor<Channel extends InvokeChannel> = DesktopApiMethodByChannel<Channel, "invoke">

type SendMethod = DesktopApiMethodByKind<"send">
type SendChannel = DesktopApiChannel<SendMethod>
type SendMethodFor<Channel extends SendChannel> = DesktopApiMethodByChannel<Channel, "send">

type SubscribeMethod = DesktopApiMethodByKind<"subscribe">
type SubscribeChannel = DesktopApiChannel<SubscribeMethod>
type SubscribeMethodFor<Channel extends SubscribeChannel> = DesktopApiMethodByChannel<Channel, "subscribe">
type SubscribeListener<Channel extends SubscribeChannel> = DesktopApiArguments<SubscribeMethodFor<Channel>>[0]

export type DesktopApiTransport = Readonly<{
  invoke: <const Channel extends InvokeChannel>(
    channel: Channel,
    ...arguments_: DesktopApiArguments<InvokeMethodFor<Channel>>
  ) => DesktopApiReturn<InvokeMethodFor<Channel>>
  send: <const Channel extends SendChannel>(
    channel: Channel,
    ...arguments_: DesktopApiArguments<SendMethodFor<Channel>>
  ) => DesktopApiReturn<SendMethodFor<Channel>>
  subscribe: <const Channel extends SubscribeChannel>(
    channel: Channel,
    listener: SubscribeListener<Channel>,
  ) => DesktopApiReturn<SubscribeMethodFor<Channel>>
}>

export function createDesktopApi(transport: DesktopApiTransport): DesktopApi {
  return Object.freeze({
    getAppInfo: () => transport.invoke(IPC_CHANNELS.appInfo),
    openAiDevtools: () => transport.invoke(IPC_CHANNELS.aiDevtoolsOpen),
    deleteAiProviderConfig: (configId) => transport.invoke(IPC_CHANNELS.aiProviderDeleteConfig, configId),
    listAiProviderConfigs: () => transport.invoke(IPC_CHANNELS.aiProviderListConfigs),
    listAiProviderModels: (input) => transport.invoke(IPC_CHANNELS.aiProviderListModels, input),
    saveAiProviderConfig: (input) => transport.invoke(IPC_CHANNELS.aiProviderSaveConfig, input),
    getResearchNetworkMode: () => transport.invoke(IPC_CHANNELS.researchNetworkGet),
    setResearchNetworkMode: (mode) => transport.invoke(IPC_CHANNELS.researchNetworkSet, mode),
    readResearchNotebook: (taskId, requestId) =>
      transport.invoke(IPC_CHANNELS.researchNotebookRead, taskId, requestId),
    saveResearchSources: (taskId, requestId, sourceIds) =>
      transport.invoke(IPC_CHANNELS.researchSourcesSave, taskId, requestId, sourceIds),
    listMcpServers: () => transport.invoke(IPC_CHANNELS.mcpServerList),
    saveMcpServer: (input) => transport.invoke(IPC_CHANNELS.mcpServerSave, input),
    deleteMcpServer: (serverId) => transport.invoke(IPC_CHANNELS.mcpServerDelete, serverId),
    testMcpServer: (serverId) => transport.invoke(IPC_CHANNELS.mcpServerTest, serverId),
    listUserSkills: () => transport.invoke(IPC_CHANNELS.userSkillList),
    installUserSkill: () => transport.invoke(IPC_CHANNELS.userSkillInstall),
    scanUserSkills: () => transport.invoke(IPC_CHANNELS.userSkillScan),
    installScannedUserSkills: (scanId, candidateIds) =>
      transport.invoke(IPC_CHANNELS.userSkillInstallScanned, scanId, candidateIds),
    setUserSkillEnabled: (skillId, enabled) =>
      transport.invoke(IPC_CHANNELS.userSkillSetEnabled, skillId, enabled),
    deleteUserSkill: (skillId) => transport.invoke(IPC_CHANNELS.userSkillDelete, skillId),
    startAiChat: (input) => transport.invoke(IPC_CHANNELS.aiChatStart, input),
    resumeAiChat: (taskId) => transport.invoke(IPC_CHANNELS.aiChatResume, taskId),
    cancelAiChat: (requestId) => transport.send(IPC_CHANNELS.aiChatCancel, requestId),
    readTaskRun: (taskId, requestId) => transport.invoke(IPC_CHANNELS.taskRunRead, taskId, requestId),
    readAgentChangePreview: (taskId, approvalId) =>
      transport.invoke(IPC_CHANNELS.agentChangePreview, taskId, approvalId),
    listRecentTasks: () => transport.invoke(IPC_CHANNELS.taskListRecent),
    listDefaultTasks: () => transport.invoke(IPC_CHANNELS.taskListDefault),
    listWorkspaceTasks: () => transport.invoke(IPC_CHANNELS.taskListWorkspace),
    listTasksPage: (request) => transport.invoke(IPC_CHANNELS.taskListPage, request),
    listTaskArtifacts: (taskId) => transport.invoke(IPC_CHANNELS.taskListArtifacts, taskId),
    readTask: (taskId) => transport.invoke(IPC_CHANNELS.taskRead, taskId),
    saveTask: (input) => transport.invoke(IPC_CHANNELS.taskSave, input),
    renameTask: (taskId, title) => transport.invoke(IPC_CHANNELS.taskRename, taskId, title),
    setTaskPinned: (taskId, pinned) => transport.invoke(IPC_CHANNELS.taskSetPinned, taskId, pinned),
    setTaskArchived: (taskId, archived) => transport.invoke(IPC_CHANNELS.taskSetArchived, taskId, archived),
    deleteTask: (taskId) => transport.invoke(IPC_CHANNELS.taskDelete, taskId),
    cancelClose: () => transport.send(IPC_CHANNELS.appCancelClose),
    confirmClose: () => transport.send(IPC_CHANNELS.appConfirmClose),
    getCurrentWorkspace: () => transport.invoke(IPC_CHANNELS.workspaceCurrent),
    openDefaultWorkspace: () => transport.invoke(IPC_CHANNELS.workspaceOpenDefault),
    getCurrentContentLibrary: () => transport.invoke(IPC_CHANNELS.contentLibraryCurrent),
    selectContentLibrary: () => transport.invoke(IPC_CHANNELS.contentLibrarySelect),
    revokeContentLibrary: () => transport.invoke(IPC_CHANNELS.contentLibraryRevoke),
    selectWorkspace: () => transport.invoke(IPC_CHANNELS.workspaceSelect),
    listRecentWorkspaces: () => transport.invoke(IPC_CHANNELS.workspaceRecent),
    openRecentWorkspace: (workspaceId) => transport.invoke(IPC_CHANNELS.workspaceOpenRecent, workspaceId),
    revealCurrentWorkspace: () => transport.invoke(IPC_CHANNELS.workspaceReveal),
    revealWorkspace: (workspaceId) => transport.invoke(IPC_CHANNELS.workspaceRevealRecent, workspaceId),
    copyWorkspacePath: (workspaceId) => transport.invoke(IPC_CHANNELS.workspaceCopyPath, workspaceId),
    removeRecentWorkspace: (workspaceId) => transport.invoke(IPC_CHANNELS.workspaceRemoveRecent, workspaceId),
    listWorkspaceDocuments: () => transport.invoke(IPC_CHANNELS.workspaceListDocuments),
    listWorkspaceDirectories: () => transport.invoke(IPC_CHANNELS.workspaceListDirectories),
    readDocument: (relativePath) => transport.invoke(IPC_CHANNELS.documentRead, relativePath),
    createDocument: (parentRelativePath) =>
      parentRelativePath === undefined
        ? transport.invoke(IPC_CHANNELS.documentCreate)
        : transport.invoke(IPC_CHANNELS.documentCreate, parentRelativePath),
    createDirectory: (parentRelativePath) =>
      parentRelativePath === undefined
        ? transport.invoke(IPC_CHANNELS.workspaceEntryCreateDirectory)
        : transport.invoke(IPC_CHANNELS.workspaceEntryCreateDirectory, parentRelativePath),
    renameDocument: (relativePath) => transport.invoke(IPC_CHANNELS.documentRename, relativePath),
    renameDirectory: (relativePath) =>
      transport.invoke(IPC_CHANNELS.workspaceEntryRenameDirectory, relativePath),
    deleteWorkspaceEntry: (relativePath, kind) =>
      transport.invoke(IPC_CHANNELS.workspaceEntryDelete, relativePath, kind),
    revealWorkspaceEntry: (relativePath) => transport.invoke(IPC_CHANNELS.workspaceEntryReveal, relativePath),
    copyWorkspaceEntryPath: (relativePath) =>
      transport.invoke(IPC_CHANNELS.workspaceEntryCopyPath, relativePath),
    writeDocument: (relativePath, content, expectedModifiedAt) =>
      transport.invoke(IPC_CHANNELS.documentWrite, relativePath, content, expectedModifiedAt),
    onAiProviderConfigsChanged: (listener) =>
      transport.subscribe(IPC_CHANNELS.aiProviderConfigsChanged, listener),
    onMcpServersChanged: (listener) => transport.subscribe(IPC_CHANNELS.mcpServersChanged, listener),
    onUserSkillsChanged: (listener) => transport.subscribe(IPC_CHANNELS.userSkillsChanged, listener),
    onAiChatEvent: (listener) => transport.subscribe(IPC_CHANNELS.aiChatEvent, listener),
    onWorkspaceChanged: (listener) => transport.subscribe(IPC_CHANNELS.workspaceChanged, listener),
    onCloseRequested: (listener) => transport.subscribe(IPC_CHANNELS.appCloseRequested, listener),
  } satisfies DesktopApi)
}
