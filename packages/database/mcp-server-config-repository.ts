/**
 * [INPUT]: 数据库客户端、已校验 MCP 服务器配置与 safeStorage 密文
 * [OUTPUT]: MCP 服务器记录的查询、幂等写入与删除操作
 * [POS]: MCP 配置持久化的低层 SQLite 仓储边界
 * [DOC]: docs/architecture/database.md、docs/architecture/mcp.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { asc, eq } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import { type NewMcpServerConfigRecord, mcpServerConfigs } from "./schema"

export function listMcpServerConfigRecords(client: DatabaseClient) {
  return client.db.select().from(mcpServerConfigs).orderBy(asc(mcpServerConfigs.name)).all()
}

export function findMcpServerConfigRecord(client: DatabaseClient, serverId: string) {
  return client.db.select().from(mcpServerConfigs).where(eq(mcpServerConfigs.id, serverId)).get() ?? null
}

export function upsertMcpServerConfigRecord(client: DatabaseClient, config: NewMcpServerConfigRecord) {
  client.db
    .insert(mcpServerConfigs)
    .values(config)
    .onConflictDoUpdate({
      target: mcpServerConfigs.id,
      set: {
        name: config.name,
        description: config.description,
        transport: config.transport,
        enabled: config.enabled,
        trusted: config.trusted,
        command: config.command,
        argsJson: config.argsJson,
        url: config.url,
        timeoutMs: config.timeoutMs,
        envCiphertext: config.envCiphertext,
        headersCiphertext: config.headersCiphertext,
        disabledToolsJson: config.disabledToolsJson,
        updatedAt: config.updatedAt,
      },
    })
    .run()
}

export function deleteMcpServerConfigRecord(client: DatabaseClient, serverId: string) {
  client.db.delete(mcpServerConfigs).where(eq(mcpServerConfigs.id, serverId)).run()
}
