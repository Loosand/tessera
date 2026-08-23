/**
 * [INPUT]: 已阅读研究来源的推荐、用户保存决策与正式材料文档关联需求
 * [OUTPUT]: 可恢复、可审计且与读取状态分离的研究来源推荐表
 * [POS]: 研究闭环从证据核验进入材料沉淀阶段的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const researchSourceRecommendationsMigration = {
  id: "0017-research-source-recommendations",
  statements: [
    `CREATE TABLE research_source_recommendations (
      id TEXT PRIMARY KEY NOT NULL,
      request_id TEXT NOT NULL REFERENCES research_runs(request_id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'recommended' CHECK (status IN ('recommended', 'saved', 'dismissed')),
      saved_document_id TEXT REFERENCES document_index(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL,
      UNIQUE (request_id, source_id)
    )`,
    "CREATE INDEX research_source_recommendations_run_status_idx ON research_source_recommendations (request_id, status)",
  ],
} as const satisfies DatabaseMigration
