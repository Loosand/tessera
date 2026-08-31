# Pi 会话树、持久化与恢复

> Pi 证据：`packages/coding-agent/src/core/session-manager.ts::SessionManager`、
> `packages/coding-agent/src/core/session-manager.ts::buildSessionContext`、
> `packages/coding-agent/src/core/session-manager.ts::parseSessionEntries`、
> `packages/coding-agent/src/core/session-manager.ts::migrateSessionEntries`、
> `packages/coding-agent/src/core/agent-session.ts::navigateTree`、
> `packages/agent/src/harness/session/types.ts::LaneRecord`、
> `packages/agent/src/harness/session/session.ts::Session`
>
> Tessera 对照：`packages/database/schema.ts::taskRuns`、
> `packages/database/schema.ts::taskRunEvents`、
> `packages/database/task-run-repository.ts`、
> `apps/desktop/src/main/task-run-recovery.ts`、
> `docs/architecture/task-navigation.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Pi 旧主链的 Session 是一个追加式 JSONL 树。每条 entry 指向 `parentId`，当前 leaf 决定活动分支；branch 不删除历史，
compaction 不重写历史，只改变“如何投影成下一次模型上下文”。这套模型非常适合本地 CLI：可查看、可复制、可 fork、实现成本低。

但它主要恢复“对话树”，不是“正在执行的 durable operation”。正在 retry、压缩、跑工具或等待 queue 的状态仍依赖进程内
`AgentSession`。Pi 下一代 Harness 新增 operation/tool/queue/usage records，正是在补这个缺口；固定提交中执行器尚未完成。

## 1. JSONL 文件结构

文件第一行是 header：

```text
type=session
version=3
id / timestamp / cwd / parentSession?
```

后续每条 SessionEntry 都有：

- `id`；
- `parentId`；
- `timestamp`；
- 具体 entry type。

主要 entry：

| 类型 | 内容 | 是否进入模型上下文 |
| --- | --- | --- |
| `message` | user/assistant/toolResult/产品消息 | 取决于 message 转换 |
| `thinking_level_change` | thinking level | 不直接作为消息 |
| `model_change` | provider/model | 不直接作为消息 |
| `compaction` | summary、firstKeptEntryId、usage/details | 转为压缩摘要消息 |
| `branch_summary` | 放弃分支摘要与 fromId | 转为分支摘要消息 |
| `custom` | 扩展私有状态 | 不进入 LLM |
| `custom_message` | 扩展提供的模型上下文消息 | 进入 LLM |
| `label` | 节点标签 | 不进入 LLM |
| `session_info` | 会话名称等信息 | 不进入 LLM |

“扩展状态”和“扩展模型消息”被分成两种 entry，避免所有持久扩展数据都自动污染上下文。

## 2. 追加与首次落盘

新 Session 不会立刻创建空文件。用户消息和设置变化先保存在内存；直到出现第一条 assistant message，SessionManager 才用
exclusive create 写 header 与所有累计 entry。之后每条 entry 通过同步 append 追加。

收益：

- 打开后未发送、只输入后退出的空会话不会污染 session 列表；
- 首次创建避免覆盖同名文件；
- 每条记录天然按物理追加顺序形成日志。

代价：

- 第一条 assistant 前崩溃会丢失内存 entry；
- 同步文件写在 message lifecycle 热路径上；
- 没有数据库事务、checksum 或 entry-level schema version；
- 完整 tool result、路径和上下文可能原样长期留在用户目录。

## 3. 树与 branch

`branch(entryId)` 只把当前 leaf 移到目标，下一次 append 以该 entry 为 parent，于是形成新分支。旧分支仍在同一文件中。

```text
root -> user A -> assistant B -> tool C -> assistant D
                    \
                     -> branch summary -> user E -> assistant F
```

`navigateTree()` 可以在切换前摘要被放弃的路径，再把 summary entry 挂到目标分支。`createBranchedSession()` 则把当前
root-to-leaf path 复制到新 Session 文件，重新串接 parent 并记录 `parentSession`。

这个设计比复制/删除消息数组稳健：树身份存在，UI 可展示历史分叉，压缩和 label 也能作为节点。

局限是 reopened session 的默认 leaf 基本取最后物理 entry，正确性依赖“所有 append 都发生在当前 leaf”这一协议；leaf
pointer 不是独立事务提交。跨进程并发写同一 session 也不是旧主链的目标。

## 4. 上下文投影

`buildSessionContext()` 先沿当前 leaf 的 parent 链构造路径，再查找该路径最新 compaction：

```text
最新 compaction summary
  + compaction.firstKeptEntryId 起仍需保留的旧 entry
  + compaction 之后的新 entry
  -> AgentMessage[]
