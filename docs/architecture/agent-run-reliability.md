# Agent Run 可靠性契约

> 代码源头：`packages/ai/src/server/task-agent.ts`、`packages/ai/src/server/context-compaction.ts`、
> `packages/ai/src/react/use-electron-chat.ts`、`apps/desktop/src/main/agent-run-event-ledger.ts`、
> `apps/desktop/src/main/ai-chat-chunk-coalescer.ts`、`apps/desktop/src/main/task-run-inspection.ts`、
> `apps/desktop/src/main/index.ts`、`apps/desktop/src/main/workspace-execution-environment.ts`、
> `packages/agent-runtime/src/workspace-file-capabilities.ts`
>
> 状态：**已实现 P3/P4 一期契约。** P3 覆盖模型流、文件/Web/MCP 工具、事件持久化、取消、重试和长会话投影；
> P4 已把前台 `bash` 纳入隔离、进程组、输出和文件事件收口。

## 1. 目标与非目标

本契约把 Pi 的稳定性经验映射到 Tessera 现有 AI SDK `ToolLoopAgent` 上，但不平行实现第二套
Agent loop。它解决五个可验证问题：

1. 一次 run 的 turn、工具批次和 terminal 以什么顺序出现；
2. 已接受的 Tool Call 如何只产生一个终态；
3. 取消和重试如何避免迟到提交或重放副作用；
4. 长会话如何在不改写历史的前提下继续；
5. 用户和调试界面如何只展示可从运行事实重建的信息。

本阶段不实现 durable step replay、跨进程 Agent 恢复、运行中 steering/follow-up 队列、交互终端或长期后台进程。

## 2. 运行单位和事件顺序

- **Run**：一次用户提交对应一个 `requestId` 和一条 `task_run`。同一任务同时只允许一个活动 run。
- **Turn**：一次 Provider response，由 `start-step` 和 `finish-step` 围住。
- **Tool batch**：同一 turn 产生的一个或多个 Tool Call。本地工具可并行执行。
- **Terminal**：run 只接受 `finish`、`abort` 或 `error` 之一；terminal 之后的 chunk 全部丢弃。

正常链路是：

```text
run start
  -> start-step
  -> model message / tool input stream
  -> tool-input-available
  -> zero or more tool results
  -> finish-step
  -> next start-step ...
  -> finish | abort | error
```

`AgentRunEventLedger` 位于 AI SDK chunk 和 SQLite/IPC 之间。它先归约化工具终态，再交给
`AiChatChunkCoalescer` 的有序 flush/持久化链路，因此恢复时看到的是同一份事件事实，而不是 renderer
内存状态的重建猜测。

## 3. Tool Call 唯一终态

工具调用按 `toolCallId` 归约为：

```text
started  --tool-input-available--> accepted
started  --tool-input-error-----> terminal
accepted --output/denied/error--> terminal
```

- 第一个有效工具终态生效，后续重复或迟到结果被丢弃。
- `finish-step` 或 run terminal 到达时，未收口调用会获得稳定 `tool-input-error` 或 `tool-output-error`，
  不留下无限等待的半状态。
- `request-user-input` 和尚在等待人工审批的 MCP 是明确暂停态；正常 `finish` 不把它们伪装成失败，
  `abort` 则收口为不可自动重试的取消。
- 模型以 `length` 结束且参数未完整时，AI SDK 不执行该工具；事件账本再将其收口为
  `invalid-input`，明确标注“未执行”。

UI 可以按真实完成时间显示并行工具，但下一个模型 turn 的 `tool-result` 必须按上一条 assistant
message 中 Tool Call 的源顺序重排。这使上下文不受网络和文件 IO 完成时机影响。

## 4. Abort 和副作用提交点

用户停止会触发主进程 `AbortController`，不只是关闭 renderer 订阅。模型流、Web Reader、MCP 调用和
文件工具共用该 signal。终止前先 flush 已接收的 delta，再持久化唯一 `abort`；终止后迟到
chunk 不再广播或入库。

文件工具的取消边界是显式的：

1. `write update` 先确认当前 run 已读完同一 hash 的所有分页/超长单行分片；部分读取不能整篇覆盖。
2. 同文件变更在进程内串行；临近原子替换时重新解析目标并再次读取、检查最新 hash，缩小外部编辑竞态窗口。
3. 原子替换前检查 Abort；此时取消不改变磁盘。
4. 一旦原子替换成功，该文件结果就是已提交，不会因随后的 Artifact 登记失败改报为写入失败。

