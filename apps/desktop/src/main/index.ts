/**
 * [INPUT]: Electron 生命周期、共享 IPC 契约与 Tessera 核心服务
 * [OUTPUT]: 安全配置、关闭保存握手和已注册 IPC 处理器的桌面窗口
 * [POS]: Electron 主进程入口与平台安全边界
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { createHash, randomUUID } from "node:crypto"
import { type FSWatcher, realpathSync, statSync, watch } from "node:fs"
import { readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { DesktopApi } from "@tessera/contracts"
import {
  type DocumentSnapshot,
  type DocumentWriteResult,
  IPC_CHANNELS,
  type WorkspaceDocumentEntry,
  type WorkspaceInfo,
} from "@tessera/contracts"
import { createAppInfo } from "@tessera/core"
import {
  type DatabaseClient,
  findMostRecentWorkspace,
  findWorkspaceById,
  listRecentWorkspaces,
  openDatabase,
  saveWorkspace,
} from "@tessera/database"
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type WebContents,
  app,
  dialog,
  ipcMain,
  shell,
} from "electron"

const APP_USER_MODEL_ID = "com.tessera.desktop"
const MAIN_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"])
const IGNORED_DIRECTORIES = new Set([".git", ".tessera", "node_modules"])
const WORKSPACE_CHANGE_DEBOUNCE_MS = 120

interface WorkspaceSession {
  workspace: WorkspaceInfo
  watcher: FSWatcher
  pendingPaths: Set<string>
  changeTimer: NodeJS.Timeout | null
}

const activeWorkspaces = new Map<number, WorkspaceSession>()
const approvedWindowCloseIds = new Set<number>()
const requestedWindowCloseIds = new Set<number>()
let databaseClient: DatabaseClient | null = null
let appQuitApproved = false
let appQuitRequested = false

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

async function createDocument(rootPath: string): Promise<DocumentSnapshot> {
  let sequence = 0
  let fileName = "未命名文档.md"
  let absolutePath = join(rootPath, fileName)

  while (true) {
    try {
      await stat(absolutePath)
      sequence += 1
      fileName = `未命名文档 ${sequence + 1}.md`
      absolutePath = join(rootPath, fileName)
    } catch {
      break
    }
  }

  await writeFile(absolutePath, "# 未命名文档\n\n从这里开始记录。\n", { encoding: "utf8", flag: "wx" })
  return readDocument(rootPath, fileName)
}

function validateDocumentName(value: string) {
  const fileName = value.trim()
  if (!fileName || fileName === "." || fileName === ".." || basename(fileName) !== fileName) {
    throw new Error("请输入有效的文件名。")
  }
  const hasControlCharacter = [...fileName].some((character) => character.charCodeAt(0) < 32)
  if (fileName.startsWith(".") || /[<>:"/\\|?*]/u.test(fileName) || hasControlCharacter) {
    throw new Error("文件名包含不支持的字符。")
  }
  if (!isMarkdownPath(fileName)) throw new Error("文件名需要以 .md 或 .markdown 结尾。")
  return fileName
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
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  await rename(sourcePath, destinationPath)
  const nextRelativePath = relative(rootPath, destinationPath).split("\\").join("/")
  return readDocument(rootPath, nextRelativePath)
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
  const getAppInfo: DesktopApi["getAppInfo"] = async () =>
    createAppInfo({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
    })

  ipcMain.handle(IPC_CHANNELS.appInfo, getAppInfo)
  ipcMain.on(IPC_CHANNELS.appCancelClose, (event) => {
    requestedWindowCloseIds.delete(event.sender.id)
    appQuitRequested = false
  })
  ipcMain.on(IPC_CHANNELS.appConfirmClose, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || !requestedWindowCloseIds.has(event.sender.id)) return
    requestedWindowCloseIds.delete(event.sender.id)
    approvedWindowCloseIds.add(event.sender.id)
    window.close()
  })
  ipcMain.handle(
    IPC_CHANNELS.workspaceCurrent,
    (event) => activeWorkspaces.get(event.sender.id)?.workspace ?? null,
  )
  ipcMain.handle(IPC_CHANNELS.workspaceSelect, async (event) => {
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
  ipcMain.handle(IPC_CHANNELS.workspaceRecent, () => {
    if (!databaseClient) return []
    return listRecentWorkspaces(databaseClient)
      .map(workspaceFromRecord)
      .filter((workspace): workspace is WorkspaceInfo => workspace !== null)
  })
  ipcMain.handle(IPC_CHANNELS.workspaceOpenRecent, (event, workspaceId: string) => {
    if (!databaseClient || !workspaceId) throw new Error("找不到这个最近工作区。")
    const record = findWorkspaceById(databaseClient, workspaceId)
    const workspace = record ? workspaceFromRecord(record) : null
    if (!workspace) throw new Error("工作区文件夹已经移动或不可访问。")
    installWorkspaceSession(event.sender, workspace)
    persistWorkspace(workspace)
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspaceReveal, (event) => {
    shell.showItemInFolder(workspaceForEvent(event).rootPath)
  })
  ipcMain.handle(IPC_CHANNELS.workspaceListDocuments, async (event) => {
    const workspace = workspaceForEvent(event)
    return listMarkdownDocuments(workspace.rootPath)
  })
  ipcMain.handle(IPC_CHANNELS.documentRead, async (event, relativePath: string) => {
    const workspace = workspaceForEvent(event)
    return readDocument(workspace.rootPath, relativePath)
  })
  ipcMain.handle(IPC_CHANNELS.documentCreate, async (event) => {
    const workspace = workspaceForEvent(event)
    return createDocument(workspace.rootPath)
  })
  ipcMain.handle(IPC_CHANNELS.documentRename, async (event, relativePath: string) => {
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
  ipcMain.handle(
    IPC_CHANNELS.documentWrite,
    async (event, relativePath: string, content: string, expectedModifiedAt: number) => {
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
  window.webContents.on("destroyed", () => closeWorkspaceSession(webContentsId))

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
    return
  }
  void window.loadFile(join(MAIN_DIRECTORY, "../renderer/index.html"))
}

app.whenReady().then(() => {
  app.setAppUserModelId(APP_USER_MODEL_ID)
  databaseClient = openDatabase({ path: join(app.getPath("userData"), "tessera.sqlite3") })
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
  for (const webContentsId of activeWorkspaces.keys()) closeWorkspaceSession(webContentsId)
  databaseClient?.close()
  databaseClient = null
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
