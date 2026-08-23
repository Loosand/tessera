/**
 * [INPUT]: 共享任务会话、三类 RunPolicy、按序 AI SDK UIMessageChunk 事件、托管内容库操作与磁盘 SQLite 重启
 * [OUTPUT]: 普通问答→研究→写作/创建/移动内容→中断恢复的统一 Agent 持久化验收
 * [POS]: unified creation agent 的主进程/数据库级端到端协议测试；不依赖真实供应商与研究领域实现
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AiChatStreamChunk,
  AiChatStreamEvent,
  TaskMessage,
  TaskRunPolicy,
  TaskRunResourceSummary,
} from "@tessera/contracts"
import {
  type DatabaseClient,
  appendTaskRunEvent,
  findTaskRun,
  finishTaskRun,
  openDatabase,
  startTaskRun,
} from "@tessera/database"
import { describe, expect, it } from "vitest"
import { createContentLibraryService } from "./content-library-service"
import { inspectTaskRun } from "./task-run-inspection"
import { recoverInterruptedTaskRuns } from "./task-run-recovery"
import { createDesktopTaskService } from "./task-service"

const TASK_ID = "task-unified-runtime"

function appendEvents(client: DatabaseClient, requestId: string, chunks: AiChatStreamChunk[]) {
  chunks.forEach((chunk, index) => {
    const sequence = index + 1
    const event = { taskId: TASK_ID, requestId, sequence, chunk } satisfies AiChatStreamEvent
    appendTaskRunEvent(client, { requestId, sequence, payloadJson: JSON.stringify(event) })
  })
}

function startRun(
  client: DatabaseClient,
  requestId: string,
  policy: TaskRunPolicy,
  resources: TaskRunResourceSummary,
) {
  startTaskRun(client, {
    requestId,
    taskId: TASK_ID,
    configId: "deepseek-main",
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    mode: policy.mode,
    skillId: policy.skillId,
    reasoning: policy.reasoning,
    webSearch: policy.webSearch,
    policyJson: JSON.stringify(policy),
    resourceSummaryJson: JSON.stringify(resources),
    startedAt: new Date(1_000),
  })
}

const noResources = {
  attachmentCount: 0,
  currentDocumentPath: null,
  researchNetworkMode: null,
  workspaceId: null,
  workspaceName: null,
} satisfies TaskRunResourceSummary

describe("unified Agent runtime", () => {
  it("让同一任务逐轮使用不同能力，并在重启后解释内容操作和中断原因", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "tessera-unified-runtime-"))
    const libraryPath = join(basePath, "library")
    const databasePath = join(basePath, "tessera.sqlite")
    await mkdir(libraryPath)
    let client: DatabaseClient | null = openDatabase({ path: databasePath })
    try {
      const taskService = createDesktopTaskService(client)
      taskService.save(
        {
          id: TASK_ID,
          mode: "chat",
          skillId: null,
          status: "completed",
          title: "Celeste 主角",
          workspaceId: null,
          messages: [],
        },
        null,
      )

      const answerPolicy = {
        limits: { maxOutputTokens: 4_096, maxSteps: 4, timeoutMs: 60_000 },
        mode: "chat",
        reasoning: "auto",
        skillId: null,
        toolScope: "conversation",
        webSearch: false,
      } satisfies TaskRunPolicy
      startRun(client, "run-answer", answerPolicy, noResources)
      appendEvents(client, "run-answer", [
        { type: "start", messageId: "assistant-answer" },
        { type: "text-start", id: "answer" },
        { type: "text-delta", id: "answer", delta: "主角是 Madeline。" },
        { type: "text-end", id: "answer" },
        { type: "finish", finishReason: "stop" },
      ])
      finishTaskRun(client, "run-answer", "completed", { finishReason: "stop", durationMs: 600 })

      const researchPolicy = {
        limits: { maxOutputTokens: null, maxSteps: 20, timeoutMs: 300_000 },
        mode: "chat",
        reasoning: "high",
        skillId: "research",
        toolScope: "conversation",
        webSearch: true,
      } satisfies TaskRunPolicy
      startRun(client, "run-research", researchPolicy, {
        ...noResources,
        researchNetworkMode: "system",
      })
      appendEvents(client, "run-research", [
        { type: "start", messageId: "assistant-research" },
        {
          type: "tool-input-available",
          toolCallId: "plan-1",
          toolName: "publish-research-plan",
          input: { objective: "了解 Madeline" },
        },
        { type: "tool-output-available", toolCallId: "plan-1", output: { status: "published" } },
        {
          type: "tool-input-available",
          toolCallId: "search-1",
          toolName: "web_search",
          input: { query: "Celeste Madeline" },
        },
        { type: "tool-output-available", toolCallId: "search-1", output: [] },
        {
          type: "tool-input-available",
          toolCallId: "read-1",
          toolName: "read-web-source",
          input: { url: "https://example.com/celeste" },
        },
        { type: "tool-output-available", toolCallId: "read-1", output: { title: "Celeste" } },
        { type: "finish", finishReason: "stop" },
      ])
      finishTaskRun(client, "run-research", "completed", { finishReason: "stop", durationMs: 2_400 })

      const writingPolicy = {
        limits: { maxOutputTokens: 8_192, maxSteps: 12, timeoutMs: 180_000 },
        mode: "chat",
        reasoning: "medium",
        skillId: "writing",
        toolScope: "conversation",
        webSearch: true,
      } satisfies TaskRunPolicy
      startRun(client, "run-writing", writingPolicy, noResources)
      const content = createContentLibraryService(client)
      await content.configure(libraryPath)
      const artifact = await content.createDocument(
        { taskId: TASK_ID, runId: "run-writing" },
        { title: "玛德琳：与自己和解的攀登", content: "# 玛德琳\n\n与自己和解。", reason: "写作" },
      )
      const project = await content.createProject(
        { taskId: TASK_ID, runId: "run-writing" },
        { name: "Celeste 专题" },
      )
      await content.moveDocuments(
        { taskId: TASK_ID, runId: "run-writing" },
        { documentIds: [artifact.documentId], targetProjectId: project.id },
      )
      appendEvents(client, "run-writing", [
        { type: "start", messageId: "assistant-writing" },
        {
          type: "tool-input-available",
          toolCallId: "create-1",
          toolName: "create-document",
          input: { title: artifact.document.title },
        },
        { type: "tool-output-available", toolCallId: "create-1", output: artifact },
        {
          type: "tool-input-available",
          toolCallId: "project-1",
          toolName: "create-project",
          input: { name: project.name },
        },
        { type: "tool-output-available", toolCallId: "project-1", output: project },
        {
          type: "tool-input-available",
          toolCallId: "move-1",
          toolName: "move-documents",
          input: { documentIds: [artifact.documentId], targetProjectId: project.id },
        },
        { type: "tool-output-available", toolCallId: "move-1", output: { moved: 1 } },
        { type: "finish", finishReason: "stop" },
      ])
      finishTaskRun(client, "run-writing", "completed", { finishReason: "stop", durationMs: 1_800 })

      const messages: TaskMessage[] = [
        { id: "user-answer", role: "user", parts: [{ type: "text", text: "主角是谁？" }] },
        {
          id: "assistant-answer",
          role: "assistant",
          metadata: { requestId: "run-answer", providerId: "deepseek", modelId: "deepseek-v4-flash" },
          parts: [{ type: "text", text: "主角是 Madeline。", state: "done" }],
        },
        { id: "user-research", role: "user", parts: [{ type: "text", text: "深入研究。" }] },
        {
          id: "assistant-research",
          role: "assistant",
          metadata: { requestId: "run-research", providerId: "deepseek", modelId: "deepseek-v4-flash" },
          parts: [{ type: "text", text: "研究完成。", state: "done" }],
        },
        { id: "user-writing", role: "user", parts: [{ type: "text", text: "写稿并建立项目。" }] },
        {
          id: "assistant-writing",
          role: "assistant",
          metadata: { requestId: "run-writing", providerId: "deepseek", modelId: "deepseek-v4-flash" },
          parts: [{ type: "text", text: "稿件已移动到专题。", state: "done" }],
        },
      ]
      taskService.save(
        {
          id: TASK_ID,
          mode: "chat",
          skillId: "writing",
          status: "running",
          title: "Celeste 主角",
          workspaceId: null,
          messages,
        },
        null,
      )

      startRun(client, "run-interrupted", answerPolicy, noResources)
      appendEvents(client, "run-interrupted", [
        { type: "start", messageId: "assistant-interrupted" },
        { type: "text-start", id: "partial" },
        { type: "text-delta", id: "partial", delta: "已经生成的部分" },
      ])

      client.close()
      client = openDatabase({ path: databasePath })
      const restoredTaskService = createDesktopTaskService(client)
      expect(
        recoverInterruptedTaskRuns(
          client,
          (taskId, status) => restoredTaskService.setRunStatus(taskId, status),
          4_000,
        ),
      ).toEqual(["run-interrupted"])

      const answer = findTaskRun(client, "run-answer")
      const research = findTaskRun(client, "run-research")
      const writing = findTaskRun(client, "run-writing")
      const interrupted = findTaskRun(client, "run-interrupted")
      expect(answer && inspectTaskRun(answer)).toMatchObject({
        policy: { skillId: null, webSearch: false },
        tools: [],
        status: "completed",
      })
      expect(research && inspectTaskRun(research)).toMatchObject({
        policy: { skillId: "research", reasoning: "high", webSearch: true },
        resources: { researchNetworkMode: "system" },
        tools: [
          { name: "publish-research-plan", callCount: 1 },
          { name: "web_search", callCount: 1 },
          { name: "read-web-source", callCount: 1 },
        ],
      })
      expect(writing && inspectTaskRun(writing)).toMatchObject({
        policy: { skillId: "writing" },
        tools: [
          { name: "create-document", callCount: 1 },
          { name: "create-project", callCount: 1 },
          { name: "move-documents", callCount: 1 },
        ],
      })
      expect(interrupted && inspectTaskRun(interrupted)).toMatchObject({
        status: "interrupted",
        failure: { code: "stream-interrupted", retryable: true },
        finishReason: "interrupted",
      })
      expect(restoredTaskService.read(TASK_ID)).toMatchObject({ status: "failed", messages })
      expect(createContentLibraryService(client).listArtifacts(TASK_ID)).toMatchObject([
        { documentId: artifact.documentId, project: { id: project.id, name: "Celeste 专题" } },
      ])
      await expect(
        readFile(join(libraryPath, "Celeste 专题", "玛德琳：与自己和解的攀登.md"), "utf8"),
      ).resolves.toContain("与自己和解")
    } finally {
      client?.close()
      await rm(basePath, { recursive: true, force: true })
    }
  })
})
