/**
 * [INPUT]: 已完成或进行中的研究推荐、用户明确选择的来源 ID、内容库领域服务与任务/Run 归属
 * [OUTPUT]: 幂等创建必要证据片段 Markdown Artifact，并把推荐关系标记为已保存
 * [POS]: research-sources:save IPC 与研究/内容库两个领域之间的用户确认写入边界
 * [DOC]: docs/architecture/research-workflow.md、docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskResearchSaveSourcesResult } from "@tessera/contracts"
import { type DatabaseClient, findResearchRun, markResearchRecommendationsSaved } from "@tessera/database"
import type { ContentLibraryService } from "./content-library-service"
import { researchSourcesMaterial } from "./research-service"

export async function saveResearchSourceSelection(
  client: DatabaseClient,
  contentLibrary: ContentLibraryService,
  input: Readonly<{ requestId: string; sourceIds: readonly string[]; taskId: string }>,
): Promise<TaskResearchSaveSourcesResult> {
  try {
    const run = findResearchRun(client, input.requestId)
    if (!run || run.taskId !== input.taskId) throw new Error("找不到这个研究运行。")
    const selected = [...new Set(input.sourceIds)]
    const unsaved = selected.filter(
      (sourceId) =>
        run.recommendations.find((recommendation) => recommendation.sourceId === sourceId)?.status !==
        "saved",
    )
    if (unsaved.length === 0) {
      const documentId = selected
        .map(
          (sourceId) =>
            run.recommendations.find((recommendation) => recommendation.sourceId === sourceId)
              ?.savedDocumentId,
        )
        .find((value): value is string => Boolean(value))
      const artifact = documentId
        ? (contentLibrary
            .listArtifacts(input.taskId)
            .find((candidate) => candidate.documentId === documentId) ?? null)
        : null
      return { ok: true, artifact, savedSourceIds: selected }
    }
    const material = researchSourcesMaterial(client, input.taskId, input.requestId, unsaved)
    const artifact = await contentLibrary.createDocument(
      { taskId: input.taskId, runId: input.requestId },
      {
        title: material.title,
        content: material.content,
        reason: "用户从研究推荐中明确选择保存这些来源材料。",
      },
    )
    markResearchRecommendationsSaved(client, {
      requestId: input.requestId,
      sourceIds: material.sourceIds,
      documentId: artifact.documentId,
    })
    return { ok: true, artifact, savedSourceIds: material.sourceIds }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "保存研究来源失败。" }
  }
}
