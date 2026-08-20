/**
 * [INPUT]: Electron 生命周期、共享 IPC 契约与 Tessera 核心服务
 * [OUTPUT]: 安全配置的桌面窗口和已注册的 IPC 处理器
 * [POS]: Electron 主进程入口与平台安全边界
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { join } from "node:path"
import type { DesktopApi } from "@tessera/contracts"
import { IPC_CHANNELS } from "@tessera/contracts"
import { createAppInfo } from "@tessera/core"
import { BrowserWindow, app, ipcMain, shell } from "electron"

const APP_USER_MODEL_ID = "com.tessera.desktop"

function isSafeExternalUrl(value: string) {
  try {
    const protocol = new URL(value).protocol
    return protocol === "https:" || protocol === "http:"
  } catch {
    return false
  }
}

function registerIpcHandlers() {
  const getAppInfo: DesktopApi["getAppInfo"] = async () =>
    createAppInfo({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
    })

  ipcMain.handle(IPC_CHANNELS.appInfo, getAppInfo)
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#11100e",
    title: "Tessera",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
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

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
    return
  }
  void window.loadFile(join(__dirname, "../renderer/index.html"))
}

app.whenReady().then(() => {
  app.setAppUserModelId(APP_USER_MODEL_ID)
  registerIpcHandlers()
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
