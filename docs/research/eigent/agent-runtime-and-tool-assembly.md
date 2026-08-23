# Eigent Agent 运行时与工具装配

> Eigent 证据：`backend/app/model/chat.py::Chat`、`backend/app/controller/chat_controller.py::start_chat_stream`、
> `backend/app/service/single_agent_service.py::single_agent_solve`、
> `backend/app/agent/factory/single_agent.py::single_agent`、
> `backend/app/agent/factory/toolkit_assembler.py::assemble_single_agent_toolkits`、
> `backend/app/agent/agent_model.py::agent_model`、`backend/app/agent/listen_chat_agent.py::ListenChatAgent`、
> `backend/app/utils/listen/toolkit_listen.py::listen_toolkit`、
> `backend/app/agent/toolkit/observable_todo_toolkit.py::ObservableTodoToolkit`、
> `backend/app/agent/toolkit/depth_limited_agent_toolkit.py::DepthLimitedAgentToolkit`、
> `backend/app/service/task.py::TaskLock`
>
> Tessera 对照：`packages/ai/src/server/task-agent.ts`、`packages/ai/src/server/agent-runtime.ts`、
> `packages/agent-runtime/src/index.ts`、`apps/desktop/src/main/task-service.ts`、
> `docs/architecture/unified-creation-agent.md`、`docs/architecture/ai-chat-agent-todo.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Eigent 的 Single Agent 不是“简单问答模式”，而是一个默认拥有文件、终端、搜索、浏览器、MCP、Skills、Todo、
网页抓取、部署、工作树和一次子 Agent 委派能力的**通用元 Agent**。复杂度没有消失，而是从固定 Workforce 角色转入
运行时工具装配和系统提示词。

它最成熟的部分有三个：

1. 单 Agent 实例可以跨同一 Project 的多个 turn 延续，并把 `TaskLock` 作为暂停、人工回复、资源清理和短期上下文容器。
2. 所有 Agent/Toolkit 活动通过结构化 queue 事件映射到 SSE，使 UI 能显示进度、工具、Token、文件和人工确认。
3. 工具装配有统一入口，浏览器、终端和 MCP 会再经过 hands capability 过滤，子 Agent 委派被硬限制为一层。

它最需要警惕的部分也有三个：

1. 默认工具几乎全开，权限是“工具是否出现”的粗粒度开关，没有统一逐调用审批和副作用交易。
2. `TaskLock` 以 `project_id` 为索引，同时混合运行态、会话态、记忆、资源和 UI event queue，Project/Task/Run 语义容易串扰。
3. 自定义 SSE 和 renderer 巨型 store 复制了 Agent 框架已有的部分状态机，恢复、取消、重复事件和跨版本兼容成本很高。

Tessera 应继续使用 AI SDK `ToolLoopAgent`，学习 Eigent 的“运行期能力装配 + 可见事件投影”，但不复制 CAMEL Agent、
自定义消息协议和默认全权限策略。

## 1. 输入契约：一次请求带了什么

`Chat` Pydantic model 同时承担请求、运行配置和部分持久上下文桥接。字段可以分成七组：

| 组 | 关键字段 | 作用 |
| --- | --- | --- |
| 身份 | `task_id`、`project_id`、`space_id`、`run_id`、`email`、`user_id` | 关联 UI、TaskLock、文件根和远端控制对象 |
| 工作区 | `space_root_path`、`workdir_mode` | 解析本次真实工作目录和输出根 |
| 用户输入 | `question`、`attaches`、`project_context` | 当前请求、附件路径、重启后的上下文桥接 |
| 模型 | `model_platform`、`model_type`、`api_key`、`api_url`、`model_config_dict`、`extra_params` | 构造 CAMEL model backend |
| 工具 | `installed_mcp`、`toolkit_config`、`search_config`、`allow_local_system` | 决定可装配能力和外部连接 |
| 浏览器 | `browser_port`、`cdp_browsers` | 从 CDP pool 或 hands 获取浏览器资源 |
| 编排 | `session_mode`、`new_agents`、`remote_sub_agent_config` | Single Agent / Workforce、自定义 Worker、远端子 Agent |

这份契约的优点是一次请求能够完整重建运行时，缺点是 renderer 直接携带 API Key、绝对路径、MCP env 和权限相关布尔值。
即使走 localhost，这也让 renderer 成为高权限策略输入方。Tessera 的 `TaskRunRequest` 应只携带稳定 ID 和用户选择，
密钥、真实路径、有效端点和最终权限必须在主进程解析。

## 2. 从发送到执行的完整链路

```text
renderer chatStore
  1. 锁定 Project 对应的 chat store
  2. 汇总 model/MCP/Skills/CDP/attachments/session_mode
  3. POST /chat + fetch-event-source
        │
        ▼
