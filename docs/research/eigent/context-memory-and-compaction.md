# Eigent 上下文、记忆与压缩

> Eigent 证据：`backend/app/memory/events.py`、`backend/app/memory/paths.py`、
> `backend/app/memory/local_store.py::LocalMemoryStore`、
> `backend/app/memory/context_builder.py::ProjectContextBuilder`、
> `backend/app/memory/service.py::MemoryService`、`backend/app/utils/agent_memory.py`、
> `backend/app/service/single_agent_service.py::_build_single_agent_context`、
> `backend/app/service/chat_service.py::build_context_for_workforce`、
> `backend/app/service/chat_service.py::_trim_in_process_history`、
> `backend/app/service/chat_service.py::check_conversation_history_length`、
> `backend/app/service/task.py::TaskLock`、`src/store/chatStore.ts::buildProjectContinuationContext`、
> `backend/tests/app/memory/test_context_builder.py`、
> `backend/tests/app/memory/test_service_lifecycle.py`、
> `backend/tests/app/service/test_chat_service.py::TestInProcessHistoryCompaction`
>
> Tessera 对照：`packages/ai/src/server/agent-runtime.ts`、`packages/ai/src/server/task-agent.ts`、
> `packages/ai/src/run-policy.ts`、`packages/contracts/src/index.ts`、
> `packages/database/task-run-repository.ts`、`apps/desktop/src/main/task-service.ts`、
> `apps/desktop/src/main/index.ts`、`docs/architecture/unified-creation-agent.md`、
> `docs/architecture/database.md`、`docs/architecture/research-workflow.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Eigent 的“记忆”不是一个模块，而是四套处于不同成熟度的上下文机制叠加：

1. CAMEL `ChatAgent.memory`：当前 Agent 的完整热上下文，真正进入模型工具循环；
2. `TaskLock` 内进程历史：Project 生命周期内的对话、Agent memory snapshot 和压缩标记；
3. `~/.eigent/memory`：按 user / Space / Project / Run 分层的本地持久记忆；
4. renderer `project_context`：从前端 store 选最近 8 个 run、最多 24,000 字符拼出的兼容桥。

其中最值得 Tessera 学习的是：本地优先的 Project memory 树、append-only conversation、原子写小型 manifest、
`visibility` / `eligible_for_context` 过滤、从持久数据构造预算化 `AgentContextBundle`，以及 Single Agent / Coordinator /
Worker 使用不同上下文视图。

但必须准确评价当前实现：这是一个**有完整骨架、部分链路已接通的早期 memory milestone**，不是成熟的长期记忆系统。
生产代码会持久化用户请求、最终答复、run status 和隐藏 runtime-log artifact；却没有生产调用去生成/更新 Project
summary、MemoryFact 或可进入上下文的用户 Artifact。所谓 in-process compression 也没有用模型压缩语义，只保留最近
四条并写入“旧内容在磁盘上”的标记。

Tessera 目前比 Eigent 更清晰地持久化 Task、Run、有序事件、资源绑定和领域研究状态，但尚未形成通用的模型上下文
预算、跨 run Project memory、可追溯摘要和历史压缩。当前 Agent 会把任务消息整体转成 AI SDK UI messages；本地保存
上限 500 条 / 32 MiB 是数据库保护，不是模型上下文策略。这个缺口应在加入更多 MCP、Skills、附件和子 Agent 前补上。

## 1. 先把五个概念分开

Agent 产品里最容易走弯路的地方，是把所有“以前的信息”都叫 memory。建议统一以下词义：

| 概念 | 作用 | Eigent 对应 | 是否可直接进入模型 |
| --- | --- | --- | --- |
| Message history | 用户可见的对话事实 | renderer task messages、Project conversation JSONL | 需筛选 |
| Run context | 本轮冻结的资源、权限、模型和任务约束 | `RunContext` + request options | 是，但敏感值不进入文本 |
| Working memory | 当前执行器为完成任务保留的短期状态 | CAMEL Agent memory、Todo、Task dependency result | 是 |
| Durable memory | 跨 run / 重启仍保留的可复用信息 | `~/.eigent/memory` | 需检索、预算和 provenance |
| Compaction | 在不丢关键语义的前提下降低输入体积 | `_trim_in_process_history`、字符截断 | 目前只部分做到 |

Artifact、Skill、MCP、附件和网页证据是**资源**，不是记忆；它们可以通过引用被上下文选择。模型输出的总结是派生
内容，不应覆盖原始 Message/Event 事实。

## 2. 四条上下文路径

### 2.1 CAMEL Agent 热内存

Single Agent 实例在同一 Project 的 SSE/session 循环中跨 turn 复用。每次 `agent.astep(prompt)` 时，CAMEL 会使用 Agent
自身 memory。Eigent 的 snapshot 截断注释特别强调：`serialize_agent_memory()` 的 4,000 字符消息上限只影响快照副本，
**live prompt 仍由 `memory.get_context()` 保持完整**。

这意味着持久上下文有 8,000 token 的预算，并不代表模型真实输入被限制在这个预算内。模型还会得到 CAMEL 累积的
完整热历史，以及当前再次拼入的 durable context。长期会话可能重复注入相同内容。

### 2.2 TaskLock 内进程历史

`TaskLock` 同时保存：

- `conversation_history`：Workforce 多 turn 的 task/result 记录；
- `agent_memory_history`：Single Agent 或 Workforce 各 Agent 的序列化 memory snapshot；
- `memory_summary`：字段注释称“旧 memory 的压缩摘要”，实际主要写 compaction marker；
- `last_task_result` / `last_task_summary`；
- persistent `question_agent` 和当前 `RunContext`；
- queue、human input、toolkits、后台任务等运行状态。

它是热缓存、会话协调器和资源容器的混合物，不是稳定 memory repository。Brain 退出后这些数据消失，跨重启恢复依赖
LocalMemoryStore。

### 2.3 本地持久 Project memory

默认根目录：

```text
~/.eigent/memory/
  users/{canonical_user_id}/
    spaces/{space_id}/
      space.json
      projects/{project_id}/
        project.json
        conversation.jsonl
        summary.md
        facts.json
        artifacts.json
        runs/{run_id}/
          run.json
          status.json
          summary.md
          tool_events.jsonl
