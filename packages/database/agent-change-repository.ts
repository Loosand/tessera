/**
 * [INPUT]: Drizzle 数据库实例、冻结的 Agent Markdown 候选内容、审批决定与写入结果
 * [OUTPUT]: Agent 变更提案的幂等创建、定位、决策和结果审计
 * [POS]: 可写 Agent 人工审批与崩溃恢复的数据库事实边界
 * [DOC]: docs/architecture/database.md、docs/architecture/ai-chat-agent-todo.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { and, eq } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import { agentChangeProposals } from "./schema"

export type AgentChangeStatus = "pending" | "approved" | "rejected" | "applied" | "conflict" | "failed"

export interface AgentChangeProposalInput {
  approvalId: string
  baseContent: string | null
  baseContentHash: string | null
  baseModifiedAt: Date | null
  createdAt: Date
  modelId: string
  operation: "create" | "update"
  proposedContent: string
  proposedContentHash: string
  providerId: string
  reason: string
  relativePath: string
  requestId: string
  taskId: string
  toolCallId: string
}

export function saveAgentChangeProposal(client: DatabaseClient, input: AgentChangeProposalInput) {
  client.db
    .insert(agentChangeProposals)
    .values({ ...input, status: "pending" })
    .onConflictDoNothing()
    .run()
  return findAgentChangeProposal(client, input.approvalId)
}

export function findAgentChangeProposal(client: DatabaseClient, approvalId: string) {
  return client.db
    .select()
    .from(agentChangeProposals)
    .where(eq(agentChangeProposals.approvalId, approvalId))
    .get()
}

export function findAgentChangeProposalByToolCall(
  client: DatabaseClient,
  taskId: string,
  toolCallId: string,
) {
  return client.db
    .select()
    .from(agentChangeProposals)
    .where(
      and(eq(agentChangeProposals.taskId, taskId), eq(agentChangeProposals.toolCallId, toolCallId)),
    )
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
    .where(
      and(
        eq(agentChangeProposals.approvalId, approvalId),
        eq(agentChangeProposals.status, "pending"),
      ),
    )
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
