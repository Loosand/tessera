/**
 * [INPUT]: 临时内容库、内存 SQLite、任务/Run 与内容领域服务调用
 * [OUTPUT]: 未归档创建、Artifact 关系、独立项目、安全移动、冲突预检和撤销授权的回归验证
 * [POS]: 统一创作 Agent 混合内容领域服务的单元测试
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type DatabaseClient,
  listWorkspaceOperations,
  openDatabase,
  saveTaskSession,
  startTaskRun,
} from "@tessera/database"
import { afterEach, describe, expect, it } from "vitest"
import { ContentLibraryError, createContentLibraryService } from "./content-library-service"

const temporaryDirectories: string[] = []
const databases: DatabaseClient[] = []

async function createFixture() {
  const rootPath = await mkdtemp(join(tmpdir(), "tessera-content-library-"))
  temporaryDirectories.push(rootPath)
  const client = openDatabase({ path: ":memory:" })
  databases.push(client)
  const taskId = "task-content"
  const runId = "run-content"
  const now = new Date()
  saveTaskSession(client, {
    id: taskId,
    mode: "chat",
    skillId: null,
    workspaceId: null,
    title: "Celeste 自媒体稿",
    status: "running",
    messagePayloads: [],
    updatedAt: now,
  })
  startTaskRun(client, {
    requestId: runId,
    taskId,
    configId: "config",
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    mode: "chat",
    skillId: null,
    reasoning: "high",
    webSearch: true,
    policyJson: "{}",
    resourceSummaryJson: "{}",
    startedAt: now,
  })
  return { client, rootPath, runId, taskId, service: createContentLibraryService(client) }
}

afterEach(async () => {
  for (const client of databases.splice(0)) client.close()
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("托管内容库领域服务", () => {
  it("把正式文档创建到未归档，并在同一任务中创建项目后安全移动", async () => {
    const { client, rootPath, runId, service, taskId } = await createFixture()
    const library = await service.configure(rootPath)

    expect(library.inbox.name).toBe("未归档")
    const artifact = await service.createDocument(
      { taskId, runId },
      {
        title: "玛德琳：一座山，和她自己",
        reason: "用户要求把研究整理为正式自媒体稿",
        content: "# 玛德琳：一座山，和她自己\n\n正文。\n",
      },
    )
    expect(artifact).toMatchObject({
      document: { title: "玛德琳：一座山，和她自己" },
      project: { name: "未归档" },
      relation: "created",
    })
    await expect(
      readFile(join(rootPath, "未归档", "玛德琳：一座山，和她自己.md"), "utf8"),
    ).resolves.toContain("正文")

    const project = await service.createProject({ taskId, runId }, { name: "《Celeste》玛德琳专题" })
    const moved = await service.moveDocuments(
      { taskId, runId },
      { documentIds: [artifact.documentId], targetProjectId: project.id },
    )

    expect(moved).toMatchObject({ project: { name: "《Celeste》玛德琳专题" } })
    await expect(
      readFile(join(rootPath, "《Celeste》玛德琳专题", "玛德琳：一座山，和她自己.md"), "utf8"),
    ).resolves.toContain("正文")
    await expect(access(join(rootPath, "未归档", "玛德琳：一座山，和她自己.md"))).rejects.toThrow()
    expect(service.listArtifacts(taskId)).toMatchObject([
      {
        documentId: artifact.documentId,
        project: { id: project.id },
      },
    ])
    expect(listWorkspaceOperations(client, taskId).map((operation) => operation.operation)).toEqual([
      "create-document",
      "create-project",
      "move-documents",
    ])
  })

  it("目标存在同名文档时在移动前终止并保留原文件", async () => {
    const { rootPath, runId, service, taskId } = await createFixture()
    await service.configure(rootPath)
    const artifact = await service.createDocument(
      { taskId, runId },
      { title: "同名稿", reason: "测试", content: "原始内容" },
    )
    const project = await service.createProject({ taskId, runId }, { name: "独立项目" })
    await writeFile(join(rootPath, "独立项目", "同名稿.md"), "已有内容")

    await expect(
      service.moveDocuments(
        { taskId, runId },
        { documentIds: [artifact.documentId], targetProjectId: project.id },
      ),
    ).rejects.toBeInstanceOf(ContentLibraryError)
    await expect(readFile(join(rootPath, "未归档", "同名稿.md"), "utf8")).resolves.toBe("原始内容")
    await expect(readFile(join(rootPath, "独立项目", "同名稿.md"), "utf8")).resolves.toBe("已有内容")
  })

  it("撤销内容库只移除授权记录，不删除用户目录或文档", async () => {
    const { rootPath, runId, service, taskId } = await createFixture()
    await service.configure(rootPath)
    await service.createDocument(
      { taskId, runId },
      { title: "保留的稿子", reason: "测试", content: "保留正文" },
    )

    expect(service.revoke()).toBeNull()
    expect(service.current()).toBeNull()
    await expect(readFile(join(rootPath, "未归档", "保留的稿子.md"), "utf8")).resolves.toBe("保留正文")
  })
})
