/**
 * [INPUT]: 研究 run、结构化计划、规范化网页来源、证据片段、来源推荐/保存决策与完成覆盖结果
 * [OUTPUT]: 绑定 task_run 的研究状态创建、幂等来源记录、证据/推荐写入、完成冻结、进度快照与跨新 request 的显式状态克隆
 * [POS]: 可信研究工作流的 SQLite 控制层仓储
 * [DOC]: docs/architecture/database.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { createHash } from "node:crypto"
import { and, asc, desc, eq } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import {
  type ResearchEvidenceRecord,
  type ResearchQuestionRecord,
  type ResearchRunRecord,
  type ResearchSourceRecommendationRecord,
  type ResearchSourceRecord,
  researchEvidence,
  researchQuestions,
  researchRuns,
  researchSourceRecommendations,
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

export type ResearchRecommendationPersistenceInput = Readonly<{
  id: string
  reason: string
  requestId: string
  sourceId: string
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

function resumedSourceId(requestId: string, canonicalUrl: string) {
  return `source-${createHash("sha256").update(`${requestId}\0${canonicalUrl}`).digest("hex").slice(0, 32)}`
}

function resumedRecordId(kind: "evidence" | "recommendation", requestId: string, sourceId: string) {
  return `${kind}-${createHash("sha256").update(`${requestId}\0${sourceId}`).digest("hex").slice(0, 32)}`
}

/**
 * 把上一轮研究的领域状态复制到新的 task run。网页正文不持久化；已有证据可直接复用，
 * 若模型要从继承来源登记新证据，仍需重新读取并通过逐字校验。
 */
export function resumeResearchRun(
  client: DatabaseClient,
  input: Readonly<{ fromRequestId: string; taskId: string; toRequestId: string }>,
) {
  const resumedAt = new Date()
  client.db.transaction((transaction) => {
    const sourceRun = transaction
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.requestId, input.fromRequestId))
      .get()
    const targetRun = transaction
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.requestId, input.toRequestId))
      .get()
    if (!sourceRun || sourceRun.taskId !== input.taskId) throw new Error("找不到可续研的上一轮运行。")
    if (!targetRun || targetRun.taskId !== input.taskId) throw new Error("新的研究运行不存在。")
    if (targetRun.planVersion > 0) throw new Error("新的研究运行已经开始，不能再次继承进度。")

    const questions = transaction
      .select()
      .from(researchQuestions)
      .where(eq(researchQuestions.requestId, input.fromRequestId))
      .orderBy(asc(researchQuestions.position))
      .all()
    const sources = transaction
      .select()
      .from(researchSources)
      .where(eq(researchSources.requestId, input.fromRequestId))
      .orderBy(asc(researchSources.discoveredAt))
      .all()
    const evidence = transaction
      .select()
      .from(researchEvidence)
      .where(eq(researchEvidence.requestId, input.fromRequestId))
      .orderBy(asc(researchEvidence.createdAt))
      .all()
    const recommendations = transaction
      .select()
      .from(researchSourceRecommendations)
      .where(eq(researchSourceRecommendations.requestId, input.fromRequestId))
      .orderBy(asc(researchSourceRecommendations.createdAt))
      .all()
    const sourceIds = new Map(
      sources.map((source) => [source.id, resumedSourceId(input.toRequestId, source.canonicalUrl)]),
    )
    const questionIds = new Map(
      questions.map((question) => [question.id, `${input.toRequestId}:${question.questionId}`]),
    )
    const phase: ResearchRunRecord["phase"] = sourceRun.outcome
      ? "completed"
      : recommendations.length > 0
        ? "synthesizing"
        : evidence.length > 0
          ? "verifying"
          : sources.some((source) => source.status === "read" || source.status === "unusable")
            ? "reading"
            : sourceRun.planVersion > 0
              ? "discovering"
              : "preparing"

    transaction
      .update(researchRuns)
      .set({
        phase,
        outcome: sourceRun.outcome,
        objective: sourceRun.objective,
        scope: sourceRun.scope,
        deliverable: sourceRun.deliverable,
        planVersion: sourceRun.planVersion,
        limitationsJson: sourceRun.limitationsJson,
        updatedAt: resumedAt,
        completedAt: sourceRun.outcome ? resumedAt : null,
      })
      .where(eq(researchRuns.requestId, input.toRequestId))
      .run()

    if (questions.length > 0) {
      transaction
        .insert(researchQuestions)
        .values(
          questions.map((question) => ({
            id: questionIds.get(question.id) ?? `${input.toRequestId}:${question.questionId}`,
            requestId: input.toRequestId,
            questionId: question.questionId,
            title: question.title,
            position: question.position,
            status: question.status,
            coverageNote: question.coverageNote,
            createdAt: question.createdAt,
            updatedAt: resumedAt,
          })),
        )
        .run()
    }
    if (sources.length > 0) {
      transaction
        .insert(researchSources)
        .values(
          sources.map((source) => ({
            ...source,
            id: sourceIds.get(source.id) ?? resumedSourceId(input.toRequestId, source.canonicalUrl),
            requestId: input.toRequestId,
            status: source.status === "reading" ? ("discovered" as const) : source.status,
            updatedAt: resumedAt,
          })),
        )
        .run()
    }
    if (evidence.length > 0) {
      transaction
        .insert(researchEvidence)
        .values(
          evidence.map((item) => {
            const sourceId = sourceIds.get(item.sourceId)
            const researchQuestionId = questionIds.get(item.researchQuestionId)
            if (!sourceId || !researchQuestionId) throw new Error("上一轮研究证据关系不完整。")
            return {
              ...item,
              id: resumedRecordId("evidence", input.toRequestId, item.id),
              requestId: input.toRequestId,
              sourceId,
              researchQuestionId,
            }
          }),
        )
        .run()
    }
    if (recommendations.length > 0) {
      transaction
        .insert(researchSourceRecommendations)
        .values(
          recommendations.map((recommendation) => {
            const sourceId = sourceIds.get(recommendation.sourceId)
            if (!sourceId) throw new Error("上一轮研究推荐关系不完整。")
            return {
              ...recommendation,
              id: resumedRecordId("recommendation", input.toRequestId, recommendation.id),
              requestId: input.toRequestId,
              sourceId,
              updatedAt: resumedAt,
            }
          }),
        )
        .run()
    }
  })
  return findResearchRun(client, input.toRequestId)
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

