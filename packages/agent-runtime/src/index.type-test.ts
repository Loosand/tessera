/**
 * [INPUT]: Agent 工作区文件与 ExecutionEnvironment capability 类型
 * [OUTPUT]: read/edit/write/bash 四核心、读写级别与命令终态的编译期契约
 * [POS]: Agent 运行时公共类型退化的静态回归测试
 * [DOC]: docs/architecture.md、docs/architecture/agent-file-capabilities.md、docs/architecture/bash-execution-environment.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  EditWorkspaceFileInput,
  ReadWorkspaceFileInput,
  WorkspaceCommandResult,
  WorkspaceExecutionAccess,
  WorkspaceFileMutationResult,
  WorkspaceFileReadResult,
  WriteWorkspaceFileInput,
} from "./index"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right
  ? 1
  : 2
  ? true
  : false
type Expect<Value extends true> = Value

export type AgentRuntimeTypeContract = [
  Expect<Equal<ReadWorkspaceFileInput["offset"], number | undefined>>,
  Expect<Equal<ReadWorkspaceFileInput["lineByteOffset"], number | undefined>>,
  Expect<Equal<WorkspaceFileReadResult["truncation"]["nextOffset"], number | null>>,
  Expect<Equal<WorkspaceFileReadResult["truncation"]["nextLineByteOffset"], number | null>>,
  Expect<Equal<EditWorkspaceFileInput["edits"][number]["oldText"], string>>,
  Expect<Equal<WriteWorkspaceFileInput["operation"], "create" | "update">>,
  Expect<Equal<WorkspaceFileMutationResult["status"], "saved" | "conflict">>,
  Expect<Equal<WorkspaceExecutionAccess, "read-only" | "read-write">>,
  Expect<Equal<WorkspaceCommandResult["termination"], "exit" | "timeout">>,
]
