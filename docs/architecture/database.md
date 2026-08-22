# 本地数据库架构

> 代码源头：`packages/database/schema.ts`、`packages/database/client.ts`、
> `packages/database/migrations/index.ts`、`packages/database/workspace-repository.ts`、
> `packages/database/task-session-repository.ts`、`packages/database/task-run-repository.ts`、
> `packages/database/agent-change-repository.ts`、`packages/database/ai-provider-config-repository.ts`
>
> 状态：部分实现。

## 边界

Markdown 文件是已批准正文的内容事实源。SQLite 保存工作区登记、通用任务消息、AI 供应商普通配置与加密密钥、可重建文档索引、Agent 运行事件、待审批候选内容和权限审计，
不能成为文档正文的唯一副本。渲染层不直接访问数据库，后续查询通过核心服务和类型化 IPC 暴露。

## 连接生命周期

- **已实现**：`openDatabase()` 创建父目录、开启外键和 5 秒忙等待。
- **已实现**：磁盘数据库开启 WAL，并使用 `synchronous = NORMAL`。
- **已实现**：只读连接要求文件已经存在，默认不执行迁移。
- **已实现**：桌面主进程按 Electron `userData` 目录创建单例连接，并在退出时关闭。
- **已实现**：工作区仓储幂等记录打开时间，可按最近使用顺序列出、定位并恢复仍然存在的工作区。
- **已实现**：工作区可以通过 `hidden_at` 从最近列表隐藏；记录及关联任务保持不变，再次打开相同路径会清除隐藏状态。
- **已实现**：供应商仓储保存 Base URL、启用状态、模型 JSON 和 `safeStorage` 密文；关闭并重新打开数据库后可恢复。
- **已实现**：通用任务仓储保存内部 `chat` / `agent` mode、`research` / `writing` Skill 或 `question-answering` 行为标记、可选工作区绑定、可恢复等待用户输入状态和版本化消息；普通 Chat 允许没有工作区，Agent 必须绑定工作区，mode 与创作方式在任务创建后不可切换。
- **已实现**：任务可重命名或删除；删除 `task_sessions` 时由外键级联清理对应 `task_messages`。
- **已实现**：`task_runs` / `task_run_events` 在模型调用前创建运行 ID，并按 task/request/sequence 保存公开流事件；启动时把未结束运行标记为中断供任务页重放。
- **已实现**：`agent_change_proposals` 冻结 Markdown 基准与候选内容、模型、工具调用、人工决定和写入结果；它不是已批准正文事实源，任务删除时级联清理。

## 迁移

迁移以内嵌 TypeScript SQL 清单发布，因此 Electron 打包后不依赖额外 SQL 文件路径。执行器先创建
`__tessera_migrations`，再在单个事务内按顺序应用尚未记录的迁移。已经发布的迁移不可修改；
schema 变化必须追加迁移，并同步结构测试。

已发布的任务状态列带固定 `CHECK`，新增 `waiting-input` 不重写旧表：`0007-task-waiting-input` 追加布尔标记，仓储把公开等待态编码为物理 `status = running` 与 `waiting_for_input = 1`，读取时再统一还原。问题输入和用户答案仍保存在版本化消息 Part 中，布尔列只服务列表、恢复和状态查询。

`task_sessions.skill_id` 的已发布物理列是可空 `TEXT`，因此新增 `question-answering` 行为标记不需要改表；Drizzle schema 和跨进程校验共同约束允许值。自动方式继续使用 `NULL`，研究与写作才加载真实 `SKILL.md`。

## 初始数据域

| 表 | 用途 | 是否可重建 |
| --- | --- | --- |
| `workspaces` | 登记用户打开过的本地工作区及最近列表隐藏状态 | 否 |
| `document_index` | 文件路径、修改时间和内容哈希 | 是 |
| `agent_sessions` | Agent 会话状态与标题 | 否 |
| `agent_events` | 会话的有序事件流 | 否 |
| `permission_decisions` | 工具动作、资源和权限结果审计 | 否 |
| `task_sessions` | Chat/Agent 共用的内部 mode、创作方式/可选内置 Skill、工作区绑定、标题、运行状态和等待输入标记 | 否 |
| `task_messages` | 按序保存的版本化消息 Part 与模型元数据 | 否 |
| `task_runs` | 每次模型运行的供应商、模型、状态和事件游标 | 否 |
| `task_run_events` | 按 request/sequence 保存的公开 AI SDK 流事件检查点 | 否 |
| `agent_change_proposals` | 冻结的 Markdown 基准/候选、审批决定、冲突和写入审计 | 否 |
| `ai_provider_configs` | 供应商连接、模型状态与 Electron safeStorage 密文 | 否 |

全文搜索、订阅源、活动时间线和通用设置表仍处于规划状态，等对应领域开始实现时再新增 schema 与迁移。
