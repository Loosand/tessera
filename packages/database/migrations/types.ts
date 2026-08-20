/**
 * [INPUT]: 单次数据库版本变化需要执行的 SQL 语句
 * [OUTPUT]: 具有稳定 ID 和有序语句的 DatabaseMigration 契约
 * [POS]: 迁移定义与迁移执行器共享的底层类型
 * [DOC]: docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export interface DatabaseMigration {
  id: string
  statements: readonly string[]
}
