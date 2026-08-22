/**
 * [INPUT]: AI SDK 全局 Telemetry 注册、官方 @ai-sdk/devtools Viewer、Electron 开发运行时与本地进程能力
 * [OUTPUT]: 仅开发环境启用的 AI SDK 运行记录、官方 Viewer 按需启动/探测与退出清理
 * [POS]: Electron 主进程内的开发期 AI 可观测性边界
 * [DOC]: docs/architecture/ai-observability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type ChildProcess, spawn } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { app } from "electron"

const AI_SDK_DEVTOOLS_PORT = 4983
const AI_SDK_DEVTOOLS_URL = `http://localhost:${AI_SDK_DEVTOOLS_PORT}`
const AI_SDK_DEVTOOLS_PROBE_URL = `${AI_SDK_DEVTOOLS_URL}/api/runs`
const AI_SDK_DEVTOOLS_BUILD_ENABLED = (
  import.meta as ImportMeta & { readonly env: { readonly DEV: boolean } }
).env.DEV
const VIEWER_START_TIMEOUT_MS = 5_000
const VIEWER_PROBE_INTERVAL_MS = 100
const VIEWER_ERROR_LIMIT = 2_000

let telemetryRegistered = false
let viewerProcess: ChildProcess | null = null
let viewerError = ""

export function isAiSdkDevtoolsEnabled() {
  return AI_SDK_DEVTOOLS_BUILD_ENABLED && !app.isPackaged
}

export async function registerAiSdkDevtools() {
  if (!isAiSdkDevtoolsEnabled() || telemetryRegistered) return telemetryRegistered

  const [{ DevToolsTelemetry }, { registerTelemetry }] = await Promise.all([
    import("@ai-sdk/devtools"),
    import("ai"),
  ])
  registerTelemetry(DevToolsTelemetry())
  telemetryRegistered = true
  return true
}

async function viewerIsReady() {
  try {
    const response = await fetch(AI_SDK_DEVTOOLS_PROBE_URL, {
      signal: AbortSignal.timeout(500),
    })
    return response.ok
  } catch {
    return false
  }
}

function resolveViewerCliPath() {
  const require = createRequire(import.meta.url)
  const packageEntry = require.resolve("@ai-sdk/devtools")
  return join(dirname(dirname(packageEntry)), "bin", "cli.js")
}

function spawnViewer() {
  if (viewerProcess?.exitCode === null) return

  viewerError = ""
  viewerProcess = spawn(process.execPath, [resolveViewerCliPath()], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AI_SDK_DEVTOOLS_PORT: String(AI_SDK_DEVTOOLS_PORT),
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  viewerProcess.stderr?.setEncoding("utf8")
  viewerProcess.stderr?.on("data", (chunk: string) => {
    viewerError = `${viewerError}${chunk}`.slice(-VIEWER_ERROR_LIMIT)
  })
  viewerProcess.once("exit", () => {
    viewerProcess = null
  })
}

async function waitForViewer() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < VIEWER_START_TIMEOUT_MS) {
    if (await viewerIsReady()) return
    if (viewerProcess?.exitCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, VIEWER_PROBE_INTERVAL_MS))
  }

  const detail = viewerError.trim()
  throw new Error(detail ? `AI SDK DevTools 启动失败：${detail}` : "AI SDK DevTools 启动超时。")
}

export async function startAiSdkDevtoolsViewer() {
  if (!isAiSdkDevtoolsEnabled()) throw new Error("AI 运行日志只在开发环境提供。")
  await registerAiSdkDevtools()
  if (!(await viewerIsReady())) {
    spawnViewer()
    await waitForViewer()
  }
  return AI_SDK_DEVTOOLS_URL
}

export function stopAiSdkDevtoolsViewer() {
  if (viewerProcess?.exitCode === null) viewerProcess.kill()
  viewerProcess = null
}
