/**
 * [INPUT]: Drizzle 数据库实例、当前工作区与任务会话快照
 * [OUTPUT]: 跨工作区最近任务、工作区任务列表，以及会话消息快照的幂等读写
 * [POS]: 普通对话与后续 Agent 共用的任务会话持久化边界
 * [DOC]: docs/architecture/database.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { and, desc, eq } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import { agentEvents, agentSessions, workspaces } from "./schema"

const CHAT_SNAPSHOT_KIND = "chat.snapshot"
const CHAT_SNAPSHOT_SEQUENCE = 0

export interface TaskSessionRecordInput {
  id: string
  messagesJson: string
  status: "idle" | "running" | "completed" | "failed" | "cancelled"
  title: string
  updatedAt: Date
  workspaceId: string
}

function selectTaskSummaries(client: DatabaseClient) {
  return client.db
    .select({
      id: agentSessions.id,
      workspaceId: agentSessions.workspaceId,
      workspaceName: workspaces.displayName,
      title: agentSessions.title,
      status: agentSessions.status,
      createdAt: agentSessions.createdAt,
      updatedAt: agentSessions.updatedAt,
    })
    .from(agentSessions)
    .innerJoin(workspaces, eq(agentSessions.workspaceId, workspaces.id))
}

export function listWorkspaceTaskSessions(client: DatabaseClient, workspaceId: string, limit = 100) {
  return selectTaskSummaries(client)
    .where(eq(agentSessions.workspaceId, workspaceId))
    .orderBy(desc(agentSessions.updatedAt))
    .limit(limit)
    .all()
}

export function listRecentTaskSessions(client: DatabaseClient, limit = 12) {
  return selectTaskSummaries(client).orderBy(desc(agentSessions.updatedAt)).limit(limit).all()
}

export function findTaskSession(client: DatabaseClient, workspaceId: string, taskId: string) {
  const session = selectTaskSummaries(client)
    .where(and(eq(agentSessions.id, taskId), eq(agentSessions.workspaceId, workspaceId)))
    .get()
  if (!session) return null

  const snapshot = client.db
    .select({ payload: agentEvents.payload })
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.sessionId, taskId),
        eq(agentEvents.sequence, CHAT_SNAPSHOT_SEQUENCE),
        eq(agentEvents.kind, CHAT_SNAPSHOT_KIND),
      ),
    )
    .get()

  return { ...session, messagesJson: snapshot?.payload ?? "[]" }
}

export function saveTaskSession(client: DatabaseClient, input: TaskSessionRecordInput) {
  client.db.transaction((transaction) => {
    transaction
      .insert(agentSessions)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        title: input.title,
        status: input.status,
        updatedAt: input.updatedAt,
      })
      .onConflictDoUpdate({
        target: agentSessions.id,
        set: {
          title: input.title,
          status: input.status,
          updatedAt: input.updatedAt,
        },
      })
      .run()

    transaction
      .insert(agentEvents)
      .values({
        id: `${input.id}:${CHAT_SNAPSHOT_KIND}`,
        sessionId: input.id,
        sequence: CHAT_SNAPSHOT_SEQUENCE,
        kind: CHAT_SNAPSHOT_KIND,
        payload: input.messagesJson,
      })
      .onConflictDoUpdate({
        target: [agentEvents.sessionId, agentEvents.sequence],
        set: {
          kind: CHAT_SNAPSHOT_KIND,
          payload: input.messagesJson,
        },
      })
      .run()
  })

  return findTaskSession(client, input.workspaceId, input.id)
}
