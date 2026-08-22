/**
 * [INPUT]: 可信研究闭环对计划、问题、来源读取、证据与完成状态的持久化需求
 * [OUTPUT]: 绑定 task_run 的研究控制层表、来源去重索引和证据关系
 * [POS]: 统一 Agent 从研究能力预设演进为可恢复研究工作流的前向迁移
 * [DOC]: docs/architecture/database.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DatabaseMigration } from "./types"

export const researchWorkflowMigration = {
  id: "0014-research-workflow",
  statements: [
    `CREATE TABLE research_runs (
      request_id TEXT PRIMARY KEY NOT NULL REFERENCES task_runs(request_id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES task_sessions(id) ON DELETE CASCADE,
      phase TEXT NOT NULL CHECK (phase IN ('preparing', 'planning', 'discovering', 'reading', 'verifying', 'synthesizing', 'completed')),
      outcome TEXT CHECK (outcome IN ('complete', 'partial')),
      objective TEXT,
      scope TEXT,
      deliverable TEXT,
      plan_version INTEGER NOT NULL DEFAULT 0,
      limitations_json TEXT NOT NULL DEFAULT '[]',
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    )`,
    "CREATE INDEX research_runs_task_updated_idx ON research_runs (task_id, updated_at)",
    `CREATE TABLE research_questions (
      id TEXT PRIMARY KEY NOT NULL,
      request_id TEXT NOT NULL REFERENCES research_runs(request_id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'covered', 'partial', 'uncovered')),
      coverage_note TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL,
      UNIQUE (request_id, question_id)
    )`,
    "CREATE INDEX research_questions_run_status_idx ON research_questions (request_id, status)",
    `CREATE TABLE research_sources (
      id TEXT PRIMARY KEY NOT NULL,
      request_id TEXT NOT NULL REFERENCES research_runs(request_id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      final_url TEXT,
      title TEXT,
      author TEXT,
      published_at TEXT,
      discovered_by_query TEXT,
      question_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK (status IN ('discovered', 'shortlisted', 'reading', 'read', 'unusable')),
      content_type TEXT,
      content_hash TEXT,
      char_count INTEGER,
      truncated INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      discovered_at INTEGER NOT NULL,
      read_at INTEGER,
      updated_at INTEGER NOT NULL,
      UNIQUE (request_id, canonical_url)
    )`,
    "CREATE INDEX research_sources_run_status_idx ON research_sources (request_id, status)",
    `CREATE TABLE research_evidence (
      id TEXT PRIMARY KEY NOT NULL,
      request_id TEXT NOT NULL REFERENCES research_runs(request_id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
      research_question_id TEXT NOT NULL REFERENCES research_questions(id) ON DELETE CASCADE,
      relation TEXT NOT NULL CHECK (relation IN ('supports', 'refutes', 'qualifies')),
      claim TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      locator TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    "CREATE INDEX research_evidence_run_question_idx ON research_evidence (request_id, research_question_id)",
    "CREATE INDEX research_evidence_source_idx ON research_evidence (source_id)",
  ],
} as const satisfies DatabaseMigration