```

owner key 优先使用 `user_<id>`，没有 id 时退回经过文件名清理的 email local-part。没有任何身份时，MemoryService 会
跳过写入而不是写进公共匿名目录。

### 2.4 renderer 兼容桥

`buildProjectContinuationContext()` 遍历 Project 的各 chat store，提取每个 Task 的第一条用户请求和 summary/end result：

- 最多取最近 8 个 run；
- 合并空白为单行；
- 总计最多 24,000 字符，超出时保留尾部；
- 随请求作为 `project_context` 发送到 Brain。

后端只在 durable store 与 in-process history 都没有可用上下文时采用这条桥。它解决了 memory 新旧版本迁移和无身份
场景，但 renderer 成了另一事实源，且按字符串尾部裁剪可能切断结构或丢失最早约束。它应当是迁移期兼容层，不能
成为长期协议。

## 3. LocalMemoryStore 的存储设计

### 3.1 Append-only 与原子重写分工

Eigent 按数据形态选择写法：

- `conversation.jsonl`、`tool_events.jsonl` 逐行 append；
- Space、Project、facts、artifacts、run/status manifest 全量 JSON 重写；
- summary 使用 Markdown 文本；
- 重写先写同目录临时文件、`flush + fsync`，再 `os.replace`；
- append 使用 per-path thread lock，逐行 `flush + fsync`。

这套选择简单、可人工检查、跨重启稳定，也适合 local-first。不过它只有进程内 path lock，不是跨进程文件锁；Brain
多进程或外部同步同时写入仍可能冲突。读取 conversation tail 也会先读取整份 JSONL 再切最后 N 条，长期 Project 会
线性增长并越来越慢。

### 3.2 Schema 演进

事件和 manifest 带 `schema_version=1`。读取 dataclass 时会丢弃未知字段；缺少必需字段则记录 warning 并忽略对象。
这保证新 writer 的额外字段不会让旧 reader 整体崩溃，却也可能静默丢失新语义。没有迁移器、校验报告或 quarantine
目录，因此它更像“尽力读取”而不是可靠数据库迁移。

### 3.3 内容与控制事实重复

Project conversation、Run status、Artifact manifest 与远端 Server/renderer 的 Project、Task、日志和文件事实有重叠。
本地 memory 写失败被设计为不影响聊天，这是合理的可用性取舍；但也意味着它不能是运行恢复和审计的权威来源。

Tessera 已经以 SQLite 管理 Task/Run/Event/Binding，不需要再复制一棵同语义 JSON 树。Markdown 可以作为用户内容和
可编辑 memory note 的事实源，但控制关系、provenance、版本和检索索引应继续在 SQLite。

## 4. Memory 生命周期

### 4.1 Run 开始

`MemoryService.on_run_start()`：

1. 解析 owner key；
2. 创建或更新 Space manifest；
3. 创建或更新 Project manifest；
4. 写 `run.json` 和 running `status.json`；
5. 把当前 user prompt append 到 Project `conversation.jsonl`。

follow-up run 如果没有显式 mode，会从 `project.json` 继承，避免 run header 失去 single/workforce profile。

### 4.2 Run 期间

- Human Toolkit 的中途用户回复可以立即追加；
- `on_assistant_message()` 已有 API，但注释明确 streaming/coordinator narration 尚未接入；
- tool event schema 和 store append 方法存在，但本轮生产调用覆盖不完整；
- Agent memory snapshot 仍写入 `TaskLock`，不是 durable memory 树。

因此应用崩溃时，最终 assistant response 可能还未 append；run status 会停留 running，memory store 本身也没有统一的启动
恢复收口逻辑。Tessera 的 `task_run_events` 已能在流中逐事件持久化，并在重启时把 running 收口为 interrupted，这一层
比 Eigent memory store 更可靠。

### 4.3 Run 结束

`finalize_task_lock_run_memory()` 用 run id set 做幂等保护，避免重复 `finally` 把成功状态改成 cancelled。它会：

- 注册不可见、不可进上下文的 `camel_logs` runtime artifact；
- append 最终 assistant result；
- 写 done / failed / cancelled status；
- 有 summary 时写 run-level `summary.md`；
- 更新 Project 的 `last_run_id` 和 `updated_at`。

幂等 set 只在当前 `TaskLock` 内有效，进程重启后不会阻止同一 run 被再次 finalise；底层 conversation append 也没有
按 event hash/run/role 去重。真正可靠的幂等需要数据库唯一键或稳定 event id。

## 5. AgentContextBundle 如何做预算

默认 durable memory 预算是 8,000 token，用环境变量 `EIGENT_MEMORY_TOKEN_BUDGET` 覆盖。它不运行 tokenizer，而按
`1 token ~= 4 chars` 估算，并固定分区：

| 区域 | 权重 | 当前来源 |
| --- | ---: | --- |
| Header | 20% | Space summary + Project summary |
| Recent conversation | 65% | 最近最多 24 个可见事件 |
| Artifacts | 10% | `eligible_for_context=true` 的最近 Artifact path |
| Todos / facts | 5% | 实际代码把这部分预算用于 confidence 排序 facts；Todo 尚未接入 |

选择规则：

- 只读取 `visibility == context` 的 conversation；
- 排除当前 in-flight run，避免把当前 prompt 从 durable store 重复注入；
- conversation 从最新向旧选择，再翻转成时间正序；
- 单条最新事件如果超过整个分区，会带 marker 截断，而不是整条塞入；
- fact 只按 `confidence` 排序，没有 query relevance；
- Artifact 只按 `created_at` 倒序，注入 path/kind，不读内容；
- runtime log 明确排除。

### 5.1 做得好的地方

- 数据读取与 prompt render 分离，未来可以给审计或不同模型格式复用；
- visibility 和 Artifact eligibility 是源数据字段，不依赖 UI 临时过滤；
- current run exclusion 和 oversized-single-event 测试覆盖了常见重复/溢出 bug；
- Worker render 默认不包含完整 recent conversation，只带 assignment、narrow facts 和 Artifact refs。

### 5.2 预算并不真正精确

- 中文、代码、JSON、URL 和不同 tokenizer 不满足恒定 4 chars/token；
- 固定 8,000 没有依据 model `contextWindow`、system prompt、工具 schema、当前附件、最大输出和安全余量动态计算；
- 四个分区不能回收未使用额度，例如 Space summary 尚未实现却仍预留 Header 的一半；
- `current_run_instruction` 加在 bundle 中，却没有计入各分区裁剪；
- render 的标题、role、列表 framing 只做粗略估计；
- live CAMEL memory 和工具 schema 完全不在该预算中。

Tessera 的预算应从模型档案的 `contextWindow` / `maxInputTokens` 反推，并用实际 provider tokenizer（可用时）或保守
estimator，在发送前计算完整请求，而不是只给 memory 子串一个静态上限。

## 6. Single Agent 与 Workforce 的上下文差异

### 6.1 Single Agent 优先级

`_build_single_agent_context()` 按以下顺序短路：

```text
durable Project memory 有信号
  -> 只返回 durable bundle
