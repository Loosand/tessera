/**
 * [INPUT]: SQLite Agent 变更仓储、当前工作区根目录、AI SDK 工具输入/审批 Part 与中止信号
 * [OUTPUT]: 冻结 Markdown 候选内容、审批决定对账、版本复核、原子写入、Diff 预览和审计结果
 * [POS]: Electron 主进程中可写 Agent 的人工审批与文件落盘领域边界
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md、docs/architecture/database.md
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
  findAgentChangeProposalByToolCall,
  saveAgentChangeProposal,
} from "@tessera/database"
import {
  MAX_AGENT_MARKDOWN_BYTES,
  agentContentHash,
  readAgentMarkdownFile,
  resolveAgentCreatePath,
  writeAgentMarkdownFile,
} from "./read-only-agent-tools"

const MAX_REASON_CHARACTERS = 2_000

export interface WorkspaceDocumentChangeInput {
  baseContentHash?: string
  baseModifiedAt?: number
  content: string
  operation: "create" | "update"
  path: string
  reason: string
}

interface RegisterAgentChangeInput {
  approvalId: string
  change: WorkspaceDocumentChangeInput
  modelId: string
  providerId: string
  requestId: string
  rootPath: string
  taskId: string
  toolCallId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function parseWorkspaceDocumentChange(value: unknown): WorkspaceDocumentChangeInput {
  if (!isRecord(value)) throw new Error("Agent 变更输入无效。")
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
    throw new Error("Agent 变更输入无效。")
  }
  if (
    operation === "update" &&
    (typeof baseModifiedAt !== "number" ||
      !Number.isFinite(baseModifiedAt) ||
      typeof baseContentHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(baseContentHash))
  ) {
    throw new Error("更新文档必须携带读取时的基准版本。")
  }
  if (operation === "update") {
    return {
      operation,
      path,
      content,
      reason: reason.trim(),
      baseModifiedAt: baseModifiedAt as number,
      baseContentHash: baseContentHash as string,
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
      (part): part is TaskToolMessagePart =>
        part.type === "dynamic-tool" || part.type.startsWith("tool-"),
    ),
  )
}

export interface AgentChangeService {
  execute(
    taskId: string,
    toolCallId: string,
    value: unknown,
    rootPath: string,
    signal: AbortSignal,
  ): Promise<unknown>
  preview(taskId: string, approvalId: string): AgentChangePreview
  reconcileDecisions(taskId: string, messages: readonly TaskMessage[]): void
  register(input: RegisterAgentChangeInput): Promise<void>
}

export function createAgentChangeService(client: DatabaseClient): AgentChangeService {
  return {
    register: async (input) => {
      const change = parseWorkspaceDocumentChange(input.change)
      let baseContent: string | null = null
      let baseModifiedAt: Date | null = null
      let baseContentHash: string | null = null

      if (change.operation === "update") {
        const current = await readAgentMarkdownFile(
          input.rootPath,
          change.path,
          new AbortController().signal,
        )
        if (
          current.modifiedAt !== change.baseModifiedAt ||
          current.contentHash !== change.baseContentHash
        ) {
          throw new Error(`文档「${current.path}」已发生变化，请重新读取后再提出修改。`)
        }
        baseContent = current.content
        baseModifiedAt = new Date(current.modifiedAt)
        baseContentHash = current.contentHash
      } else {
        const target = await resolveAgentCreatePath(input.rootPath, change.path)
        change.path = target.relativePath
      }

      const proposal = saveAgentChangeProposal(client, {
        approvalId: input.approvalId,
        taskId: input.taskId,
        requestId: input.requestId,
        toolCallId: input.toolCallId,
        providerId: input.providerId,
        modelId: input.modelId,
        operation: change.operation,
        relativePath: change.path,
        reason: change.reason,
        baseContent,
        baseModifiedAt,
        baseContentHash,
        proposedContent: change.content,
        proposedContentHash: agentContentHash(change.content),
        createdAt: new Date(),
      })
      if (!proposal || !proposalMatchesChange(proposal, change)) {
        throw new Error("这个 Agent 审批请求与已冻结的候选内容不一致。")
      }
    },
    reconcileDecisions: (taskId, messages) => {
      for (const part of toolParts(messages)) {
        if (part.state !== "approval-responded" || !part.approval) continue
        const proposal = findAgentChangeProposal(client, part.approval.id)
        if (!proposal || proposal.taskId !== taskId || proposal.toolCallId !== part.toolCallId) {
          throw new Error("找不到对应的 Agent 变更提案，无法继续执行。")
        }
        const change = parseWorkspaceDocumentChange(part.input)
        if (!proposalMatchesChange(proposal, change)) {
          throw new Error("Agent 变更提案在审批后发生了变化，已阻止执行。")
        }
        if (proposal.status === "pending") {
          decideAgentChangeProposal(
            client,
            proposal.approvalId,
            Boolean(part.approval.approved),
            part.approval.reason,
          )
        }
      }
    },
    execute: async (taskId, toolCallId, value, rootPath, signal) => {
      if (signal.aborted) throw new Error("Agent 运行已停止。")
      const change = parseWorkspaceDocumentChange(value)
      const proposal = findAgentChangeProposalByToolCall(client, taskId, toolCallId)
      if (!proposal || proposal.status !== "approved" || !proposalMatchesChange(proposal, change)) {
        throw new Error("这个变更尚未获得有效批准。")
      }

      try {
        if (change.operation === "update") {
          const current = await readAgentMarkdownFile(rootPath, change.path, signal)
          if (
            current.modifiedAt !== change.baseModifiedAt ||
            current.contentHash !== change.baseContentHash
          ) {
            completeAgentChangeProposal(client, proposal.approvalId, "conflict", "磁盘版本已变化")
            return {
              status: "conflict",
              path: current.path,
              message: "审批期间磁盘版本已变化，未写入任何内容。请重新读取并生成新的候选修改。",
            }
          }
        }
        const document = await writeAgentMarkdownFile(
          rootPath,
          change.path,
          change.content,
          change.operation,
        )
        completeAgentChangeProposal(client, proposal.approvalId, "applied")
        return {
          status: "saved",
          operation: change.operation,
          path: document.path,
          modifiedAt: document.modifiedAt,
          contentHash: document.contentHash,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "写入 Markdown 文档失败。"
        completeAgentChangeProposal(client, proposal.approvalId, "failed", message)
        throw new Error(message)
      }
    },
    preview: (taskId, approvalId) => {
      const proposal = findAgentChangeProposal(client, approvalId)
      if (!proposal || proposal.taskId !== taskId) throw new Error("找不到这个 Agent 变更提案。")
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
