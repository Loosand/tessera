/**
 * [INPUT]: 数据库客户端、已校验的 AI 供应商配置与 safeStorage 密文
 * [OUTPUT]: AI 供应商配置记录的查询、幂等写入与删除操作
 * [POS]: AI 供应商持久化的低层 SQLite 仓储边界
 * [DOC]: docs/architecture/database.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { asc, eq } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import { type NewAiProviderConfigRecord, aiProviderConfigs } from "./schema"

export function listAiProviderConfigRecords(client: DatabaseClient) {
  return client.db
    .select()
    .from(aiProviderConfigs)
    .orderBy(asc(aiProviderConfigs.providerId), asc(aiProviderConfigs.displayName))
    .all()
}

export function findAiProviderConfigRecord(client: DatabaseClient, configId: string) {
  return (
    client.db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.configId, configId)).get() ??
    null
  )
}

export function upsertAiProviderConfigRecord(client: DatabaseClient, config: NewAiProviderConfigRecord) {
  client.db
    .insert(aiProviderConfigs)
    .values(config)
    .onConflictDoUpdate({
      target: aiProviderConfigs.configId,
      set: {
        providerId: config.providerId,
        displayName: config.displayName,
        enabled: config.enabled,
        baseUrl: config.baseUrl,
        modelsJson: config.modelsJson,
        apiKeyCiphertext: config.apiKeyCiphertext,
        updatedAt: config.updatedAt,
      },
    })
    .run()
}

export function deleteAiProviderConfigRecord(client: DatabaseClient, configId: string) {
  client.db.delete(aiProviderConfigs).where(eq(aiProviderConfigs.configId, configId)).run()
}