否则 TaskLock conversation_history 有内容
  -> 返回 in-process conversation + serialized agent memory
否则
  -> 返回 renderer project_context
```

这个优先级避免三套上下文同时拼接，却可能漏掉尚未 flush 到 durable store 的热内容。更关键的是，Agent 自己还保留
CAMEL memory；即使 helper 只返回一种 context，真实模型输入仍可能重复。

### 6.2 Workforce 合并 durable 与 in-process

`build_context_for_workforce()` 与 Single Agent 不同：它会把 durable coordinator context 和 in-process conversation
同时拼接。Coordinator 拿到较完整的 Project 视图，Worker 主要通过 Planner 写进 subtask 的内容和 dependency result
获得窄上下文。

`AgentContextBundle` 虽然提供 `workforce_worker` renderer，但注释明确 Worker profile 和 assignment wiring 仍是后续
milestone；当前固定提交不能据此宣称所有 Worker 都已经走统一 durable context builder。

## 7. Snapshot 不是长期记忆

Agent snapshot 保存：scope、task、agent identity、task content/result、message role/content 和 tool call name/arguments。
为了抑制膨胀：

- 单条 message content 默认上限 4,000 chars；
- 单个 tool argument 字符串默认 2,000 chars，并递归裁剪；
- task content/result 默认 8,000 chars；
- Workforce 遍历 coordinator/planner/template/worker/accumulator，并用序列化消息完全相等做跨 Agent 去重；
- 下一轮 `build_memory_context()` 默认只取最近 3 个 snapshot、每个 12 条 message、每条 1,200 chars。

这适合诊断和短期续轮，但不是可检索 memory：没有事实抽取、来源选择、过期、纠错、用户编辑、敏感信息过滤或语义
检索。完全相等去重也识别不了轻微改写后的重复内容。

快照还可能保存工具参数，其中包含文件正文、命令、URL 或外部数据。即使做长度裁剪，也应有按 tool schema 的敏感
字段 redaction，而不是一视同仁序列化。

## 8. “压缩”到底做了什么

Workforce 在新问题或开始执行前，用 `check_conversation_history_length()` 统计：

```text
conversation_history content chars
+ memory_summary chars
+ snapshots 的 task content/result/message/tool_calls chars
```

超过 200,000 字符时，`_trim_in_process_history()` 分别只保留 conversation 和 snapshot 最近 4 条，并在
`memory_summary` 加入：旧内容已经压缩、完整 transcript 位于 `~/.eigent/memory`。然后重新计算；如果单个近期 turn
仍超过上限，发送 `context_too_long` 并要求用户拆小任务。

### 8.1 这不是语义摘要

`memory_summary` 并没有总结被丢弃内容的目标、决策、约束、未完成项和产物；只是记一条 dropped count。后续 prompt
知道“有更早内容”，却没有工具自动从 durable transcript 取回相关段落。因而这是**缓存裁剪**，不是语义 compaction。

### 8.2 UI 文案与后端行为漂移

后端在 compaction 后仍过长时提示“本轮太大，请拆分步骤”；renderer 的 toast 却写“请创建新 Project”。同一个公开
错误在两端解释不同，用户可能无谓放弃现有 Project。这类提示应由版本化错误 code + structured metadata 统一映射。

### 8.3 Single Agent 仍有独立风险

200,000 字符检查位于 Workforce `step_solve` 主循环；Single Agent 使用 durable bundle 的静态预算，却复用 CAMEL Agent
热 memory。固定提交没有证明 Single Agent 的 live memory 会根据模型窗口执行同等 compaction。长会话仍可能由
provider 拒绝，或在 CAMEL 内部采用另一路不可见裁剪。

## 9. Task summary、结果汇总与 memory summary 不同

Eigent 还使用 `task_summary_agent`，但它解决的是另外两件事：

- 为 Task 生成不超过 80 字符的名称和不超过 240 字符的目标摘要，供 UI 展示；
- 多个 subtask 完成后，把各结果综合成最终答复。

run-level `summary.md` 主要接收 Task UI summary；它没有自动合并成 Project `summary.md`。搜索生产代码可见
`write_project_summary()`、`upsert_fact()` 没有调用方，`eligible_for_context=true` 的 Artifact 也没有生产注册路径。
所以测试中展示的 Project summary、facts 和可用 Artifact 是手工 seed 的未来能力，不是当前用户运行自然产生的闭环。

## 10. 安全、隐私与可信度

本地优先不自动等于安全。当前 memory 树可能包含完整 user prompt、最终答复、Human reply、tool arguments、错误和
Artifact path，且以未加密 JSON/Markdown 保存。还缺少：

- retention / delete / export 的统一产品入口；
- 项目删除时 memory 树如何级联；
- 用户纠正或忘记某条 fact 的机制；
- secret / PII redaction；
- 来自网页、附件和 tool result 的 prompt injection 标签；
- memory 注入时的来源和信任级别；
- cloud sync `SyncSettings` 的真实实现与端到端加密边界。

MemoryFact 具有 `source_event_ids` 和 confidence，是正确方向；但 context render 只输出 fact text，模型看不到 provenance，
也没有区分用户确认事实和 Agent 推断。Tessera 应让 provenance 成为可追溯数据关系，prompt 中至少标出来源类型和
可信级别，低置信推断不能写成系统事实。

## 11. 与 Tessera 当前实现对照

| 能力 | Eigent | Tessera 当前状态 | 判断 |
| --- | --- | --- | --- |
| 用户可见历史 | renderer store + remote/project 数据 | SQLite Task messages | 已实现，Tessera 事实更集中 |
| Run 账本 | local run manifest + TaskLock/SSE | SQLite task runs/events | 已实现，Tessera 更可靠 |
| 模型窗口事实 | 运行时未用于 memory 动态预算 | provider model profile 已有 context/max input/output | 模型事实已实现，预算未接通 |
| 通用输入裁剪 | durable 8k proxy + Workforce 200k chars | 全量 task messages 转 UI messages | 未实现 |
| 跨重启 Project memory | LocalMemoryStore conversation tail | 只有会话历史和领域状态 | 未开始 |
| Project summary/facts | schema/reader 有，生产 writer 缺失 | 未实现 | 双方均未闭环 |
| 领域续跑 | 通用最近对话 | 研究 plan/source/evidence/finalization 可 provenance 续跑 | Tessera 研究领域更精确 |
| Resource binding | Artifact path 和 recent refs | run resource summary + task resource bindings | 部分实现，Tessera 对象更稳 |
| Compaction | 删除旧热缓存 + marker | 未实现 | Eigent 只有最低防线 |
| Memory UI | 固定提交未见完整管理面 | 未实现 | 都需要隐私/纠错产品设计 |

Tessera 的 `MAX_TASK_MESSAGES=500` 和 32 MiB 只是保存输入校验；不能防止一个远小于 32 MiB 的会话超过模型 128K
上下文。`RunPolicy` 当前根据 context window 放宽研究 step 数，也不等于为 messages、tools、attachments、Skills 和
输出预留了 token。

## 12. Tessera 建议的数据模型

### 12.1 三层事实，不复制第四份消息

```text
原始事实层
  TaskMessage / TaskRunEvent / ResourceBinding / Artifact / Operation

