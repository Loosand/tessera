/**
 * [INPUT]: 数据库客户端、迁移和 schema 模块
 * [OUTPUT]: @tessera/database 的稳定公开 API
 * [POS]: 本地数据库包的根入口
 * [DOC]: docs/architecture/database.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export * from "./client"
export * from "./ai-provider-config-repository"
export * from "./migrations"
export * from "./schema"
export * from "./task-session-repository"
export * from "./workspace-repository"
