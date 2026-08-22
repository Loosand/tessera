# 本地数据库架构

> 代码源头：`packages/database/schema.ts`、`packages/database/client.ts`、
> `packages/database/migrations/index.ts`、`packages/database/workspace-repository.ts`、
> `packages/database/task-session-repository.ts`、`packages/database/task-run-repository.ts`、
> `packages/database/agent-change-repository.ts`、`packages/database/ai-provider-config-repository.ts`、
> `packages/database/mcp-server-config-repository.ts`、`packages/database/user-skill-config-repository.ts`、
> `packages/database/content-domain-repository.ts`、`packages/database/migrations/0013-unified-content-domain.ts`
>
> 状态：部分实现。任务、运行、工作区、审批、动态资源、Artifact、内容库和项目操作审计仓储已实现；每轮完整
> RunPolicy、脱敏资源摘要与 AI SDK 生命周期汇总已写入运行记录。正文存储仍在探索，当前仅实现托管内容库混合原型。

## 边界

Markdown 文件是已批准正文的内容事实源。SQLite 保存工作区登记、通用任务消息、AI 供应商普通配置与加密密钥、MCP 连接元数据与加密环境/请求头、用户 Skill 安装元数据、可重建文档索引、Agent 运行事件、待审批候选内容和权限审计，
不能成为文档正文的唯一副本。渲染层不直接访问数据库，后续查询通过核心服务和类型化 IPC 暴露。

当前混合实验把本地目录与 Markdown 定义为内容层，把 SQLite 定义为控制层。项目创建、文档移动和 Artifact 关联可以像数据库业务操作一样由领域服务编排，但磁盘事实优先于可重建索引。最终可能选择数据库正文或完全开放外部工作区；在独立 ADR 替换当前边界前，不能维护“数据库正文 + Markdown 正文”双事实源。

## 连接生命周期

- **已实现**：`openDatabase()` 创建父目录、开启外键和 5 秒忙等待。
- **已实现**：磁盘数据库开启 WAL，并使用 `synchronous = NORMAL`。
- **已实现**：只读连接要求文件已经存在，默认不执行迁移。
- **已实现**：桌面主进程按 Electron `userData` 目录创建单例连接，并在退出时关闭。
- **已实现**：工作区仓储幂等记录打开时间，可按最近使用顺序列出、定位并恢复仍然存在的工作区；普通打开未显式携带存储元数据时保留原有 `managed-inbox` / `managed-project` 与内容库关系，避免把托管项目降级成外部工作区。
- **已实现**：工作区可以通过 `hidden_at` 从最近列表隐藏；记录及关联任务保持不变，再次打开相同路径会清除隐藏状态。
- **已实现**：供应商仓储保存 Base URL、启用状态、模型 JSON 和 `safeStorage` 密文；关闭并重新打开数据库后可恢复。
- **已实现**：MCP 仓储保存传输配置、显式信任/启用状态、逐工具禁用清单和环境变量/请求头 `safeStorage` 密文；运行状态与发现能力不伪造成持久化事实。
- **已实现**：用户 Skill 仓储保存稳定 `user:<name>` 标识、标准描述、启用状态、文件数量/总大小与安装时间；正文和托管绝对路径不进入 SQLite，磁盘可用性由主进程服务复核。
- **已实现**：通用任务仓储保存兼容 `chat` / `agent` mode、下一轮内置/用户 Skill 或 `question-answering` 标记、可选初始工作区、可恢复等待状态和版本化消息；mode 与初始归属创建后不可变，但不再决定当前轮权限，工作区工具只来自眼下打开且已授权的工作区。
- **已实现**：任务可重命名或删除；删除 `task_sessions` 时由外键级联清理对应 `task_messages`。
- **已实现**：`task_runs` / `task_run_events` 在模型调用前创建运行 ID，固化本轮完整 RunPolicy、兼容查询列与资源摘要，并按 task/request/sequence 保存公开流事件；结束时从 AI SDK `onStepEnd` / `onEnd` 写入 SDK call、完成原因、Token/缓存和性能汇总，启动时把未结束运行标记为中断供任务页重放。
- **已实现**：`agent_change_proposals` 冻结 Markdown 基准与候选内容、模型、工具调用、人工决定和写入结果；它不是已批准正文事实源，任务删除时级联清理。
- **已实现**：`0013-unified-content-domain` 增加内容库、托管工作区来源、逐轮资源关系、Artifact 与项目操作审计；
  这些表只保存稳定 ID、相对位置和控制状态，不保存 Markdown 正文。

## 统一创作 Agent 数据探索

以下控制层能力已随混合原型实现，最终正文方案仍按[统一创作 Agent 与内容存储探索](unified-creation-agent.md)评审：

