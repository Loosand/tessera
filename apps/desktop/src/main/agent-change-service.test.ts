/**
 * [INPUT]: 临时 Markdown 工作区、内存 SQLite、冻结提案、人工批准/拒绝与外部磁盘变化
 * [OUTPUT]: Agent 变更预览、批准后原子写入、拒绝不写入和版本冲突保护的回归验证
 * [POS]: 可写 Agent 人工审批主进程边界的集成测试
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
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
import { openDatabase, saveTaskSession, saveWorkspace, startTaskRun } from "@tessera/database"
import { afterEach, describe, expect, test } from "vitest"
import { createAgentChangeService } from "./agent-change-service"
import { agentContentHash, readAgentMarkdownFile } from "./read-only-agent-tools"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function fixture() {
  const rootPath = await mkdtemp(join(tmpdir(), "tessera-agent-change-"))
  temporaryDirectories.push(rootPath)
  await writeFile(join(rootPath, "README.md"), "# 原文\n\n旧内容。\n", "utf8")
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
    title: "修改 README",
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
    startedAt: new Date(),
  })
  const service = createAgentChangeService(client)
  const base = await readAgentMarkdownFile(rootPath, "README.md", new AbortController().signal)
  return { base, client, rootPath, service }
}

function approvedMessage(
  approvalId: string,
  toolCallId: string,
  input: Record<string, unknown>,
  approved: boolean,
): TaskMessage {
  return {
    id: `message-${approvalId}`,
    role: "assistant",
    parts: [
      {
        type: "tool-write-workspace-document",
        toolCallId,
        state: "approval-responded",
        input,
        approval: { id: approvalId, approved },
      },
    ],
  }
}

describe("Agent Markdown 变更审批", () => {
  test("冻结候选内容并在批准后复核版本和原子写入", async () => {
    const { base, client, rootPath, service } = await fixture()
    const change = {
      operation: "update" as const,
      path: "README.md",
      content: "# 新文\n\n已经批准。\n",
      reason: "更新说明",
      baseModifiedAt: base.modifiedAt,
      baseContentHash: base.contentHash,
    }
    await service.register({
      approvalId: "approval-update",
      taskId: "agent-change-task",
      requestId: "request-change",
      toolCallId: "tool-update",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      rootPath,
      change,
    })

    expect(service.preview("agent-change-task", "approval-update")).toMatchObject({
      path: "README.md",
      baseContent: base.content,
      proposedContent: change.content,
      status: "pending",
    })
    service.reconcileDecisions("agent-change-task", [
      approvedMessage("approval-update", "tool-update", change, true),
    ])
    await expect(
      service.execute(
        "agent-change-task",
        "tool-update",
        change,
        rootPath,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: "saved", path: "README.md" })
    expect(await readFile(join(rootPath, "README.md"), "utf8")).toBe(change.content)
    expect(service.preview("agent-change-task", "approval-update").status).toBe("applied")
    client.close()
  })

  test("拒绝后不写入，审批期间外部变化会返回冲突", async () => {
    const { base, client, rootPath, service } = await fixture()
    const rejectedChange = {
      operation: "create" as const,
      path: "notes.md",
      content: "# 不应创建\n",
      reason: "测试拒绝",
    }
    await service.register({
      approvalId: "approval-reject",
      taskId: "agent-change-task",
      requestId: "request-change",
      toolCallId: "tool-reject",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      rootPath,
      change: rejectedChange,
    })
    service.reconcileDecisions("agent-change-task", [
      approvedMessage("approval-reject", "tool-reject", rejectedChange, false),
    ])
    await expect(
      service.execute(
        "agent-change-task",
        "tool-reject",
        rejectedChange,
        rootPath,
        new AbortController().signal,
      ),
    ).rejects.toThrow("尚未获得有效批准")

    const conflictChange = {
      operation: "update" as const,
      path: "README.md",
      content: "# 候选版本\n",
      reason: "测试冲突",
      baseModifiedAt: base.modifiedAt,
      baseContentHash: agentContentHash(base.content),
    }
    await service.register({
      approvalId: "approval-conflict",
      taskId: "agent-change-task",
      requestId: "request-change",
      toolCallId: "tool-conflict",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      rootPath,
      change: conflictChange,
    })
    service.reconcileDecisions("agent-change-task", [
      approvedMessage("approval-conflict", "tool-conflict", conflictChange, true),
    ])
    await new Promise((resolve) => setTimeout(resolve, 4))
    await writeFile(join(rootPath, "README.md"), "# 外部版本\n", "utf8")
    await expect(
      service.execute(
        "agent-change-task",
        "tool-conflict",
        conflictChange,
        rootPath,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: "conflict" })
    expect(await readFile(join(rootPath, "README.md"), "utf8")).toBe("# 外部版本\n")
    client.close()
  })
})
