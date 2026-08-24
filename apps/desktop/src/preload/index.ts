/**
 * [INPUT]: 平台无关桌面 API factory、Electron contextBridge 与类型化 IPC 渲染传输
 * [OUTPUT]: 暴露在 window.tessera 上的冻结窄接口、默认空间切换、当前 Space 活动/归档任务分页与置顶/归档操作、研究网络偏好、开发期 AI 日志入口、MCP/用户 Skill 安全配置与扫描安装、可恢复 AI 流、脱敏运行解释、Agent 变更预览、托管内容库/Artifact、受限工作区/任务操作和关闭保存握手
 * [POS]: 主进程与沙箱渲染层之间的安全桥
 * [DOC]: docs/architecture/tauri-parity.md、docs/architecture.md、docs/architecture/ai-providers.md、docs/architecture/ai-observability.md、docs/architecture/mcp.md、docs/architecture/research-workflow.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type DesktopApiTransport, createDesktopApi } from "@tessera/desktop-bridge"
import { contextBridge } from "electron"
import { invokeDesktop, sendDesktop, subscribeDesktop } from "./ipc-contract"

const api = createDesktopApi({
  invoke: invokeDesktop as DesktopApiTransport["invoke"],
  send: sendDesktop as DesktopApiTransport["send"],
  subscribe: subscribeDesktop as DesktopApiTransport["subscribe"],
})

contextBridge.exposeInMainWorld("tessera", api)
