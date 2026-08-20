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
} as const

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>
}
