# Eigent 工作群与多智能体编排

> Eigent 证据：`backend/app/service/chat_service.py::step_solve`、
> `backend/app/service/chat_service.py::construct_workforce`、`backend/app/utils/workforce.py::Workforce`、
> `backend/app/utils/single_agent_worker.py::SingleAgentWorker`、`backend/app/agent/factory/developer.py`、
> `backend/app/agent/factory/browser.py`、`backend/app/agent/factory/document.py`、
> `backend/app/agent/factory/multi_modal.py`、`backend/app/utils/telemetry/workforce_metrics.py`、
> `backend/tests/app/utils/test_workforce.py`、`backend/tests/app/utils/test_single_agent_worker.py`、
> `src/components/Session/Workforce/WorkforceSidePanel.tsx`、
> `src/components/Session/SidePanelSections/AgentPoolSection.tsx`、
> `src/components/Session/SidePanelSections/ProgressSection.tsx`、`src/store/chatStore.ts`
>
> Tessera 对照：`packages/ai/src/server/agent-runtime.ts`、`packages/ai/src/server/task-agent.ts`、
> `packages/contracts/src/index.ts`、`packages/database/task-run-repository.ts`、
> `apps/desktop/src/main/task-run-inspection.ts`、`docs/architecture/unified-creation-agent.md`、
> `docs/architecture/ai-observability.md`、`docs/architecture/task-navigation.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Eigent 的 Workforce 不是多个 Agent 自由对话的群聊，也不是把同一提示词并行发给多个模型再投票。它是一个以
CAMEL Workforce 为执行器的**任务图调度系统**：先判断问题是否复杂，再把主任务分解为带依赖的子任务，交给不同
职责的 Worker 节点；Worker 可以通过 Agent pool 克隆并行执行，结果回流主任务，最终再由协调链汇总。

它最值得 Tessera 学习的是四点：

1. 用户可以在真正执行前查看和修改分解结果，计划不是不可见的内部推理。
2. “已分配”和“真正开始”是两个状态，依赖未满足时不会假装任务正在运行。
3. Agent、计划、实际工具、产物分成 Agent Pool、Progress、Execution Context、Agent Folder 四个审查视图。
4. 重试、重规划、超时、暂停、跳过、停止和资源释放都有明确入口，而不是只靠中断一次模型流。

但固定角色 Workforce 也放大了工程成本：一次复杂运行会同时构造协调、规划、Worker 模板和多个专职 Agent；任务
对象在 CAMEL 内部、`TaskLock` 事件和 renderer `chatStore` 中重复表达；Agent 的 `node_id` 与产品 `agent_id` 还要手工
映射。源码中用于修补父子任务状态、重复通知、失败重试和 CDP 回收的防御代码，已经表明这套模型很难保持单一事实源。

Tessera 近期不应增加一个与统一 `ToolLoopAgent` 平行的固定 Workforce runtime。更合适的方向是：保持单 Agent 心智，
把委派建成一种有预算、有资源引用、有返回契约的工具调用；只有真正发生委派时，才把 run event 投影成可展开的
Agent/Progress 视图。多 Agent 是运行策略，不应先成为用户必须选择的组织结构。

## 1. 产品模式与真实执行模式

Eigent 的请求使用 `session_mode` 区分 `single-agent` 和 Workforce。Workforce 路径仍会先使用一个可跨 turn 复用的
`question_agent` 判断任务：

```text
用户请求
  -> 有附件？
       是：直接按复杂任务处理
       否：question_agent 判断 simple / complex
  -> simple：question_agent 直接回答
  -> complex：构造 Workforce -> 分解 -> 用户确认 -> 执行 -> 汇总
