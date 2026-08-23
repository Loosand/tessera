/**
 * [INPUT]: 对话列表需要持久化置顶顺序、归档状态与可恢复入口
 * [OUTPUT]: task_sessions 的 pinned_at / archived_at 字段及作用域列表索引
 * [POS]: 任务导航从纯时间排序演进为活动/归档分区与置顶排序的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const taskPlacementMigration = {
  id: "0018-task-placement",
  statements: [
    "ALTER TABLE task_sessions ADD COLUMN pinned_at INTEGER",
    "ALTER TABLE task_sessions ADD COLUMN archived_at INTEGER",
    "CREATE INDEX task_sessions_workspace_archive_pin_idx ON task_sessions (workspace_id, archived_at, pinned_at, updated_at)",
  ],
} as const satisfies DatabaseMigration