派生记忆层
  MemoryRecord / ContextSummary / RetrievalIndex
  全部带 source refs、版本、生成方式、时间和可信度

本轮输入层
  ContextManifest
  记录最终选中的消息段、摘要、资源、Skill、工具 schema 预算和估算 token
```

建议对象：

```ts
type MemoryRecord = {
  id: string
  scope: "task" | "workspace" | "user"
  kind: "decision" | "preference" | "constraint" | "fact" | "open-loop"
  text: string
  sourceRefs: SourceRef[]
  confidence: number
  status: "candidate" | "confirmed" | "superseded" | "forgotten"
  createdAt: number
  updatedAt: number
}

type ContextManifest = {
  runId: string
  modelContextWindow: number | null
  reservedOutputTokens: number
  estimatedInputTokens: number
  sections: Array<{
    kind: "system" | "skill" | "tools" | "recent-messages" | "summary" | "resource" | "memory"
    sourceRefs: SourceRef[]
    estimatedTokens: number
    truncated: boolean
  }>
}
```

### 12.2 摘要是版本化派生物

Context summary 必须保存：

- 覆盖到哪个 message/event sequence；
- 源消息 ID；
- 使用的模型和 prompt version；
- 保留的目标、用户约束、决策、未完成项、Artifact/Source refs；
- token estimate；
- 后续纠正和 supersede 关系。

新摘要不能删除原消息，也不能和用户可见正文混为一谈。运行失败时可以回退到最近已验证摘要 + 最近原始消息。

### 12.3 预算应自顶向下计算

```text
model input capacity
- reserved output
- provider/system overhead safety margin
- system + RunPolicy + Skill instructions
- active tool schemas
- current user message + explicit attachments
= 可分配历史/记忆预算
```

剩余预算再在 recent messages、workspace summary、retrieved memory、领域状态和资源摘要之间动态分配。当前 user message
和显式附件优先；最近对话其次；长期 memory 只取与当前请求相关且有 provenance 的少量记录。分区未用完的预算应可
回流，而不是固定浪费。

## 13. 推荐实施顺序

### P0：先避免上下文失控

1. 在主进程发送前生成 `ContextManifest`，使用 model context/max input/max output 和保守 tokenizer。
2. 统计 system、Skill、tool schema、消息、附件和领域续跑上下文，不只统计正文字符。
3. 为“单条当前输入过大”和“历史需要压缩”定义不同稳定错误。
4. 把实际估算、裁剪与摘要版本写入 run resource summary 的受控扩展，不把正文写进运行汇总。

### P1：可追溯会话 compaction

1. 保留最近若干完整 turn 和所有未完成 approval/tool interaction。
2. 为更早历史生成版本化 summary；先支持 Task scope。
3. 摘要失败时安全裁剪或提示用户，不覆盖已完成历史。
4. 对工具结果保存 Artifact/Source ref，避免把大正文重复塞进摘要。

### P2：Workspace memory

1. 只从用户确认、已批准操作和可追溯来源抽取 candidate memory。
2. 提供查看、编辑、确认、忘记和导出入口。
3. 使用 query relevance + scope + freshness + confidence 选择，不只按 confidence。
4. memory 的实际使用进入 Execution Context 投影。

### P3：多 Agent memory

1. child Agent 默认只拿 assignment 和明确 resource refs。
2. 通过结构化 TaskOutput/Artifact 共享，不复制所有 Agent transcript。
3. 根 Agent 汇总 child deliverable；跨 Agent 长期 memory 仍进入统一 MemoryRecord，不保留每个 clone 的完整对话。

## 14. 明确不照搬

- 不新增一棵与 SQLite Task/Run 重复的 JSON 控制树。
- 不让 renderer 重新拼接长期上下文并提交给高权限运行时。
- 不把 4 chars/token 当成所有模型和内容的可靠估算。
- 不给固定分区永久预留无法使用的 token。
- 不把“删除旧项并留路径提示”称为语义压缩。
- 不把 Agent 完整 memory snapshot 直接当作 Project memory。
- 不保存未经 schema redaction 的完整工具参数。
- 不让模型自动生成的低置信 fact 以无 provenance 系统事实进入 prompt。
- 不让摘要覆盖原始消息或成为唯一恢复副本。
- 不在 memory 管理、删除和隐私入口缺失时默认永久保存跨项目用户偏好。

## 15. 验收问题

1. 发送前是否能解释每类上下文占用了多少 token？
2. 当前输入、工具 schema、Skill 和预留输出是否进入同一预算？
3. 历史被压缩后，原消息和摘要 provenance 是否仍可审查？
4. summary 是否保留用户约束、决策、未完成项和 Artifact refs，而不是只做主题概述？
5. 用户纠正事实后，旧 memory 是否被 supersede 而不是继续注入？
6. 网页/附件中的不可信文本是否与用户确认事实区分？
7. 应用重启后是否能从权威 Task/Run/Event 恢复，而不是依赖内存对象？
8. child Agent 是否只获得完成 assignment 所需的最小上下文？
9. memory 写入失败是否不阻断主任务，同时留下可诊断状态？
10. 删除 Task/Workspace/账户时，消息、摘要、索引、Artifact 和 memory 的保留边界是否一致？

