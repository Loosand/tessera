/**
 * [INPUT]: 研究 run、结构化计划、规范化网页来源、证据片段与完成覆盖结果
 * [OUTPUT]: 绑定 task_run 的研究状态创建、幂等来源记录、证据写入、完成冻结与进度快照
 * [POS]: 可信研究工作流的 SQLite 控制层仓储
 * [DOC]: docs/architecture/database.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { and, asc, eq } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import {
  type ResearchEvidenceRecord,
  type ResearchQuestionRecord,
  type ResearchRunRecord,
  type ResearchSourceRecord,
  researchEvidence,
  researchQuestions,
  researchRuns,
  researchSources,
} from "./schema"

export function setResearchRunPhase(
  client: DatabaseClient,
  requestId: string,
  phase: Exclude<ResearchRunRecord["phase"], "completed">,
) {
  client.db
    .update(researchRuns)
    .set({ phase, updatedAt: new Date() })
    .where(eq(researchRuns.requestId, requestId))
    .run()
  return findResearchRun(client, requestId)
}

export type ResearchPlanPersistenceInput = Readonly<{
  deliverable: string | null
  objective: string
  questions: readonly Readonly<{ id: string; title: string }>[]
  requestId: string
  scope: string | null
}>

export type ResearchSourcePersistenceInput = Readonly<{
  author: string | null
  canonicalUrl: string
  charCount: number | null
  contentHash: string | null
  contentType: string | null
  discoveredByQuery: string | null
  errorMessage: string | null
  finalUrl: string | null
  id: string
  publishedAt: string | null
  questionIds: readonly string[]
  requestId: string
  status: ResearchSourceRecord["status"]
  title: string | null
  truncated: boolean
  url: string
}>

export type ResearchEvidencePersistenceInput = Readonly<{
  claim: string
  excerpt: string
  id: string
  locator: string | null
  questionId: string
  relation: ResearchEvidenceRecord["relation"]
  requestId: string
  sourceId: string
}>

export type ResearchQuestionResultPersistenceInput = Readonly<{
  id: string
  note: string
  status: Exclude<ResearchQuestionRecord["status"], "pending">
}>

export function startResearchRun(
  client: DatabaseClient,
  input: Readonly<{ requestId: string; taskId: string; startedAt: Date }>,
) {
  client.db
    .insert(researchRuns)
    .values({
      requestId: input.requestId,
      taskId: input.taskId,
      phase: "preparing",
      startedAt: input.startedAt,
      updatedAt: input.startedAt,
    })
    .onConflictDoNothing()
    .run()
  return findResearchRun(client, input.requestId)
}

export function publishResearchPlan(client: DatabaseClient, input: ResearchPlanPersistenceInput) {
  const now = new Date()
  client.db.transaction((transaction) => {
    const run = transaction
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.requestId, input.requestId))
      .get()
    if (!run) throw new Error("研究运行不存在。")
    if (run.planVersion > 0) throw new Error("研究计划已经发布，不能在同一运行中静默替换。")
    transaction
      .update(researchRuns)
      .set({
        objective: input.objective,
        scope: input.scope,
        deliverable: input.deliverable,
        phase: "discovering",
        planVersion: 1,
        updatedAt: now,
      })
      .where(eq(researchRuns.requestId, input.requestId))
      .run()
    transaction
      .insert(researchQuestions)
      .values(
        input.questions.map((question, position) => ({
          id: `${input.requestId}:${question.id}`,
          requestId: input.requestId,
          questionId: question.id,
          title: question.title,
          position,
          updatedAt: now,
        })),
      )
      .run()
  })
  return findResearchRun(client, input.requestId)
}

export function saveResearchSource(client: DatabaseClient, input: ResearchSourcePersistenceInput) {
  const now = new Date()
  const existing = client.db
    .select()
    .from(researchSources)
    .where(
      and(
        eq(researchSources.requestId, input.requestId),
        eq(researchSources.canonicalUrl, input.canonicalUrl),
      ),
    )
    .get()
  if (existing) {
    const status = existing.status === "read" && input.status === "discovered" ? "read" : input.status
    client.db
      .update(researchSources)
      .set({
        url: input.url,
        finalUrl: input.finalUrl ?? existing.finalUrl,
        title: input.title ?? existing.title,
        author: input.author ?? existing.author,
        publishedAt: input.publishedAt ?? existing.publishedAt,
        discoveredByQuery: input.discoveredByQuery ?? existing.discoveredByQuery,
        questionIdsJson:
          input.questionIds.length > 0 ? JSON.stringify(input.questionIds) : existing.questionIdsJson,
        status,
        contentType: input.contentType ?? existing.contentType,
        contentHash: input.contentHash ?? existing.contentHash,
        charCount: input.charCount ?? existing.charCount,
        truncated: input.truncated || existing.truncated,
        errorMessage: input.errorMessage,
        readAt: status === "read" || status === "unusable" ? now : existing.readAt,
        updatedAt: now,
      })
      .where(eq(researchSources.id, existing.id))
      .run()
    return client.db.select().from(researchSources).where(eq(researchSources.id, existing.id)).get() ?? null
  }
  client.db
    .insert(researchSources)
    .values({
      id: input.id,
      requestId: input.requestId,
      url: input.url,
      canonicalUrl: input.canonicalUrl,
      finalUrl: input.finalUrl,
      title: input.title,
      author: input.author,
      publishedAt: input.publishedAt,
      discoveredByQuery: input.discoveredByQuery,
      questionIdsJson: JSON.stringify(input.questionIds),
      status: input.status,
      contentType: input.contentType,
      contentHash: input.contentHash,
      charCount: input.charCount,
      truncated: input.truncated,
      errorMessage: input.errorMessage,
      discoveredAt: now,
      readAt: input.status === "read" || input.status === "unusable" ? now : null,
      updatedAt: now,
    })
    .run()
  return client.db.select().from(researchSources).where(eq(researchSources.id, input.id)).get() ?? null
}

export function saveResearchEvidence(client: DatabaseClient, input: ResearchEvidencePersistenceInput) {
  const source = client.db
    .select()
    .from(researchSources)
    .where(and(eq(researchSources.id, input.sourceId), eq(researchSources.requestId, input.requestId)))
    .get()
  if (!source || source.status !== "read") throw new Error("研究证据必须来自已阅读来源。")
  const question = client.db
    .select()
    .from(researchQuestions)
    .where(
      and(
        eq(researchQuestions.requestId, input.requestId),
        eq(researchQuestions.questionId, input.questionId),
      ),
    )
    .get()
  if (!question) throw new Error("研究证据引用了未知问题。")
  client.db
    .insert(researchEvidence)
    .values({
      id: input.id,
      requestId: input.requestId,
      sourceId: input.sourceId,
      researchQuestionId: question.id,
      relation: input.relation,
      claim: input.claim,
      excerpt: input.excerpt,
      locator: input.locator,
    })
    .run()
  client.db
    .update(researchRuns)
    .set({ phase: "verifying", updatedAt: new Date() })
    .where(eq(researchRuns.requestId, input.requestId))
    .run()
  return client.db.select().from(researchEvidence).where(eq(researchEvidence.id, input.id)).get() ?? null
}

export function finishResearchRun(
  client: DatabaseClient,
  input: Readonly<{
    limitations: readonly string[]
    outcome: NonNullable<ResearchRunRecord["outcome"]>
    questions: readonly ResearchQuestionResultPersistenceInput[]
    requestId: string
  }>,
) {
  const now = new Date()
  client.db.transaction((transaction) => {
    for (const result of input.questions) {
      transaction
        .update(researchQuestions)
        .set({ status: result.status, coverageNote: result.note, updatedAt: now })
        .where(
          and(eq(researchQuestions.requestId, input.requestId), eq(researchQuestions.questionId, result.id)),
        )
        .run()
    }
    transaction
      .update(researchRuns)
      .set({
        phase: "completed",
        outcome: input.outcome,
        limitationsJson: JSON.stringify(input.limitations),
        updatedAt: now,
        completedAt: now,
      })
      .where(eq(researchRuns.requestId, input.requestId))
      .run()
  })
  return findResearchRun(client, input.requestId)
}

export function findResearchRun(client: DatabaseClient, requestId: string) {
  const run = client.db.select().from(researchRuns).where(eq(researchRuns.requestId, requestId)).get()
  if (!run) return null
  return {
    ...run,
    questions: client.db
      .select()
      .from(researchQuestions)
      .where(eq(researchQuestions.requestId, requestId))
      .orderBy(asc(researchQuestions.position))
      .all(),
    sources: client.db
      .select()
      .from(researchSources)
      .where(eq(researchSources.requestId, requestId))
      .orderBy(asc(researchSources.discoveredAt))
      .all(),
    evidence: client.db
      .select()
      .from(researchEvidence)
      .where(eq(researchEvidence.requestId, requestId))
      .orderBy(asc(researchEvidence.createdAt))
      .all(),
  }
}
