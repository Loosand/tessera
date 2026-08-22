/**
 * [INPUT]: 临时内容库、内存或文件 SQLite、任务/Run 与内容领域服务调用
 * [OUTPUT]: 未归档创建、Artifact 关系、独立项目、安全移动、重启恢复、冲突预检和撤销授权的回归验证
 * [POS]: 统一创作 Agent 混合内容领域服务的单元测试
 * [DOC]: docs/architecture/unified-creation-agent.md、docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type DatabaseClient,
  listWorkspaceOperations,
  openDatabase,
  saveTaskSession,
  startTaskRun,
} from "@tessera/database"
import type { TaskMessage } from "@tessera/contracts"
import { afterEach, describe, expect, it } from "vitest"
import { ContentLibraryError, createContentLibraryService } from "./content-library-service"
import { createDesktopTaskService } from "./task-service"

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

  it("同一任务从普通对话进入写作、创建项目并移动文档后可在重启时完整恢复", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "tessera-content-closure-"))
    temporaryDirectories.push(basePath)
    const libraryPath = join(basePath, "library")
    const databasePath = join(basePath, "tessera.sqlite")
    await mkdir(libraryPath)

    const taskId = "task-content-closure"
    const runId = "run-content-closure"
    const client = openDatabase({ path: databasePath })
    databases.push(client)
    const taskService = createDesktopTaskService(client)
    const contentService = createContentLibraryService(client)
    await contentService.configure(libraryPath)
    taskService.save(
      {
        id: taskId,
        mode: "chat",
        skillId: null,
        status: "completed",
        title: "Celeste 主角",
        workspaceId: null,
        messages: [
          { id: "user-question", role: "user", parts: [{ type: "text", text: "Celeste 的主角是谁？" }] },
          {
            id: "assistant-answer",
            role: "assistant",
            parts: [{ type: "text", text: "主角是 Madeline。", state: "done" }],
          },
        ],
      },
      null,
    )
    startTaskRun(client, {
      requestId: runId,
      taskId,
      configId: "config",
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      mode: "chat",
      skillId: "writing",
      reasoning: "high",
      webSearch: true,
      policyJson: JSON.stringify({ skillId: "writing" }),
      resourceSummaryJson: "{}",
      startedAt: new Date(),
    })

    const artifact = await contentService.createDocument(
      { taskId, runId },
      {
        title: "玛德琳：与自己和解的攀登",
        reason: "用户要求写成自媒体稿",
        content: "# 玛德琳：与自己和解的攀登\n\n一座山，也是一次与自己的和解。\n",
      },
    )
    const project = await contentService.createProject({ taskId, runId }, { name: "Celeste 专题" })
    const moved = await contentService.moveDocuments(
      { taskId, runId },
      { documentIds: [artifact.documentId], targetProjectId: project.id },
    )
    const inspection = await contentService.inspectProject({ taskId, runId }, project.id)
    const messages: TaskMessage[] = [
      ...taskService.read(taskId).messages,
      {
        id: "user-writing",
        role: "user",
        parts: [{ type: "text", text: "深入一点，写成自媒体稿并建立单独项目。" }],
      },
      {
        id: "assistant-writing",
        role: "assistant",
        parts: [
          {
            type: "tool-create-document",
            toolCallId: "create-document",
            state: "output-available",
            input: { title: artifact.document.title },
            output: artifact,
          },
          {
            type: "tool-create-project",
            toolCallId: "create-project",
            state: "output-available",
            input: { name: project.name },
            output: project,
          },
          {
            type: "tool-move-documents",
            toolCallId: "move-documents",
            state: "output-available",
            input: { documentIds: [artifact.documentId], targetProjectId: project.id },
            output: moved,
          },
          {
            type: "tool-inspect-project",
            toolCallId: "inspect-project",
            state: "output-available",
            input: { projectId: project.id },
            output: inspection,
          },
          { type: "text", text: "稿件已创建并移动到「Celeste 专题」。", state: "done" },
        ],
      },
    ]
    taskService.save(
      {
        id: taskId,
        mode: "chat",
        skillId: "writing",
        status: "completed",
        title: "Celeste 主角",
        workspaceId: null,
        messages,
      },
      null,
    )

    databases.splice(databases.indexOf(client), 1)
    client.close()
    const restoredClient = openDatabase({ path: databasePath })
    databases.push(restoredClient)
    const restoredTask = createDesktopTaskService(restoredClient).read(taskId)
    const restoredContent = createContentLibraryService(restoredClient)

    expect(restoredTask).toMatchObject({ skillId: "writing", status: "completed" })
    expect(restoredTask.messages).toHaveLength(4)
    expect(restoredTask.messages.at(-1)?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool-create-document", state: "output-available" }),
        expect.objectContaining({ type: "tool-create-project", state: "output-available" }),
        expect.objectContaining({ type: "tool-move-documents", state: "output-available" }),
        expect.objectContaining({ type: "tool-inspect-project", state: "output-available" }),
      ]),
    )
    expect(restoredContent.current()?.rootPath).toBe(await realpath(libraryPath))
    expect(restoredContent.listArtifacts(taskId)).toMatchObject([
      { documentId: artifact.documentId, project: { id: project.id, name: "Celeste 专题" } },
    ])
    expect(listWorkspaceOperations(restoredClient, taskId).map((operation) => operation.operation)).toEqual([
      "create-document",
      "create-project",
      "move-documents",
      "inspect-project",
    ])
    await expect(
      readFile(join(libraryPath, "Celeste 专题", "玛德琳：与自己和解的攀登.md"), "utf8"),
    ).resolves.toContain("与自己的和解")
  })
})
