/**
 * [INPUT]: Drizzle 数据库实例与非敏感应用设置键值
 * [OUTPUT]: 应用设置的单项查询与幂等保存操作
 * [POS]: 主进程持久化全局偏好的数据库仓储边界
 * [DOC]: docs/architecture/database.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { eq } from "drizzle-orm"
import type { DatabaseClient } from "./client"
import { type NewAppSettingRecord, appSettings } from "./schema"

export function findAppSetting(client: DatabaseClient, key: string) {
  return client.db.select().from(appSettings).where(eq(appSettings.key, key)).get() ?? null
}

export function upsertAppSetting(client: DatabaseClient, setting: NewAppSettingRecord) {
  client.db
    .insert(appSettings)
    .values(setting)
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value: setting.value,
        updatedAt: setting.updatedAt,
      },
    })
    .run()
  return findAppSetting(client, setting.key)
}
