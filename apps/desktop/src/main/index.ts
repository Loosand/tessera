/**
 * [INPUT]: Electron 生命周期、共享 IPC 契约、AI Chat/Agent/Skill 配置、AI SDK 开发期日志、用户 Skill 扫描安装服务、可信研究服务、混合内容库、Agent 变更服务、模型服务、safeStorage 与 Tessera 核心服务
 * [OUTPUT]: 受限研究/工作区/MCP Agent 工具、托管内容库/Artifact 查询、内置/用户 Skill 校验后的 SQLite 可恢复后台 AI 运行、官方 AI SDK 日志入口、Diff/MCP 审批、持久化研究/AI/MCP/用户 Skill 配置与扫描会话、关闭保存握手和桌面窗口
 * [POS]: Electron 主进程入口与平台安全边界
 * [DOC]: docs/architecture.md、docs/architecture/ai-providers.md、docs/architecture/ai-observability.md、docs/architecture/database.md、docs/architecture/mcp.md、docs/architecture/research-workflow.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { createHash, randomUUID } from "node:crypto"
import { type FSWatcher, realpathSync, statSync, watch } from "node:fs"
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AiProviderConfigError,
  AiProviderConnectionError,
  type ContentDomainAgentTools,
  type ResearchAgentTools,
  type TaskAgentRunMetrics,
  listAiProviderModels,
  streamAiAgent,
} from "@tessera/ai/server"
import {
  type AiChatStartInput,
  type AiChatStreamChunk,
  type AiChatStreamEvent,
  type AiProviderId,
  type DocumentSnapshot,
  type DocumentWriteResult,
  IPC_CHANNELS,
  type TaskRunResourceSummary,
  type WorkspaceDirectoryEntry,
  type WorkspaceDocumentEntry,
  type WorkspaceEntryKind,
  type WorkspaceInfo,
  isAiProviderId,
} from "@tessera/contracts"
import { createAppInfo } from "@tessera/core"
import {
  type DatabaseClient,
  appendTaskRunEvent,
  findLatestTaskRun,
  findMostRecentWorkspace,
  findWorkspaceById,
  finishTaskRun,
  hideRecentWorkspace,
  listRecentWorkspaces,
  listRunningTaskRuns,
  openDatabase,
  saveTaskResourceBinding,
  saveWorkspace,
  startTaskRun,
  startResearchRun,
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
  shell,
} from "electron"
import { AgentChangeError, type AgentChangeService, createAgentChangeService } from "./agent-change-service"
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
import { createReadonlyWorkspaceAgentTools } from "./read-only-agent-tools"
import {
  type DesktopResearchService,
  createDesktopResearchService,
  researchFinishIssue,
} from "./research-service"
import { type DesktopTaskService, createDesktopTaskService } from "./task-service"
import { UserSkillError, type UserSkillService, createUserSkillService } from "./user-skill-service"

const APP_USER_MODEL_ID = "com.tessera.desktop"
const MAIN_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"])
const IGNORED_DIRECTORIES = new Set([".git", ".tessera", "node_modules"])
const WORKSPACE_CHANGE_DEBOUNCE_MS = 120

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
): TaskRunResourceSummary {
  return {
    attachmentCount: input.messages.reduce(
      (count, message) => count + message.parts.filter((part) => part.type === "file").length,
      0,
    ),
    currentDocumentPath: workspace ? (input.currentDocumentPath ?? null) : null,
    workspaceId: workspace?.id ?? null,
    workspaceName: workspace?.name ?? null,
  }
}

function researchSearchQuery(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  for (const key of ["query", "search_query", "q"]) {
    const candidate = input[key]
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 1_000)
  }
  return undefined
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
    "abortSignal" | "onChunk" | "onRunMetrics" | "researchTools" | "skill"
  >,
) {
  const workspaceTools = workspace
    ? createReadonlyWorkspaceAgentTools({
        rootPath: workspace.rootPath,
        ...(input.currentDocumentPath ? { currentDocumentPath: input.currentDocumentPath } : {}),
      })
    : null
  const externalTools = await requireMcpService().createAgentTools(options.abortSignal)
  const contentService = requireContentLibraryService()
  const contentTools: ContentDomainAgentTools | undefined = contentService.current()
    ? {
        listProjects: async (signal: AbortSignal) => {
          signal.throwIfAborted()
          return contentService.listProjects()
        },
        listArtifacts: async (signal: AbortSignal) => {
          signal.throwIfAborted()
          return contentService.listArtifacts(input.taskId)
        },
        inspectProject: async ({ projectId }, context) => {
          context.signal.throwIfAborted()
          return contentService.inspectProject({ taskId: input.taskId, runId: input.requestId }, projectId)
        },
        createDocument: async (document, context) => {
          context.signal.throwIfAborted()
          return contentService.createDocument({ taskId: input.taskId, runId: input.requestId }, document)
        },
        createProject: async (project, context) => {
          context.signal.throwIfAborted()
          return contentService.createProject({ taskId: input.taskId, runId: input.requestId }, project)
        },
        moveDocuments: async (move, context) => {
          context.signal.throwIfAborted()
          return contentService.moveDocuments({ taskId: input.taskId, runId: input.requestId }, move)
        },
      }
    : undefined
  return streamAiAgent(input, {
    ...options,
    ...(contentTools ? { contentTools } : {}),
    externalTools,
    ...(workspace && workspaceTools
      ? {
          workspaceName: workspace.name,
          tools: {
            ...workspaceTools,
            writeWorkspaceDocument: (change, context) =>
              requireAgentChangeService().execute(
                input.taskId,
                context.toolCallId,
                change,
                workspace.rootPath,
                context.signal,
              ),
          },
        }
      : {}),
  })
}

function recoverInterruptedAiRuns(client: DatabaseClient) {
  for (const run of listRunningTaskRuns(client)) {
    const sequence = run.lastSequence + 1
    const event: AiChatStreamEvent = {
      requestId: run.requestId,
      taskId: run.taskId,
      sequence,
      chunk: {
        type: "error",
        errorText: "应用上次运行时意外中断，已恢复中断前的可见进度；磁盘写入不会自动重放，请继续或重试。",
      },
    }
    appendTaskRunEvent(client, {
      requestId: run.requestId,
      sequence,
      payloadJson: JSON.stringify(event),
    })
    finishTaskRun(client, run.requestId, "interrupted", {
      finishReason: "interrupted",
      durationMs: Math.max(0, Date.now() - run.startedAt.getTime()),
    })
  }
}

function abortAiChatsForWebContents(webContentsId: number) {
  for (const chat of activeAiChats.values()) {
    if (chat.webContentsId !== webContentsId) continue
    chat.abortController.abort("窗口已关闭")
    releaseAiChatRun(chat)
  }
}

function aiChatErrorMessage(error: unknown) {
  if (
    error instanceof AiProviderConfigError ||
    error instanceof AgentChangeError ||
    error instanceof ContentLibraryError
  )
    return error.message
  return "模型请求失败，请检查供应商配置、模型状态与网络连接。"
}

function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code
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
  return !relativePath
    .split("/")
    .some((part) => !part || part.startsWith(".") || IGNORED_DIRECTORIES.has(part))
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

function restoreMostRecentWorkspace(): WorkspaceInfo | null {
  if (!databaseClient) return null
  const record = findMostRecentWorkspace(databaseClient)
  return record ? workspaceFromRecord(record) : null
}

async function resolveWorkspacePath(rootPath: string, relativePath: string) {
  if (!relativePath || isAbsolute(relativePath)) throw new Error("文档路径无效。")

  const targetPath = resolve(rootPath, relativePath)
  const relation = relative(rootPath, targetPath)
  if (!relation || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("文档必须位于当前工作区内。")
  }

  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
  const canonicalRelation = relative(canonicalRoot, canonicalTarget)
  if (!canonicalRelation || canonicalRelation.startsWith("..") || isAbsolute(canonicalRelation)) {
    throw new Error("文档不能通过链接指向工作区外部。")
  }
  return canonicalTarget
}

function isMarkdownPath(path: string) {
  return MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase())
}

async function listMarkdownDocuments(rootPath: string) {
  const documents: WorkspaceDocumentEntry[] = []

  async function visit(directoryPath: string) {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) return

        const absolutePath = join(directoryPath, entry.name)
        if (entry.isDirectory()) {
          await visit(absolutePath)
          return
        }
        if (!entry.isFile() || !isMarkdownPath(entry.name)) return

        const metadata = await stat(absolutePath)
        documents.push({
          name: entry.name,
          relativePath: relative(rootPath, absolutePath).split("\\").join("/"),
          modifiedAt: metadata.mtimeMs,
          size: metadata.size,
        })
      }),
    )
  }

  await visit(rootPath)
  return documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
}

async function listWorkspaceDirectories(rootPath: string) {
  const directories: WorkspaceDirectoryEntry[] = []

  async function visit(directoryPath: string) {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name) || !entry.isDirectory()) return

        const absolutePath = join(directoryPath, entry.name)
        directories.push({
          name: entry.name,
          relativePath: relative(rootPath, absolutePath).split("\\").join("/"),
        })
        await visit(absolutePath)
      }),
    )
  }

  await visit(rootPath)
  return directories.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"))
}

async function readDocument(rootPath: string, relativePath: string): Promise<DocumentSnapshot> {
  const absolutePath = await resolveWorkspacePath(rootPath, relativePath)
  if (!isMarkdownPath(absolutePath)) throw new Error("当前仅支持 Markdown 文档。")

  const [content, metadata] = await Promise.all([readFile(absolutePath, "utf8"), stat(absolutePath)])
  if (!metadata.isFile()) throw new Error("目标不是可读取的文档。")

  return {
    name: basename(absolutePath),
    relativePath: relative(rootPath, absolutePath).split("\\").join("/"),
    modifiedAt: metadata.mtimeMs,
    size: metadata.size,
    content,
  }
}

async function resolveWorkspaceDirectory(rootPath: string, relativePath = "") {
  const absolutePath = relativePath
    ? await resolveWorkspacePath(rootPath, relativePath)
    : await realpath(rootPath)
  const metadata = await stat(absolutePath)
  if (!metadata.isDirectory()) throw new Error("目标不是工作区文件夹。")
  return absolutePath
}

async function createDocument(rootPath: string, parentRelativePath = ""): Promise<DocumentSnapshot> {
  const directoryPath = await resolveWorkspaceDirectory(rootPath, parentRelativePath)
  let sequence = 0
  let fileName = "未命名文档.md"
  let absolutePath = join(directoryPath, fileName)

  while (true) {
    try {
      await stat(absolutePath)
      sequence += 1
      fileName = `未命名文档 ${sequence + 1}.md`
      absolutePath = join(directoryPath, fileName)
    } catch {
      break
    }
  }

  await writeFile(absolutePath, "# 未命名文档\n\n从这里开始记录。\n", { encoding: "utf8", flag: "wx" })
  return readDocument(rootPath, relative(rootPath, absolutePath).split("\\").join("/"))
}

function validateWorkspaceEntryName(value: string) {
  const fileName = value.trim()
  if (!fileName || fileName === "." || fileName === ".." || basename(fileName) !== fileName) {
    throw new Error("请输入有效的文件名。")
  }
  const hasControlCharacter = [...fileName].some((character) => character.charCodeAt(0) < 32)
  if (fileName.startsWith(".") || /[<>:"/\\|?*]/u.test(fileName) || hasControlCharacter) {
    throw new Error("文件名包含不支持的字符。")
  }
  return fileName
}

function validateDocumentName(value: string) {
  const fileName = validateWorkspaceEntryName(value)
  if (!isMarkdownPath(fileName)) throw new Error("文件名需要以 .md 或 .markdown 结尾。")
  return fileName
}

async function createDirectory(rootPath: string, parentRelativePath = ""): Promise<WorkspaceDirectoryEntry> {
  const parentPath = await resolveWorkspaceDirectory(rootPath, parentRelativePath)
  let sequence = 0
  let name = "新建文件夹"
  let absolutePath = join(parentPath, name)

  while (true) {
    try {
      await stat(absolutePath)
      sequence += 1
      name = `新建文件夹 ${sequence + 1}`
      absolutePath = join(parentPath, name)
    } catch {
      break
    }
  }

  await mkdir(absolutePath)
  return { name, relativePath: relative(rootPath, absolutePath).split("\\").join("/") }
}

async function renameDocument(
  rootPath: string,
  relativePath: string,
  selectedPath: string,
): Promise<DocumentSnapshot> {
  const sourcePath = await resolveWorkspacePath(rootPath, relativePath)
  const fileName = validateDocumentName(basename(selectedPath))
  const destinationDirectory = await realpath(dirname(resolve(selectedPath)))
  const canonicalRoot = await realpath(rootPath)
  const destinationRelation = relative(canonicalRoot, destinationDirectory)
  if (destinationRelation.startsWith("..") || isAbsolute(destinationRelation)) {
    throw new Error("文档必须保留在当前工作区内。")
  }

  const destinationPath = join(destinationDirectory, fileName)
  if (sourcePath === destinationPath) return readDocument(rootPath, relativePath)

  try {
    await stat(destinationPath)
    throw new Error("同一位置已存在同名文档。")
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error
  }

  await rename(sourcePath, destinationPath)
  const nextRelativePath = relative(rootPath, destinationPath).split("\\").join("/")
  return readDocument(rootPath, nextRelativePath)
}

async function renameDirectory(
  rootPath: string,
  relativePath: string,
  selectedPath: string,
): Promise<WorkspaceDirectoryEntry> {
  const sourcePath = await resolveWorkspacePath(rootPath, relativePath)
  const metadata = await stat(sourcePath)
  if (!metadata.isDirectory()) throw new Error("目标不是可重命名的文件夹。")

  const name = validateWorkspaceEntryName(basename(selectedPath))
  const destinationPath = join(dirname(sourcePath), name)
  if (sourcePath === destinationPath) return { name, relativePath }

  try {
    await stat(destinationPath)
    throw new Error("同一位置已存在同名文件夹。")
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error
  }

  await rename(sourcePath, destinationPath)
  return {
    name,
    relativePath: relative(rootPath, destinationPath).split("\\").join("/"),
  }
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

async function writeDocument(
  rootPath: string,
  relativePath: string,
  content: string,
  expectedModifiedAt: number,
): Promise<DocumentWriteResult> {
  const currentDocument = await readDocument(rootPath, relativePath)
  if (currentDocument.modifiedAt !== expectedModifiedAt) {
    return { status: "conflict", document: currentDocument }
  }

  const absolutePath = await resolveWorkspacePath(rootPath, relativePath)
  const metadata = await stat(absolutePath)
  const temporaryPath = join(dirname(absolutePath), `.${basename(absolutePath)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: metadata.mode, flag: "wx" })
    await rename(temporaryPath, absolutePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }

  return { status: "saved", document: await readDocument(rootPath, relativePath) }
}

function registerIpcHandlers() {
  const getAppInfo = async () =>
    createAppInfo({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
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
      if (workspace) {
        requireAgentChangeService().reconcileDecisions(input.taskId, input.messages)
      }
      const runtimeInput = resolveAiChatInput({ ...input, mode: workspace ? "agent" : "chat" })
      const loadedSkill = await requireUserSkillService().load(runtimeInput.skillId)
      if (!databaseClient) throw new AiProviderConfigError("本地任务数据库尚未就绪。")
      const runDatabase = databaseClient
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
        resourceSummaryJson: JSON.stringify(summarizeTaskRunResources(input, workspace)),
        startedAt: runStartedAt,
      })
      taskRunStarted = true
      let researchService: DesktopResearchService | null = null
      if (runtimeInput.runPolicy.skillId === "research") {
        startResearchRun(runDatabase, {
          requestId: input.requestId,
          taskId: input.taskId,
          startedAt: runStartedAt,
        })
        researchService = createDesktopResearchService(runDatabase, {
          requestId: input.requestId,
          reader: createElectronResearchReader(),
        })
      }
      recordTaskRunResourceBindings(runDatabase, input, workspace)

      const pendingToolInputs = new Map<string, { input: unknown; toolName: string }>()
      let latestSearchQuery: string | undefined
      let researchFinalTextCharacters = 0

      const emit = async (incomingChunk: AiChatStreamChunk) => {
        const awaitingUserInput = [...pendingToolInputs.values()].some(
          (pending) => pending.toolName === "request-user-input",
        )
        const researchOutcome = researchService?.getProgress().outcome ?? null
        if (incomingChunk.type === "text-delta" && researchOutcome) {
          researchFinalTextCharacters += incomingChunk.delta.trim().length
        }
        const researchIssue =
          incomingChunk.type === "finish" && researchService
            ? researchFinishIssue({
                awaitingUserInput,
                finalTextCharacters: researchFinalTextCharacters,
                outcome: researchOutcome,
              })
            : null
        const chunk: AiChatStreamChunk = researchIssue
          ? { type: "error", errorText: researchIssue }
          : incomingChunk
        if (chunk.type === "tool-input-available") {
          pendingToolInputs.set(chunk.toolCallId, { input: chunk.input, toolName: chunk.toolName })
          if (chunk.toolName.includes("web_search") || chunk.toolName.includes("web-search")) {
            latestSearchQuery = researchSearchQuery(chunk.input)
          }
        }
        if (
          chunk.type === "tool-output-available" ||
          chunk.type === "tool-output-error" ||
          chunk.type === "tool-output-denied"
        ) {
          pendingToolInputs.delete(chunk.toolCallId)
        }
        if (chunk.type === "source-url" && researchService) {
          try {
            researchService.recordDiscoveredSource({
              url: chunk.url,
              ...(chunk.title ? { title: chunk.title } : {}),
              ...(latestSearchQuery ? { query: latestSearchQuery } : {}),
            })
          } catch {
            // 供应商可能发出非 http(s) 来源或计划前的辅助来源；不让来源归一化失败中断模型流。
          }
        }
        if (chunk.type === "tool-approval-request") {
          const pending = pendingToolInputs.get(chunk.toolCallId)
          if (pending?.toolName === "write-workspace-document") {
            if (!workspace) throw new Error("Agent 变更提案缺少工作区。")
            await requireAgentChangeService().register({
              approvalId: chunk.approvalId,
              taskId: input.taskId,
              requestId: input.requestId,
              toolCallId: chunk.toolCallId,
              providerId: input.providerId,
              modelId: input.modelId,
              rootPath: workspace.rootPath,
              change: pending.input,
            })
          }
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

      void streamAiTask(runtimeInput, workspace, {
        abortSignal: abortController.signal,
        onChunk: emit,
        onRunMetrics: (metrics) => {
          runMetrics = metrics
        },
        ...(researchService ? { researchTools: researchService satisfies ResearchAgentTools } : {}),
        ...(loadedSkill ? { skill: loadedSkill } : {}),
      })
        .catch(async (error) => {
          const lastType = run.events.at(-1)?.chunk.type
          if (lastType === "finish" || lastType === "abort" || lastType === "error") return
          if (abortController.signal.aborted) {
            await emit({ type: "abort", reason: String(abortController.signal.reason ?? "生成已停止") })
          } else {
            await emit({ type: "error", errorText: aiChatErrorMessage(error) })
          }
        })
        .finally(() => {
          run.active = false
          const lastType = run.events.at(-1)?.chunk.type
          finishTaskRun(
            runDatabase,
            input.requestId,
            lastType === "finish" ? "completed" : lastType === "abort" ? "cancelled" : "failed",
            taskRunCompletion(runMetrics, lastType, Math.max(0, Date.now() - runStartedAt.getTime())),
          )
          if (activeAiChats.get(input.requestId) === run) activeAiChats.delete(input.requestId)
          if (aiChatRunsByTask.get(input.taskId) !== run) return
          run.retentionTimer = setTimeout(() => releaseAiChatRun(run), AI_CHAT_RUN_RETENTION_MS)
          run.retentionTimer.unref()
        })
      initializingRun = null
      return { ok: true }
    } catch (error) {
      if (initializingRun) {
        initializingRun.active = false
        if (taskRunStarted && initializingRunDatabase && initializingRunStartedAt) {
          try {
            finishTaskRun(initializingRunDatabase, initializingRun.requestId, "failed", {
              ...taskRunCompletion(
                null,
                "error",
                Math.max(0, Date.now() - initializingRunStartedAt.getTime()),
              ),
            })
          } catch {
            // 原始初始化异常优先返回给调用方；下次启动仍会把未收尾的运行恢复为 interrupted。
          }
        }
        releaseAiChatRun(initializingRun)
      }
      return { ok: false, error: aiChatErrorMessage(error) }
    }
  })
  handleDesktopInvoke(IPC_CHANNELS.aiChatResume, (event, taskId) => {
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
      if (task.status !== "running" || !databaseClient) return { ok: true, run: null }
      const persisted = findLatestTaskRun(databaseClient, taskId)
      if (!persisted) return { ok: true, run: null }
      if (!isAiProviderId(persisted.providerId)) throw new Error("任务使用了不支持的 AI 供应商。")
      return {
        ok: true,
        run: {
          active: persisted.status === "running",
          configId: persisted.configId ?? persisted.providerId,
          events: persisted.events.map((record) => parseAiChatStreamEvent(record.payloadJson)),
          modelId: persisted.modelId,
          providerId: persisted.providerId,
          requestId: persisted.requestId,
        },
      }
    } catch {
      return { ok: false, error: "无法恢复这个任务的生成流。" }
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
  handleDesktopInvoke(IPC_CHANNELS.taskListWorkspace, (event) => {
    const workspace = workspaceForEvent(event)
    return requireDesktopTaskService().listWorkspace(workspace.id)
  })
  handleDesktopInvoke(IPC_CHANNELS.taskListArtifacts, (_event, taskId) => {
    requireDesktopTaskService().read(taskId)
    return requireContentLibraryService().listArtifacts(taskId)
  })
  handleDesktopInvoke(IPC_CHANNELS.taskRead, (_event, taskId) => {
    return requireDesktopTaskService().read(taskId)
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
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
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
  recoverInterruptedAiRuns(databaseClient)
  registerIpcHandlers()
  createWindow(restoreMostRecentWorkspace())

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(restoreMostRecentWorkspace())
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