chat_controller.start_chat_stream
  4. 解析 workspace，创建/更新 TaskLock
  5. 构造冻结 RunContext
  6. 根据 session_mode 进入 single_agent_solve 或 step_solve/Workforce
        │
        ▼
single_agent_solve
  7. 首 turn 延迟创建 agent；后续 turn 复用同一实例
  8. 组装 durable/in-process/project context + attachment path + question
  9. agent.astep(prompt)
 10. 同时等待模型 turn 与 TaskLock action queue
        │
        ├─ queue action -> SSE step
        └─ turn result  -> memory snapshot + conversation + SSE end
```

关键实现不是一个阻塞的 `await agent.astep()`。`single_agent_solve` 把模型 turn 放入 background task，同时持续消费
`TaskLock.queue`。因此工具开始/结束、Agent 激活、Todo、文件写入、终端输出和人工提问可以在最终文本之前持续送达 UI。

### 2.1 Agent 延迟创建与跨 turn 复用

`ensure_agent()` 只在 `agent is None` 时调用 factory。同一个 SSE/session 循环后续收到 `improve` action 时，复用原 Agent
及其 CAMEL memory、工具实例、CDP session 和 Todo toolkit，只更新 `process_task_id` 与当前 task id。

收益：

- 工具连接和浏览器 session 不必每轮重建；
- CAMEL Agent 内存可延续；
- Todo 可以跨 turn 投影；
- 用户补充问题和人工回复能进入同一生命周期。

风险：

- 如果模型、工具启用、MCP 或权限在界面被修改，旧 Agent 不会自然重新装配；
- 资源生命周期与 SSE 连接耦合，客户端断开会暂停/取消正在进行的 turn；
- Project 级 `TaskLock` 和 task/run 级 `process_task_id` 叠加，容易把“会话延续”和“本次运行冻结”混在一起。

Tessera 应复用会话历史，不复用带旧权限的 Agent 实例。每个 run 通过 AI SDK `prepareCall` 重新解析工具和策略；昂贵
连接可以由主进程连接池复用，但连接池不能决定 run 权限。

## 3. Single Agent 的构造

`single_agent()` 做四件事：

1. 从 workspace resolver 获取工作目录；
2. 调用统一 toolkit assembler；
3. 把平台、架构、工作目录和当前时间填入系统提示词；
4. 调用 `agent_model()` 创建 `ListenChatAgent`，再挂接 Todo 和 CDP 生命周期元数据。

系统提示词要求多步任务先写 Todo，显式 Skill 优先，按需使用 terminal/file/search/browser/web fetch，允许委派一个有界
子任务，并只在歧义、凭据、权限或人工验证阻塞时询问用户。这种 prompt 很克制，没有把每种 toolkit 的长说明全部
复制进去；工具 schema 仍是能力说明主体。

值得保留的设计是：系统 prompt 只定义跨工具行为政策，具体工具使用说明留给 tool description 或 Skill。Tessera 当前
统一 Agent 方向一致，不应把所有领域工作流继续堆入根 prompt。

## 4. 动态工具装配

### 4.1 默认能力集合

`DEFAULT_SINGLE_AGENT_TOOLKIT_CONFIG` 默认开启：

```text
human
file
web_deploy
screenshot
skill
todo
search
browser
terminal
web_fetch
planning_worktree
mcp
agent
```

请求中的 `toolkit_config` 可以用布尔值或 `{ enabled, ...options }` 覆盖整项。`ToolkitAssembly` 收集实际 FunctionTools、
toolkit 名称、需要在 CAMEL Agent 注册的 toolkit，以及 Todo/Browser 资源句柄。

### 4.2 各能力的附加限制

| 能力 | 运行时限制 | 观察 |
| --- | --- | --- |
| File | 注入 `working_directory` | 是否真正限制路径取决于 toolkit 实现；后续工作区篇详述 |
| Skill | 注入 `working_directory` 和 user config id | 安装/启用与实际加载分开，但默认工具总是存在 |
| Todo | 绑定 project/task/agent | CAMEL Todo 是事实源，Eigent 只观察成功写入 |
| Search | 通过 `get_can_use_tools` 选择 | 搜索能力受配置影响，不是模型固有能力 |
| Browser | `hands.can_use_browser()`，CDP pool 复用 | 有资源分配/释放，但 fallback 会在无空闲时取第一个 browser |
| Terminal | `hands.can_execute_terminal()`，`safe_mode=True` | 仍属于高副作用工具，需单独审查 safe mode 实际边界 |
| MCP | `hands.can_use_mcp(name)` 逐 server 过滤 | 连接失败只跳过 MCP，不阻塞 Agent |
| Delegate | `depth < max_depth` | child tool set 移除 AgentToolkit，硬限制一层 |

`ToolkitMessageIntegration` 把 toolkit 的消息输出接入 HumanToolkit，用于在工具需要时向用户发消息。这是一个不错的
统一人工介入适配层，但仍依赖各 toolkit 主动调用。

### 4.3 粗粒度开关不等于授权

assembler 回答的是“模型能否看到某工具”，不回答：

- 这个具体调用是否有副作用；
- 参数是否越过 workspace scope；
- 当前用户是否批准写入/登录/发布；
- 调用前磁盘版本是否变化；
- 执行后如何审计、撤销或恢复。

Tessera 应将能力装配与调用授权分开：

```text
Capability resolution
  -> activeTools（本次模型可见）
  -> tool input validation
  -> needsApproval（按参数和副作用动态判断）
  -> trusted service execute
  -> audit/version/artifact event
