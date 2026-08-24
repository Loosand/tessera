/**
 * [INPUT]: Tauri invoke/event/window API、共享 DesktopApi bridge 与 Electron 应用持有的共享 renderer 入口
 * [OUTPUT]: 在 renderer 执行前安装的 window.tessera、单一总事件监听、隐藏标题栏拖动适配和可见启动失败界面
 * [POS]: Tauri WebView 的平台启动边界
 * [DOC]: docs/architecture/tauri-parity.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { invoke as invokeTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { IPC_CHANNELS } from "@tessera/contracts"
import { type DesktopApiTransport, createDesktopApi } from "@tessera/desktop-bridge"
import "./tauri.css"
import { toTauriError } from "./tauri-error"

const DESKTOP_EVENT_NAME = "tessera-desktop-event"
const SUBSCRIBE_CHANNELS = new Set<string>([
  IPC_CHANNELS.aiProviderConfigsChanged,
  IPC_CHANNELS.mcpServersChanged,
  IPC_CHANNELS.userSkillsChanged,
  IPC_CHANNELS.aiChatEvent,
  IPC_CHANNELS.workspaceChanged,
  IPC_CHANNELS.appCloseRequested,
])

type EventListener = (...arguments_: unknown[]) => void
type DesktopEventEnvelope = Readonly<{
  arguments: unknown[]
  channel: string
}>

const listeners = new Map<string, Set<EventListener>>()

function isDesktopEventEnvelope(value: unknown): value is DesktopEventEnvelope {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<DesktopEventEnvelope>
  return (
    typeof candidate.channel === "string" &&
    SUBSCRIBE_CHANNELS.has(candidate.channel) &&
    Array.isArray(candidate.arguments)
  )
}

async function installDesktopEventListener() {
  await listen<unknown>(DESKTOP_EVENT_NAME, ({ payload }) => {
    if (!isDesktopEventEnvelope(payload)) {
      console.warn("Tauri 壳忽略了无效的桌面事件。")
      return
    }
    for (const listener of listeners.get(payload.channel) ?? []) {
      try {
        Reflect.apply(listener, undefined, payload.arguments)
      } catch (error) {
        console.error("桌面事件监听器执行失败。", error)
      }
    }
  })
}

const invokeDesktop = (async (channel: string, ...arguments_: unknown[]) => {
  try {
    return await invokeTauri("desktop_invoke", {
      channel,
      arguments: arguments_,
    })
  } catch (error) {
    throw toTauriError(error)
  }
}) as DesktopApiTransport["invoke"]

const transport: DesktopApiTransport = {
  invoke: invokeDesktop,
  send: (channel, ...arguments_) => {
    void invokeTauri("desktop_send", { channel, arguments: arguments_ }).catch((error) => {
      console.error(`桌面单向消息 ${channel} 发送失败。`, toTauriError(error))
    })
  },
  subscribe: (channel, listener) => {
    const normalizedListener = listener as EventListener
    let channelListeners = listeners.get(channel)
    if (!channelListeners) {
      channelListeners = new Set()
      listeners.set(channel, channelListeners)
    }
    channelListeners.add(normalizedListener)
    return () => {
      channelListeners?.delete(normalizedListener)
      if (channelListeners?.size === 0) listeners.delete(channel)
    }
  },
}

const INTERACTIVE_TITLEBAR_SELECTOR =
  '.app-no-drag,button,input,textarea,select,a,[role="button"],[contenteditable="true"]'

function installTitlebarDragging() {
  document.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    if (!event.target.closest(".app-drag-region")) return
    if (event.target.closest(INTERACTIVE_TITLEBAR_SELECTOR)) return
    event.preventDefault()
    void getCurrentWindow()
      .startDragging()
      .catch((error) => console.warn("无法开始拖动 Tauri 窗口。", error))
  })
}

async function showWindow() {
  try {
    await getCurrentWindow().show()
  } catch (error) {
    console.error("Tauri 主窗口显示失败。", error)
  }
}

function renderBootstrapError(error: unknown) {
  const root = document.getElementById("root")
  if (!root) return
  const message = toTauriError(error).message
  const container = document.createElement("section")
  container.dataset.tauriBootstrapError = ""
  const title = document.createElement("h1")
  title.textContent = "Tauri 对照壳启动失败"
  const detail = document.createElement("p")
  detail.textContent = message
  container.append(title, detail)
  root.replaceChildren(container)
}

async function bootstrap() {
  document.documentElement.dataset.desktopHost = "tauri"
  await installDesktopEventListener()
  Object.defineProperty(window, "tessera", {
    configurable: false,
    enumerable: false,
    value: createDesktopApi(transport),
    writable: false,
  })
  installTitlebarDragging()
  await import("../../desktop/src/renderer/src/main")
  await showWindow()
}

void bootstrap().catch(async (error) => {
  console.error("Tauri 对照壳启动失败。", error)
  renderBootstrapError(error)
  await showWindow()
})