```

所以“工作群模式”并不保证每次都启用多个 Worker；简单问题仍走单 Agent。这个细节说明产品入口和执行策略已经开始
分离，只是 UI 仍把两者呈现为显式模式。

### 1.1 为什么附件直接触发复杂路径

附件以 `filename -> absolute path` 写入 CAMEL Task 的 `additional_info`。代码没有先根据附件种类、用户目标或所需工具
判断是否真的需要分工，而是直接避免 question classifier 漏掉文件任务。这是稳妥的兼容策略，但会让“一张图片问一句”
也承担 Workforce 初始化和分解成本。

Tessera 应把复杂度判断建立在可验证信号上：预估步骤、需要的能力域、可并行性、上下文隔离性、预计工具时长和用户
明确要求，而不是用“存在附件”替代意图分析。

## 2. Workforce 是怎样被构造出来的

`construct_workforce()` 使用 `asyncio.gather()` / `to_thread()` 并行构造以下对象：

| 对象 | 作用 | 是否直接执行用户子任务 |
| --- | --- | --- |
| Coordinator Agent | 分析、分配、评估、失败重规划和最终协调 | 否 |
| Task Planner Agent | 把主目标拆成 Task DAG | 否 |
| New Worker Agent | CAMEL 在需要时生成新 Worker 的模板 | 间接 |
| Developer Agent | 终端、代码、文件、部署 | 是 |
| Browser Agent | 搜索、浏览、网页提取 | 是 |
| Document Agent | Markdown、Office、PDF、表格等文件处理 | 是 |
| Multi-Modal Agent | 图片、音频、视频和图片生成 | 是 |
| MCP Agent | 发现、连接和使用动态 MCP | 不作为普通固定 Worker 注册 |

Workforce 初始化时配置：

- `share_memory=False`；
- task timeout 为 3600 秒；
- failure strategy 同时启用 `retry` 与 `replan`；
- graceful shutdown timeout 为 3 秒；
- structured output handler 是否启用会随模型平台和订阅模式变化；
- 每种专职 Agent 通过 `add_single_agent_worker()` 注册为 `SingleAgentWorker`。

### 2.1 自定义 Worker

请求中的 `new_agents` 可以补充用户 Worker。每个 Worker 可以有：

- 名称和职责描述；
- 用户选择的工具；
- MCP 能力；
- 单独的 model provider / model；
- 独立的系统角色提示。

这是比“所有子 Agent 复制根 Agent”更成熟的方向：角色和权限是显式配置，模型也可以按任务成本分层。不过当前请求
仍由 renderer 携带这些配置，运行时只做有限兼容校验；更安全的系统应让 renderer 只传 Worker profile ID，由可信
进程冻结实际模型、工具和权限交集。

### 2.2 并行构造不等于便宜

并行工厂降低的是墙钟启动时间，不是资源量。复杂任务开始前仍可能创建八个 Agent/model backend，并初始化多个
toolkit、MCP 和 CDP 资源。实际子任务还没确定时，固定角色就已经付出连接、内存和密钥解析成本。

Tessera 应采用惰性 Worker：分解得到 `requiredCapabilities` 后再解析最小执行者；没有浏览器任务就不分配浏览器资源，
没有文档转换就不构造文档 Worker。

## 3. 任务分解是可编辑的协议阶段

复杂任务不会直接调用 `workforce.start()`。Eigent 把 CAMEL 原本较整体的 `process_task` 拆成两个公开阶段：

```text
eigent_make_sub_tasks(mainTask)
  -> reset workforce
  -> TaskChannel
  -> task_agent 流式生成子任务
  -> 修正依赖关系
  -> decompose_text / decompose_progress / to_sub_tasks
  -> 用户查看、添加、修改、删除子任务

eigent_start(userEditedSubtasks)
  -> 清空旧 pending queue
  -> 以用户最终列表重新装载
  -> 保存 initial decomposition snapshot
  -> workforce.start()