```

## 5. 模型构造与 Agent 包装

`agent_model()` 为每个 Agent 生成 UUID，先发 `create_agent` action，再合并任务默认模型与 per-agent override。它使用
CAMEL `ModelFactory.create()`，主要策略包括：

- 区分 constructor 参数和推理 `model_config_dict`；
- subscription auth 在 401/expired 时刷新 token 并仅在尚未输出内容时重试一次；
- Anthropic/Bedrock 启用 prompt cache，OpenAI 使用 `project_id` 作为 prompt cache key；
- OpenAI-family stream 自动请求 usage；
- Browser Agent 对部分平台关闭 parallel tool calls；
- 模型请求 timeout 600 秒，Agent step 默认 timeout 1800 秒。

`ListenChatAgent` 继承 CAMEL `ChatAgent`，不重写核心工具循环，只补：

- Agent activate/deactivate 事件；
- request usage 事件；
- 流式内容累计；
- subscription auth refresh；
- step timeout；
- task/agent id 关联。

这是 Eigent 比较健康的一层：扩展框架的观测和鉴权，而不是再写一套 Agent loop。不过固定 10 分钟请求和 30 分钟
step 是宽泛兜底，不是按工具/模型/任务策略解析出的预算；Tessera 应把模型 timeout、工具 timeout、总 run deadline、
空闲 deadline 分开。

## 6. Todo 如何变成右侧 Progress

Single Agent prompt 强制多步任务先调用 `todo_write`。`ObservableTodoToolkit` 直接继承 CAMEL `TodoToolkit`：

```text
model calls todo_write(full ordered list)
  -> CAMEL validates and stores TodoItem[]
  -> Eigent emits todo_state action
  -> SSE todo_state
  -> chatStore updates task todo projection
  -> ProgressSection renders completed / in_progress / pending
```

这里的关键取舍是**不另建第二套 Todo 数据模型**。Eigent 给每项生成 `todo_1` 等展示 ID，但真实内容和状态仍来自
CAMEL toolkit。Progress 因此是 Agent 显式维护的计划投影，而不是 UI 根据工具日志猜出来的。

局限：

- LLM 可能忘记写 Todo、提前标完成或计划粒度不稳；
- ID 根据列表序号生成，重排后身份不稳定；
- Todo 主要活在 Agent/toolkit 实例，跨进程重启的恢复需要另一路历史重建；
- “计划完成”不等于产物和验收已经完成。

Tessera 当前已有目标/todo 与结构化计划方向，建议保留稳定 UUID 和 `source = user | agent | system`，并把
`completionEvidence` 关联到 Artifact/Tool result。右侧 Progress 显示用户目标，底层工具时间线仍单独保留。

## 7. 工具事件如何进入 UI

Eigent 对自有 toolkit 使用 `listen_toolkit` 装饰器：

```text
tool method call
  -> ActionActivateToolkitData(toolkit, method, args, agent, processTask)
  -> execute sync/async method
  -> ActionDeactivateToolkitData(result or error)