- `task_sessions` 只承担会话身份、标题、状态和时间；已发布的 mode、`skill_id` 与单一 `workspace_id` 保留为旧任务兼容字段，不继续作为新任务的完整权限事实。
- `task_runs` 已保存本轮实际内部 mode、显式 Skill、联网/思考兼容查询列、完整 `policy_json`、`resource_summary_json`，以及完成原因、输入/输出/推理与缓存读写 Token、步骤/工具计数、首输出/模型/工具/总耗时；后续增加规范化资源关系。同一会话不同 run 可以使用不同策略。
- `task_resource_bindings` 记录 Task/Run 与 Workspace、Document、Attachment 的动态关系和角色；恢复历史时以 run 快照解释模型当时可见的资源。
- `artifacts` 为 Agent 创建或修改的 Markdown 建立稳定逻辑 ID、当前工作区/相对路径、创建 run 和状态。移动文件改变路径关系，不改变会话或 Artifact 身份。
- `workspace_operations` 记录创建项目、移动/重命名文档的授权依据、来源、目标、冲突、结果与恢复信息；正文候选继续使用现有 `agent_change_proposals`。
- 当前混合实验中，内容库根目录授权保存在主进程 SQLite 控制层，“未归档”和项目使用普通工作区登记；正文不复制进 SQLite。

领域服务协调文件系统和数据库时先预检真实路径与冲突，再执行可恢复的磁盘操作，最后更新关系并刷新索引。数据库更新失败时重新扫描磁盘事实，不能通过回滚索引覆盖、移动或删除用户正文。

## 迁移

迁移以内嵌 TypeScript SQL 清单发布，因此 Electron 打包后不依赖额外 SQL 文件路径。执行器先创建
`__tessera_migrations`，再在单个事务内按顺序应用尚未记录的迁移。已经发布的迁移不可修改；
schema 变化必须追加迁移，并同步结构测试。

已发布的任务状态列带固定 `CHECK`，新增 `waiting-input` 不重写旧表：`0007-task-waiting-input` 追加布尔标记，仓储把公开等待态编码为物理 `status = running` 与 `waiting_for_input = 1`，读取时再统一还原。问题输入和用户答案仍保存在版本化消息 Part 中，布尔列只服务列表、恢复和状态查询。

`task_sessions.skill_id` 与 `task_runs.skill_id` 的已发布物理列都是可空 `TEXT`，因此可以保存通过共享守卫校验的 `user:<name>`；自动方式继续使用 `NULL`。用户 Skill 安装元数据由 `0011-user-skills` 单独建表，任务历史只保存稳定 ID，不复制 Skill 正文。

统一 Agent 迁移继续采用追加迁移：不删除或重解释旧列中的历史值，不重写已发布迁移。旧 mode/Skill/Workspace 在读取时转换为初始运行策略和初始资源绑定；新 run 写入新的策略与关系表。整个迁移不导入、复制或重编码现有 Markdown 正文。

## 初始数据域

| 表 | 用途 | 是否可重建 |
| --- | --- | --- |
| `workspaces` | 登记用户打开过的本地工作区及最近列表隐藏状态 | 否 |
| `document_index` | 文件路径、修改时间和内容哈希 | 是 |
| `agent_sessions` | Agent 会话状态与标题 | 否 |
| `agent_events` | 会话的有序事件流 | 否 |
| `permission_decisions` | 工具动作、资源和权限结果审计 | 否 |
| `task_sessions` | Chat/Agent 共用的内部 mode、创作方式/可选内置或用户 Skill、工作区绑定、标题、运行状态和等待输入标记 | 否 |
| `task_messages` | 按序保存的版本化消息 Part 与模型元数据 | 否 |
| `task_runs` | 每次模型运行的供应商、模型、完整 RunPolicy、资源摘要、兼容策略列、状态、事件游标和无正文运行汇总 | 否 |
| `task_run_events` | 按 request/sequence 保存的公开 AI SDK 流事件检查点 | 否 |
| `agent_change_proposals` | 冻结的 Markdown 基准/候选、审批决定、冲突和写入审计 | 否 |
| `ai_provider_configs` | 供应商连接、模型状态与 Electron safeStorage 密文 | 否 |
| `mcp_server_configs` | MCP 传输、信任/启用状态、禁用工具与 Electron safeStorage 密文 | 否 |
| `user_skill_configs` | 用户 Skill 稳定 ID、描述、启用状态与托管目录统计 | 否 |
| `content_libraries` | 内容库授权、显示名与撤销状态；根路径只留在主进程控制层 | 否 |
| `task_resource_bindings` | Task/Run 与工作区、文档和附件的动态资源关系 | 否 |
| `artifacts` | Agent 产物的稳定身份、文档关系和创建 run | 否 |
| `workspace_operations` | 文档/项目创建、移动和结构检查的结果、冲突与恢复信息 | 否 |

全文搜索、订阅源和面向用户的完整 Operation 活动聚合仍处于规划；内容库设置和统一 Agent 控制表已实现。