```

这是一项很值得吸收的产品设计。它把“模型计划”从内部 chain-of-thought 中分离出来，变成用户可审核的结构化
deliverable。用户看到的是目标步骤和依赖，而不是模型的私密推理文本。

### 3.1 分解失败的降级

分解有三层防线：

1. 空内容先校验并拒绝；
2. 流式 generator 没产出时回看 `task.subtasks`；
3. 最终仍为空时生成一个包含原任务的 fallback subtask。

因此“规划模型输出不合法”不会直接让任务消失。不过 fallback 没有表达为什么降级，也没有重新评估固定 Workforce 是否
还有意义。Tessera 的计划协议应返回 `planStatus = planned | direct | degraded` 和公开原因；单步骤 fallback 可以回到根
Agent 直接执行，而不是继续承担多 Agent 调度成本。

### 3.2 协调上下文没有传播给 Worker

`coordinator_context` 只在分解时临时拼入主任务，随后恢复原始 `task.content`，不会自动进入每个子任务或 Worker
提示词。这避免了整段会话历史复制给所有子 Agent，是正确的隔离意识；但 Planner 必须主动把必要约束写入每个
subtask，否则 Worker 可能缺少来源、格式或禁止项。

Tessera 的委派契约应显式列出 `objective`、`constraints`、`resourceRefs`、`dependencyRefs`、`capabilityRefs`、`budget`
和 `deliverableSchema`，不能寄希望于 Planner 用自然语言无损转抄上下文。

## 4. Task DAG 的分配与执行

Workforce 的子任务不是按列表顺序简单串行执行。Planner 为任务建立依赖；协调 Agent 基于 Worker 描述选择 assignee；
依赖满足后，任务才真正发布给 Worker。

Eigent 特别区分两个事件：

| 阶段 | 后端入口 | UI 状态 | 含义 |
| --- | --- | --- | --- |
| 分配完成 | `_find_assignee()` | `waiting` | 已决定 Worker，但依赖可能未满足 |
| 发布执行 | `_post_task()` | `running` | 依赖通过，Worker 即将真正处理 |

这个差异很重要。很多 Agent UI 在模型决定“稍后做什么”时就显示运行中，用户会误以为系统卡住。Tessera 的 Task/Run
投影至少应区分 `planned`、`blocked`、`queued`、`running`、`waiting-input`、`completed`、`failed`、`cancelled`。

### 4.1 Worker pool 与克隆

`SingleAgentWorker` 默认开启 Agent pool：

- 初始池大小为 0，避免预创建克隆浪费 CDP；
- 最大池大小默认可达 10；
- 自动扩缩；
- 没有 pool 时回退到 clone；
- 每次取出的 Agent 绑定当前 `process_task_id`，结束后归还。

Worker 收到的提示词包括当前任务、父任务、依赖任务结果和 `additional_info`。输出被解析为结构化 `TaskResult`，包含
内容和 `failed`。即使模型宣称成功，`is_task_result_insufficient()` 仍可能把结果判为失败。

pool 的正确价值是隔离并发上下文，而不是把一个有历史的 ChatAgent 同时用于多个任务。但 Agent clone 还可能复制
旧 memory、工具实例或资源句柄，实际语义取决于 CAMEL 的 clone 实现。Eigent 用 CDP release callback 和最后的
`release_by_task()` safety net 回收浏览器，恰好说明资源所有权不能只依赖对象垃圾回收。

### 4.2 不共享内存，但会记录工作流记忆

Workforce 默认 `share_memory=False`，Worker 主要通过 Task dependency result 交换信息。`SingleAgentWorker` 另有
`enable_workflow_memory`：启用时才把 Worker 的 CAMEL memory records 复制到 conversation accumulator；无论是否启用，
它都会尝试记录 agent memory snapshot。

这其实存在三种不同语义：

1. 任务依赖产物：下游执行所必需；
2. 工作流共享上下文：本次 run 中其他 Agent 可使用；
3. 长期用户/项目记忆：跨 run 可恢复。

它们不能都叫 memory。Tessera 后续必须分别建模为 `TaskOutputRef`、`RunContextRef` 和 `MemoryRecord`，并设置不同预算、
来源和保留期。

## 5. 失败、重试、重规划与生命周期

Eigent 在 CAMEL 的 failure handling 上增加了多层防御：

- `_analyze_task()` 在结构化质量分析返回 `None` 或抛错时重试；如果只是成功结果的质量评估失败，最终以 80 分接受；
  如果已经是失败任务且分析仍失败，则抛错停止。
- 失败任务先交给父类执行 retry/replan；只有达到最大次数才向前端发送终态失败。
- 重试/重规划已有 `assigned_worker_id` 时，不重复发送首次分配通知，避免 UI 显示假“重新分配”。
- 主任务最长等待返回 60 分钟；超时时连同 pending 和 in-flight 数量发送公开事件。
- `pause`、`resume`、`skip_gracefully`、`stop`、`stop_gracefully` 分别进入 CAMEL 生命周期。
- cleanup 不只停止 Agent，还遍历 Worker pool、callback 和 CDP task ownership 做多层释放。

这些代码说明成熟 Agent 系统需要区分：模型失败、工具失败、结果不足、调度失败、资源超时、用户停止和客户端断开。
它们不能只压成一个 `errorText`。

### 5.1 失败恢复中的语义债务

源码还暴露出几个不稳定点：

- CAMEL 完成任务后没有始终同步 `parent.subtasks`，Eigent 用 `_sync_subtask_to_parent()` 手工修补；
- Coordinator 返回的是 Worker `node_id`，产品 UI 用 `agent_id`，每次分配和启动都要转换；
- Task 在 `_completed_tasks`、`parent.subtasks`、pending/in-flight queue 和前端数组中重复存在；
- worker attempt 详情被塞入自由形态 `task.additional_info`，包括 token 和截断后的工具信息；
- `TaskLock` queue 的事件与 Workforce 内部状态不是一个事务提交。

这些不是小瑕疵，而是说明“框架 Task 状态”和“产品 Run 状态”缺少权威账本。Tessera 已有有序 `task_run_events`，应让
Task projection、Agent projection 和工具/Artifact projection 都从同一事件序列生成，不再让 renderer 写第二套运行状态。

## 6. 从运行事件到右侧工作群视图

`WorkforceSidePanel` 同时展示四块：

```text
Agent Pool
  当前有哪些 Agent、谁有任务、谁在运行、最近使用哪个 toolkit