```

返回内容和输入会被格式化并截断，事件通过线程安全调度写入 `TaskLock.queue`。`single_agent_solve::_action_to_sse`
再把 action 映射为 `activate_toolkit`、`deactivate_toolkit`、`write_file`、`terminal`、`todo_state` 等 step。

这实现了较强的 UI 可见性，但协议存在几个问题：

1. 事件类型与具体 toolkit 特例并存，`write_file`/`terminal` 既可能是 tool lifecycle，也可能有独立 action；
2. 输入/输出只是面向展示的字符串，无法稳定支持恢复、结构化审计和 UI schema 演进；
3. queue 是内存对象，远端历史同步是额外链路，崩溃点可能丢失尾部事件；
4. renderer 需要识别大量字符串 step，并自行处理乱序、重放、完成后忽略等边界。

Tessera 已使用 AI SDK 标准 Tool Part，应继续让它承载 tool input/output/state；产品只增加带稳定 schema 的领域事件，
不要把所有标准 tool lifecycle 再复制一份。

## 8. 暂停、跳过、停止和人工回复

Single Agent 同时等待 action queue 与模型 task，因此能处理控制 action：

| action | 实际行为 | 风险/语义 |
| --- | --- | --- |
| `pause` | 清除 `pause_event`，状态设为 confirming | 已开始的底层调用是否立即暂停取决于 CAMEL/toolkit |
| `resume` | 设置 `pause_event`，状态设为 processing | 继续同一 Agent 实例 |
| `skip_task` | cancel 当前 turn，不等待底层快速退出，立刻发 end | 某些 HTTP/browser/MCP 调用可能继续产生迟到副作用 |
| `stop` | 设置 stop event、cancel turn、删除 TaskLock | 资源 cleanup 会执行，但外部副作用不可回滚 |
| `ask`/human reply | Future 精确投递给当前 waiter | 避免旧 queue reply 被下次问题误消费 |

`skip_task` 特意不 await cancelled task，因为底层工具不一定及时传播 `CancelledError`。这是务实处理，也直接证明“流已经
结束”不等于“所有执行都已经停止”。Tessera 的运行状态应区分 `cancel-requested`、`cancelled` 和 `effects-draining`，
高副作用服务在 apply 前再检查 run lease/abort token。

## 9. 状态边界：TaskLock 的收益与债务

`TaskLock` 包含：

- action queue、human waiter、background tasks、registered toolkits；
- conversation history、Agent memory snapshot、memory summary、last result；
- current task id、RunContext、工作目录、输出根、base snapshot；
- memory service、CDP/cleanup 所需引用和状态。

它解决了 Python 运行时中“一个 Project 当前正在干什么”的协调问题，但职责已经接近内存版 aggregate + service
container。最大语义问题是 map key 使用 `project_id`，内部又保存 `current_task_id` 和 `run_id`。并行 run、重放历史、
续轮和 Project 级长期状态需要靠调用约定避免覆盖。

Tessera 应拆成：

```text
TaskSessionState        长期会话关系
TaskRunRecord           持久运行状态与冻结策略
LiveRunController       Abort/approval/subscription，仅进程内
CapabilityLeasePool     MCP/CDP/terminal 等可复用资源
RunEventStore           有序事件事实源
```

这些对象可以互相引用稳定 ID，但不能由一个 renderer store 或主进程 map 同时承担。

## 10. Single Agent 与 Workforce 的真实关系

Single Agent 并不等于完全单体：默认 AgentToolkit 允许根 Agent 创建一个 child sub-agent。`DepthLimitedAgentToolkit`
覆盖 CAMEL child tool resolution，移除所有 AgentToolkit 和 registered AgentToolkit，并给 child prompt 加入“不得继续委派”。
因此是固定最大深度 1，而非任意递归 swarm。

这提供了一个更适合 Tessera 的方向：

- 产品默认仍是一个 Agent；
- 遇到有界、可并行、上下文隔离明显的子任务时，根 Agent 才调用 delegate tool；
- 子 Agent 获得经过收窄的工具和资源，而不是复制根权限；
- UI 只在发生委派后展开 Agent pool，不要求用户预先切“工作群模式”。

Eigent 当前 child 会继承父 tool set 再过滤 AgentToolkit，仍可能继承过多文件、终端、浏览器或 MCP 权限。Tessera 应让
delegate input 明确声明 `objective`、`resourceRefs`、`capabilityRefs`、`budget` 和 `deliverable`，由主进程做交集解析。

## 11. Tessera 对照

| 领域 | Eigent | Tessera 当前状态 | 建议 |
| --- | --- | --- | --- |
| Agent loop | CAMEL ChatAgent | AI SDK `ToolLoopAgent` 已实现统一骨架 | 不更换框架 |
| 每轮策略 | 请求字段 + toolkit config | `RunPolicy`、`prepareCall` 部分实现 | 补成不可变 RunContext |
| 工具装配 | 单一 assembler，默认全开 | 主进程按工作区/Skill/搜索装配 | 引入统一 capability resolver，但默认最小权限 |
| 工具 UI | 自定义 action/SSE | AI SDK Tool Part + 产品事件 | 标准 Part 为主，领域事件为辅 |
| Todo/Progress | CAMEL Todo + SSE projection | Todo/目标能力已有部分实现 | 稳定 ID、证据关联、右侧投影 |
| 人工确认 | HumanToolkit/Future | AI SDK tool approval +主进程审批规划 | 优先标准 approval |
| 取消 | cancel task，底层可能迟退 | AbortController/运行事件已有 | 增加 effects-draining/lease 复核 |
| 子 Agent | AgentToolkit，最大深度 1 | 规划 | 后期做显式 delegate tool，不先做固定 Workforce |
| 生命周期 | Project TaskLock 混合职责 | SQLite Task/Run +主进程 controller | 保持持久与临时状态分离 |

## 12. 建议的 Tessera Agent 主链路

```text
UserTurn
  -> main process resolveTaskRunContext()
      -> model route
      -> resource snapshots
      -> capability intersection
      -> approval policy
      -> context budget
  -> ToolLoopAgent.prepareCall(activeTools, instructions, providerOptions)
  -> AI SDK UIMessage/tool parts
  -> ordered RunEvent checkpoint
      ├─ conversation UI
      ├─ Progress sidebar
      ├─ Execution Context sidebar
      └─ Artifact/Review panel
  -> tool service checks approval + run lease + version
  -> finish / cancel / failure -> audit + memory candidate
