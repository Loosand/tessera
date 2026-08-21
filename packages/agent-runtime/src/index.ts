/**
 * [INPUT]: 具体 Agent 适配器定义的可序列化请求、取消信号与运行事件
 * [OUTPUT]: 支持具体运行时保留类型化请求/事件的可替换 AgentRuntime 泛型端口，以及基础权限事件契约
 * [POS]: Tessera 核心与具体 Agent 适配器之间的稳定端口
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export type PermissionEffect = "allow" | "ask" | "deny"

export interface AgentRequest {
  sessionId: string
  prompt: string
  workspaceRoot: string
}

export type AgentEvent =
  | { type: "text.delta"; text: string }
  | { type: "tool.started"; tool: string }
  | { type: "tool.completed"; tool: string; output: unknown }
  | { type: "permission.asked"; action: string; resources: readonly string[] }
  | { type: "session.completed" }
  | { type: "session.failed"; message: string }

export interface AgentRuntime<REQUEST = AgentRequest, EVENT = AgentEvent> {
  readonly id: string
  run(request: REQUEST, signal: AbortSignal): AsyncIterable<EVENT>
}
