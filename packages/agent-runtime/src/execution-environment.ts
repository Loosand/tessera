/**
 * [INPUT]: 已授权工作区内的前台 shell 命令、读写级别、超时与 AbortSignal
 * [OUTPUT]: 与本地/测试/未来隔离或远程实现无关的 ExecutionEnvironment 契约和有界终态结果
 * [POS]: Agent bash tool 与具体进程/沙箱实现之间的稳定 capability contract
 * [DOC]: docs/architecture/bash-execution-environment.md、docs/architecture/agent-simplification-roadmap.md、docs/architecture/agent-run-reliability.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export type WorkspaceExecutionAccess = "read-only" | "read-write"

export type WorkspaceCommandInput = Readonly<{
  command: string
  timeoutMs?: number | undefined
}>

export type WorkspaceCommandResult = Readonly<{
  access: WorkspaceExecutionAccess
  changedFiles: readonly string[]
  changesTruncated: boolean
  durationMs: number
  exitCode: number | null
  signal: string | null
  stderr: string
  stderrTruncated: boolean
  stdout: string
  stdoutTruncated: boolean
  termination: "exit" | "timeout"
}>

export type ExecutionEnvironmentDescriptor = Readonly<{
  id: string
  isolation: "macos-seatbelt" | "remote" | "test"
  network: "denied" | "policy"
  secrets: "cleared" | "policy"
}>

export interface ExecutionEnvironment {
  readonly descriptor: ExecutionEnvironmentDescriptor
  execute(
    input: WorkspaceCommandInput,
    access: WorkspaceExecutionAccess,
    signal: AbortSignal,
  ): Promise<WorkspaceCommandResult>
}

export type WorkspaceBashAgentTool = Readonly<{
  bash(
    input: WorkspaceCommandInput,
    access: WorkspaceExecutionAccess,
    signal: AbortSignal,
  ): Promise<WorkspaceCommandResult>
}>