export function saveResearchRecommendations(
  client: DatabaseClient,
  inputs: readonly ResearchRecommendationPersistenceInput[],
) {
  if (inputs.length === 0) throw new Error("研究来源推荐不能为空。")
  const requestId = inputs[0]?.requestId
  if (!requestId || inputs.some((input) => input.requestId !== requestId)) {
    throw new Error("研究来源推荐必须属于同一运行。")
  }
  if (new Set(inputs.map((input) => input.sourceId)).size !== inputs.length) {
    throw new Error("研究来源推荐不能包含重复来源。")
  }
  const run = findResearchRun(client, requestId)
  if (!run) throw new Error("研究运行不存在。")
  const readSourceIds = new Set(
    run.sources.filter((source) => source.status === "read").map((source) => source.id),
  )
  if (inputs.some((input) => !readSourceIds.has(input.sourceId))) {
    throw new Error("只能推荐已经阅读的研究来源。")
  }
  const now = new Date()
  client.db.transaction((transaction) => {
    for (const input of inputs) {
      transaction
        .insert(researchSourceRecommendations)
        .values({
          id: input.id,
          requestId: input.requestId,
          sourceId: input.sourceId,
          reason: input.reason,
          status: "recommended",
          savedDocumentId: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [researchSourceRecommendations.requestId, researchSourceRecommendations.sourceId],
          set: { reason: input.reason, updatedAt: now },
        })
        .run()
    }
    transaction
      .update(researchRuns)
      .set({ phase: "synthesizing", updatedAt: now })
      .where(eq(researchRuns.requestId, requestId))
      .run()
  })
  return findResearchRun(client, requestId)
}

export function markResearchRecommendationsSaved(
  client: DatabaseClient,
  input: Readonly<{ documentId: string; requestId: string; sourceIds: readonly string[] }>,
) {
  const uniqueSourceIds = [...new Set(input.sourceIds)]
  const now = new Date()
  client.db.transaction((transaction) => {
    for (const sourceId of uniqueSourceIds) {
      transaction
        .update(researchSourceRecommendations)
        .set({ status: "saved", savedDocumentId: input.documentId, updatedAt: now })
        .where(
          and(
            eq(researchSourceRecommendations.requestId, input.requestId),
            eq(researchSourceRecommendations.sourceId, sourceId),
          ),
        )
        .run()
    }
  })
  return findResearchRun(client, input.requestId)
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
    recommendations: client.db
      .select()
      .from(researchSourceRecommendations)
      .where(eq(researchSourceRecommendations.requestId, requestId))
      .orderBy(asc(researchSourceRecommendations.createdAt))
      .all(),
  }
}

export function findLatestCompletedResearchRun(client: DatabaseClient, taskId: string) {
  const run = client.db
    .select({ requestId: researchRuns.requestId })
    .from(researchRuns)
    .where(and(eq(researchRuns.taskId, taskId), eq(researchRuns.phase, "completed")))
    .orderBy(desc(researchRuns.updatedAt))
    .limit(1)
    .get()
  return run ? findResearchRun(client, run.requestId) : null
}

export type ResearchSourceRecommendationStatus = ResearchSourceRecommendationRecord["status"]
