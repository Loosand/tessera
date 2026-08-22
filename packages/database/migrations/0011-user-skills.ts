/**
 * [INPUT]: 用户导入 Skill 的托管目录元数据、启用状态与安装统计
 * [OUTPUT]: 可前向创建的 user_skill_configs 表及启用/名称索引
 * [POS]: 数据库从任务 Skill 标识演进到用户级 Skill 安装目录的迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const userSkillsMigration = {
  id: "0011-user-skills",
  statements: [
    `CREATE TABLE user_skill_configs (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      file_count INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      installed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    "CREATE INDEX user_skill_configs_enabled_idx ON user_skill_configs (enabled)",
    "CREATE INDEX user_skill_configs_name_idx ON user_skill_configs (name)",
  ],
} as const satisfies DatabaseMigration
