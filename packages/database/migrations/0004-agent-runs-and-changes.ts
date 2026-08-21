/**
 * [INPUT]: 通用任务会话、AI 运行事件持久化与 Agent Markdown 变更审批需求
 * [OUTPUT]: 可恢复任务运行事件和可审计 Agent 变更提案表
 * [POS]: 数据库从仅保存最终消息演进到保存运行检查点与人工审批的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const agentRunsAndChangesMigration = {
  id: "0004-agent-runs-and-changes",
  statements: [
    `CREATE TABLE task_runs (
      request_id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task_sessions(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
      last_sequence INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    )`,
    "CREATE INDEX task_runs_task_updated_idx ON task_runs (task_id, updated_at)",
    `CREATE TABLE task_run_events (
      id TEXT PRIMARY KEY NOT NULL,
      request_id TEXT NOT NULL REFERENCES task_runs(request_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    "CREATE UNIQUE INDEX task_run_events_request_sequence_unique ON task_run_events (request_id, sequence)",
    `CREATE TABLE agent_change_proposals (
      approval_id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES task_sessions(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL REFERENCES task_runs(request_id) ON DELETE CASCADE,
      tool_call_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('create', 'update')),
      relative_path TEXT NOT NULL,
      reason TEXT NOT NULL,
      base_content TEXT,
      base_modified_at INTEGER,
      base_content_hash TEXT,
      proposed_content TEXT NOT NULL,
      proposed_content_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'conflict', 'failed')),
      decision_reason TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      applied_at INTEGER
    )`,
    "CREATE UNIQUE INDEX agent_change_proposals_task_tool_unique ON agent_change_proposals (task_id, tool_call_id)",
    "CREATE INDEX agent_change_proposals_task_created_idx ON agent_change_proposals (task_id, created_at)",
  ],
} as const satisfies DatabaseMigration
