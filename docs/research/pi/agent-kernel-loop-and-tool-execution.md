# Pi Agent Kernel、循环与工具执行

> Pi 证据：`packages/agent/src/agent.ts::Agent`、
> `packages/agent/src/agent-loop.ts::runAgentLoop`、
> `packages/agent/src/agent-loop.ts::runLoop`、
> `packages/agent/src/agent-loop.ts::executeToolCalls`、
> `packages/agent/src/agent-loop.ts::executeToolCallsParallel`、
> `packages/agent/src/types.ts::AgentTool`、
> `packages/coding-agent/src/core/sdk.ts::createAgentSession`
>
> Tessera 对照：`packages/ai/src/server/task-agent.ts::createTaskAgent`、
> `packages/ai/src/server/task-agent.ts::activeTaskAgentTools`、
> `docs/architecture/agent-kernel-and-capability-runtime.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Pi 的低层 Agent Kernel 确实很薄：`Agent` 管状态、队列、单次活动运行和事件订阅；`agentLoop` 管模型 turn、工具批次和下一
turn。它不管理 Session 文件、Skills、Project Trust、压缩、模型登录或 UI。

真正值得 Tessera 学习的不是自己写 while loop，而是 Pi 对四种顺序的处理：

1. provider message 与 tool result 的配对顺序；
2. 并行工具的完成顺序与上下文写入顺序分离；
3. steering 在工具批次后、follow-up 在当前 Agent 完成后进入；
4. abort/error 仍合成为正常的消息和生命周期终止事件。

## 1. `Agent` 持有什么

`Agent` 的可变 state 主要包含：

- system prompt；
- model 与 thinking level；
- tools；
- messages；
- 当前 streaming/active run 状态。

它另有两个 pending queue：steering 和 follow-up，均支持 `one-at-a-time` 或 `all` 消费模式。`prompt()` 开始新 run，
`continue()` 从已有消息继续，`abort()` 传播 AbortSignal，`waitForIdle()` 等待运行和异步 listener 全部结束。

构造与 setter 会复制顶层数组，避免调用方直接 push 改内部集合；但消息对象、Tool 对象和 Model 仍按引用共享。它是受控的
mutable runtime，不是 immutable reducer。

## 2. 一次 Agent run 的两层循环

```text
outer loop：处理初始输入和 follow-up
  inner loop：
    1. 准备下一 turn 的 context/model/thinking
    2. transformContext
    3. convertToLlm
    4. stream assistant response
    5. 若有 tool calls，执行整批并追加 ToolResult
    6. 若有 steering，追加 steering 后继续 inner loop
    7. 无 tool/steering 时结束当前 turn chain
  若有 follow-up，追加后重新进入 outer loop
```

Pi 把“一个 turn”定义为一次 Provider response 加随后工具批次，而“一个 run”可以包含多个 turn、多个 steering 和多个
follow-up。这个区分直接体现在 `turn_start/end` 与 `agent_start/end` 事件上。

## 3. 模型边界的两个变换

`runLoop()` 在每个模型调用前依次执行：

1. `prepareNextTurn`：允许宿主更新 context、model、thinking level；
2. `transformContext`：允许产品层或扩展改 AgentMessage 上下文；
3. `convertToLlm`：把产品自定义消息角色转换为 Provider 接受的标准 Message。

这使 Agent 核心不需要认识 `bashExecution`、`compactionSummary`、`branchSummary` 或任意 extension custom message。Pi 的
`coding-agent` 通过 module augmentation 扩充 `AgentMessage`，最终在 `messages.ts::convertToLlm` 收口。

优点是产品消息与模型协议解耦。风险是多个变换点叠加后，磁盘记录、UI 展示与真实 Provider payload 可能不同；必须有
调试手段解释最终上下文。

## 4. 工具参数与执行前置

`AgentTool` 包含 name、description、TypeBox schema、execute，以及可选：

- 流式 `onUpdate`；
- `executionMode: sequential`；
- `addedToolNames`；
- `terminate`。

工具调用先经过参数准备和 schema 校验，再进入 `beforeToolCall` hook。hook 可以改参数或阻止调用。执行后
`afterToolCall` 可以改结果。未知工具、参数错误和 hook 拒绝都被转换成 ToolResult，而不是让整个 loop 因 expected tool
failure 抛出。

如果 Provider 因 length 截断了包含 tool call 的 assistant message，Pi 会拒绝这批所有工具调用，不尝试执行可能不完整的
参数。这是重要的副作用安全细节。

## 5. 并行工具的顺序语义

默认工具批次并行，但不是简单 `Promise.all(execute)`：

```text
按模型返回顺序逐个 preflight
  -> 可执行项并发开始
  -> tool_execution_end 按真实完成顺序发出
  -> ToolResult message 按原 tool-call 顺序写入 messages
