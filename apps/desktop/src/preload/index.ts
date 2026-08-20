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

import type { DesktopApi } from "@tessera/contracts"
import { IPC_CHANNELS } from "@tessera/contracts"
import { contextBridge, ipcRenderer } from "electron"

const api: DesktopApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
})

contextBridge.exposeInMainWorld("tessera", api)
