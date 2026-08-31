/**
 * [INPUT]: 具体 Agent 适配器定义的请求、事件流、取消信号与工作区文件能力契约
 * [OUTPUT]: 可由具体适配器收窄的 Agent 运行时端口，以及与 AI SDK/桌面平台解耦的工作区文件 capability contract
 * [POS]: Tessera 核心与具体 Agent 适配器之间的稳定端口
 * [DOC]: docs/architecture.md、docs/architecture/agent-file-capabilities.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export type PermissionEffect = "allow" | "ask" | "deny"

export type AgentRuntime<Request, Event> = {
  readonly id: string
  run(request: Request, signal: AbortSignal): AsyncIterable<Event>
}

export * from "./workspace-file-capabilities"
