/**
 * [INPUT]: SQLite 中已有的旧 Agent 变更提案与历史审批 Tool Part
 * [OUTPUT]: 旧提案 Diff 预览、审批对账和不再执行旧写入的失效终态
 * [POS]: read/edit/write 上线后旧工作区审批数据的只读兼容边界
 * [DOC]: docs/architecture/agent-file-capabilities.md、docs/architecture/agent-simplification-roadmap.md、docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AgentChangePreview, TaskMessage, TaskToolMessagePart } from "@tessera/contracts"
import {
  type AgentChangeProposal,
  type DatabaseClient,
  completeAgentChangeProposal,
  decideAgentChangeProposal,
  findAgentChangeProposal,
} from "@tessera/database"
import { MAX_AGENT_MARKDOWN_BYTES, agentContentHash } from "./read-only-agent-tools"

const MAX_REASON_CHARACTERS = 2_000

export class AgentChangeError extends Error {
  override readonly name = "AgentChangeError"
}

type WorkspaceDocumentChangeBase = {
  readonly content: string
  readonly path: string
  readonly reason: string
}

export type WorkspaceDocumentChangeInput =
  | (WorkspaceDocumentChangeBase & {
      readonly baseContentHash?: never
      readonly baseModifiedAt?: never
      readonly operation: "create"
    })
  | (WorkspaceDocumentChangeBase & {
      readonly baseContentHash: string
      readonly baseModifiedAt: number
      readonly operation: "update"
    })

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function parseWorkspaceDocumentChange(value: unknown): WorkspaceDocumentChangeInput {
  if (!isRecord(value)) throw new AgentChangeError("Agent 变更输入无效。")
  const operation = value.operation
  const path = value.path
  const content = value.content
  const reason = value.reason
  const baseModifiedAt = value.baseModifiedAt
  const baseContentHash = value.baseContentHash
  if (
    (operation !== "create" && operation !== "update") ||
    typeof path !== "string" ||
    typeof content !== "string" ||
    typeof reason !== "string" ||
    !reason.trim() ||
    reason.length > MAX_REASON_CHARACTERS ||
    Buffer.byteLength(content, "utf8") > MAX_AGENT_MARKDOWN_BYTES
  ) {
    throw new AgentChangeError("Agent 变更输入无效。")
  }
  if (operation === "update") {
    if (
      typeof baseModifiedAt !== "number" ||
      !Number.isFinite(baseModifiedAt) ||
      typeof baseContentHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(baseContentHash)
    ) {
      throw new AgentChangeError("更新文档必须携带读取时的基准版本。")
    }
    return {
      operation,
      path,
      content,
      reason: reason.trim(),
      baseModifiedAt,
      baseContentHash,
    }
  }
  return { operation, path, content, reason: reason.trim() }
}

function proposalMatchesChange(proposal: AgentChangeProposal, change: WorkspaceDocumentChangeInput) {
  return (
    proposal.operation === change.operation &&
    proposal.relativePath === change.path &&
    proposal.reason === change.reason &&
    proposal.proposedContentHash === agentContentHash(change.content) &&
    proposal.baseModifiedAt?.getTime() === change.baseModifiedAt &&
    (proposal.baseContentHash ?? undefined) === change.baseContentHash
  )
}

function toolParts(messages: readonly TaskMessage[]) {
  return messages.flatMap((message) =>
    message.parts.filter(
      (part): part is TaskToolMessagePart => part.type === "dynamic-tool" || part.type.startsWith("tool-"),
    ),
  )
}

export type AgentChangeService = {
  preview(taskId: string, approvalId: string): AgentChangePreview
  reconcileDecisions(taskId: string, messages: readonly TaskMessage[]): void
}

export function createAgentChangeService(client: DatabaseClient): AgentChangeService {
  return {
    reconcileDecisions: (taskId, messages) => {
      for (const part of toolParts(messages)) {
        if (
          part.type !== "tool-write-workspace-document" ||
          part.state !== "approval-responded" ||
          !part.approval
        ) {
          continue
        }
        const proposal = findAgentChangeProposal(client, part.approval.id)
        if (!proposal || proposal.taskId !== taskId || proposal.toolCallId !== part.toolCallId) {
          throw new AgentChangeError("找不到对应的 Agent 变更提案，无法继续执行。")
        }
        const change = parseWorkspaceDocumentChange(part.input)
        if (!proposalMatchesChange(proposal, change)) {
          throw new AgentChangeError("Agent 变更提案在审批后发生了变化，已阻止执行。")
        }
        if (proposal.status === "pending") {
          const approved = Boolean(part.approval.approved)
          decideAgentChangeProposal(client, proposal.approvalId, approved, part.approval.reason)
          if (approved) {
            completeAgentChangeProposal(
              client,
              proposal.approvalId,
              "failed",
              "旧版逐次文件审批已失效；未执行磁盘写入。",
            )
          }
        }
      }
    },
    preview: (taskId, approvalId) => {
      const proposal = findAgentChangeProposal(client, approvalId)
      if (!proposal || proposal.taskId !== taskId) {
        throw new AgentChangeError("找不到这个 Agent 变更提案。")
      }
      return {
        approvalId: proposal.approvalId,
        toolCallId: proposal.toolCallId,
        operation: proposal.operation,
        path: proposal.relativePath,
        reason: proposal.reason,
        baseContent: proposal.baseContent ?? "",
        baseModifiedAt: proposal.baseModifiedAt?.getTime() ?? null,
        proposedContent: proposal.proposedContent,
        status: proposal.status,
        createdAt: proposal.createdAt.getTime(),
      }
    },
  }
}
