/**
 * [INPUT]: 具体 Agent 适配器定义的可序列化请求、取消信号与运行事件
 * [OUTPUT]: 支持按事件类型和工具输出收窄的 Agent 事件映射，以及保留具体请求/事件的泛型运行时端口
 * [POS]: Tessera 核心与具体 Agent 适配器之间的稳定端口
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export type PermissionEffect = "allow" | "ask" | "deny"

export type AgentRequest = {
  readonly sessionId: string
  readonly prompt: string
  readonly workspaceRoot: string
}

export type AgentEventMap<ToolOutput = unknown> = {
  readonly "text.delta": { readonly type: "text.delta"; readonly text: string }
  readonly "tool.started": { readonly type: "tool.started"; readonly tool: string }
  readonly "tool.completed": {
    readonly type: "tool.completed"
    readonly tool: string
    readonly output: ToolOutput
  }
  readonly "permission.asked": {
    readonly type: "permission.asked"
    readonly action: string
    readonly resources: readonly string[]
  }
  readonly "session.completed": { readonly type: "session.completed" }
  readonly "session.failed": { readonly type: "session.failed"; readonly message: string }
}

export type AgentEventType = keyof AgentEventMap
export type AgentEvent<ToolOutput = unknown> = AgentEventMap<ToolOutput>[AgentEventType]
export type AgentEventOf<Type extends AgentEventType, ToolOutput = unknown> = AgentEventMap<ToolOutput>[Type]

export type AgentRuntime<Request = AgentRequest, Event = AgentEvent> = {
  readonly id: string
  run(request: Request, signal: AbortSignal): AsyncIterable<Event>
}
