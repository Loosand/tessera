/**
 * [INPUT]: Electron 生命周期、共享 IPC 契约、主进程工作区文件服务、AI Chat/Agent/Skill 配置、AI SDK 开发期日志、用户 Skill 扫描安装服务、研究网络偏好、历史研究数据、混合内容库、旧 Agent 变更兼容服务、模型服务与 safeStorage
 * [OUTPUT]: 可选系统代理/直连的无状态 Web Reader、历史研究笔记与来源保存、直接文件/Bash 事件后的 Artifact 登记、带压缩 marker 的 ContextManifest 持久化、工具唯一终态与 run terminal 后无迟到事件、顺序安全的流增量合并、默认空间/工作区恢复与任务分页、read/edit/write/受控 bash 工作区与 MCP Agent 工具、托管内容库/Artifact 查询、内置/用户 Skill 校验后的 SQLite 可恢复后台 AI 运行、版本化公开错误与脱敏运行解释、官方 AI SDK 日志入口、旧 Diff 兼容/MCP 审批、持久化研究/AI/MCP/用户 Skill 配置与扫描会话、关闭保存握手和满高桌面窗口
 * [POS]: Electron 主进程入口与平台安全边界
 * [DOC]: docs/architecture.md、docs/architecture/agent-run-reliability.md、docs/architecture/agent-simplification-roadmap.md、docs/architecture/ai-providers.md、docs/architecture/ai-observability.md、docs/architecture/database.md、docs/architecture/mcp.md、docs/architecture/research-workflow.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { createHash } from "node:crypto"
import { type FSWatcher, realpathSync, statSync, watch } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AiProviderConfigError,
  AiProviderConnectionError,
  PublicAgentToolError,
  type TaskAgentRunMetrics,
  type WebAgentTools,
  listAiProviderModels,
  streamAiAgent,
} from "@tessera/ai/server"
import {
  type AiChatStartInput,
  type AiChatStreamChunk,
  type AiChatStreamEvent,
  type AiProviderId,
  IPC_CHANNELS,
  type ResearchNetworkMode,
  type TaskRunErrorDataV1,
  type TaskRunResourceSummary,
  type TaskToolMessagePart,
  type WorkspaceEntryKind,
  type WorkspaceInfo,
  isAiProviderId,
} from "@tessera/contracts"
import {
  type DatabaseClient,
  appendTaskRunEvent,
  findAppSetting,
  findTaskRun,
  findWorkspaceById,
  finishTaskRun,
  hideRecentWorkspace,
  listRecentWorkspaces,
  openDatabase,
  saveTaskResourceBinding,
  saveWorkspace,
  startTaskRun,
  updateTaskRunResourceSummary,
  upsertAppSetting,
} from "@tessera/database"
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type WebContents,
  app,
  clipboard,
  dialog,
  safeStorage,
  screen,
  shell,
} from "electron"
import { AgentChangeError, type AgentChangeService, createAgentChangeService } from "./agent-change-service"
import { AgentRunEventLedger } from "./agent-run-event-ledger"
import { AiChatChunkCoalescer, coalesceAiChatEvents } from "./ai-chat-chunk-coalescer"
import { classifyTaskRunError, classifyTaskToolError } from "./ai-chat-error"
import { parseAiChatStreamEvent } from "./ai-chat-event"
import { registerAiSdkDevtools, startAiSdkDevtoolsViewer, stopAiSdkDevtoolsViewer } from "./ai-devtools"
import { type DesktopAiService, createDesktopAiService } from "./ai-service"
import { createElectronResearchReader } from "./browser-research-reader"
import {
  ContentLibraryError,
  type ContentLibraryService,
  createContentLibraryService,
} from "./content-library-service"
import { handleDesktopInvoke, onDesktopSend } from "./ipc-contract"
import { McpConfigError, type McpService, createMcpService } from "./mcp-service"
import {
  DEFAULT_RESEARCH_NETWORK_MODE,
  readResearchNetworkMode,
  saveResearchNetworkMode,
} from "./research-network-settings"
import { readResearchNotebook } from "./research-service"
import { saveResearchSourceSelection } from "./research-source-save-service"
import { readAgentMarkdownFile } from "./read-only-agent-tools"
import { inspectTaskRun } from "./task-run-inspection"
import { findUnpersistedLatestTaskRun, recoverInterruptedTaskRuns } from "./task-run-recovery"
import { type DesktopTaskService, createDesktopTaskService } from "./task-service"
import { createWorkspaceAgentTools } from "./workspace-agent-tools"
import { createWorkspaceExecutionEnvironment } from "./workspace-execution-environment"
import { UserSkillError, type UserSkillService, createUserSkillService } from "./user-skill-service"
import {
  createDirectory,
  createDocument,
  isIgnoredWorkspaceEntryName,
  isMarkdownPath,
  listMarkdownDocuments,
  listWorkspaceDirectories,
  readDocument,
  renameDirectory,
  renameDocument,
  resolveWorkspacePath,
  writeDocument,
} from "./workspace-file-service"

const APP_USER_MODEL_ID = "com.tessera.desktop"
const MAIN_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const WORKSPACE_CHANGE_DEBOUNCE_MS = 120
const LAST_ACTIVE_SPACE_SETTING_KEY = "workspace.last-active-space.v1"
const DEFAULT_SPACE_SETTING_VALUE = "default"

type WorkspaceSession = {
  workspace: WorkspaceInfo
  watcher: FSWatcher
  pendingPaths: Set<string>
  changeTimer: NodeJS.Timeout | null
}

const activeWorkspaces = new Map<number, WorkspaceSession>()
const approvedWindowCloseIds = new Set<number>()
const requestedWindowCloseIds = new Set<number>()
let databaseClient: DatabaseClient | null = null
let desktopAiService: DesktopAiService | null = null
let desktopTaskService: DesktopTaskService | null = null
let agentChangeService: AgentChangeService | null = null
let mcpService: McpService | null = null
let userSkillService: UserSkillService | null = null
let contentLibraryService: ContentLibraryService | null = null
let appQuitApproved = false
let appQuitRequested = false

type ActiveAiChat = {
  active: boolean
  abortController: AbortController
  configId: string
  events: AiChatStreamEvent[]
  modelId: string
  providerId: AiProviderId
  requestId: string
  retentionTimer: NodeJS.Timeout | null
  taskId: string
  webContentsId: number
}

const activeAiChats = new Map<string, ActiveAiChat>()
const aiChatRunsByTask = new Map<string, ActiveAiChat>()
const AI_CHAT_RUN_RETENTION_MS = 30 * 60 * 1000

function releaseAiChatRun(run: ActiveAiChat) {
  if (run.retentionTimer) clearTimeout(run.retentionTimer)
  if (activeAiChats.get(run.requestId) === run) activeAiChats.delete(run.requestId)
  if (aiChatRunsByTask.get(run.taskId) === run) aiChatRunsByTask.delete(run.taskId)
}

function requireDesktopAiService(): DesktopAiService {
  if (!desktopAiService) throw new AiProviderConfigError("AI 服务尚未就绪。")
  return desktopAiService
}

function requireDesktopTaskService(): DesktopTaskService {
  if (!desktopTaskService) throw new Error("任务服务尚未就绪。")
  return desktopTaskService
}

function requireAgentChangeService(): AgentChangeService {
  if (!agentChangeService) throw new Error("Agent 变更服务尚未就绪。")
  return agentChangeService
}

function requireMcpService(): McpService {
  if (!mcpService) throw new McpConfigError("MCP 服务尚未就绪。")
  return mcpService
}

function requireUserSkillService(): UserSkillService {
  if (!userSkillService) throw new UserSkillError("用户 Skill 服务尚未就绪。")
  return userSkillService
}

function requireContentLibraryService(): ContentLibraryService {
  if (!contentLibraryService) throw new ContentLibraryError("内容库服务尚未就绪。", "library-unavailable")
  return contentLibraryService
}

function requireDatabaseClient(): DatabaseClient {
  if (!databaseClient) throw new Error("本地数据库尚未就绪。")
  return databaseClient
}

function notifyAiProviderConfigsChanged() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.aiProviderConfigsChanged)
  }
}

function notifyMcpServersChanged() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.mcpServersChanged)
  }
}

function notifyUserSkillsChanged() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.userSkillsChanged)
  }
}

function resolveAiChatInput(input: AiChatStartInput) {
  if (!input?.requestId || input.requestId.length > 128 || !/^[\w-]+$/u.test(input.requestId)) {
    throw new AiProviderConfigError("对话请求 ID 无效。")
  }
  if (
    input.continueFromMessageId &&
    (input.continueFromMessageId.length > 512 || !input.continueFromMessageId.trim())
  ) {
    throw new AiProviderConfigError("续跑消息 ID 无效。")
  }
  if (input.continueFromMessageId) {
    const continuation = input.messages.at(-1)
    const completedToolCount = continuation?.parts.filter((part) => {
      if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) return false
      const toolPart = part as TaskToolMessagePart
      return toolPart.state === "output-available" && toolPart.preliminary !== true
    }).length
    const retryableFailure = continuation?.parts.some(
      (part) => part.type === "data-task-error" && part.data.retryable,
    )
    const isRegenerationContinuation = input.regenerateMessageId === input.continueFromMessageId
    if (
      continuation?.id !== input.continueFromMessageId ||
      continuation.role !== "assistant" ||
      !completedToolCount ||
      (!retryableFailure && !isRegenerationContinuation)
    ) {
      throw new AiProviderConfigError("续跑消息没有可复用的已完成工具结果。")
    }
  }
  if (
    input.resumeResearchRequestId &&
    (input.resumeResearchRequestId.length > 128 || !/^[\w-]+$/u.test(input.resumeResearchRequestId))
  ) {
    throw new AiProviderConfigError("续研请求 ID 无效。")
  }
  if (
    input.regenerateMessageId &&
    (input.regenerateMessageId.length > 512 || !input.regenerateMessageId.trim())
  ) {
    throw new AiProviderConfigError("重新生成消息 ID 无效。")
  }
  if (
    input.currentDocumentPath &&
    (input.currentDocumentPath.length > 1_024 ||
      isAbsolute(input.currentDocumentPath) ||
      input.currentDocumentPath.replaceAll("\\", "/").split("/").includes(".."))
  ) {
    throw new AiProviderConfigError("当前文档路径无效。")
  }
  return requireDesktopAiService().resolveChatInput(input)
}

function summarizeTaskRunResources(
  input: AiChatStartInput,
  workspace: WorkspaceInfo | null,
  researchNetworkMode: ResearchNetworkMode | null,
  resumedResearchRequestId: string | null,
): TaskRunResourceSummary {
  return {
    attachmentCount: input.messages.reduce(
      (count, message) => count + message.parts.filter((part) => part.type === "file").length,
      0,
    ),
    continuedFromMessageId: input.continueFromMessageId ?? null,
    currentDocumentPath: workspace ? (input.currentDocumentPath ?? null) : null,
    researchNetworkMode,
    resumedResearchRequestId,
    workspaceId: workspace?.id ?? null,
    workspaceName: workspace?.name ?? null,
  }
}

function recordTaskRunResourceBindings(
  client: DatabaseClient,
  input: AiChatStartInput,
  workspace: WorkspaceInfo | null,
) {
  const saveBinding = (
    resourceType: "attachment" | "document" | "project",
    resourceId: string,
    role: "context" | "scope",
  ) => {
    const id = createHash("sha256")
      .update([input.taskId, input.requestId, resourceType, resourceId, role].join("\0"))
      .digest("hex")
    saveTaskResourceBinding(client, {
      id,
      taskId: input.taskId,
      runId: input.requestId,
      resourceType,
      resourceId,
      role,
    })
  }

  if (workspace) saveBinding("project", workspace.id, "scope")
  if (workspace && input.currentDocumentPath) {
    const documentId = createHash("sha256")
      .update(`${workspace.id}\0${input.currentDocumentPath}`)
      .digest("hex")
    saveBinding("document", documentId, "context")
  }
  for (const message of input.messages) {
    for (const part of message.parts) {
      if (part.type !== "file") continue
      const attachmentId = createHash("sha256")
        .update([part.mediaType, part.filename ?? "", part.url].join("\0"))
        .digest("hex")
      saveBinding("attachment", attachmentId, "context")
    }
  }
}

function taskRunCompletion(
  metrics: TaskAgentRunMetrics | null,
  lastType: AiChatStreamChunk["type"] | undefined,
  durationMs: number,
) {
  const completed = lastType === "finish"
  return {
    sdkCallId: metrics?.callId ?? null,
    finishReason: completed ? (metrics?.finishReason ?? null) : lastType === "abort" ? "cancelled" : "error",
    rawFinishReason: completed ? (metrics?.rawFinishReason ?? null) : null,
    inputTokens: metrics?.inputTokens ?? null,
    cacheReadTokens: metrics?.cacheReadTokens ?? null,
    cacheWriteTokens: metrics?.cacheWriteTokens ?? null,
    outputTokens: metrics?.outputTokens ?? null,
    reasoningTokens: metrics?.reasoningTokens ?? null,
    totalTokens: metrics?.totalTokens ?? null,
    stepCount: metrics?.stepCount ?? null,
    toolCallCount: metrics?.toolCallCount ?? null,
    timeToFirstOutputMs: metrics?.timeToFirstOutputMs ?? null,
    modelDurationMs: metrics?.modelDurationMs ?? null,
    toolDurationMs: metrics?.toolDurationMs ?? null,
    durationMs,
  }
}

async function streamAiTask(
  input: ReturnType<typeof resolveAiChatInput>,
  workspace: WorkspaceInfo | null,
  options: Pick<
    Parameters<typeof streamAiAgent>[1],
    "abortSignal" | "onChunk" | "onContextManifest" | "onRunMetrics" | "skill" | "webTools"
  >,
) {
  const contentService = requireContentLibraryService()
  const executionEnvironment = workspace
    ? await createWorkspaceExecutionEnvironment(workspace.rootPath)
    : null
  const workspaceTools = workspace
    ? createWorkspaceAgentTools({
        ...(executionEnvironment ? { executionEnvironment } : {}),
        rootPath: workspace.rootPath,
        onMutation: (mutation) => {
          contentService.recordWorkspaceFileArtifact(
            { taskId: input.taskId, runId: input.requestId },
            workspace.id,
            mutation,
          )
        },
        onCommandFilesChanged: async (paths) => {
          for (const path of paths) {
            if (!isMarkdownPath(path)) continue
            try {
              const document = await readAgentMarkdownFile(
                workspace.rootPath,
                path,
                new AbortController().signal,
              )
              contentService.recordWorkspaceFileArtifact(
                { taskId: input.taskId, runId: input.requestId },
                workspace.id,
                {
                  contentHash: document.contentHash,
                  modifiedAt: document.modifiedAt,
                  operation: "update",
                  path: document.path,
                  status: "saved",
                },
              )
            } catch {
              // 只从真实文件事件登记可读 Markdown；删除、超限或瞬时路径不猜测为 Artifact。
            }
          }
        },
      })
    : null
  const externalTools = await requireMcpService().createAgentTools(options.abortSignal)
  return streamAiAgent(input, {
    ...options,
    externalTools,
    ...(workspace && workspaceTools
      ? {
          workspaceName: workspace.name,
          tools: workspaceTools,
        }
      : {}),
  })
}

function aiChatErrorChunk(failure: TaskRunErrorDataV1): AiChatStreamChunk {
  return { type: "error", errorText: failure.message, failure }
}

function normalizeAiChatErrorChunk(chunk: AiChatStreamChunk): AiChatStreamChunk {
  if (chunk.type !== "error" || chunk.failure) return chunk
  return aiChatErrorChunk(classifyTaskRunError(chunk.errorText, "stream"))
}

function normalizeAiChatToolErrorChunk(chunk: AiChatStreamChunk, knownToolName?: string): AiChatStreamChunk {
  if (chunk.type === "tool-input-error" && !chunk.failure) {
    return {
      ...chunk,
      failure: classifyTaskToolError(chunk.errorText, chunk.toolCallId, chunk.toolName),
    }
  }
  if (chunk.type === "tool-output-error" && !chunk.failure) {
    return {
      ...chunk,
      failure: classifyTaskToolError(chunk.errorText, chunk.toolCallId, knownToolName ?? "unknown-tool"),
    }
  }
  return chunk
}

function abortAiChatsForWebContents(webContentsId: number) {
  for (const chat of activeAiChats.values()) {
    if (chat.webContentsId !== webContentsId) continue
    chat.abortController.abort("窗口已关闭")
    releaseAiChatRun(chat)
  }
}

function isSafeExternalUrl(value: string) {
  try {
    const protocol = new URL(value).protocol
    return protocol === "https:" || protocol === "http:"
  } catch {
    return false
  }
}

function workspaceId(rootPath: string) {
  return createHash("sha256").update(rootPath).digest("hex").slice(0, 16)
}

function workspaceForEvent(event: IpcMainInvokeEvent) {
  const session = activeWorkspaces.get(event.sender.id)
  if (!session) throw new Error("请先打开一个工作区。")
  return session.workspace
}

function closeWorkspaceSession(webContentsId: number) {
  const session = activeWorkspaces.get(webContentsId)
  if (!session) return
  if (session.changeTimer) clearTimeout(session.changeTimer)
  session.watcher.close()
  activeWorkspaces.delete(webContentsId)
}

function requestWindowClose(window: BrowserWindow) {
  const webContentsId = window.webContents.id
  if (window.webContents.isDestroyed()) return
  if (window.webContents.isLoadingMainFrame()) {
    approvedWindowCloseIds.add(webContentsId)
    window.close()
    return
  }
  if (requestedWindowCloseIds.has(webContentsId)) return
  requestedWindowCloseIds.add(webContentsId)
  window.webContents.send(IPC_CHANNELS.appCloseRequested)
}

function shouldReportWorkspacePath(relativePath: string) {
  return !relativePath.split("/").some((part) => !part || isIgnoredWorkspaceEntryName(part))
}

function installWorkspaceSession(webContents: WebContents, workspace: WorkspaceInfo) {
  closeWorkspaceSession(webContents.id)

  const pendingPaths = new Set<string>()
  const session: WorkspaceSession = {
    workspace,
    pendingPaths,
    changeTimer: null,
    watcher: watch(workspace.rootPath, { recursive: true }, (_eventType, fileName) => {
      if (!fileName || webContents.isDestroyed()) return
      const relativePath = fileName.toString().split("\\").join("/")
      if (!shouldReportWorkspacePath(relativePath)) return

      pendingPaths.add(relativePath)
      if (session.changeTimer) clearTimeout(session.changeTimer)
      session.changeTimer = setTimeout(() => {
        session.changeTimer = null
        if (webContents.isDestroyed() || pendingPaths.size === 0) return
        webContents.send(IPC_CHANNELS.workspaceChanged, { paths: [...pendingPaths] })
        pendingPaths.clear()
      }, WORKSPACE_CHANGE_DEBOUNCE_MS)
    }),
  }

  session.watcher.on("error", (error) => {
    console.warn("工作区文件监听已停止。", error)
  })
  activeWorkspaces.set(webContents.id, session)
}

function persistWorkspace(workspace: WorkspaceInfo) {
  if (!databaseClient) return
  saveWorkspace(databaseClient, {
    id: workspace.id,
    rootPath: workspace.rootPath,
    displayName: workspace.name,
    lastOpenedAt: new Date(),
  })
  upsertAppSetting(databaseClient, {
    key: LAST_ACTIVE_SPACE_SETTING_KEY,
    value: workspace.id,
    updatedAt: new Date(),
  })
}

function persistDefaultSpace() {
  if (!databaseClient) return
  upsertAppSetting(databaseClient, {
    key: LAST_ACTIVE_SPACE_SETTING_KEY,
    value: DEFAULT_SPACE_SETTING_VALUE,
    updatedAt: new Date(),
  })
}

function workspaceFromRecord(record: {
  id: string
  rootPath: string
  displayName: string
}): WorkspaceInfo | null {
  try {
    const rootPath = realpathSync(record.rootPath)
    if (!statSync(rootPath).isDirectory()) return null
    return { id: record.id, name: record.displayName, rootPath }
  } catch {
    return null
  }
}

function restoreLastActiveWorkspace(): WorkspaceInfo | null {
  if (!databaseClient) return null
  const workspaceId = findAppSetting(databaseClient, LAST_ACTIVE_SPACE_SETTING_KEY)?.value
  if (!workspaceId || workspaceId === DEFAULT_SPACE_SETTING_VALUE) return null
  const record = findWorkspaceById(databaseClient, workspaceId)
  const workspace = record ? workspaceFromRecord(record) : null
  if (!workspace) persistDefaultSpace()
  return workspace
}

async function deleteWorkspaceEntry(
  window: BrowserWindow | null,
  rootPath: string,
  relativePath: string,
  kind: WorkspaceEntryKind,
) {
  const absolutePath = await resolveWorkspacePath(rootPath, relativePath)
  const metadata = await stat(absolutePath)
  if (kind === "document" && (!metadata.isFile() || !isMarkdownPath(absolutePath))) {
    throw new Error("目标不是可删除的 Markdown 文档。")
  }
  if (kind === "directory" && !metadata.isDirectory()) throw new Error("目标不是可删除的文件夹。")

  const options = {
    type: "warning",
    title: kind === "directory" ? "删除文件夹" : "删除文档",
    message: `要将“${basename(absolutePath)}”移到废纸篓吗？`,
    detail: kind === "directory" ? "文件夹内的内容也会一并移到废纸篓。" : "可以稍后从废纸篓恢复。",
    buttons: ["移到废纸篓", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  } satisfies Electron.MessageBoxOptions
  const selection = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  if (selection.response !== 0) return false

  await shell.trashItem(absolutePath)
  return true
}

function registerIpcHandlers() {
  const getAppInfo = async () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    runtime: "electron" as const,
  })

  handleDesktopInvoke(IPC_CHANNELS.appInfo, getAppInfo)
  handleDesktopInvoke(IPC_CHANNELS.aiDevtoolsOpen, async () => {
    try {
      const url = await startAiSdkDevtoolsViewer()
      await shell.openExternal(url)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "打开 AI 运行日志失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.aiProviderListConfigs, () => requireDesktopAiService().listConfigs())
  handleDesktopInvoke(IPC_CHANNELS.researchNetworkGet, () => readResearchNetworkMode(requireDatabaseClient()))
  handleDesktopInvoke(IPC_CHANNELS.researchNetworkSet, (_event, mode) =>
    saveResearchNetworkMode(requireDatabaseClient(), mode),
  )
  handleDesktopInvoke(IPC_CHANNELS.researchNotebookRead, (_event, taskId, requestId) =>
    readResearchNotebook(requireDatabaseClient(), taskId, requestId),
  )
  handleDesktopInvoke(IPC_CHANNELS.researchSourcesSave, async (_event, taskId, requestId, sourceIds) => {
    return saveResearchSourceSelection(requireDatabaseClient(), requireContentLibraryService(), {
      taskId,
      requestId,
      sourceIds,
    })
  })
  handleDesktopInvoke(IPC_CHANNELS.aiProviderSaveConfig, (_event, input) => {
    try {
      const config = requireDesktopAiService().saveConfig(input)
      notifyAiProviderConfigsChanged()
      return { ok: true, config }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof AiProviderConfigError ? error.message : "保存供应商配置失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.aiProviderDeleteConfig, (_event, configId) => {
    try {
      requireDesktopAiService().deleteConfig(configId)
      notifyAiProviderConfigsChanged()
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof AiProviderConfigError ? error.message : "删除供应商配置失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.aiProviderListModels, async (_event, input) => {
    try {
      const connection = requireDesktopAiService().resolveDiscoveryConnection(input)
      return { ok: true, models: await listAiProviderModels(connection) }
    } catch (error) {
      return {
        ok: false,
        ...(error instanceof AiProviderConnectionError ? { code: error.code } : {}),
        error:
          error instanceof AiProviderConnectionError || error instanceof AiProviderConfigError
            ? error.message
            : "请求供应商模型列表失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.mcpServerList, () => requireMcpService().listServers())
  handleDesktopInvoke(IPC_CHANNELS.mcpServerSave, async (_event, input) => {
    try {
      return { ok: true, server: await requireMcpService().saveServer(input) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof McpConfigError ? error.message : "保存 MCP 服务器失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.mcpServerDelete, async (_event, serverId) => {
    try {
      await requireMcpService().deleteServer(serverId)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof McpConfigError ? error.message : "删除 MCP 服务器失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.mcpServerTest, async (_event, serverId) => {
    try {
      const result = await requireMcpService().testServer(serverId)
      return { ok: true, ...result }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof McpConfigError ? error.message : "检测 MCP 服务器失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.userSkillList, () => requireUserSkillService().list())
  handleDesktopInvoke(IPC_CHANNELS.userSkillInstall, async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        title: "选择 Skill 文件夹",
        buttonLabel: "导入",
        properties: ["openDirectory"],
      }
      const selection = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      const selectedPath = selection.filePaths[0]
      if (selection.canceled || !selectedPath) return { ok: true, skill: null }
      return { ok: true, skill: await requireUserSkillService().install(selectedPath) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof UserSkillError ? error.message : "导入 Skill 失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.userSkillScan, async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        title: "选择要扫描的 Skill 根目录",
        buttonLabel: "扫描",
        properties: ["openDirectory"],
      }
      const selection = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      const selectedPath = selection.filePaths[0]
      if (selection.canceled || !selectedPath) return { ok: true, scan: null }
      return { ok: true, scan: await requireUserSkillService().scan(selectedPath) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof UserSkillError ? error.message : "扫描 Skill 失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.userSkillInstallScanned, async (_event, scanId, candidateIds) => {
    try {
      return {
        ok: true,
        ...(await requireUserSkillService().installScanned(scanId, candidateIds)),
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof UserSkillError ? error.message : "批量导入 Skill 失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.userSkillSetEnabled, async (_event, skillId, enabled) => {
    try {
      return { ok: true, skill: await requireUserSkillService().setEnabled(skillId, enabled) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof UserSkillError ? error.message : "更新 Skill 状态失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.userSkillDelete, async (_event, skillId) => {
    try {
      await requireUserSkillService().delete(skillId)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof UserSkillError ? error.message : "删除 Skill 失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.aiChatStart, async (event, input) => {
    let initializingRun: ActiveAiChat | null = null
    let initializingRunDatabase: DatabaseClient | null = null
    let initializingRunStartedAt: Date | null = null
    let taskRunStarted = false
    try {
      if (activeAiChats.has(input.requestId)) {
        throw new AiProviderConfigError("这个对话请求正在运行，请先停止后重试。")
      }
      const previousRun = aiChatRunsByTask.get(input.taskId)
      if (previousRun?.active) {
        throw new AiProviderConfigError("这个任务正在生成，请等待完成或先停止。")
      }
      if (previousRun) releaseAiChatRun(previousRun)
      const workspace = activeWorkspaces.get(event.sender.id)?.workspace ?? null
      requireDesktopTaskService().authorizeTurn(input.taskId, input.mode, workspace, input.skillId)
      const hasLegacyWorkspaceApproval = input.messages.some((message) =>
        message.parts.some(
          (part) =>
            part.type === "tool-write-workspace-document" &&
            part.state === "approval-responded" &&
            Boolean(part.approval),
        ),
      )
      if (workspace) {
        requireAgentChangeService().reconcileDecisions(input.taskId, input.messages)
      }
      if (hasLegacyWorkspaceApproval) {
        throw new AgentChangeError(
          "这条旧版文件审批已失效，未执行磁盘写入。请发送一条新消息，Agent 将使用 read/edit/write 重新完成修改。",
        )
      }
      if (!databaseClient) throw new AiProviderConfigError("本地任务数据库尚未就绪。")
      const runDatabase = databaseClient
      const requestedMode = workspace ? "agent" : "chat"
      const runtimeInput = resolveAiChatInput({ ...input, mode: requestedMode })
      const loadedSkill = await requireUserSkillService().load(runtimeInput.skillId)
      const resumedResearchRequestId = null
      const researchNetworkMode = runtimeInput.runPolicy.webSearch
        ? readResearchNetworkMode(runDatabase)
        : null
      const abortController = new AbortController()
      const runStartedAt = new Date()
      const webContentsId = event.sender.id
      let sequence = 0
      let runMetrics: TaskAgentRunMetrics | null = null
      const run: ActiveAiChat = {
        active: true,
        abortController,
        configId: input.configId,
        events: [],
        modelId: input.modelId,
        providerId: input.providerId,
        requestId: input.requestId,
        retentionTimer: null,
        taskId: input.taskId,
        webContentsId,
      }
      initializingRun = run
      initializingRunDatabase = runDatabase
      initializingRunStartedAt = runStartedAt
      activeAiChats.set(input.requestId, run)
      aiChatRunsByTask.set(input.taskId, run)
      let resourceSummary = summarizeTaskRunResources(
        input,
        workspace,
        researchNetworkMode,
        resumedResearchRequestId,
      )
      startTaskRun(runDatabase, {
        requestId: input.requestId,
        taskId: input.taskId,
        configId: input.configId,
        providerId: input.providerId,
        modelId: input.modelId,
        mode: runtimeInput.runPolicy.mode,
        skillId: runtimeInput.runPolicy.skillId,
        reasoning: runtimeInput.runPolicy.reasoning,
        webSearch: runtimeInput.runPolicy.webSearch,
        policyJson: JSON.stringify(runtimeInput.runPolicy),
        resourceSummaryJson: JSON.stringify(resourceSummary),
        startedAt: runStartedAt,
      })
      taskRunStarted = true
      requireDesktopTaskService().setRunStatus(input.taskId, "running")
      const webTools: WebAgentTools | undefined = runtimeInput.runPolicy.webSearch
        ? {
            readSource: async ({ url }, context) => {
              try {
                return await createElectronResearchReader(
                  researchNetworkMode ?? DEFAULT_RESEARCH_NETWORK_MODE,
                )(url, context.signal)
              } catch (error) {
                if (context.signal.aborted) throw error
                throw new PublicAgentToolError(error instanceof Error ? error.message : "网页读取失败。", {
                  cause: error,
                })
              }
            },
          }
        : undefined
      recordTaskRunResourceBindings(runDatabase, input, workspace)

      const pendingToolInputs = new Map<string, { input: unknown; toolName: string }>()
      const eventLedger = new AgentRunEventLedger()

      const persistChunk = async (incomingChunk: AiChatStreamChunk) => {
        const normalizedRunChunk = normalizeAiChatErrorChunk(incomingChunk)
        const chunk = normalizeAiChatToolErrorChunk(
          normalizedRunChunk,
          normalizedRunChunk.type === "tool-output-error"
            ? pendingToolInputs.get(normalizedRunChunk.toolCallId)?.toolName
            : undefined,
        )
        if (chunk.type === "tool-input-available") {
          pendingToolInputs.set(chunk.toolCallId, { input: chunk.input, toolName: chunk.toolName })
        }
        if (
          chunk.type === "tool-input-error" ||
          chunk.type === "tool-output-available" ||
          chunk.type === "tool-output-error" ||
          chunk.type === "tool-output-denied"
        ) {
          pendingToolInputs.delete(chunk.toolCallId)
        }
        sequence += 1
        const streamEvent: AiChatStreamEvent = {
          requestId: input.requestId,
          sequence,
          chunk,
          taskId: input.taskId,
        }
        run.events.push(streamEvent)
        appendTaskRunEvent(runDatabase, {
          requestId: input.requestId,
          sequence,
          payloadJson: JSON.stringify(streamEvent),
        })
        if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.aiChatEvent, streamEvent)
      }
      const emit = async (incomingChunk: AiChatStreamChunk) => {
        for (const chunk of eventLedger.accept(incomingChunk)) await persistChunk(chunk)
      }

      const chunkCoalescer = new AiChatChunkCoalescer(emit)
      void streamAiTask(runtimeInput, workspace, {
        abortSignal: abortController.signal,
        onChunk: (chunk) => chunkCoalescer.push(chunk),
        onContextManifest: (contextManifest) => {
          resourceSummary = { ...resourceSummary, contextManifest }
          updateTaskRunResourceSummary(runDatabase, input.requestId, JSON.stringify(resourceSummary))
        },
        onRunMetrics: (metrics) => {
          runMetrics = metrics
        },
        ...(loadedSkill ? { skill: loadedSkill } : {}),
        ...(webTools ? { webTools } : {}),
      })
        .catch(async (error) => {
          await chunkCoalescer.flush()
          const lastType = run.events.at(-1)?.chunk.type
          if (lastType === "finish" || lastType === "abort" || lastType === "error") return
          if (abortController.signal.aborted) {
            await emit({ type: "abort", reason: String(abortController.signal.reason ?? "生成已停止") })
          } else {
            await emit(aiChatErrorChunk(classifyTaskRunError(error, "stream")))
          }
        })
        .finally(() => {
          run.active = false
          const lastType = run.events.at(-1)?.chunk.type
          const awaitingUserInput = [...pendingToolInputs.values()].some(
            (pending) => pending.toolName === "request-user-input",
          )
          const taskStatus =
            lastType === "finish"
              ? awaitingUserInput
                ? "waiting-input"
                : "completed"
              : lastType === "abort"
                ? "cancelled"
                : "failed"
          finishTaskRun(
            runDatabase,
            input.requestId,
            lastType === "finish" ? "completed" : lastType === "abort" ? "cancelled" : "failed",
            taskRunCompletion(runMetrics, lastType, Math.max(0, Date.now() - runStartedAt.getTime())),
          )
          requireDesktopTaskService().setRunStatus(input.taskId, taskStatus)
          if (activeAiChats.get(input.requestId) === run) activeAiChats.delete(input.requestId)
          if (aiChatRunsByTask.get(input.taskId) !== run) return
          run.retentionTimer = setTimeout(() => releaseAiChatRun(run), AI_CHAT_RUN_RETENTION_MS)
          run.retentionTimer.unref()
        })
      initializingRun = null
      return { ok: true }
    } catch (error) {
      const failure = classifyTaskRunError(error, "start")
      if (initializingRun) {
        initializingRun.active = false
        if (taskRunStarted && initializingRunDatabase && initializingRunStartedAt) {
          try {
            const sequence = (initializingRun.events.at(-1)?.sequence ?? 0) + 1
            const streamEvent: AiChatStreamEvent = {
              requestId: initializingRun.requestId,
              taskId: initializingRun.taskId,
              sequence,
              chunk: aiChatErrorChunk(failure),
            }
            initializingRun.events.push(streamEvent)
            appendTaskRunEvent(initializingRunDatabase, {
              requestId: initializingRun.requestId,
              sequence,
              payloadJson: JSON.stringify(streamEvent),
            })
            finishTaskRun(initializingRunDatabase, initializingRun.requestId, "failed", {
              ...taskRunCompletion(
                null,
                "error",
                Math.max(0, Date.now() - initializingRunStartedAt.getTime()),
              ),
            })
            requireDesktopTaskService().setRunStatus(initializingRun.taskId, "failed")
          } catch {
            // 原始初始化异常优先返回给调用方；下次启动仍会把未收尾的运行恢复为 interrupted。
          }
        }
        releaseAiChatRun(initializingRun)
      }
      return { ok: false, error: failure }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.aiChatResume, async (event, taskId) => {
    try {
      const run = aiChatRunsByTask.get(taskId)
      if (run && run.webContentsId === event.sender.id) {
        return {
          ok: true,
          run: {
            active: run.active,
            configId: run.configId,
            events: [...run.events],
            modelId: run.modelId,
            providerId: run.providerId,
            requestId: run.requestId,
          },
        }
      }
      const task = requireDesktopTaskService().readIfExists(taskId)
      if (!task) return { ok: true, run: null }
      if (!databaseClient) return { ok: true, run: null }
      const persisted = findUnpersistedLatestTaskRun(databaseClient, task)
      if (!persisted) return { ok: true, run: null }
      if (!isAiProviderId(persisted.providerId)) throw new Error("任务使用了不支持的 AI 供应商。")
      return {
        ok: true,
        run: {
          active: persisted.status === "running",
          configId: persisted.configId ?? persisted.providerId,
          events: await coalesceAiChatEvents(
            persisted.events.map((record) => parseAiChatStreamEvent(record.payloadJson)),
          ),
          modelId: persisted.modelId,
          providerId: persisted.providerId,
          requestId: persisted.requestId,
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: classifyTaskRunError(error, "resume", "无法恢复这个任务的生成流。"),
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.agentChangePreview, (event, taskId, approvalId) => {
    const workspace = activeWorkspaces.get(event.sender.id)?.workspace ?? null
    requireDesktopTaskService().authorizeTurn(taskId, "agent", workspace)
    return requireAgentChangeService().preview(taskId, approvalId)
  })
  onDesktopSend(IPC_CHANNELS.aiChatCancel, (event, requestId) => {
    const active = activeAiChats.get(requestId)
    if (!active || active.webContentsId !== event.sender.id) return
    active.abortController.abort("用户已停止生成")
  })
  onDesktopSend(IPC_CHANNELS.appCancelClose, (event) => {
    requestedWindowCloseIds.delete(event.sender.id)
    appQuitRequested = false
  })
  onDesktopSend(IPC_CHANNELS.appConfirmClose, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || !requestedWindowCloseIds.has(event.sender.id)) return
    requestedWindowCloseIds.delete(event.sender.id)
    approvedWindowCloseIds.add(event.sender.id)
    window.close()
  })
  handleDesktopInvoke(
    IPC_CHANNELS.workspaceCurrent,
    (event) => activeWorkspaces.get(event.sender.id)?.workspace ?? null,
  )
  handleDesktopInvoke(IPC_CHANNELS.workspaceOpenDefault, (event) => {
    closeWorkspaceSession(event.sender.id)
    persistDefaultSpace()
    return null
  })
  handleDesktopInvoke(IPC_CHANNELS.contentLibraryCurrent, () => {
    try {
      return { ok: true, library: requireContentLibraryService().current() }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof ContentLibraryError ? error.message : "读取内容库设置失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.contentLibrarySelect, async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        title: "选择托管内容库",
        buttonLabel: "选择",
        properties: ["openDirectory", "createDirectory"],
      }
      const selection = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      const selectedPath = selection.filePaths[0]
      if (selection.canceled || !selectedPath) {
        return { ok: true, library: requireContentLibraryService().current() }
      }
      return { ok: true, library: await requireContentLibraryService().configure(selectedPath) }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof ContentLibraryError ? error.message : "设置内容库失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.contentLibraryRevoke, () => {
    try {
      return { ok: true, library: requireContentLibraryService().revoke() }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof ContentLibraryError ? error.message : "移除内容库授权失败。",
      }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceSelect, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: "打开工作区",
      buttonLabel: "打开",
      properties: ["openDirectory", "createDirectory"],
    }
    const selection = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const selectedPath = selection.filePaths[0]
    if (selection.canceled || !selectedPath) return null
    const rootPath = await realpath(selectedPath)

    const workspace = {
      id: workspaceId(rootPath),
      name: basename(rootPath),
      rootPath,
    } satisfies WorkspaceInfo
    installWorkspaceSession(event.sender, workspace)
    persistWorkspace(workspace)
    return workspace
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceRecent, () => {
    if (!databaseClient) return []
    return listRecentWorkspaces(databaseClient)
      .map(workspaceFromRecord)
      .filter((workspace): workspace is WorkspaceInfo => workspace !== null)
  })
  handleDesktopInvoke(IPC_CHANNELS.taskListRecent, () => {
    return requireDesktopTaskService().listRecent()
  })
  handleDesktopInvoke(IPC_CHANNELS.taskListDefault, () => {
    return requireDesktopTaskService().listDefault()
  })
  handleDesktopInvoke(IPC_CHANNELS.taskListWorkspace, (event) => {
    const workspace = workspaceForEvent(event)
    return requireDesktopTaskService().listWorkspace(workspace.id)
  })
  handleDesktopInvoke(IPC_CHANNELS.taskListPage, (event, request) => {
    const workspaceId = activeWorkspaces.get(event.sender.id)?.workspace.id ?? null
    return requireDesktopTaskService().listPage(workspaceId, request)
  })
  handleDesktopInvoke(IPC_CHANNELS.taskListArtifacts, (_event, taskId) => {
    requireDesktopTaskService().read(taskId)
    return requireContentLibraryService().listArtifacts(taskId)
  })
  handleDesktopInvoke(IPC_CHANNELS.taskRead, (_event, taskId) => {
    return requireDesktopTaskService().read(taskId)
  })
  handleDesktopInvoke(IPC_CHANNELS.taskRunRead, (_event, taskId, requestId) => {
    requireDesktopTaskService().read(taskId)
    const run = findTaskRun(requireDatabaseClient(), requestId)
    if (!run || run.taskId !== taskId) return null
    return inspectTaskRun(run)
  })
  handleDesktopInvoke(IPC_CHANNELS.taskSave, (event, input) => {
    const workspace = activeWorkspaces.get(event.sender.id)?.workspace ?? null
    const snapshot = requireDesktopTaskService().save(input, workspace)
    const run = aiChatRunsByTask.get(input.id)
    if (snapshot.status !== "running" && run && !run.active) releaseAiChatRun(run)
    return snapshot
  })
  handleDesktopInvoke(IPC_CHANNELS.taskRename, (_event, taskId, title) => {
    return requireDesktopTaskService().rename(taskId, title)
  })
  handleDesktopInvoke(IPC_CHANNELS.taskSetPinned, (_event, taskId, pinned) => {
    return requireDesktopTaskService().setPinned(taskId, pinned)
  })
  handleDesktopInvoke(IPC_CHANNELS.taskSetArchived, (_event, taskId, archived) => {
    return requireDesktopTaskService().setArchived(taskId, archived)
  })
  handleDesktopInvoke(IPC_CHANNELS.taskDelete, async (event, taskId) => {
    const taskService = requireDesktopTaskService()
    const task = taskService.read(taskId)
    const options = {
      type: "warning",
      title: "删除对话",
      message: `要删除“${task.title}”吗？`,
      detail: "该对话及其本地消息将被删除，无法恢复。",
      buttons: ["删除", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    } satisfies Electron.MessageBoxOptions
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    if (result.response !== 0) return false
    const run = aiChatRunsByTask.get(taskId)
    if (run) {
      run.abortController.abort("任务已删除")
      releaseAiChatRun(run)
    }
    return taskService.delete(taskId)
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceOpenRecent, (event, workspaceId) => {
    if (!databaseClient || !workspaceId) throw new Error("找不到这个最近工作区。")
    const record = findWorkspaceById(databaseClient, workspaceId)
    const workspace = record ? workspaceFromRecord(record) : null
    if (!workspace) throw new Error("工作区文件夹已经移动或不可访问。")
    installWorkspaceSession(event.sender, workspace)
    persistWorkspace(workspace)
    return workspace
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceReveal, (event) => {
    shell.showItemInFolder(workspaceForEvent(event).rootPath)
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceRevealRecent, (_event, workspaceId) => {
    if (!databaseClient || !workspaceId) throw new Error("找不到这个最近工作区。")
    const record = findWorkspaceById(databaseClient, workspaceId)
    const workspace = record ? workspaceFromRecord(record) : null
    if (!workspace) throw new Error("工作区文件夹已经移动或不可访问。")
    shell.showItemInFolder(workspace.rootPath)
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceCopyPath, (_event, workspaceId) => {
    if (!databaseClient || !workspaceId) throw new Error("找不到这个最近工作区。")
    const record = findWorkspaceById(databaseClient, workspaceId)
    if (!record) throw new Error("找不到这个最近工作区。")
    clipboard.writeText(record.rootPath)
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceRemoveRecent, async (event, workspaceId) => {
    if (!databaseClient || !workspaceId) throw new Error("找不到这个最近工作区。")
    const record = findWorkspaceById(databaseClient, workspaceId)
    if (!record) throw new Error("找不到这个最近工作区。")
    const options = {
      type: "question",
      title: "移除最近工作区",
      message: `要从最近列表移除“${record.displayName}”吗？`,
      detail: "不会删除工作区文件或对话；重新打开该文件夹后会再次显示。",
      buttons: ["移除", "取消"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    } satisfies Electron.MessageBoxOptions
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    return result.response === 0 ? hideRecentWorkspace(databaseClient, workspaceId) : false
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceListDocuments, async (event) => {
    const workspace = workspaceForEvent(event)
    return listMarkdownDocuments(workspace.rootPath)
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceListDirectories, async (event) => {
    const workspace = workspaceForEvent(event)
    return listWorkspaceDirectories(workspace.rootPath)
  })
  handleDesktopInvoke(IPC_CHANNELS.documentRead, async (event, relativePath) => {
    const workspace = workspaceForEvent(event)
    return readDocument(workspace.rootPath, relativePath)
  })
  handleDesktopInvoke(IPC_CHANNELS.documentCreate, async (event, parentRelativePath) => {
    const workspace = workspaceForEvent(event)
    return createDocument(workspace.rootPath, parentRelativePath)
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceEntryCreateDirectory, async (event, parentRelativePath) => {
    const workspace = workspaceForEvent(event)
    return createDirectory(workspace.rootPath, parentRelativePath)
  })
  handleDesktopInvoke(IPC_CHANNELS.documentRename, async (event, relativePath) => {
    const workspace = workspaceForEvent(event)
    const sourcePath = await resolveWorkspacePath(workspace.rootPath, relativePath)
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: "重命名文档",
      buttonLabel: "重命名",
      defaultPath: sourcePath,
      nameFieldLabel: "文件名",
      showsTagField: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      properties: ["showOverwriteConfirmation", "createDirectory", "dontAddToRecent"],
    } satisfies Electron.SaveDialogOptions
    const selection = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (selection.canceled || !selection.filePath) return null
    return renameDocument(workspace.rootPath, relativePath, selection.filePath)
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceEntryRenameDirectory, async (event, relativePath) => {
    const workspace = workspaceForEvent(event)
    const sourcePath = await resolveWorkspacePath(workspace.rootPath, relativePath)
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: "重命名文件夹",
      buttonLabel: "重命名",
      defaultPath: sourcePath,
      nameFieldLabel: "文件夹名称",
      showsTagField: false,
      properties: ["showOverwriteConfirmation", "dontAddToRecent"],
    } satisfies Electron.SaveDialogOptions
    const selection = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (selection.canceled || !selection.filePath) return null
    return renameDirectory(workspace.rootPath, relativePath, selection.filePath)
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceEntryDelete, async (event, relativePath, kind) => {
    if (kind !== "document" && kind !== "directory") throw new Error("工作区条目类型无效。")
    const workspace = workspaceForEvent(event)
    return deleteWorkspaceEntry(
      BrowserWindow.fromWebContents(event.sender),
      workspace.rootPath,
      relativePath,
      kind,
    )
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceEntryReveal, async (event, relativePath) => {
    const workspace = workspaceForEvent(event)
    shell.showItemInFolder(await resolveWorkspacePath(workspace.rootPath, relativePath))
  })
  handleDesktopInvoke(IPC_CHANNELS.workspaceEntryCopyPath, async (event, relativePath) => {
    const workspace = workspaceForEvent(event)
    clipboard.writeText(await resolveWorkspacePath(workspace.rootPath, relativePath))
  })
  handleDesktopInvoke(
    IPC_CHANNELS.documentWrite,
    async (event, relativePath, content, expectedModifiedAt) => {
      const workspace = workspaceForEvent(event)
      return writeDocument(workspace.rootPath, relativePath, content, expectedModifiedAt)
    },
  )
}

function createWindow(initialWorkspace: WorkspaceInfo | null = null) {
  const workArea = screen.getPrimaryDisplay().workArea
  const width = Math.min(1320, workArea.width)
  const window = new BrowserWindow({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y,
    width,
    height: workArea.height,
    minWidth: 520,
    minHeight: 420,
    show: false,
    backgroundColor: "#f7f7f5",
    title: "Tessera",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(MAIN_DIRECTORY, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once("ready-to-show", () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (url !== currentUrl) event.preventDefault()
  })
  const webContentsId = window.webContents.id
  window.on("close", (event) => {
    if (approvedWindowCloseIds.delete(webContentsId)) return
    event.preventDefault()
    requestWindowClose(window)
  })
  window.on("closed", () => {
    requestedWindowCloseIds.delete(webContentsId)
    approvedWindowCloseIds.delete(webContentsId)
    if (appQuitRequested && BrowserWindow.getAllWindows().length === 0) {
      appQuitApproved = true
      app.quit()
    }
  })
  if (initialWorkspace) installWorkspaceSession(window.webContents, initialWorkspace)
  window.webContents.on("destroyed", () => {
    closeWorkspaceSession(webContentsId)
    abortAiChatsForWebContents(webContentsId)
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
    return
  }
  void window.loadFile(join(MAIN_DIRECTORY, "../renderer/index.html"))
}

app.whenReady().then(async () => {
  app.setAppUserModelId(APP_USER_MODEL_ID)
  try {
    await registerAiSdkDevtools()
  } catch (error) {
    console.warn("AI SDK DevTools 注册失败。", error)
  }
  const userDataPath = app.getPath("userData")
  databaseClient = openDatabase({ path: join(userDataPath, "tessera.sqlite3") })
  desktopAiService = createDesktopAiService(databaseClient)
  desktopTaskService = createDesktopTaskService(databaseClient)
  contentLibraryService = createContentLibraryService(databaseClient)
  agentChangeService = createAgentChangeService(databaseClient)
  mcpService = createMcpService({
    client: databaseClient,
    onChanged: notifyMcpServersChanged,
    secretStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
      decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
    },
  })
  userSkillService = createUserSkillService({
    client: databaseClient,
    rootPath: userDataPath,
    onChanged: notifyUserSkillsChanged,
    trashDirectory: (path) => shell.trashItem(path),
  })
  recoverInterruptedTaskRuns(databaseClient, (taskId, status) =>
    requireDesktopTaskService().setRunStatus(taskId, status),
  )
  registerIpcHandlers()
  createWindow(restoreLastActiveWorkspace())

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(restoreLastActiveWorkspace())
  })
})

app.on("before-quit", (event) => {
  if (appQuitApproved) return
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) {
    appQuitApproved = true
    return
  }

  event.preventDefault()
  appQuitRequested = true
  for (const window of windows) requestWindowClose(window)
})

app.on("will-quit", () => {
  stopAiSdkDevtoolsViewer()
  for (const chat of activeAiChats.values()) chat.abortController.abort("应用已退出")
  for (const chat of aiChatRunsByTask.values()) releaseAiChatRun(chat)
  for (const webContentsId of activeWorkspaces.keys()) closeWorkspaceSession(webContentsId)
  void mcpService?.close()
  databaseClient?.close()
  databaseClient = null
  desktopAiService = null
  desktopTaskService = null
  agentChangeService = null
  mcpService = null
  userSkillService = null
  contentLibraryService = null
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