P4 已把同一契约扩展到前台 `bash`：命令运行在独立进程组，timeout/Abort 终止进程组，Promise 等待 child
`close` 和 stdio 关闭；shell 正常退出也会清理同组后台进程。输出持续 drain 且每流只保留 65,536 字节，真实文件事件
在工具结果返回前收口。主动脱离进程组的 daemon 不属于支持契约，详见
[Bash ExecutionEnvironment](bash-execution-environment.md)。

## 5. 重试分层

| 类型 | 当前契约 | 副作用边界 |
| --- | --- | --- |
| Provider retry | AI SDK 每次模型调用最多重试 2 次 | 只处理 Provider 调用失败，不作为工具再执行机制 |
| Tool input repair | 对已知工具执行一次无工具副作用的单工具短模型修复 | 只返回修复后参数，修复调用本身不执行工具 |
| Tool execution retry | 不自动重试 | 失败作为稳定 Tool Result 进入上下文或终止链路 |
| User retry/regenerate | 新建 run，保留原消息 ID 来源 | 已完成的写入/MCP/未知工具结果作为 continuation 复用，不再放该调用 |

纯读取工具可以从新 run 重建；其他已完成工具都按“可能已提交副作用”保守处理。续跑消息只保留
已完成 Tool Part 和失败数据，不保留未完成正文；主进程再复核续跑消息 ID 和完成结果。

## 6. 运行中输入：当前明确不开放

Tessera 当前不支持运行中 steering 或 follow-up，也不把用户正在编辑的文本、新普通消息或
renderer 队列猜成两者。

- composer 在 run 活动时只提供“停止”，不提交新消息；已输入文本仍是本地草稿。
- 主进程按 task 拒绝第二个并发 run，防止绕过 UI 产生暗中队列。
- 用户要立即纠偏时，必须先停止再发送；要追问时，等当前 run terminal 后新建下一个 run。

若以后开放，必须使用类型化命令和持久事件：`steer` 在当前工具批次后、下一个模型 turn 前消费；
`follow-up` 在当前 run 已无工具后消费。在这两个消费点能够被决定性测试之前，不新增空契约或
无实际消费者的队列。

## 7. 上下文压缩

Context compaction 只修改下一次 Provider 调用的 `ModelMessage[]` 投影，不改写 `TaskMessage`、SQLite
事件或文件。

1. 每个 step 先按工具源顺序规范化消息，再生成初始 `ContextManifest`。
2. 超过已知安全输入预算时，将较早历史替换为带固定 marker 的确定性摘要，并保留最新用户 turn。
3. 切点不能从孤立 `tool` message 开始；摘要不包含工具输出正文，也不推断工具已产生某副作用。
4. 压缩后重新生成 `ContextManifest`，记录压缩前后估算、省略/保留消息数和摘要长度。
5. 如果最新 turn 本身已超预算，不为强行调用模型而截断语法；保留原投影，由预算错误明确停止。

这是无模型、无隐式副作用的一期压缩。它的保守性高于语义完整性；未来若引入模型摘要，必须保持
同样的工具效果诚实性和外部历史不变性。

## 8. Run Inspector 与验收矩阵

Run Inspector 只从已持久化的 RunPolicy、资源摘要、ContextManifest、有序事件和数值指标投影：

- turn 数、工具调用/失败/拒绝和尚在等待的 Tool Call；
- `finish` / `abort` / `error` terminal，稳定失败与 finish reason；
- 压缩前后预算、省略和保留消息数；
- 实际模型、Skill、工具作用域、用量与耗时；
- 失败时供应商返回的有界原始错误正文，只剔除 API Key / Authorization 凭据。

供应商错误响应正文是唯一原始诊断例外；它不返回 prompt、请求正文、响应 Header、堆栈、消息正文、完整工具输入/输出、绝对路径或 Secrets。

P3 的决定性矩阵覆盖：工具参数截断未执行、单一工具终态、terminal 后迟到事件、用户/审批暂停、
Abort 收口、并行结果源顺序、文件完整读取许可、临近提交版本复核、提交前取消、副作用重生成续跑、压缩保留最新 turn、超大最新 turn 安全失败，
以及终止前 coalescer 尾部 flush。P4 另覆盖 timeout、输出上限、Abort、正常 shell 后台进程清理、真实 Seatbelt
越界/网络/Secret 隔离、`ls/rg/find` 与 Artifact 文件事件。
