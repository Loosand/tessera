/**
 * [INPUT]: Drizzle 数据库实例、含完整 RunPolicy/资源摘要的任务运行元数据、AI SDK 生命周期完成指标与按序序列化的 UIMessageChunk 事件
 * [OUTPUT]: 带实际执行策略、可运行中刷新 ContextManifest 的资源摘要、完成原因、Token/缓存与耗时指标的任务运行创建、幂等事件追加与单调检查点、结束、崩溃中断标记、恢复读取与清理
 * [POS]: Electron 主进程持久化 AI 运行检查点的数据库边界
 * [DOC]: docs/architecture/database.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { asc, desc, eq, sql } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import { type TaskRun, type TaskRunEventRecord, taskRunEvents, taskRuns } from "./schema"

export type TaskRunStatus = TaskRun["status"]

export type TaskRunInput = Pick<
  TaskRun,
  | "requestId"
  | "taskId"
  | "configId"
  | "providerId"
  | "modelId"
  | "policyJson"
  | "resourceSummaryJson"
  | "startedAt"
> & {
  readonly mode: NonNullable<TaskRun["mode"]>
  readonly reasoning: NonNullable<TaskRun["reasoning"]>
  readonly skillId: TaskRun["skillId"]
  readonly webSearch: NonNullable<TaskRun["webSearch"]>
}

export type TaskRunEventInput = Pick<TaskRunEventRecord, "requestId" | "sequence" | "payloadJson">

export type TaskRunCompletionInput = Readonly<
  Partial<
    Pick<
      TaskRun,
      | "sdkCallId"
      | "finishReason"
      | "rawFinishReason"
      | "inputTokens"
      | "cacheReadTokens"
      | "cacheWriteTokens"
      | "outputTokens"
      | "reasoningTokens"
      | "totalTokens"
      | "stepCount"
      | "toolCallCount"
      | "timeToFirstOutputMs"
      | "modelDurationMs"
      | "toolDurationMs"
      | "durationMs"
    >
  >
>

export function startTaskRun(client: DatabaseClient, input: TaskRunInput) {
  client.db
    .insert(taskRuns)
    .values({
      requestId: input.requestId,
      taskId: input.taskId,
      configId: input.configId,
      providerId: input.providerId,
      modelId: input.modelId,
      mode: input.mode,
      skillId: input.skillId,
      reasoning: input.reasoning,
      webSearch: input.webSearch,
      policyJson: input.policyJson,
      resourceSummaryJson: input.resourceSummaryJson,
      status: "running",
      lastSequence: 0,
      startedAt: input.startedAt,
      updatedAt: input.startedAt,
    })
    .run()
}

export function appendTaskRunEvent(client: DatabaseClient, input: TaskRunEventInput) {
  const now = new Date()
  client.db.transaction((transaction) => {
    const inserted = transaction
      .insert(taskRunEvents)
      .values({
        id: `${input.requestId}:${input.sequence}`,
        requestId: input.requestId,
        sequence: input.sequence,
        payloadJson: input.payloadJson,
      })
      .onConflictDoNothing()
      .run()
    if (inserted.changes === 0) return
    transaction
      .update(taskRuns)
      .set({
        lastSequence: sql<number>`max(${taskRuns.lastSequence}, ${input.sequence})`,
        updatedAt: now,
      })
      .where(eq(taskRuns.requestId, input.requestId))
      .run()
  })
}

export function updateTaskRunResourceSummary(
  client: DatabaseClient,
  requestId: string,
  resourceSummaryJson: string,
) {
  return (
    client.db
      .update(taskRuns)
      .set({ resourceSummaryJson, updatedAt: new Date() })
      .where(eq(taskRuns.requestId, requestId))
      .run().changes > 0
  )
}

export function finishTaskRun(
  client: DatabaseClient,
  requestId: string,
  status: Exclude<TaskRunStatus, "running">,
  completion: TaskRunCompletionInput = {},
) {
  const now = new Date()
  return (
    client.db
      .update(taskRuns)
      .set({ ...completion, status, updatedAt: now, completedAt: now })
      .where(eq(taskRuns.requestId, requestId))
      .run().changes > 0
  )
}

export function listRunningTaskRuns(client: DatabaseClient) {
  return client.db.select().from(taskRuns).where(eq(taskRuns.status, "running")).all()
}

export function findLatestTaskRun(client: DatabaseClient, taskId: string) {
  const run = client.db
    .select()
    .from(taskRuns)
    .where(eq(taskRuns.taskId, taskId))
    .orderBy(desc(taskRuns.updatedAt))
    .limit(1)
    .get()
  if (!run) return null
  const events = client.db
    .select()
    .from(taskRunEvents)
    .where(eq(taskRunEvents.requestId, run.requestId))
    .orderBy(asc(taskRunEvents.sequence))
    .all()
  return { ...run, events }
}

export function findLatestTaskRunStatus(client: DatabaseClient, taskId: string) {
  return (
    client.db
      .select({ status: taskRuns.status })
      .from(taskRuns)
      .where(eq(taskRuns.taskId, taskId))
      .orderBy(desc(taskRuns.updatedAt))
      .limit(1)
      .get()?.status ?? null
  )
}

export function findTaskRun(client: DatabaseClient, requestId: string) {
  const run = client.db.select().from(taskRuns).where(eq(taskRuns.requestId, requestId)).get()
  if (!run) return null
  const events = client.db
    .select()
    .from(taskRunEvents)
    .where(eq(taskRunEvents.requestId, requestId))
    .orderBy(asc(taskRunEvents.sequence))
    .all()
  return { ...run, events }
}

export function deleteTaskRuns(client: DatabaseClient, taskId: string) {
  return client.db.delete(taskRuns).where(eq(taskRuns.taskId, taskId)).run().changes
}
