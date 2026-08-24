/**
 * [INPUT]: 共享 DesktopApiContract、全部 IPC 频道与平台无关桌面 API factory
 * [OUTPUT]: 67 个方法的冻结、完整性、调用类型、频道、规范化参数与订阅释放函数回归测试
 * [POS]: desktop-bridge 公共映射不会遗漏或错误转发契约方法的运行时守卫
 * [DOC]: docs/architecture/tauri-parity.md、docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AiChatStreamEvent,
  DesktopApiArguments,
  DesktopApiChannel,
  DesktopApiContract,
  DesktopApiMethod,
  WorkspaceChangeEvent,
} from "@tessera/contracts"
import { IPC_CHANNELS } from "@tessera/contracts"
import { describe, expect, it, vi } from "vitest"
import { type DesktopApiTransport, createDesktopApi } from "./index"

type MethodCase<Method extends DesktopApiMethod> = {
  arguments: DesktopApiArguments<Method>
  channel: DesktopApiChannel<Method>
  kind: DesktopApiContract[Method]["kind"]
}

type CompleteMethodCases = {
  [Method in DesktopApiMethod]: MethodCase<Method>
}

const opaqueInput = { marker: "opaque-input" } as never
const noArgumentsListener = () => undefined
const aiChatEventListener = (_event: AiChatStreamEvent) => undefined
const workspaceChangedListener = (_event: WorkspaceChangeEvent) => undefined

const METHOD_CASES = {
  getAppInfo: { kind: "invoke", channel: IPC_CHANNELS.appInfo, arguments: [] },
  openAiDevtools: { kind: "invoke", channel: IPC_CHANNELS.aiDevtoolsOpen, arguments: [] },
  cancelClose: { kind: "send", channel: IPC_CHANNELS.appCancelClose, arguments: [] },
  confirmClose: { kind: "send", channel: IPC_CHANNELS.appConfirmClose, arguments: [] },
  getCurrentWorkspace: { kind: "invoke", channel: IPC_CHANNELS.workspaceCurrent, arguments: [] },
  openDefaultWorkspace: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceOpenDefault,
    arguments: [],
  },
  getCurrentContentLibrary: {
    kind: "invoke",
    channel: IPC_CHANNELS.contentLibraryCurrent,
    arguments: [],
  },
  selectContentLibrary: {
    kind: "invoke",
    channel: IPC_CHANNELS.contentLibrarySelect,
    arguments: [],
  },
  revokeContentLibrary: {
    kind: "invoke",
    channel: IPC_CHANNELS.contentLibraryRevoke,
    arguments: [],
  },
  selectWorkspace: { kind: "invoke", channel: IPC_CHANNELS.workspaceSelect, arguments: [] },
  listRecentWorkspaces: { kind: "invoke", channel: IPC_CHANNELS.workspaceRecent, arguments: [] },
  openRecentWorkspace: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceOpenRecent,
    arguments: ["workspace-id"],
  },
  revealCurrentWorkspace: { kind: "invoke", channel: IPC_CHANNELS.workspaceReveal, arguments: [] },
  revealWorkspace: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceRevealRecent,
    arguments: ["workspace-id"],
  },
  copyWorkspacePath: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceCopyPath,
    arguments: ["workspace-id"],
  },
  removeRecentWorkspace: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceRemoveRecent,
    arguments: ["workspace-id"],
  },
  listWorkspaceDocuments: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceListDocuments,
    arguments: [],
  },
  listWorkspaceDirectories: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceListDirectories,
    arguments: [],
  },
  readDocument: {
    kind: "invoke",
    channel: IPC_CHANNELS.documentRead,
    arguments: ["draft.md"],
  },
  createDocument: {
    kind: "invoke",
    channel: IPC_CHANNELS.documentCreate,
    arguments: ["notes"],
  },
  createDirectory: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceEntryCreateDirectory,
    arguments: ["notes"],
  },
  renameDocument: {
    kind: "invoke",
    channel: IPC_CHANNELS.documentRename,
    arguments: ["draft.md"],
  },
  renameDirectory: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceEntryRenameDirectory,
    arguments: ["notes"],
  },
  deleteWorkspaceEntry: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceEntryDelete,
    arguments: ["draft.md", "document"],
  },
  revealWorkspaceEntry: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceEntryReveal,
    arguments: ["draft.md"],
  },
  copyWorkspaceEntryPath: {
    kind: "invoke",
    channel: IPC_CHANNELS.workspaceEntryCopyPath,
    arguments: ["draft.md"],
  },
  writeDocument: {
    kind: "invoke",
    channel: IPC_CHANNELS.documentWrite,
    arguments: ["draft.md", "# Draft", 123],
  },
  deleteAiProviderConfig: {
    kind: "invoke",
    channel: IPC_CHANNELS.aiProviderDeleteConfig,
    arguments: ["provider-config"],
  },
  listAiProviderConfigs: {
    kind: "invoke",
    channel: IPC_CHANNELS.aiProviderListConfigs,
    arguments: [],
  },
  listAiProviderModels: {
    kind: "invoke",
    channel: IPC_CHANNELS.aiProviderListModels,
    arguments: [opaqueInput],
  },
  saveAiProviderConfig: {
    kind: "invoke",
    channel: IPC_CHANNELS.aiProviderSaveConfig,
    arguments: [opaqueInput],
  },
  getResearchNetworkMode: {
    kind: "invoke",
    channel: IPC_CHANNELS.researchNetworkGet,
    arguments: [],
  },
  setResearchNetworkMode: {
    kind: "invoke",
    channel: IPC_CHANNELS.researchNetworkSet,
    arguments: ["direct"],
  },
  readResearchNotebook: {
    kind: "invoke",
    channel: IPC_CHANNELS.researchNotebookRead,
    arguments: ["task-id", "request-id"],
  },
  saveResearchSources: {
    kind: "invoke",
    channel: IPC_CHANNELS.researchSourcesSave,
    arguments: ["task-id", "request-id", ["source-id"]],
  },
  listMcpServers: { kind: "invoke", channel: IPC_CHANNELS.mcpServerList, arguments: [] },
  saveMcpServer: {
    kind: "invoke",
    channel: IPC_CHANNELS.mcpServerSave,
    arguments: [opaqueInput],
  },
  deleteMcpServer: {
    kind: "invoke",
    channel: IPC_CHANNELS.mcpServerDelete,
    arguments: ["server-id"],
  },
  testMcpServer: {
    kind: "invoke",
    channel: IPC_CHANNELS.mcpServerTest,
    arguments: ["server-id"],
  },
  listUserSkills: { kind: "invoke", channel: IPC_CHANNELS.userSkillList, arguments: [] },
  installUserSkill: { kind: "invoke", channel: IPC_CHANNELS.userSkillInstall, arguments: [] },
  scanUserSkills: { kind: "invoke", channel: IPC_CHANNELS.userSkillScan, arguments: [] },
  installScannedUserSkills: {
    kind: "invoke",
    channel: IPC_CHANNELS.userSkillInstallScanned,
    arguments: ["scan-id", ["candidate-id"]],
  },
  setUserSkillEnabled: {
    kind: "invoke",
    channel: IPC_CHANNELS.userSkillSetEnabled,
    arguments: ["user:writing", true],
  },
  deleteUserSkill: {
    kind: "invoke",
    channel: IPC_CHANNELS.userSkillDelete,
    arguments: ["user:writing"],
  },
  startAiChat: { kind: "invoke", channel: IPC_CHANNELS.aiChatStart, arguments: [opaqueInput] },
  resumeAiChat: {
    kind: "invoke",
    channel: IPC_CHANNELS.aiChatResume,
    arguments: ["task-id"],
  },
  cancelAiChat: {
    kind: "send",
    channel: IPC_CHANNELS.aiChatCancel,
    arguments: ["request-id"],
  },
  readTaskRun: {
    kind: "invoke",
    channel: IPC_CHANNELS.taskRunRead,
    arguments: ["task-id", "request-id"],
  },
  readAgentChangePreview: {
    kind: "invoke",
    channel: IPC_CHANNELS.agentChangePreview,
    arguments: ["task-id", "approval-id"],
  },
  listRecentTasks: { kind: "invoke", channel: IPC_CHANNELS.taskListRecent, arguments: [] },
  listDefaultTasks: { kind: "invoke", channel: IPC_CHANNELS.taskListDefault, arguments: [] },
  listWorkspaceTasks: { kind: "invoke", channel: IPC_CHANNELS.taskListWorkspace, arguments: [] },
  listTasksPage: {
    kind: "invoke",
    channel: IPC_CHANNELS.taskListPage,
    arguments: [opaqueInput],
  },
  listTaskArtifacts: {
    kind: "invoke",
    channel: IPC_CHANNELS.taskListArtifacts,
    arguments: ["task-id"],
  },
  readTask: { kind: "invoke", channel: IPC_CHANNELS.taskRead, arguments: ["task-id"] },
  saveTask: { kind: "invoke", channel: IPC_CHANNELS.taskSave, arguments: [opaqueInput] },
  renameTask: {
    kind: "invoke",
    channel: IPC_CHANNELS.taskRename,
    arguments: ["task-id", "New title"],
  },
  setTaskPinned: {
    kind: "invoke",
    channel: IPC_CHANNELS.taskSetPinned,
    arguments: ["task-id", true],
  },
  setTaskArchived: {
    kind: "invoke",
    channel: IPC_CHANNELS.taskSetArchived,
    arguments: ["task-id", true],
  },
  deleteTask: { kind: "invoke", channel: IPC_CHANNELS.taskDelete, arguments: ["task-id"] },
  onAiProviderConfigsChanged: {
    kind: "subscribe",
    channel: IPC_CHANNELS.aiProviderConfigsChanged,
    arguments: [noArgumentsListener],
  },
  onMcpServersChanged: {
    kind: "subscribe",
    channel: IPC_CHANNELS.mcpServersChanged,
    arguments: [noArgumentsListener],
  },
  onUserSkillsChanged: {
    kind: "subscribe",
    channel: IPC_CHANNELS.userSkillsChanged,
    arguments: [noArgumentsListener],
  },
  onAiChatEvent: {
    kind: "subscribe",
    channel: IPC_CHANNELS.aiChatEvent,
    arguments: [aiChatEventListener],
  },
  onWorkspaceChanged: {
    kind: "subscribe",
    channel: IPC_CHANNELS.workspaceChanged,
    arguments: [workspaceChangedListener],
  },
  onCloseRequested: {
    kind: "subscribe",
    channel: IPC_CHANNELS.appCloseRequested,
    arguments: [noArgumentsListener],
  },
} satisfies CompleteMethodCases

type TransportCall = {
  arguments: unknown[]
  channel: string
  kind: "invoke" | "send" | "subscribe"
}

describe("createDesktopApi", () => {
  it("冻结并完整暴露契约中的每个桌面方法", () => {
    const api = createDesktopApi({
      invoke: (() => Promise.resolve(undefined)) as DesktopApiTransport["invoke"],
      send: (() => undefined) as DesktopApiTransport["send"],
      subscribe: (() => () => undefined) as DesktopApiTransport["subscribe"],
    })

    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.keys(api).sort()).toEqual(Object.keys(METHOD_CASES).sort())
    expect(Object.keys(api)).toHaveLength(67)
  })

  it("逐项把准确的调用类型、频道和参数转发给宿主传输", async () => {
    const calls: TransportCall[] = []
    const unsubscribe = vi.fn()
    const transport: DesktopApiTransport = {
      invoke: ((channel: string, ...arguments_: unknown[]) => {
        calls.push({ kind: "invoke", channel, arguments: arguments_ })
        return Promise.resolve(undefined)
      }) as DesktopApiTransport["invoke"],
      send: ((channel: string, ...arguments_: unknown[]) => {
        calls.push({ kind: "send", channel, arguments: arguments_ })
      }) as DesktopApiTransport["send"],
      subscribe: ((channel: string, listener: unknown) => {
        calls.push({ kind: "subscribe", channel, arguments: [listener] })
        return unsubscribe
      }) as DesktopApiTransport["subscribe"],
    }
    const api = createDesktopApi(transport)

    for (const method of Object.keys(METHOD_CASES) as DesktopApiMethod[]) {
      const expected = METHOD_CASES[method]
      calls.length = 0
      const result = Reflect.apply(api[method], undefined, expected.arguments)
      if (expected.kind === "invoke") await result

      expect(calls, method).toEqual([
        {
          kind: expected.kind,
          channel: expected.channel,
          arguments: expected.arguments,
        },
      ])
      if (expected.kind === "subscribe") expect(result, method).toBe(unsubscribe)
    }
  })

  it("省略可选父目录时不跨宿主发送 undefined 占位", async () => {
    const calls: TransportCall[] = []
    const api = createDesktopApi({
      invoke: ((channel: string, ...arguments_: unknown[]) => {
        calls.push({ kind: "invoke", channel, arguments: arguments_ })
        return Promise.resolve(undefined)
      }) as DesktopApiTransport["invoke"],
      send: (() => undefined) as DesktopApiTransport["send"],
      subscribe: (() => () => undefined) as DesktopApiTransport["subscribe"],
    })

    await api.createDocument()
    await api.createDirectory()

    expect(calls).toEqual([
      { kind: "invoke", channel: IPC_CHANNELS.documentCreate, arguments: [] },
      { kind: "invoke", channel: IPC_CHANNELS.workspaceEntryCreateDirectory, arguments: [] },
    ])
  })
})
