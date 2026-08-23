/**
 * [INPUT]: 临时 SQLite 中已结束但会话仍 running 的任务，以及应用退出时仍在运行的任务
 * [OUTPUT]: 重启恢复对运行状态漂移和真正中断运行的回归验证
 * [POS]: Electron 主进程任务运行恢复协议的聚焦测试
 * [DOC]: docs/architecture/database.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendTaskRunEvent,
  findTaskRun,
  findTaskSession,
  finishTaskRun,
  openDatabase,
  saveTaskSession,
  startTaskRun,
  updateTaskSessionStatus,
} from "@tessera/database"
import { describe, expect, it } from "vitest"
import { findUnpersistedLatestTaskRun, recoverInterruptedTaskRuns } from "./task-run-recovery"

const POLICY_JSON = JSON.stringify({
  limits: { maxOutputTokens: null, maxSteps: 64, timeoutMs: 1_800_000 },
  mode: "agent",
  reasoning: "high",
  skillId: "research",
  toolScope: "workspace-write",
  webSearch: true,
})

function createTask(client: ReturnType<typeof openDatabase>, id: string) {
  saveTaskSession(client, {
    id,
    mode: "chat",
    workspaceId: null,
    title: id,
    status: "running",
    messagePayloads: [],
    updatedAt: new Date(1_000),
  })
}

function createRun(client: ReturnType<typeof openDatabase>, taskId: string, requestId: string) {
  startTaskRun(client, {
    requestId,
    taskId,
    configId: "deepseek",
    providerId: "deepseek",
    modelId: "deepseek-v4-pro",
    mode: "agent",
    skillId: "research",
    reasoning: "high",
    webSearch: true,
    policyJson: POLICY_JSON,
    resourceSummaryJson: "{}",
    startedAt: new Date(1_000),
  })
}

describe("任务运行重启恢复", () => {
  it("校正已完成运行的会话状态，并只把真正运行中的请求标为中断", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tessera-task-recovery-"))
    const client = openDatabase({ path: join(directory, "tessera.sqlite3") })
    try {
      createTask(client, "task-completed")
      createRun(client, "task-completed", "run-completed")
      finishTaskRun(client, "run-completed", "completed", { finishReason: "stop" })

      createTask(client, "task-interrupted")
      createRun(client, "task-interrupted", "run-interrupted")

      expect(
        recoverInterruptedTaskRuns(
          client,
          (taskId, status) => updateTaskSessionStatus(client, taskId, status),
          4_000,
        ),
      ).toEqual(["run-interrupted"])
      expect(findTaskSession(client, "task-completed")?.status).toBe("completed")
      expect(findTaskSession(client, "task-interrupted")?.status).toBe("failed")
      expect(findTaskRun(client, "run-interrupted")).toMatchObject({
        status: "interrupted",
        finishReason: "interrupted",
      })
    } finally {
      client.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("只重放尚未进入助手消息的最新终态运行", () => {
    const client = openDatabase({ path: ":memory:" })
    try {
      createTask(client, "task-orphaned-output")
      createRun(client, "task-orphaned-output", "run-orphaned-output")
      for (const [index, chunk] of [
        { type: "start", messageId: "assistant-orphaned" },
        { type: "text-start", id: "answer" },
        { type: "text-delta", id: "answer", delta: "已经完成的报告" },
        { type: "text-end", id: "answer" },
        { type: "finish", finishReason: "stop" },
      ].entries()) {
        const sequence = index + 1
        appendTaskRunEvent(client, {
          requestId: "run-orphaned-output",
          sequence,
          payloadJson: JSON.stringify({
            taskId: "task-orphaned-output",
            requestId: "run-orphaned-output",
            sequence,
            chunk,
          }),
        })
      }
      finishTaskRun(client, "run-orphaned-output", "completed", { finishReason: "stop" })
      updateTaskSessionStatus(client, "task-orphaned-output", "completed")

      const orphaned = findUnpersistedLatestTaskRun(client, {
        id: "task-orphaned-output",
        messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "请研究" }] }],
      })
      expect(orphaned).toMatchObject({ requestId: "run-orphaned-output", status: "completed" })

      expect(
        findUnpersistedLatestTaskRun(client, {
          id: "task-orphaned-output",
          messages: [
            {
              id: "assistant",
              role: "assistant",
              metadata: { requestId: "run-orphaned-output" },
              parts: [{ type: "text", text: "已经完成的报告" }],
            },
          ],
        }),
      ).toBeNull()
    } finally {
      client.close()
    }
  })
})
