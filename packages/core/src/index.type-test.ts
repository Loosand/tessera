/**
 * [INPUT]: core 公开目录类型与应用信息工厂
 * [OUTPUT]: 字面量联合和泛型保真能力的编译期契约
 * [POS]: core 公共类型退化的静态回归测试
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type ProductAreaId, type ProductAreaStatus, createAppInfo } from "./index"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right
  ? 1
  : 2
  ? true
  : false
type Expect<Value extends true> = Value

const appInfo = createAppInfo({
  name: "Tessera",
  platform: "darwin",
  runtime: "electron",
  version: "0.0.1",
} as const)

export type CoreTypeContract = [
  Expect<Equal<ProductAreaId, "library" | "reader" | "inbox" | "skills">>,
  Expect<Equal<ProductAreaStatus, "foundation" | "planned">>,
  Expect<Equal<typeof appInfo.name, "Tessera">>,
  Expect<Equal<typeof appInfo.platform, "darwin">>,
  Expect<Equal<typeof appInfo.runtime, "electron">>,
]
