/**
 * [INPUT]: 已有任务运行检查点与每轮实际采用的 mode、Skill、思考和联网策略
 * [OUTPUT]: 可审计且不把旧运行误标为已知策略的逐轮执行策略快照字段
 * [POS]: 数据库从只记录模型连接演进到记录每轮实际执行策略的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const taskRunPolicyMigration = {
  id: "0009-task-run-policy",
  statements: [
    "ALTER TABLE task_runs ADD COLUMN mode TEXT",
    "ALTER TABLE task_runs ADD COLUMN skill_id TEXT",
    "ALTER TABLE task_runs ADD COLUMN reasoning TEXT",
    "ALTER TABLE task_runs ADD COLUMN web_search INTEGER",
  ],
} as const satisfies DatabaseMigration
