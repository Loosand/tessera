/**
 * [INPUT]: 已有 Chat/Agent 任务会话
 * [OUTPUT]: 与执行模式正交、可为空的任务 Skill 选择
 * [POS]: 数据库从单一 mode 演进到 mode 与 Skill 双维度任务配置的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const taskSkillsMigration = {
  id: "0006-task-skills",
  statements: ["ALTER TABLE task_sessions ADD COLUMN skill_id TEXT"],
} as const satisfies DatabaseMigration
