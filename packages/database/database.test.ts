/**
 * [INPUT]: 内存/临时磁盘 SQLite 客户端与前向迁移
 * [OUTPUT]: 迁移幂等性、统一内容控制层、工作区最近项、通用任务会话、AI/MCP 加密配置恢复、任务运行观测指标和级联删除的回归验证
 * [POS]: 数据库包不依赖磁盘状态的基础集成测试
 * [DOC]: docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import { describe, expect, test } from "vitest"
import {
  deleteAiProviderConfigRecord,
  findAiProviderConfigRecord,
  listAiProviderConfigRecords,
  upsertAiProviderConfigRecord,
} from "./ai-provider-config-repository"
import { openDatabase } from "./client"
import {
  findActiveContentLibrary,
  findIndexedDocumentById,
  listManagedWorkspaces,
  listTaskArtifacts,
  listTaskResourceBindings,
  listWorkspaceOperations,
  moveIndexedDocument,
  saveArtifact,
  saveContentLibrary,
  saveIndexedDocument,
  saveTaskResourceBinding,
  saveWorkspaceOperation,
  setTaskWorkspace,
} from "./content-domain-repository"
import {
  deleteMcpServerConfigRecord,
  findMcpServerConfigRecord,
  listMcpServerConfigRecords,
  upsertMcpServerConfigRecord,
} from "./mcp-server-config-repository"
import { DATABASE_MIGRATIONS, applyDatabaseMigrations } from "./migrations"
import { foundationMigration } from "./migrations/0000-foundation"
import { taskSessionsMigration } from "./migrations/0002-task-sessions"
import { appendTaskRunEvent, findLatestTaskRun, finishTaskRun, startTaskRun } from "./task-run-repository"
import {
  deleteTaskSession,
  findTaskSession,
  listRecentTaskSessions,
  listWorkspaceTaskSessions,
  renameTaskSession,
  saveTaskSession,
} from "./task-session-repository"
import {
  deleteUserSkillConfigRecord,
  findUserSkillConfigRecord,
  listUserSkillConfigRecords,
  setUserSkillConfigEnabled,
  upsertUserSkillConfigRecord,
} from "./user-skill-config-repository"
import {
  findMostRecentWorkspace,
  findWorkspaceById,
  hideRecentWorkspace,
  listRecentWorkspaces,
  saveWorkspace,
} from "./workspace-repository"

describe("本地数据库基建", () => {
  test("首次打开会创建全部基础表", () => {
    const client = openDatabase({ path: ":memory:" })
    const tables = client.connection
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()

    expect(tables.map((table) => table.name)).toEqual([
      "__tessera_migrations",
      "agent_change_proposals",
      "agent_events",
      "agent_sessions",
      "ai_provider_configs",
      "artifacts",
      "content_libraries",
      "document_index",
      "mcp_server_configs",
      "permission_decisions",
      "task_messages",
      "task_resource_bindings",
      "task_run_events",
      "task_runs",
      "task_sessions",
      "user_skill_configs",
      "workspace_operations",
      "workspaces",
    ])
    client.close()
  })

  test("内容库、Artifact、动态资源与项目操作只保存控制关系", () => {
    const client = openDatabase({ path: ":memory:" })
    const now = new Date(100)
    expect(
      saveContentLibrary(client, {
        id: "library-1",
        rootPath: "/tmp/tessera-library",
        displayName: "Tessera 内容库",
        updatedAt: now,
      }),
    ).toMatchObject({ id: "library-1", revokedAt: null })
    saveWorkspace(client, {
      id: "workspace-inbox",
      rootPath: "/tmp/tessera-library/未归档",
      displayName: "未归档",
      lastOpenedAt: now,
      contentLibraryId: "library-1",
      storageKind: "managed-inbox",
    })
    saveWorkspace(client, {
      id: "workspace-project",
      rootPath: "/tmp/tessera-library/Celeste",
      displayName: "Celeste",
      lastOpenedAt: now,
      contentLibraryId: "library-1",
      storageKind: "managed-project",
    })
    saveTaskSession(client, {
      id: "task-content",
      mode: "chat",
      workspaceId: null,
      title: "Celeste 研究",
      status: "completed",
      updatedAt: now,
      messagePayloads: [],
    })
    startTaskRun(client, {
      requestId: "run-content",
      taskId: "task-content",
      configId: "deepseek",
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      mode: "chat",
      skillId: "writing",
      reasoning: "high",
      webSearch: true,
      policyJson: "{}",
      resourceSummaryJson: "{}",
      startedAt: now,
    })
    saveIndexedDocument(client, {
      id: "document-celeste",
      workspaceId: "workspace-inbox",
      relativePath: "玛德琳.md",
      contentHash: "hash-before",
      sourceModifiedAt: now,
      indexedAt: now,
    })
    saveTaskResourceBinding(client, {
      id: "binding-output",
      taskId: "task-content",
      runId: "run-content",
      resourceType: "document",
      resourceId: "document-celeste",
      role: "output",
    })
    saveArtifact(client, {
      id: "artifact-celeste",
      taskId: "task-content",
      runId: "run-content",
      documentId: "document-celeste",
      relation: "created",
      updatedAt: now,
    })
    saveWorkspaceOperation(client, {
      id: "operation-move",
      taskId: "task-content",
      runId: "run-content",
      operation: "move-documents",
      status: "applied",
      parametersJson: '{"documentIds":["document-celeste"]}',
      resultJson: '{"projectId":"workspace-project"}',
      recoveryJson: '{"projectId":"workspace-inbox"}',
      errorMessage: null,
      completedAt: now,
    })
    expect(
      moveIndexedDocument(client, "document-celeste", {
        workspaceId: "workspace-project",
        relativePath: "玛德琳.md",
        contentHash: "hash-after",
        sourceModifiedAt: new Date(200),
        indexedAt: new Date(200),
      }),
    ).toMatchObject({ workspaceId: "workspace-project", relativePath: "玛德琳.md" })
    expect(setTaskWorkspace(client, "task-content", "workspace-project")).toBe(true)

    expect(findActiveContentLibrary(client)).toMatchObject({ id: "library-1" })
    expect(listManagedWorkspaces(client, "library-1")).toHaveLength(2)
    expect(findIndexedDocumentById(client, "document-celeste")).toMatchObject({
      workspaceId: "workspace-project",
      contentHash: "hash-after",
    })
    expect(listTaskResourceBindings(client, "task-content")).toMatchObject([
      { resourceId: "document-celeste", role: "output" },
    ])
    expect(listTaskArtifacts(client, "task-content")).toMatchObject([
      { id: "artifact-celeste", documentId: "document-celeste", status: "active" },
    ])
    expect(listWorkspaceOperations(client, "task-content")).toMatchObject([
      { id: "operation-move", operation: "move-documents", status: "applied" },
    ])
    expect(findTaskSession(client, "task-content")?.workspaceId).toBe("workspace-project")
    client.close()
  })

  test("可以保存、停用并删除用户 Skill 安装目录", () => {
    const client = openDatabase({ path: ":memory:" })
    upsertUserSkillConfigRecord(client, {
      id: "user:meeting-notes",
      name: "meeting-notes",
      description: "整理会议记录",
      enabled: true,
      fileCount: 2,
      totalBytes: 128,
      installedAt: new Date(100),
      updatedAt: new Date(100),
    })

    expect(listUserSkillConfigRecords(client)).toHaveLength(1)
    expect(findUserSkillConfigRecord(client, "user:meeting-notes")).toMatchObject({
      enabled: true,
      name: "meeting-notes",
    })
    expect(setUserSkillConfigEnabled(client, "user:meeting-notes", false)).toBe(true)
    expect(findUserSkillConfigRecord(client, "user:meeting-notes")?.enabled).toBe(false)
    expect(deleteUserSkillConfigRecord(client, "user:meeting-notes")).toBe(true)
    expect(listUserSkillConfigRecords(client)).toEqual([])
    client.close()
  })

  test("重复执行迁移不会重复应用", () => {
    const client = openDatabase({ path: ":memory:" })
    applyDatabaseMigrations(client.connection)
    const result = client.connection
      .prepare<[], { count: number }>("SELECT count(*) AS count FROM __tessera_migrations")
      .get()

    expect(result?.count).toBe(DATABASE_MIGRATIONS.length)
    client.close()
  })

  test("前向迁移会保留旧 agent_events 中的 Chat 快照", () => {
    const database = new BetterSqlite3(":memory:")
    database.pragma("foreign_keys = ON")
    for (const statement of foundationMigration.statements) database.exec(statement)
    database
      .prepare("INSERT INTO workspaces (id, root_path, display_name, last_opened_at) VALUES (?, ?, ?, ?)")
      .run("legacy-workspace", "/tmp/legacy", "旧工作区", 100)
    database
      .prepare(
        "INSERT INTO agent_sessions (id, workspace_id, title, status, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("legacy-chat", "legacy-workspace", "旧对话", "completed", 200)
    database
      .prepare("INSERT INTO agent_events (id, session_id, sequence, kind, payload) VALUES (?, ?, ?, ?, ?)")
      .run(
        "legacy-snapshot",
        "legacy-chat",
        0,
        "chat.snapshot",
        JSON.stringify([{ id: "legacy-message", role: "user", parts: [{ type: "text", text: "旧消息" }] }]),
      )

    for (const statement of taskSessionsMigration.statements) database.exec(statement)

    expect(database.prepare("SELECT id, mode FROM task_sessions").get()).toEqual({
      id: "legacy-chat",
      mode: "chat",
    })
    expect(database.prepare("SELECT payload_json FROM task_messages").get()).toEqual({
      payload_json: JSON.stringify({
        id: "legacy-message",
        role: "user",
        parts: [{ type: "text", text: "旧消息" }],
      }),
    })
    database.close()
  })

  test("删除工作区会级联清理可重建索引", () => {
    const client = openDatabase({ path: ":memory:" })
    client.connection
      .prepare("INSERT INTO workspaces (id, root_path, display_name, last_opened_at) VALUES (?, ?, ?, ?)")
      .run("workspace-1", "/tmp/tessera", "测试空间", Date.now())
    client.connection
      .prepare(
        "INSERT INTO document_index (id, workspace_id, relative_path, content_hash, source_modified_at, indexed_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("document-1", "workspace-1", "README.md", "hash", Date.now(), Date.now())

    client.connection.prepare("DELETE FROM workspaces WHERE id = ?").run("workspace-1")
    const result = client.connection
      .prepare<[], { count: number }>("SELECT count(*) AS count FROM document_index")
      .get()

    expect(result?.count).toBe(0)
    client.close()
  })

  test("保存工作区后可以恢复最近打开项", () => {
    const client = openDatabase({ path: ":memory:" })
    saveWorkspace(client, {
      id: "workspace-1",
      rootPath: "/tmp/first",
      displayName: "第一个空间",
      lastOpenedAt: new Date(100),
    })
    saveWorkspace(client, {
      id: "workspace-2",
      rootPath: "/tmp/latest",
      displayName: "最近空间",
      lastOpenedAt: new Date(200),
    })
    saveWorkspace(client, {
      id: "workspace-1-reopened",
      rootPath: "/tmp/first",
      displayName: "第一个空间",
      lastOpenedAt: new Date(300),
    })

    expect(findMostRecentWorkspace(client)).toMatchObject({
      id: "workspace-1",
      rootPath: "/tmp/first",
      lastOpenedAt: new Date(300),
    })
    client.close()
  })

  test("重新打开托管项目时不会把内容库身份降级为外部工作区", () => {
    const client = openDatabase({ path: ":memory:" })
    saveContentLibrary(client, {
      id: "library-managed",
      rootPath: "/tmp/tessera-managed",
      displayName: "Tessera 内容库",
      updatedAt: new Date(100),
    })
    saveWorkspace(client, {
      id: "workspace-managed",
      rootPath: "/tmp/tessera-managed/project",
      displayName: "托管项目",
      lastOpenedAt: new Date(100),
      contentLibraryId: "library-managed",
      storageKind: "managed-project",
    })

    saveWorkspace(client, {
      id: "ignored-reopen-id",
      rootPath: "/tmp/tessera-managed/project",
      displayName: "托管项目",
      lastOpenedAt: new Date(200),
    })

    expect(findWorkspaceById(client, "workspace-managed")).toMatchObject({
      contentLibraryId: "library-managed",
      storageKind: "managed-project",
      lastOpenedAt: new Date(200),
    })
    client.close()
  })

  test("可以按最近使用时间列出并定位工作区", () => {
    const client = openDatabase({ path: ":memory:" })
    saveWorkspace(client, {
      id: "workspace-1",
      rootPath: "/tmp/first",
      displayName: "第一个空间",
      lastOpenedAt: new Date(100),
    })
    saveWorkspace(client, {
      id: "workspace-2",
      rootPath: "/tmp/latest",
      displayName: "最近空间",
      lastOpenedAt: new Date(200),
    })

    expect(listRecentWorkspaces(client).map((workspace) => workspace.id)).toEqual([
      "workspace-2",
      "workspace-1",
    ])
    expect(findWorkspaceById(client, "workspace-1")?.displayName).toBe("第一个空间")
    client.close()
  })

  test("从最近列表移除工作区不会删除数据，重新打开会恢复显示", () => {
    const client = openDatabase({ path: ":memory:" })
    saveWorkspace(client, {
      id: "workspace-hidden",
      rootPath: "/tmp/hidden",
      displayName: "暂时隐藏的空间",
      lastOpenedAt: new Date(100),
    })
    saveTaskSession(client, {
      id: "workspace-task",
      mode: "chat",
      workspaceId: "workspace-hidden",
      title: "保留的对话",
      status: "completed",
      updatedAt: new Date(200),
      messagePayloads: [],
    })

    expect(hideRecentWorkspace(client, "workspace-hidden")).toBe(true)
    expect(listRecentWorkspaces(client)).toEqual([])
    expect(findMostRecentWorkspace(client)).toBeNull()
    expect(findWorkspaceById(client, "workspace-hidden")?.displayName).toBe("暂时隐藏的空间")
    expect(listWorkspaceTaskSessions(client, "workspace-hidden")).toHaveLength(1)

    saveWorkspace(client, {
      id: "ignored-reopen-id",
      rootPath: "/tmp/hidden",
      displayName: "重新打开的空间",
      lastOpenedAt: new Date(300),
    })
    expect(listRecentWorkspaces(client)).toMatchObject([
      { id: "workspace-hidden", displayName: "重新打开的空间" },
    ])
    client.close()
  })

  test("普通对话可以不绑定工作区并恢复版本化消息", () => {
    const client = openDatabase({ path: ":memory:" })
    saveTaskSession(client, {
      id: "chat-task",
      mode: "chat",
      skillId: "research",
      workspaceId: null,
      title: "无工作区对话",
      status: "completed",
      updatedAt: new Date(200),
      messagePayloads: [
        JSON.stringify({ id: "message-1", role: "user", parts: [{ type: "text", text: "你好" }] }),
        JSON.stringify({
          id: "message-2",
          role: "assistant",
          metadata: { providerId: "deepseek", modelId: "deepseek-chat" },
          parts: [{ type: "text", text: "你好，有什么可以帮你？", state: "done" }],
        }),
      ],
    })

    expect(listRecentTaskSessions(client)).toMatchObject([
      { id: "chat-task", mode: "chat", skillId: "research", workspaceId: null, workspaceName: null },
    ])
    expect(findTaskSession(client, "chat-task")?.messagePayloads).toHaveLength(2)
    client.close()
  })

  test("对话可以重命名并在删除时级联清理消息", () => {
    const client = openDatabase({ path: ":memory:" })
    saveTaskSession(client, {
      id: "mutable-task",
      mode: "chat",
      workspaceId: null,
      title: "原名称",
      status: "completed",
      updatedAt: new Date(100),
      messagePayloads: [
        JSON.stringify({ id: "message-1", role: "user", parts: [{ type: "text", text: "你好" }] }),
      ],
    })

    expect(renameTaskSession(client, "mutable-task", "新名称")?.title).toBe("新名称")
    expect(findTaskSession(client, "mutable-task")?.title).toBe("新名称")
    expect(deleteTaskSession(client, "mutable-task")).toBe(true)
    expect(findTaskSession(client, "mutable-task")).toBeNull()
    expect(
      client.connection
        .prepare("SELECT count(*) AS count FROM task_messages WHERE task_id = ?")
        .get("mutable-task"),
    ).toEqual({ count: 0 })
    client.close()
  })

  test("Agent 任务必须绑定工作区并按工作区列出", () => {
    const client = openDatabase({ path: ":memory:" })
    saveWorkspace(client, {
      id: "workspace-agent",
      rootPath: "/tmp/agent",
      displayName: "Agent 空间",
      lastOpenedAt: new Date(100),
    })
    expect(() =>
      saveTaskSession(client, {
        id: "invalid-agent-task",
        mode: "agent",
        workspaceId: null,
        title: "无效 Agent",
        status: "idle",
        updatedAt: new Date(100),
        messagePayloads: [],
      }),
    ).toThrow()

    saveTaskSession(client, {
      id: "agent-task",
      mode: "agent",
      workspaceId: "workspace-agent",
      title: "只读研究",
      status: "idle",
      updatedAt: new Date(200),
      messagePayloads: [],
    })
    expect(listWorkspaceTaskSessions(client, "workspace-agent")).toMatchObject([
      { id: "agent-task", mode: "agent", workspaceName: "Agent 空间" },
    ])
    client.close()
  })

  test("等待用户回答的任务状态可以持久化并恢复", () => {
    const client = openDatabase({ path: ":memory:" })
    saveTaskSession(client, {
      id: "waiting-task",
      mode: "chat",
      skillId: "research",
      workspaceId: null,
      title: "等待确认研究方向",
      status: "waiting-input",
      updatedAt: new Date(100),
      messagePayloads: [
        JSON.stringify({
          id: "assistant-question",
          role: "assistant",
          parts: [
            {
              type: "tool-request-user-input",
              toolCallId: "question-call",
              state: "input-available",
              input: { questions: [] },
            },
          ],
        }),
      ],
    })

    expect(findTaskSession(client, "waiting-task")).toMatchObject({
      status: "waiting-input",
      messagePayloads: [expect.stringContaining("tool-request-user-input")],
    })
    expect(
      client.connection
        .prepare("SELECT status, waiting_for_input FROM task_sessions WHERE id = ?")
        .get("waiting-task"),
    ).toEqual({ status: "running", waiting_for_input: 1 })
    client.close()
  })

  test("任务运行事件按 request 和 sequence 持久化并可恢复", () => {
    const client = openDatabase({ path: ":memory:" })
    saveTaskSession(client, {
      id: "run-task",
      mode: "chat",
      workspaceId: null,
      title: "恢复运行",
      status: "running",
      updatedAt: new Date(100),
      messagePayloads: [],
    })
    startTaskRun(client, {
      configId: "deepseek",
      requestId: "run-request",
      taskId: "run-task",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      mode: "chat",
      skillId: "research",
      reasoning: "high",
      webSearch: true,
      policyJson: JSON.stringify({
        limits: {
          maxOutputTokens: 4_096,
          maxSteps: 8,
          maxTotalTokens: 40_000,
          timeoutMs: 120_000,
        },
        mode: "chat",
        reasoning: "high",
        skillId: "research",
        toolScope: "conversation",
        webSearch: true,
      }),
      resourceSummaryJson: JSON.stringify({
        attachmentCount: 1,
        currentDocumentPath: "notes/celeste.md",
        workspaceId: null,
        workspaceName: null,
      }),
      startedAt: new Date(200),
    })
    appendTaskRunEvent(client, {
      requestId: "run-request",
      sequence: 1,
      payloadJson: JSON.stringify({ sequence: 1, chunk: { type: "start" } }),
    })
    appendTaskRunEvent(client, {
      requestId: "run-request",
      sequence: 2,
      payloadJson: JSON.stringify({ sequence: 2, chunk: { type: "text-delta", delta: "恢复" } }),
    })
    finishTaskRun(client, "run-request", "completed", {
      sdkCallId: "sdk-call-1",
      finishReason: "stop",
      rawFinishReason: "end_turn",
      inputTokens: 120,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      outputTokens: 30,
      reasoningTokens: 12,
      totalTokens: 150,
      stepCount: 3,
      toolCallCount: 2,
      timeToFirstOutputMs: 240,
      modelDurationMs: 1_600,
      toolDurationMs: 300,
      durationMs: 2_100,
    })

    expect(findLatestTaskRun(client, "run-task")).toMatchObject({
      requestId: "run-request",
      status: "completed",
      lastSequence: 2,
      mode: "chat",
      skillId: "research",
      reasoning: "high",
      webSearch: true,
      policyJson: expect.stringContaining('"toolScope":"conversation"'),
      resourceSummaryJson: expect.stringContaining('"currentDocumentPath":"notes/celeste.md"'),
      sdkCallId: "sdk-call-1",
      finishReason: "stop",
      rawFinishReason: "end_turn",
      inputTokens: 120,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      outputTokens: 30,
      reasoningTokens: 12,
      totalTokens: 150,
      stepCount: 3,
      toolCallCount: 2,
      timeToFirstOutputMs: 240,
      modelDurationMs: 1_600,
      toolDurationMs: 300,
      durationMs: 2_100,
      events: [{ sequence: 1 }, { sequence: 2 }],
    })
    client.close()
  })

  test("AI 供应商普通配置与 safeStorage 密文可以幂等保存并删除", () => {
    const client = openDatabase({ path: ":memory:" })
    upsertAiProviderConfigRecord(client, {
      configId: "openrouter",
      displayName: "OpenRouter",
      providerId: "openrouter",
      enabled: true,
      baseUrl: "https://openrouter.ai/api/v1",
      modelsJson: '[{"id":"openrouter/auto","enabled":true}]',
      apiKeyCiphertext: "encrypted-value",
      updatedAt: new Date(100),
    })
    upsertAiProviderConfigRecord(client, {
      configId: "openrouter",
      displayName: "OpenRouter",
      providerId: "openrouter",
      enabled: false,
      baseUrl: "https://relay.example.com/v1",
      modelsJson: "[]",
      apiKeyCiphertext: "encrypted-value",
      updatedAt: new Date(200),
    })

    expect(listAiProviderConfigRecords(client)).toHaveLength(1)
    expect(findAiProviderConfigRecord(client, "openrouter")).toMatchObject({
      enabled: false,
      baseUrl: "https://relay.example.com/v1",
      apiKeyCiphertext: "encrypted-value",
      updatedAt: new Date(200),
    })

    deleteAiProviderConfigRecord(client, "openrouter")
    expect(findAiProviderConfigRecord(client, "openrouter")).toBeNull()
    client.close()
  })

  test("MCP 服务器配置只持久化密文并支持幂等更新和删除", () => {
    const client = openDatabase({ path: ":memory:" })
    upsertMcpServerConfigRecord(client, {
      id: "filesystem",
      name: "Filesystem",
      description: "本地文件服务",
      transport: "stdio",
      enabled: false,
      trusted: true,
      command: "npx",
      argsJson: '["-y","@modelcontextprotocol/server-filesystem","/tmp"]',
      url: null,
      timeoutMs: 15_000,
      envCiphertext: "encrypted-env",
      headersCiphertext: null,
      disabledToolsJson: '["write_file"]',
      updatedAt: new Date(100),
    })
    upsertMcpServerConfigRecord(client, {
      id: "filesystem",
      name: "Filesystem MCP",
      description: "本地文件服务",
      transport: "stdio",
      enabled: true,
      trusted: true,
      command: "npx",
      argsJson: '["-y","@modelcontextprotocol/server-filesystem","/tmp"]',
      url: null,
      timeoutMs: 20_000,
      envCiphertext: "encrypted-env",
      headersCiphertext: null,
      disabledToolsJson: "[]",
      updatedAt: new Date(200),
    })

    expect(listMcpServerConfigRecords(client)).toHaveLength(1)
    expect(findMcpServerConfigRecord(client, "filesystem")).toMatchObject({
      name: "Filesystem MCP",
      enabled: true,
      envCiphertext: "encrypted-env",
      updatedAt: new Date(200),
    })

    deleteMcpServerConfigRecord(client, "filesystem")
    expect(findMcpServerConfigRecord(client, "filesystem")).toBeNull()
    client.close()
  })

  test("同一兼容协议可以持久化多条独立连接", () => {
    const client = openDatabase({ path: ":memory:" })
    upsertAiProviderConfigRecord(client, {
      configId: "anthropic-compatible:deepseek",
      displayName: "DeepSeek Messages",
      providerId: "anthropic-compatible",
      enabled: true,
      baseUrl: "https://api.deepseek.com/anthropic",
      modelsJson: '[{"id":"deepseek-chat","enabled":true}]',
      apiKeyCiphertext: "deepseek-ciphertext",
      updatedAt: new Date(100),
    })
    upsertAiProviderConfigRecord(client, {
      configId: "anthropic-compatible:relay",
      displayName: "团队中转",
      providerId: "anthropic-compatible",
      enabled: true,
      baseUrl: "https://relay.example.com/anthropic",
      modelsJson: '[{"id":"claude-relay","enabled":true}]',
      apiKeyCiphertext: "relay-ciphertext",
      updatedAt: new Date(200),
    })

    expect(listAiProviderConfigRecords(client)).toMatchObject([
      {
        configId: "anthropic-compatible:deepseek",
        providerId: "anthropic-compatible",
        baseUrl: "https://api.deepseek.com/anthropic",
      },
      {
        configId: "anthropic-compatible:relay",
        providerId: "anthropic-compatible",
        baseUrl: "https://relay.example.com/anthropic",
      },
    ])
    client.close()
  })

  test("关闭并重新打开磁盘数据库后仍能恢复 AI 供应商配置", () => {
    const directory = mkdtempSync(join(tmpdir(), "tessera-provider-config-"))
    const databasePath = join(directory, "tessera.sqlite3")
    try {
      const first = openDatabase({ path: databasePath })
      upsertAiProviderConfigRecord(first, {
        configId: "deepseek",
        displayName: "DeepSeek",
        providerId: "deepseek",
        enabled: true,
        baseUrl: "https://api.deepseek.com",
        modelsJson: '[{"id":"deepseek-chat","enabled":true}]',
        apiKeyCiphertext: "encrypted-value",
        updatedAt: new Date(100),
      })
      first.close()

      const restarted = openDatabase({ path: databasePath })
      expect(findAiProviderConfigRecord(restarted, "deepseek")).toMatchObject({
        enabled: true,
        baseUrl: "https://api.deepseek.com",
        apiKeyCiphertext: "encrypted-value",
      })
      restarted.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
