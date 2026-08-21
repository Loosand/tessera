/**
 * [INPUT]: @tessera/contracts 的频道、参数与返回值映射，以及 Electron ipcMain
 * [OUTPUT]: 由频道反向推导方法签名的 invoke/send 注册函数
 * [POS]: 共享桌面契约与 Electron 主进程宽泛 IPC API 之间的类型适配层
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
import { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from "electron"

type InvokeMethod = DesktopApiMethodByKind<"invoke">
type InvokeChannel = DesktopApiChannel<InvokeMethod>
type InvokeMethodFor<Channel extends InvokeChannel> = DesktopApiMethodByChannel<Channel, "invoke">
type InvokeResult<Channel extends InvokeChannel> = Awaited<DesktopApiReturn<InvokeMethodFor<Channel>>>
type InvokeHandler<Channel extends InvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...arguments_: DesktopApiArguments<InvokeMethodFor<Channel>>
) => InvokeResult<Channel> | Promise<InvokeResult<Channel>>

type SendMethod = DesktopApiMethodByKind<"send">
type SendChannel = DesktopApiChannel<SendMethod>
type SendMethodFor<Channel extends SendChannel> = DesktopApiMethodByChannel<Channel, "send">
type SendHandler<Channel extends SendChannel> = (
  event: IpcMainEvent,
  ...arguments_: DesktopApiArguments<SendMethodFor<Channel>>
) => void

export function handleDesktopInvoke<const Channel extends InvokeChannel>(
  channel: Channel,
  handler: InvokeHandler<Channel>,
) {
  ipcMain.handle(channel, (event, ...arguments_) => Reflect.apply(handler, undefined, [event, ...arguments_]))
}

export function onDesktopSend<const Channel extends SendChannel>(
  channel: Channel,
  handler: SendHandler<Channel>,
) {
  ipcMain.on(channel, (event, ...arguments_) => {
    Reflect.apply(handler, undefined, [event, ...arguments_])
  })
}