```

这里没有持久 Agent 实例这个必要条件。模型 provider client、MCP connection、browser/CDP session 可以复用，但每个 run
重新冻结可见工具和上下文。

## 13. 可直接转化为任务的结论

1. 定义 `TaskRunContext` 与 `CapabilityRef`，由主进程解析并随 run 持久化。
2. 将 Progress、Execution Context、Artifact 三个投影建立在有序 run event 上，而不是页面临时状态。
3. Todo 使用稳定 ID，记录完成证据和最后更新 actor。
4. 将工具“可见”“需审批”“已调用”“已产生副作用”拆成不同状态。
5. 为取消后的迟到工具结果和副作用增加 run lease 校验。
6. 子 Agent 等基础运行审计、资源快照和权限收窄完成后再实现，默认最大深度 1。
7. 保持 AI SDK 标准 message/tool/approval 协议，不复制 Eigent 的 action 字符串状态机。

## 14. 明确不照搬

- 不默认向每个普通对话暴露文件、终端、浏览器、部署、MCP 和子 Agent。
- 不把 API Key、MCP env 和绝对路径作为 renderer 可自由构造的 Agent 请求字段。
- 不以 `projectId -> TaskLock` 同时承载 Project、Task、Run 和连接资源状态。
- 不认为取消 SSE 就等于取消外部副作用。
- 不给 child sub-agent 复制父 Agent 的完整 tool set 后再做黑名单过滤。
- 不为工具 UI 重建一套与 AI SDK Tool Part 平行的通用生命周期协议。