```

这兼顾实时 UI 与 Provider 协议稳定性。用户可以先看到快速工具完成，但下一次模型输入中的 tool result 仍与原调用顺序一致。

只要批次中任意工具声明 `executionMode: sequential`，Pi 会让整个批次顺序执行。这是保守策略，避免一个有顺序要求的工具
与其他调用交错；代价是批次级吞吐下降，也没有资源级冲突图。

工具的 `terminate` 只有在一批所有 finalized outcome 都为 `terminate: true` 时才结束循环，避免一个终止型工具意外吞掉
同批仍应反馈给模型的结果。

## 6. abort、更新与错误收口

- Agent 同一时间只允许一个活动 run。
- AbortSignal 传入模型流和工具。
- 工具返回后如果 signal 已中止，迟到的 update 不再发出。
- Provider 或 loop 抛错会生成 `stopReason=error/aborted` 的 assistant message。
- 即使失败，也会发 message/turn/agent 的结束事件，订阅者可以统一收口。
- `agent_end` 发出后，`Agent` 仍要等待 listener settle 才变为真正 idle。

最后一点很关键：持久化或 extension listener 可能异步工作，UI 看到 `agent_end` 不应立即销毁宿主。

但 abort 只能表达“停止继续处理”，不能撤销已经开始的文件写入、Shell 子进程或外部 API 副作用。Pi 的具体工具各自尽力
响应 signal，Kernel 本身不提供 lease、transaction 或 idempotency。

## 7. steering 与 follow-up

| 队列 | 消费时机 | 用途 |
| --- | --- | --- |
| steering | 当前工具批次结束、下一个模型 turn 前 | 用户纠偏、补充即时约束 |
| follow-up | 当前 run 已无工具和 steering 后 | 排队的下一问题或连续任务 |

两种队列都支持一次取一个或全部取出。Pi 不会把它们压成同一种“在 streaming 时追加消息”，因此 UI 和 RPC 可以清楚表达
用户是要改变当前方向，还是等待当前工作结束后继续。

局限是队列在当前 `Agent` 内存中，耐久性由 `AgentSession` 的消息落盘时机间接提供；旧主链没有 operation-level queue record。
这正是下一代 Harness Session 新增 `queue_enqueued`/`queue_cancelled` record 的原因之一。

## 8. Tessera 对照

Tessera 的 AI SDK `ToolLoopAgent` 已提供模型循环、tool schema、`activeTools`、`prepareCall`、`prepareStep`、停止条件、
`needsApproval` 和标准 UI Part。重新实现 Pi loop 会丢失现有类型、Provider 兼容、审批流和观测链。

Pi 仍提供以下设计输入：

| Pi 机制 | Tessera 当前状态 | 建议 |
| --- | --- | --- |
| Provider 前 context transform | ContextManifest 已估算但通用 Compiler 仍规划 | 建立可解释的单一 Context Compiler |
| 活跃工具动态刷新 | `prepareCall/prepareStep` 已动态收窄 | 保持每 step 重算，并持久化 capability snapshot |
| steering/follow-up 分义 | UI 主要按单次请求运行 | 若开放运行中输入，先定义两种明确协议 |
| 并发完成、源序持久化 | 依赖 AI SDK 标准 tool parts | 加跨工具并发与顺序回归，不自行重排消息 |
| length 截断不执行工具 | SDK/Provider 行为需专门验证 | 增加截断 tool-call 安全测试 |
| listener settle 决定 idle | 主进程有事件持久化/消息保存 | terminal 前等待事实写入完成 |

## 9. 不应从 Kernel 学到的错误结论

- Kernel 小，不代表系统没有权限和恢复成本。
- AbortSignal 存在，不代表外部副作用已经停止。
- 工具结果是结构化 Message，不代表它适合不加裁剪地长期进入上下文。
- Tool hook 可以阻止调用，不代表同进程扩展就是可信策略执行器。
- 并行工具能运行，不代表文件、MCP 或领域写入天然可并发。

## 10. 对 Tessera 的具体建议

1. 继续让 AI SDK 拥有 loop；Tessera 只在 `prepareCall/prepareStep` 编译上下文和能力。
2. 为运行中输入预留 `steer` 与 `follow-up` 两种显式命令和持久事件，暂不以普通消息模拟。
3. 给每个副作用工具增加 run lease、approval/version/idempotency 关联；Abort 只改变 lease 状态。
4. 将“模型完成”“工具 effects draining”“事件持久化完成”“消息投影完成”区分为不同收口点。
5. 为截断 tool call、并行工具乱序、hook 拒绝、abort 后迟到结果建立统一回归矩阵。
