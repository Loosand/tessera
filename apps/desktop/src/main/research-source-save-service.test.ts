/**
 * [INPUT]: 临时内容库、内存研究运行、证据链推荐与用户来源选择
 * [OUTPUT]: 明确选择后创建 Markdown、推荐保存关系和重复请求幂等性的回归验证
 * [POS]: 研究来源推荐从控制状态进入用户正文事实源的集成测试
 * [DOC]: docs/architecture/research-workflow.md、docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  findResearchRun,
  openDatabase,
  publishResearchPlan,
  saveResearchEvidence,
  saveResearchRecommendations,
  saveResearchSource,
  saveTaskSession,
  startResearchRun,
  startTaskRun,
} from "@tessera/database"
import { describe, expect, it } from "vitest"
import { createContentLibraryService } from "./content-library-service"
import { saveResearchSourceSelection } from "./research-source-save-service"

describe("研究来源选择保存", () => {
  it("只在用户选择后创建一份材料，并让重复保存复用同一 Artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tessera-research-save-"))
    const client = openDatabase({ path: ":memory:" })
    try {
      saveTaskSession(client, {
        id: "task-research-save",
        mode: "chat",
        workspaceId: null,
        title: "FKJ 研究",
        status: "completed",
        updatedAt: new Date(1),
        messagePayloads: [],
      })
      startTaskRun(client, {
        requestId: "run-research-save",
        taskId: "task-research-save",
        configId: "provider",
        providerId: "deepseek",
        modelId: "deepseek-v4-pro",
        mode: "chat",
        skillId: "research",
        reasoning: "high",
        webSearch: true,
        policyJson: "{}",
        resourceSummaryJson: "{}",
        startedAt: new Date(1),
      })
      startResearchRun(client, {
        requestId: "run-research-save",
        taskId: "task-research-save",
        startedAt: new Date(1),
      })
      publishResearchPlan(client, {
        requestId: "run-research-save",
        objective: "了解 FKJ",
        scope: null,
        deliverable: null,
        questions: [{ id: "q1", title: "现场方法是什么？" }],
      })
      saveResearchSource(client, {
        id: "source-fkj",
        requestId: "run-research-save",
        url: "https://example.com/fkj",
        canonicalUrl: "https://example.com/fkj",
        finalUrl: "https://example.com/fkj",
        title: "FKJ interview",
        author: "Example",
        publishedAt: null,
        discoveredByQuery: "FKJ interview",
        questionIds: ["q1"],
        status: "read",
        contentType: "text/html",
        contentHash: "sha256:fkj",
        charCount: 1_000,
        truncated: false,
        errorMessage: null,
      })
      saveResearchEvidence(client, {
        id: "evidence-fkj",
        requestId: "run-research-save",
        sourceId: "source-fkj",
        questionId: "q1",
        relation: "supports",
        claim: "FKJ 使用现场循环",
        excerpt: "FKJ layers instruments through live looping.",
        locator: "p1",
      })
      saveResearchRecommendations(client, [
        {
          id: "recommendation-fkj",
          requestId: "run-research-save",
          sourceId: "source-fkj",
          reason: "一手访谈直接解释现场方法。",
        },
      ])

      const contentLibrary = createContentLibraryService(client)
      await contentLibrary.configure(directory)
      expect(contentLibrary.listArtifacts("task-research-save")).toEqual([])

      const first = await saveResearchSourceSelection(client, contentLibrary, {
        taskId: "task-research-save",
        requestId: "run-research-save",
        sourceIds: ["source-fkj", "source-fkj"],
      })
      expect(first).toMatchObject({ ok: true, savedSourceIds: ["source-fkj"] })
      if (!first.ok || !first.artifact) throw new Error("预期创建来源材料。")
      expect(await readFile(join(directory, "未归档", first.artifact.relativePath), "utf8")).toContain(
        "FKJ layers instruments through live looping.",
      )
      expect(findResearchRun(client, "run-research-save")?.recommendations).toMatchObject([
        { sourceId: "source-fkj", status: "saved", savedDocumentId: first.artifact.documentId },
      ])

      const repeated = await saveResearchSourceSelection(client, contentLibrary, {
        taskId: "task-research-save",
        requestId: "run-research-save",
        sourceIds: ["source-fkj"],
      })
      expect(repeated).toMatchObject({
        ok: true,
        artifact: { id: first.artifact.id },
        savedSourceIds: ["source-fkj"],
      })
      expect(contentLibrary.listArtifacts("task-research-save")).toHaveLength(1)
    } finally {
      client.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
