/**
 * [INPUT]: 尚未持久化非敏感应用级偏好的本地数据库
 * [OUTPUT]: 可由主进程读写的通用 app_settings 键值表
 * [POS]: 研究网络模式等应用级偏好的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const appSettingsMigration = {
  id: "0016-app-settings",
  statements: [
    `CREATE TABLE app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ],
} as const satisfies DatabaseMigration
