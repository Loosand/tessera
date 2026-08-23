/**
 * [INPUT]: Drizzle 数据库实例、任务执行模式、作为下一轮默认值的可选 Skill、工作区绑定、置顶/归档状态、等待输入状态与版本化任务消息
 * [OUTPUT]: 跨空间最近活动任务、默认空间/文件工作区任务列表与活动/归档稳定分页，以及带可变 Skill 默认值/等待输入的通用任务会话幂等读写、置顶/归档、主进程运行状态收口、重命名和删除
 * [POS]: 普通对话与后续 Agent 共用的任务会话持久化边界
 * [DOC]: docs/architecture/database.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import { type TaskSession, taskMessages, taskSessions, workspaces } from "./schema"

export type TaskSessionRecordStatus = TaskSession["status"] | "waiting-input"

export type TaskSessionPageQuery = {
  readonly archived?: boolean
  readonly limit: number
  readonly offset: number
}

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
      pinnedAt: taskSessions.pinnedAt,
      archivedAt: taskSessions.archivedAt,
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
    .where(and(eq(taskSessions.workspaceId, workspaceId), isNull(taskSessions.archivedAt)))
    .orderBy(
      sql`${taskSessions.pinnedAt} IS NOT NULL DESC`,
      desc(taskSessions.pinnedAt),
      desc(taskSessions.updatedAt),
      desc(taskSessions.createdAt),
      desc(taskSessions.id),
    )
    .limit(limit)
    .all()
}

export function listDefaultTaskSessions(client: DatabaseClient, limit = 100) {
  return selectTaskSummaries(client)
    .where(and(isNull(taskSessions.workspaceId), isNull(taskSessions.archivedAt)))
    .orderBy(
      sql`${taskSessions.pinnedAt} IS NOT NULL DESC`,
      desc(taskSessions.pinnedAt),
      desc(taskSessions.updatedAt),
      desc(taskSessions.createdAt),
      desc(taskSessions.id),
    )
    .limit(limit)
    .all()
}

export function listRecentTaskSessions(client: DatabaseClient, limit = 12) {
  return selectTaskSummaries(client)
    .where(isNull(taskSessions.archivedAt))
    .orderBy(
      sql`${taskSessions.pinnedAt} IS NOT NULL DESC`,
      desc(taskSessions.pinnedAt),
      desc(taskSessions.updatedAt),
      desc(taskSessions.createdAt),
      desc(taskSessions.id),
    )
    .limit(limit)
    .all()
}

export function listWorkspaceTaskSessionsPage(
  client: DatabaseClient,
  workspaceId: string,
  query: TaskSessionPageQuery,
) {
  const archived = query.archived === true
  const scope = archived ? isNotNull(taskSessions.archivedAt) : isNull(taskSessions.archivedAt)
  const items = selectTaskSummaries(client)
    .where(and(eq(taskSessions.workspaceId, workspaceId), scope))
    .orderBy(
      archived ? desc(taskSessions.archivedAt) : sql`${taskSessions.pinnedAt} IS NOT NULL DESC`,
      desc(taskSessions.pinnedAt),
      desc(taskSessions.updatedAt),
      desc(taskSessions.createdAt),
      desc(taskSessions.id),
    )
    .limit(query.limit)
    .offset(query.offset)
    .all()
  const total = client.db
    .select({ value: sql<number>`count(*)` })
    .from(taskSessions)
    .where(and(eq(taskSessions.workspaceId, workspaceId), scope))
    .get()?.value
  return { items, total: Number(total ?? 0) }
}

export function listDefaultTaskSessionsPage(client: DatabaseClient, query: TaskSessionPageQuery) {
  const archived = query.archived === true
  const scope = archived ? isNotNull(taskSessions.archivedAt) : isNull(taskSessions.archivedAt)
  const items = selectTaskSummaries(client)
    .where(and(isNull(taskSessions.workspaceId), scope))
    .orderBy(
      archived ? desc(taskSessions.archivedAt) : sql`${taskSessions.pinnedAt} IS NOT NULL DESC`,
      desc(taskSessions.pinnedAt),
      desc(taskSessions.updatedAt),
      desc(taskSessions.createdAt),
      desc(taskSessions.id),
    )
    .limit(query.limit)
    .offset(query.offset)
    .all()
  const total = client.db
    .select({ value: sql<number>`count(*)` })
    .from(taskSessions)
    .where(and(isNull(taskSessions.workspaceId), scope))
    .get()?.value
  return { items, total: Number(total ?? 0) }
}

export function listTaskSessionRunStates(client: DatabaseClient) {
  return client.db
    .select({ id: taskSessions.id, status: taskSessions.status })
    .from(taskSessions)
    .where(eq(taskSessions.waitingForInput, false))
    .all()
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
          archivedAt: null,
          skillId: input.skillId ?? null,
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

export function setTaskSessionPinned(client: DatabaseClient, taskId: string, pinned: boolean) {
  const result = client.db
    .update(taskSessions)
    .set({ pinnedAt: pinned ? new Date() : null })
    .where(and(eq(taskSessions.id, taskId), isNull(taskSessions.archivedAt)))
    .run()
  return result.changes > 0 ? findTaskSession(client, taskId) : null
}

export function setTaskSessionArchived(client: DatabaseClient, taskId: string, archived: boolean) {
  const result = client.db
    .update(taskSessions)
    .set(archived ? { archivedAt: new Date(), pinnedAt: null } : { archivedAt: null })
    .where(eq(taskSessions.id, taskId))
    .run()
  return result.changes > 0 ? findTaskSession(client, taskId) : null
}

export function updateTaskSessionStatus(
  client: DatabaseClient,
  taskId: string,
  status: TaskSessionRecordStatus,
) {
  const waitingForInput = status === "waiting-input"
  const persistedStatus = waitingForInput ? "running" : status
  const result = client.db
    .update(taskSessions)
    .set({ status: persistedStatus, waitingForInput, updatedAt: new Date() })
    .where(eq(taskSessions.id, taskId))
    .run()
  return result.changes > 0 ? findTaskSession(client, taskId) : null
}

export function deleteTaskSession(client: DatabaseClient, taskId: string) {
  return client.db.delete(taskSessions).where(eq(taskSessions.id, taskId)).run().changes > 0
}
