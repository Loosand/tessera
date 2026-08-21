/**
 * [INPUT]: DesktopApiContract 及其泛型查询工具
 * [OUTPUT]: 编译期类型等价与错误用例，防止 IPC 方法关系退化
 * [POS]: contracts 包的零运行时类型回归测试
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { IPC_CHANNELS } from "./index"
import type {
  DesktopApiArguments,
  DesktopApiChannel,
  DesktopApiMethodByKind,
  DesktopApiReturn,
  DocumentSnapshot,
  OperationResult,
} from "./index"

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false

type Expect<Value extends true> = Value

export type DesktopApiContractTypeTests = [
  Expect<Equal<DesktopApiArguments<"readDocument">, [relativePath: string]>>,
  Expect<Equal<DesktopApiReturn<"readDocument">, Promise<DocumentSnapshot>>>,
  Expect<Equal<DesktopApiChannel<"readDocument">, typeof IPC_CHANNELS.documentRead>>,
  Expect<Equal<Extract<DesktopApiMethodByKind<"send">, "cancelAiChat">, "cancelAiChat">>,
  Expect<Equal<Extract<DesktopApiMethodByKind<"subscribe">, "onAiChatEvent">, "onAiChatEvent">>,
  Expect<Equal<Extract<OperationResult, { ok: true }>, { ok: true }>>,
]

// @ts-expect-error readDocument 只能接收一个相对路径参数。
export type InvalidReadDocumentArguments = DesktopApiArguments<"readDocument">[1]
