/**
 * [INPUT]: 已发布的工作区与 Agent 表、通用 Chat/Agent 任务会话模型
 * [OUTPUT]: 可选工作区绑定的任务会话表、版本化消息表与旧 Chat 快照迁移
 * [POS]: 数据库从 Agent 专用会话演进到通用任务会话的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const taskSessionsMigration: DatabaseMigration = {
  id: "0002-task-sessions",
  statements: [
    `CREATE TABLE task_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      mode TEXT NOT NULL DEFAULT 'chat' CHECK (mode IN ('chat', 'agent')),
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'completed', 'failed', 'cancelled')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL,
      CHECK (mode = 'chat' OR workspace_id IS NOT NULL)
    )`,
    "CREATE INDEX task_sessions_updated_idx ON task_sessions (updated_at)",
    "CREATE INDEX task_sessions_workspace_updated_idx ON task_sessions (workspace_id, updated_at)",
    `CREATE TABLE task_messages (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task_sessions(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    "CREATE UNIQUE INDEX task_messages_task_sequence_unique ON task_messages (task_id, sequence)",
    "CREATE INDEX task_messages_task_idx ON task_messages (task_id)",
    `INSERT OR IGNORE INTO task_sessions (
      id, mode, workspace_id, title, status, created_at, updated_at
    )
    SELECT sessions.id, 'chat', sessions.workspace_id, sessions.title, sessions.status,
      sessions.created_at, sessions.updated_at
    FROM agent_sessions AS sessions
    WHERE EXISTS (
      SELECT 1 FROM agent_events AS events
      WHERE events.session_id = sessions.id AND events.kind = 'chat.snapshot'
    )`,
    `INSERT OR IGNORE INTO task_messages (id, task_id, sequence, payload_json, created_at)
    SELECT sessions.id || ':legacy:' || messages.key, sessions.id, CAST(messages.key AS INTEGER),
      messages.value, events.created_at
    FROM agent_events AS events
    JOIN task_sessions AS sessions ON sessions.id = events.session_id
    JOIN json_each(CASE WHEN json_valid(events.payload) THEN events.payload ELSE '[]' END) AS messages
    WHERE events.kind = 'chat.snapshot'
      AND json_valid(events.payload)
      AND json_type(CASE WHEN json_valid(events.payload) THEN events.payload ELSE '[]' END) = 'array'`,
  ],
}
