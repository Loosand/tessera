/**
 * [INPUT]: 内存 SQLite 中的旧 Agent 变更提案与历史审批 Tool Part
 * [OUTPUT]: 旧提案可预览、拒绝可审计、批准失效且绝不写盘的兼容回归验证
 * [POS]: read/edit/write 上线后旧逐次文件审批边界的集成测试
 * [DOC]: docs/architecture/agent-file-capabilities.md、docs/architecture/agent-simplification-roadmap.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TaskMessage } from "@tessera/contracts"
import {
  agentChangeProposals,
  findAgentChangeProposal,
  openDatabase,
  saveTaskSession,
  saveWorkspace,
  startTaskRun,
} from "@tessera/database"
import { afterEach, describe, expect, test } from "vitest"
import { createAgentChangeService } from "./agent-change-service"
import { agentContentHash } from "./read-only-agent-tools"

const temporaryDirectories: string[] = []
const LEGACY_APPROVAL_ERROR = "旧版逐次文件审批已失效；未执行磁盘写入。"

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function fixture() {
  const rootPath = await mkdtemp(join(tmpdir(), "tessera-agent-change-"))
  temporaryDirectories.push(rootPath)
  const originalContent = "# 原文\n\n旧内容。\n"
  const proposedContent = "# 新文\n\n不应由旧审批写入。\n"
  await writeFile(join(rootPath, "README.md"), originalContent, "utf8")

  const client = openDatabase({ path: ":memory:" })
  saveWorkspace(client, {
    id: "workspace-agent-change",
    rootPath,
    displayName: "审批工作区",
    lastOpenedAt: new Date(),
  })
  saveTaskSession(client, {
    id: "agent-change-task",
    mode: "agent",
    workspaceId: "workspace-agent-change",
    title: "历史审批",
    status: "running",
    updatedAt: new Date(),
    messagePayloads: [],
  })
  startTaskRun(client, {
    configId: "deepseek",
    requestId: "request-change",
    taskId: "agent-change-task",
    providerId: "deepseek",
    modelId: "deepseek-chat",
    mode: "agent",
    skillId: "writing",
    reasoning: "high",
    webSearch: false,
    policyJson: null,
    resourceSummaryJson: null,
    startedAt: new Date(),
  })

  const baseModifiedAt = new Date("2026-01-01T00:00:00.000Z")
  const change = {
    operation: "update" as const,
    path: "README.md",
    content: proposedContent,
    reason: "历史测试",
    baseModifiedAt: baseModifiedAt.getTime(),
    baseContentHash: agentContentHash(originalContent),
  }
  client.db
    .insert(agentChangeProposals)
    .values({
      approvalId: "approval-update",
      taskId: "agent-change-task",
      requestId: "request-change",
      toolCallId: "tool-update",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      operation: "update",
      relativePath: "README.md",
      reason: change.reason,
      baseContent: originalContent,
      baseModifiedAt,
      baseContentHash: change.baseContentHash,
      proposedContent,
      proposedContentHash: agentContentHash(proposedContent),
      status: "pending",
      createdAt: new Date(),
    })
    .run()

  return {
    change,
    client,
    originalContent,
    rootPath,
    service: createAgentChangeService(client),
  }
}

function approvalMessage(input: Record<string, unknown>, approved: boolean): TaskMessage {
  return {
    id: `message-${approved ? "approved" : "rejected"}`,
    role: "assistant",
    parts: [
      {
        type: "tool-write-workspace-document",
        toolCallId: "tool-update",
        state: "approval-responded",
        input,
        approval: { id: "approval-update", approved },
      },
    ],
  }
}

describe("旧 Agent 文件审批兼容", () => {
  test("历史提案仍可读取 Diff 预览", async () => {
    const { client, originalContent, service } = await fixture()

    expect(service.preview("agent-change-task", "approval-update")).toMatchObject({
      path: "README.md",
      baseContent: originalContent,
      status: "pending",
    })
    client.close()
  })

  test("拒绝只记录决定且不写入磁盘", async () => {
    const { change, client, originalContent, rootPath, service } = await fixture()

    service.reconcileDecisions("agent-change-task", [approvalMessage(change, false)])

    expect(findAgentChangeProposal(client, "approval-update")?.status).toBe("rejected")
    expect(await readFile(join(rootPath, "README.md"), "utf8")).toBe(originalContent)
    client.close()
  })

  test("批准立即进入明确失败终态且不写入磁盘", async () => {
    const { change, client, originalContent, rootPath, service } = await fixture()

    service.reconcileDecisions("agent-change-task", [approvalMessage(change, true)])

    expect(findAgentChangeProposal(client, "approval-update")).toMatchObject({
      status: "failed",
      errorMessage: LEGACY_APPROVAL_ERROR,
    })
    expect(await readFile(join(rootPath, "README.md"), "utf8")).toBe(originalContent)
    client.close()
  })

  test("审批输入被篡改时阻止对账并保留 pending", async () => {
    const { change, client, service } = await fixture()

    expect(() =>
      service.reconcileDecisions("agent-change-task", [
        approvalMessage({ ...change, content: "# 被替换的候选\n" }, true),
      ]),
    ).toThrow("提案在审批后发生了变化")
    expect(findAgentChangeProposal(client, "approval-update")?.status).toBe("pending")
    client.close()
  })

  test("忽略其他领域工具的标准审批结果", async () => {
    const { client, service } = await fixture()
    const contentApprovalMessage = {
      id: "message-content-approval",
      role: "assistant",
      parts: [
        {
          type: "tool-create-document",
          toolCallId: "tool-create-document",
          state: "approval-responded",
          input: { title: "测试文档", content: "# 测试文档\n" },
          approval: { id: "approval-create-document", approved: true },
        },
      ],
    } as TaskMessage

    expect(() => service.reconcileDecisions("agent-change-task", [contentApprovalMessage])).not.toThrow()
    client.close()
  })
})