Progress
  用户确认后的子任务及完成状态

Execution Context
  本次实际涉及的 Agent、Skills、MCP/工具和上传文件

Agent Folder
  当前 run / project 产出的可打开文件
```

数据主要来自 renderer 的三个数组：

- `taskInfo`：分解阶段的计划文本和顺序；
- `taskRunning`：实时子任务状态、Agent 和 toolkit；
- `taskAssigning`：Agent 列表、每个 Agent 的任务和日志。

`WorkforceSidePanel` 会以 `taskInfo` 为骨架，用相同 ID 的 `taskRunning` 覆盖状态。这让编辑后的稳定计划不会被运行事件
中的空内容覆盖，但仍是手工 join。`chatStore.ts` 超过五千行，在不同 action 分支中同时更新三个数组；这是 UI 一致性
风险的主要来源。

### 6.1 让极短工具活动仍可观察

`AgentPoolSection` 为 toolkit 活动实现至少 1500 ms 的展示时间，并在同时出现多个 toolkit 时每 2000 ms 轮换。搜索或
截图可能几毫秒完成，如果严格跟随事件状态，用户根本看不到；Eigent 用纯展示层滞留解决感知问题，而没有篡改真实
运行状态。

这个细节值得 Tessera 学习：事实事件可以瞬时完成，动画层允许设置最短可见时间，但必须明确只是视觉投影，不能延迟
审计完成时间或阻止后续操作。

### 6.2 展开视图与默认侧栏

默认右栏用于快速审查，Expanded Overlay 才承载完整 Workforce canvas、Agent 节点和工具详情。信息架构上形成了：

```text
对话正文：结果和关键交互
右侧栏：持续审查摘要
展开工作群：复杂任务拓扑与 Agent 详情
开发日志：底层诊断
```

这是比“把所有 tool call 塞进聊天气泡”更好的层级。Tessera 可复用层级，不必复用 React Flow 或固定角色卡片。

## 7. 成本、延迟与适用边界

Workforce 的调用成本至少可能包含：

1. simple/complex 分类；
2. Task decomposition；
3. 每轮 assignment；
4. 每个 Worker 的执行；
5. 每个结果的质量分析；
6. 失败时 retry/replan；
7. 最终综合；
8. 可能的 memory/summary 后处理。

它适合具备以下特征的任务：

- 能拆成至少两个边界清晰的 deliverable；
- 子任务需要不同能力或可以真正并行；
- 中间产物能以文件、结构化结果或引用传递；
- 任务价值足以覆盖额外模型调用和启动时间；
- 用户需要检查分工与进度。

它不适合短问答、单文件小改、强顺序且共享上下文密集的任务。若两个 Agent 必须不停互相同步整段上下文，多 Agent
只会增加信息损失和 token。

## 8. 与 Tessera 当前实现对照

| 能力 | Eigent | Tessera 当前状态 | 判断 |
| --- | --- | --- | --- |
| 根 Agent | CAMEL ChatAgent + 自定义监听 | AI SDK `ToolLoopAgent` | Tessera 运行时边界更统一 |
| 子 Agent | 固定 Workforce + Single Agent depth-1 delegate | `delegate-workspace-research` 只读研究子 Agent | 部分实现，已有安全的窄切口 |
| 计划 | Workforce Task DAG / Single Agent Todo | 研究工作流有显式计划与 progress | 领域内已实现，通用计划未统一 |
| 运行账本 | CAMEL Task + TaskLock + renderer store | SQLite `task_runs` + 有序事件 | Tessera 基础更适合投影 |
| Agent 视图 | Agent Pool + Expanded canvas | 尚无通用 Agent/委派侧栏 | 未开始 |
| Progress | Task/Todo 投影 | 研究 activity 有领域进度 | 部分实现 |
| 执行上下文 | Skills/Agent/附件等聚合 | run resource summary / inspection popover | 部分实现，缺常驻侧栏 |
| 产物 | Agent Folder | Task Artifact tray、内容库/工作区关联 | 部分实现，方向一致 |
| 暂停/继续 | Workforce 生命周期 + TaskLock | 审批/用户输入可续，重启中断会终结 | 部分实现 |
| 失败恢复 | retry、replan、timeout、stop | 类型化 run/tool error、重试和中断恢复 | 单 Agent 更稳，多任务调度未实现 |
| per-agent 权限 | Worker 选择工具/MCP/模型 | 子研究 Agent 固定只读工具 | Tessera 更窄但不可配置 |

Tessera 已经有两个重要优势：`delegate-workspace-research` 证明子 Agent 可以作为标准 tool 组合进入根 Agent；
`task_run_events`、审批和资源摘要证明运行事实可以在主进程持久化。下一步应扩展这些对象，而不是引入一套新的
Workforce session 和 SSE action。

## 9. Tessera 建议架构

### 9.1 用委派任务替代固定工作群模式

建议最小对象：

```ts
type DelegationTask = {
  id: string
  parentRunId: string
  parentTaskId?: string
  objective: string
  constraints: string[]
  resourceRefs: ResourceRef[]
  capabilityRefs: CapabilityRef[]
  dependencyIds: string[]
  deliverable: DeliverableContract
  budget: { maxSteps: number; maxTokens?: number; deadlineMs: number }
  status: "planned" | "blocked" | "queued" | "running" | "waiting-input" |
    "completed" | "failed" | "cancelled"
}
```

根 Agent 通过 `delegate-task` 提交有界任务。主进程：

1. 校验父 run 当前权限；
2. 将请求能力与父 run 能力做交集；
3. 冻结稳定资源引用，不传任意绝对路径或密钥；
4. 根据能力和成本选择 Worker profile / model；
5. 启动 child run，并把 child event 关联到 parent run；
6. 只把结构化 deliverable 和 Artifact refs 返回根 Agent。

### 9.2 一个事件账本，多种投影

建议事件最少包含：

```text
plan.published / plan.revised
delegation.created / queued / started / waiting / completed / failed
tool.started / completed / failed
artifact.created / changed / approved / rejected
context.bound / capability.used
run.paused / resumed / cancelled / timed_out / completed
```

右侧栏、聊天 Tool Part、运行信息 popover 和调试日志读取同一事件，但展示不同粒度。禁止在 renderer 再维护
`taskInfo + taskRunning + taskAssigning` 三个相互覆盖的事实数组。

### 9.3 先支持按需委派，再考虑 Task DAG

推荐实施顺序：

1. 把现有只读研究子 Agent 泛化为版本化 `DelegationTask` 和 child run 关联。
2. 增加 Agent/Progress 投影，只展示实际发生的委派。
3. 支持最多一层、低并发、有硬预算的多个 child run。
4. 支持用户审核由根 Agent 提出的计划。
5. 只有真实任务证明需要时，再增加依赖 DAG、自动调度和重规划。

这样能先验证用户价值和成本，而不会一次引入 Coordinator、Planner、Worker pool、TaskChannel 和第二套恢复协议。

## 10. 明确不照搬

- 不把“工作群”做成与统一 Agent 平行的第二套聊天和消息协议。
- 不在任务尚未分解前预创建全部固定角色 Agent。
- 不把父 Agent 完整消息历史和全部工具复制给所有 child。
- 不让 renderer 提交密钥、真实路径或最终 Worker 权限。
- 不用 `node_id`、`agent_id`、task id 多套身份在链路中反复转换。
- 不以自由形态 `additional_info` 作为任务结果、token、附件和失败信息的长期容器。
- 不让暂停、停止和客户端断开共享模糊语义。
- 不把 React Flow 视为多 Agent 的必要组成；只有拓扑确实帮助理解时才提供展开图。

## 11. 验收问题

Tessera 开始通用委派或多 Agent 实现前，应能回答：

1. child run 的权限是否严格小于等于 parent run？
2. child 只获得哪些资源引用，为什么需要？
3. 计划、排队、依赖阻塞和真正运行能否被 UI 正确区分？
4. 父任务取消、应用退出或网络失败时，child 如何终结和恢复？
5. 同一副作用工具是否可能因重试被执行两次？
6. child 结果不足由谁判断，失败会重试、重规划还是交还根 Agent？
7. token、deadline、并发和模型成本是否有硬上限？
8. Agent/Progress/Artifact 视图是否都可从有序事件重建？
9. 用户是否能审查和修改外显计划，但看不到或依赖私密 chain-of-thought？
10. 单 Agent 完成同一任务时，系统是否能避免多 Agent 开销？

