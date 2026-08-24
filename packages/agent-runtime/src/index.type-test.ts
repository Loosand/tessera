/**
 * [INPUT]: Agent 事件映射、事件提取器、泛型运行时端口与工作区文件 capability 类型
 * [OUTPUT]: 事件判别字段、工具输出和文件分页结果的编译期契约
 * [POS]: Agent 运行时公共类型退化的静态回归测试
 * [DOC]: docs/architecture.md、docs/architecture/agent-file-capabilities.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AgentEvent,
  AgentEventOf,
  AgentEventType,
  ReadWorkspaceFileInput,
  WorkspaceDocumentWriteResult,
  WorkspaceFileReadResult,
} from "./index"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right
  ? 1
  : 2
  ? true
  : false
type Expect<Value extends true> = Value

type ToolResult = { readonly changedFiles: number }
type CompletedEvent = AgentEventOf<"tool.completed", ToolResult>

export type AgentRuntimeTypeContract = [
  Expect<
    Equal<
      AgentEventType,
      | "text.delta"
      | "tool.started"
      | "tool.completed"
      | "permission.asked"
      | "session.completed"
      | "session.failed"
    >
  >,
  Expect<Equal<CompletedEvent["output"], ToolResult>>,
  Expect<Equal<Extract<AgentEvent<ToolResult>, { type: "tool.completed" }>, CompletedEvent>>,
  Expect<Equal<ReadWorkspaceFileInput["offset"], number | undefined>>,
  Expect<Equal<WorkspaceFileReadResult["truncation"]["nextOffset"], number | null>>,
  Expect<Equal<WorkspaceDocumentWriteResult["status"], "saved" | "conflict">>,
]
