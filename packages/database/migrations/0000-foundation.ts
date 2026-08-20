/**
 * [INPUT]: 初始 SQLite 数据模型与索引约束
 * [OUTPUT]: 可在单个事务中执行的 0000-foundation 迁移
 * [POS]: Tessera 本地数据库的首个前向迁移
 * [DOC]: docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const foundationMigration: DatabaseMigration = {
  id: "0000-foundation",
  statements: [
    `CREATE TABLE workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      root_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      last_opened_at INTEGER NOT NULL
    )`,
    "CREATE UNIQUE INDEX workspaces_root_path_unique ON workspaces (root_path)",
    `CREATE TABLE document_index (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source_modified_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    )`,
    "CREATE UNIQUE INDEX document_index_workspace_path_unique ON document_index (workspace_id, relative_path)",
    "CREATE INDEX document_index_workspace_idx ON document_index (workspace_id)",
    `CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'completed', 'failed', 'cancelled')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL
    )`,
    "CREATE INDEX agent_sessions_workspace_updated_idx ON agent_sessions (workspace_id, updated_at)",
    `CREATE TABLE agent_events (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    "CREATE UNIQUE INDEX agent_events_session_sequence_unique ON agent_events (session_id, sequence)",
    `CREATE TABLE permission_decisions (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      effect TEXT NOT NULL CHECK (effect IN ('allow', 'ask', 'deny')),
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    "CREATE INDEX permission_decisions_session_created_idx ON permission_decisions (session_id, created_at)",
  ],
}
