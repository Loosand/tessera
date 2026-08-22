/**
 * [INPUT]: 数据库客户端与已经通过主进程文件校验的用户 Skill 元数据
 * [OUTPUT]: 用户 Skill 安装记录的查询、幂等写入、启停与删除操作
 * [POS]: 用户 Skill 托管目录之上的低层 SQLite 目录仓储
 * [DOC]: docs/architecture/database.md、docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { asc, eq } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import { type NewUserSkillConfigRecord, userSkillConfigs } from "./schema"

export function listUserSkillConfigRecords(client: DatabaseClient) {
  return client.db.select().from(userSkillConfigs).orderBy(asc(userSkillConfigs.name)).all()
}

export function findUserSkillConfigRecord(client: DatabaseClient, skillId: string) {
  return client.db.select().from(userSkillConfigs).where(eq(userSkillConfigs.id, skillId)).get() ?? null
}

export function upsertUserSkillConfigRecord(client: DatabaseClient, config: NewUserSkillConfigRecord) {
  client.db
    .insert(userSkillConfigs)
    .values(config)
    .onConflictDoUpdate({
      target: userSkillConfigs.id,
      set: {
        name: config.name,
        description: config.description,
        enabled: config.enabled,
        fileCount: config.fileCount,
        totalBytes: config.totalBytes,
        updatedAt: config.updatedAt,
      },
    })
    .run()
}

export function setUserSkillConfigEnabled(client: DatabaseClient, skillId: string, enabled: boolean) {
  return (
    client.db
      .update(userSkillConfigs)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(userSkillConfigs.id, skillId))
      .run().changes > 0
  )
}

export function deleteUserSkillConfigRecord(client: DatabaseClient, skillId: string) {
  return client.db.delete(userSkillConfigs).where(eq(userSkillConfigs.id, skillId)).run().changes > 0
}
