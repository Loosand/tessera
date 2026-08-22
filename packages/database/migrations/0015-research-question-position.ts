/**
 * [INPUT]: 已执行 0014 但尚未持久化研究问题顺序的本地数据库
 * [OUTPUT]: 为 research_questions 追加稳定 position，并按原创建顺序回填既有问题
 * [POS]: 修复开发期 0014 迁移漂移的只向前兼容迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const researchQuestionPositionMigration = {
  id: "0015-research-question-position",
  statements: [
    "ALTER TABLE research_questions ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
    `UPDATE research_questions AS question
      SET position = (
        SELECT COUNT(*)
        FROM research_questions AS previous
        WHERE previous.request_id = question.request_id
          AND (
            previous.created_at < question.created_at
            OR (previous.created_at = question.created_at AND previous.id < question.id)
          )
      )`,
  ],
} as const satisfies DatabaseMigration
