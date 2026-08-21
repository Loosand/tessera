/**
 * [INPUT]: SQLite 文件路径、只读标记与迁移选项
 * [OUTPUT]: 配置好外键、WAL、Drizzle 和关闭边界的 DatabaseClient
 * [POS]: Electron 主进程打开本地数据库的唯一低层入口
 * [DOC]: docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3"
import { applyDatabaseMigrations } from "./migrations"
import * as schema from "./schema"

export type OpenDatabaseOptions = {
  readonly path: string
  readonly readonly?: boolean
  readonly migrate?: boolean
}

export type DatabaseClient = {
  readonly connection: BetterSqlite3.Database
  readonly db: BetterSQLite3Database<typeof schema>
  close(): void
}

export function openDatabase({
  path,
  readonly = false,
  migrate = !readonly,
}: OpenDatabaseOptions): DatabaseClient {
  if (path !== ":memory:" && !readonly) mkdirSync(dirname(resolve(path)), { recursive: true })

  const connection = new BetterSqlite3(path, {
    readonly,
    fileMustExist: readonly,
  })

  connection.pragma("foreign_keys = ON")
  connection.pragma("busy_timeout = 5000")
  if (!readonly && path !== ":memory:") {
    connection.pragma("journal_mode = WAL")
    connection.pragma("synchronous = NORMAL")
  }
  if (migrate) applyDatabaseMigrations(connection)

  return {
    connection,
    db: drizzle(connection, { schema }),
    close: () => connection.close(),
  }
}