```

因此：

- JSONL 保存完整事实；
- active context 只是一种 projection；
- 再次压缩可以基于旧 summary 继续迭代；
- 切换到未压缩分支仍能重建它自己的上下文。

这是 Pi 会话设计中最值得 Tessera 学习的原则：持久事实、会话树和模型窗口不是同一个对象。

## 5. 迁移与损坏处理

当前格式版本为 3：

- v1 -> v2：补树节点 id/parent；
- v2 -> v3：重命名旧 hook message/custom 语义。

加载时：

- 逐行 JSON parse，畸形行跳过；
- 只有 header 合法后才对缺少末尾换行的文件做修复；
- session discovery 的 header 扫描有 1 MiB 上限；
- legacy 场景可回退完整加载；
- session 列表使用有界并发读取。

这是务实的本地文件容错，但“跳过畸形行”可能把树中间节点静默丢失，使子节点成为孤儿；没有公开 corruption state 提醒
上层。Tessera 的运行检查已把损坏事件降级为明确的安全失败，不应采用静默忽略作为主策略。

## 6. 完整历史与统计

Session stats 会遍历所有 entry，包括已经被 compaction 排除的消息和 summary call usage。它回答的是“这份 session
累计消耗”，不是“当前 context 大小”。`getContextUsage()` 在 compaction 后、下一条带 usage 的 assistant message 前会把精确
context usage 视为未知，避免拿旧 Provider usage 冒充当前投影值。

这一区分值得保留：

- billing/累计 usage；
- 当前模型窗口估算；
- 最新 Provider 实际 usage；
- compaction 自身 usage；

不能混成一个 Token 数。

## 7. 恢复边界

旧 SessionManager 能恢复：

- 消息树与当前 leaf；
- model/thinking 变化；
- compaction/branch summary；
- extension custom state；
- session name/label。

它不能可靠恢复：

- 正在进行的 Provider stream；
- 已开始未完成的工具调用；
- retry sleep 与 attempt；
- compaction summary 请求；
- steering/follow-up queue 的精确消费点；
- Bash 子进程与迟到副作用。

所以 Pi 的“session resume”主要是 conversation resume，不等于 exactly-once run recovery。

## 8. 下一代 durable Session 透露的方向

`packages/agent/src/harness/session/types.ts` 新增：

- `operation_started` / `operation_finished`；
- `abort_requested`；
- `step_attempt`；
- `tool_started`，含 `replay: never | safe`；
- `queue_enqueued` / `queue_cancelled`；
- `write_deferred`；
- `usage`；
- lane pointer 与 shared sequence。

它把消息 entry 与 operation record 分开，已经接近“事实树 + 执行日志”。其中 tool replay 分类尤其重要：恢复时不是所有工具都
能重放。

但当前 Harness 仍不能执行和 restore，不能把 schema 的存在当成恢复保证。真正验证还需覆盖：record 持久化后崩溃、工具开始后
崩溃、外部副作用完成但 result 未写、abort 与 finish 竞争、queue 消费后未提交等 crash point。

## 9. Tessera 对照

| 维度 | Pi 旧主链 | Tessera 当前状态 | 建议 |
| --- | --- | --- | --- |
| 会话内容 | JSONL 树 | SQLite task session/messages | 若需要 branch，增加稳定 parent/branch 关系 |
| Run | 多数是内存态 | `task_runs` 一等记录 | 保持 Run 与 Session 分离 |
| 事件 | Session entry 与 live event | 有序 `task_run_events` | 继续作为恢复/投影事实 |
| 压缩 | compaction entry 改 context projection | 通用压缩未实现 | 增加版本化 projection marker |
| 损坏 | 部分畸形行跳过 | inspection 返回安全 corruption | 维持显式失败 |
| 恢复 | 会话恢复强、operation 恢复弱 | 中断 run 标记与事件恢复已实现 | 先做副作用不重放，再扩自动恢复 |
| 可移植 | 单文件易复制 | SQLite + Markdown 多对象 | 可提供导出格式，不改变主存储 |

## 10. 对 Tessera 的建议

1. 借鉴树形 entry 与 compaction projection，但映射到现有 SQLite identity/event，不引入第二事实源 JSONL。
2. 若实现 branch，为 user/assistant/tool/summary 建稳定 parentId；branch 是指针变化，不复制和删除旧消息。
3. compaction 记录 summary、source range、retained tail、模型与 usage，并保留原始历史。
4. run operation 与 conversation entry 分开；tool call 必须标记是否可安全重放。
5. 损坏、孤儿节点、缺失 tool result 都显式进入 inspection，不静默跳过。
6. 提供脱敏导出/导入作为可移植层，不让导出格式支配运行时事务设计。
