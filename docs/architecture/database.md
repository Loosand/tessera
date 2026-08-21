# 本地数据库架构

> 代码源头：`packages/database/schema.ts`、`packages/database/client.ts`、
> `packages/database/migrations/index.ts`、`packages/database/workspace-repository.ts`、
> `packages/database/ai-provider-config-repository.ts`
>
> 状态：部分实现。

## 边界

Markdown 文件是内容事实源。SQLite 保存工作区登记、AI 供应商普通配置与加密密钥、可重建文档索引、Agent 会话事件和权限审计，
不能成为文档正文的唯一副本。渲染层不直接访问数据库，后续查询通过核心服务和类型化 IPC 暴露。

## 连接生命周期

- **已实现**：`openDatabase()` 创建父目录、开启外键和 5 秒忙等待。
- **已实现**：磁盘数据库开启 WAL，并使用 `synchronous = NORMAL`。
- **已实现**：只读连接要求文件已经存在，默认不执行迁移。
- **已实现**：桌面主进程按 Electron `userData` 目录创建单例连接，并在退出时关闭。
- **已实现**：工作区仓储幂等记录打开时间，可按最近使用顺序列出、定位并恢复仍然存在的工作区。
- **已实现**：供应商仓储保存 Base URL、启用状态、模型 JSON 和 `safeStorage` 密文；关闭并重新打开数据库后可恢复。

## 迁移

迁移以内嵌 TypeScript SQL 清单发布，因此 Electron 打包后不依赖额外 SQL 文件路径。执行器先创建
`__tessera_migrations`，再在单个事务内按顺序应用尚未记录的迁移。已经发布的迁移不可修改；
schema 变化必须追加迁移，并同步结构测试。

## 初始数据域

| 表 | 用途 | 是否可重建 |
| --- | --- | --- |
| `workspaces` | 登记用户打开过的本地工作区 | 否 |
| `document_index` | 文件路径、修改时间和内容哈希 | 是 |
| `agent_sessions` | Agent 会话状态与标题 | 否 |
| `agent_events` | 会话的有序事件流 | 否 |
| `permission_decisions` | 工具动作、资源和权限结果审计 | 否 |
| `ai_provider_configs` | 供应商连接、模型状态与 Electron safeStorage 密文 | 否 |

全文搜索、订阅源、活动时间线和通用设置表仍处于规划状态，等对应领域开始实现时再新增 schema 与迁移。
