/**
 * [INPUT]: Agent 工作区文件 capability 类型
 * [OUTPUT]: 文件分页与写入结果的编译期契约
 * [POS]: Agent 运行时公共类型退化的静态回归测试
 * [DOC]: docs/architecture.md、docs/architecture/agent-file-capabilities.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { ReadWorkspaceFileInput, WorkspaceDocumentWriteResult, WorkspaceFileReadResult } from "./index"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right
  ? 1
  : 2
  ? true
  : false
type Expect<Value extends true> = Value

export type AgentRuntimeTypeContract = [
  Expect<Equal<ReadWorkspaceFileInput["offset"], number | undefined>>,
  Expect<Equal<WorkspaceFileReadResult["truncation"]["nextOffset"], number | null>>,
  Expect<Equal<WorkspaceDocumentWriteResult["status"], "saved" | "conflict">>,
]
