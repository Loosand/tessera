/**
 * [INPUT]: 内存/临时磁盘 SQLite 客户端与前向迁移
 * [OUTPUT]: 迁移幂等性、表结构、AI 配置重启恢复和级联删除的回归验证
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
import { describe, expect, test } from "vitest"
import {
  deleteAiProviderConfigRecord,
  findAiProviderConfigRecord,
  listAiProviderConfigRecords,
  upsertAiProviderConfigRecord,
} from "./ai-provider-config-repository"
import { openDatabase } from "./client"
import { DATABASE_MIGRATIONS, applyDatabaseMigrations } from "./migrations"
import {
  findMostRecentWorkspace,
  findWorkspaceById,
  listRecentWorkspaces,
  saveWorkspace,
} from "./workspace-repository"

describe("本地数据库基建", () => {
  test("首次打开会创建全部基础表", () => {
    const client = openDatabase({ path: ":memory:" })
    const tables = client.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>

    expect(tables.map((table) => table.name)).toEqual([
      "__tessera_migrations",
      "agent_events",
      "agent_sessions",
      "ai_provider_configs",
      "document_index",
      "permission_decisions",
      "workspaces",
    ])
    client.close()
  })

  test("重复执行迁移不会重复应用", () => {
    const client = openDatabase({ path: ":memory:" })
    applyDatabaseMigrations(client.connection)
    const result = client.connection.prepare("SELECT count(*) AS count FROM __tessera_migrations").get() as {
      count: number
    }

    expect(result.count).toBe(DATABASE_MIGRATIONS.length)
    client.close()
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
    const result = client.connection.prepare("SELECT count(*) AS count FROM document_index").get() as {
      count: number
    }

    expect(result.count).toBe(0)
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

  test("AI 供应商普通配置与 safeStorage 密文可以幂等保存并删除", () => {
    const client = openDatabase({ path: ":memory:" })
    upsertAiProviderConfigRecord(client, {
      providerId: "openrouter",
      enabled: true,
      baseUrl: "https://openrouter.ai/api/v1",
      modelsJson: '[{"id":"openrouter/auto","enabled":true}]',
      apiKeyCiphertext: "encrypted-value",
      updatedAt: new Date(100),
    })
    upsertAiProviderConfigRecord(client, {
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

  test("关闭并重新打开磁盘数据库后仍能恢复 AI 供应商配置", () => {
    const directory = mkdtempSync(join(tmpdir(), "tessera-provider-config-"))
    const databasePath = join(directory, "tessera.sqlite3")
    try {
      const first = openDatabase({ path: databasePath })
      upsertAiProviderConfigRecord(first, {
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
