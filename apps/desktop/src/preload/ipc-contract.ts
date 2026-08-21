/**
 * [INPUT]: @tessera/contracts 的频道、参数与返回值映射，以及 Electron ipcRenderer
 * [OUTPUT]: 由频道反向推导签名的 invoke/send/subscribe 渲染桥函数
 * [POS]: 共享桌面契约与 Electron 预加载层宽泛 IPC API 之间的类型适配层
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  DesktopApiArguments,
  DesktopApiChannel,
  DesktopApiMethodByChannel,
  DesktopApiMethodByKind,
  DesktopApiReturn,
} from "@tessera/contracts"
import { type IpcRendererEvent, ipcRenderer } from "electron"

type InvokeMethod = DesktopApiMethodByKind<"invoke">
type InvokeChannel = DesktopApiChannel<InvokeMethod>
type InvokeMethodFor<Channel extends InvokeChannel> = DesktopApiMethodByChannel<Channel, "invoke">

type SendMethod = DesktopApiMethodByKind<"send">
type SendChannel = DesktopApiChannel<SendMethod>
type SendMethodFor<Channel extends SendChannel> = DesktopApiMethodByChannel<Channel, "send">

type SubscribeMethod = DesktopApiMethodByKind<"subscribe">
type SubscribeChannel = DesktopApiChannel<SubscribeMethod>
type SubscribeMethodFor<Channel extends SubscribeChannel> = DesktopApiMethodByChannel<Channel, "subscribe">
type SubscribeListener<Channel extends SubscribeChannel> = DesktopApiArguments<SubscribeMethodFor<Channel>>[0]
type SubscribeArguments<Channel extends SubscribeChannel> = SubscribeListener<Channel> extends (
  ...arguments_: infer Arguments
) => void
  ? Arguments
  : never

export function invokeDesktop<const Channel extends InvokeChannel>(
  channel: Channel,
  ...arguments_: DesktopApiArguments<InvokeMethodFor<Channel>>
): DesktopApiReturn<InvokeMethodFor<Channel>> {
  return ipcRenderer.invoke(channel, ...arguments_)
}

export function sendDesktop<const Channel extends SendChannel>(
  channel: Channel,
  ...arguments_: DesktopApiArguments<SendMethodFor<Channel>>
) {
  ipcRenderer.send(channel, ...arguments_)
}

export function subscribeDesktop<const Channel extends SubscribeChannel>(
  channel: Channel,
  listener: SubscribeListener<Channel>,
) {
  const handler = (_event: IpcRendererEvent, ...arguments_: SubscribeArguments<Channel>) =>
    Reflect.apply(listener, undefined, arguments_)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}
