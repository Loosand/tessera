/**
 * [INPUT]: Drizzle 数据库实例、任务执行模式、可选 Skill/工作区绑定、等待输入状态与版本化任务消息
 * [OUTPUT]: 跨工作区最近任务、工作区任务列表，以及带 Skill/等待输入的通用 Chat/Agent 会话幂等读写、重命名和删除
 * [POS]: 普通对话与后续 Agent 共用的任务会话持久化边界
 * [DOC]: docs/architecture/database.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { asc, desc, eq, sql } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import { type TaskSession, taskMessages, taskSessions, workspaces } from "./schema"

export type TaskSessionRecordStatus = TaskSession["status"] | "waiting-input"

export type TaskSessionRecordInput = Pick<
  TaskSession,
  "id" | "mode" | "workspaceId" | "title" | "updatedAt"
> & {
  readonly messagePayloads: readonly string[]
  readonly skillId?: TaskSession["skillId"]
  readonly status: TaskSessionRecordStatus
}

function selectTaskSummaries(client: DatabaseClient) {
  return client.db
    .select({
      id: taskSessions.id,
      mode: taskSessions.mode,
      skillId: taskSessions.skillId,
      workspaceId: taskSessions.workspaceId,
      workspaceName: workspaces.displayName,
      title: taskSessions.title,
      status:
        sql<TaskSessionRecordStatus>`CASE WHEN ${taskSessions.waitingForInput} THEN 'waiting-input' ELSE ${taskSessions.status} END`.as(
          "status",
        ),
      createdAt: taskSessions.createdAt,
      updatedAt: taskSessions.updatedAt,
    })
    .from(taskSessions)
    .leftJoin(workspaces, eq(taskSessions.workspaceId, workspaces.id))
}

export function listWorkspaceTaskSessions(client: DatabaseClient, workspaceId: string, limit = 100) {
  return selectTaskSummaries(client)
    .where(eq(taskSessions.workspaceId, workspaceId))
    .orderBy(desc(taskSessions.updatedAt))
    .limit(limit)
    .all()
}

export function listRecentTaskSessions(client: DatabaseClient, limit = 12) {
  return selectTaskSummaries(client).orderBy(desc(taskSessions.updatedAt)).limit(limit).all()
}

export function findTaskSession(client: DatabaseClient, taskId: string) {
  const session = selectTaskSummaries(client).where(eq(taskSessions.id, taskId)).get()
  if (!session) return null

  const messages = client.db
    .select({ payloadJson: taskMessages.payloadJson })
    .from(taskMessages)
    .where(eq(taskMessages.taskId, taskId))
    .orderBy(asc(taskMessages.sequence))
    .all()

  return { ...session, messagePayloads: messages.map((message) => message.payloadJson) }
}

export function saveTaskSession(client: DatabaseClient, input: TaskSessionRecordInput) {
  const waitingForInput = input.status === "waiting-input"
  const status = waitingForInput ? "running" : input.status
  client.db.transaction((transaction) => {
    transaction
      .insert(taskSessions)
      .values({
        id: input.id,
        mode: input.mode,
        skillId: input.skillId ?? null,
        workspaceId: input.workspaceId,
        title: input.title,
        status,
        waitingForInput,
        updatedAt: input.updatedAt,
      })
      .onConflictDoUpdate({
        target: taskSessions.id,
        set: {
          title: input.title,
          status,
          waitingForInput,
          updatedAt: input.updatedAt,
        },
      })
      .run()

    transaction.delete(taskMessages).where(eq(taskMessages.taskId, input.id)).run()
    if (input.messagePayloads.length > 0) {
      transaction
        .insert(taskMessages)
        .values(
          input.messagePayloads.map((payloadJson, sequence) => ({
            id: `${input.id}:${sequence}`,
            taskId: input.id,
            sequence,
            payloadJson,
          })),
        )
        .run()
    }
  })

  return findTaskSession(client, input.id)
}

export function renameTaskSession(client: DatabaseClient, taskId: string, title: string) {
  const result = client.db
    .update(taskSessions)
    .set({ title, updatedAt: new Date() })
    .where(eq(taskSessions.id, taskId))
    .run()
  return result.changes > 0 ? findTaskSession(client, taskId) : null
}

export function deleteTaskSession(client: DatabaseClient, taskId: string) {
  return client.db.delete(taskSessions).where(eq(taskSessions.id, taskId)).run().changes > 0
}
