/**
 * [INPUT]: Drizzle 数据库实例、旧 Agent Markdown 审批决定与兼容终态
 * [OUTPUT]: 历史 Agent 变更提案的定位、决策和失效结果审计
 * [POS]: read/edit/write 上线后旧逐次审批数据的兼容仓储边界
 * [DOC]: docs/architecture/database.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { and, eq } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import { type AgentChangeProposal, agentChangeProposals } from "./schema"

export type AgentChangeStatus = AgentChangeProposal["status"]

export function findAgentChangeProposal(client: DatabaseClient, approvalId: string) {
  return client.db
    .select()
    .from(agentChangeProposals)
    .where(eq(agentChangeProposals.approvalId, approvalId))
    .get()
}

export function decideAgentChangeProposal(
  client: DatabaseClient,
  approvalId: string,
  approved: boolean,
  reason?: string,
) {
  client.db
    .update(agentChangeProposals)
    .set({
      status: approved ? "approved" : "rejected",
      decisionReason: reason ?? null,
      decidedAt: new Date(),
    })
    .where(and(eq(agentChangeProposals.approvalId, approvalId), eq(agentChangeProposals.status, "pending")))
    .run()
  return findAgentChangeProposal(client, approvalId)
}

export function completeAgentChangeProposal(
  client: DatabaseClient,
  approvalId: string,
  status: Extract<AgentChangeStatus, "applied" | "conflict" | "failed">,
  errorMessage?: string,
) {
  client.db
    .update(agentChangeProposals)
    .set({
      status,
      errorMessage: errorMessage ?? null,
      ...(status === "applied" ? { appliedAt: new Date() } : {}),
    })
    .where(eq(agentChangeProposals.approvalId, approvalId))
    .run()
  return findAgentChangeProposal(client, approvalId)
}
