/**
 * [INPUT]: 既有 workspaces 表与最近工作区可恢复移除需求
 * [OUTPUT]: 工作区最近列表隐藏时间字段
 * [POS]: 工作区历史展示状态的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const workspaceRecentsMigration = {
  id: "0003-workspace-recents",
  statements: ["ALTER TABLE workspaces ADD COLUMN hidden_at INTEGER;"],
} as const satisfies DatabaseMigration
