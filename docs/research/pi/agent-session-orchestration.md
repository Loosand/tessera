# Pi AgentSession 产品编排

> Pi 证据：`packages/coding-agent/src/core/agent-session.ts::AgentSession`、
> `packages/coding-agent/src/core/agent-session-runtime.ts::AgentSessionRuntime`、
> `packages/coding-agent/src/core/agent-session-services.ts::createAgentSessionFromServices`、
> `packages/coding-agent/src/core/sdk.ts::createAgentSession`、
> `packages/coding-agent/src/core/extensions/runner.ts::ExtensionRunner`
>
> Tessera 对照：`packages/ai/src/server/agent-runtime.ts`、
> `packages/ai/src/server/task-agent.ts`、`apps/desktop/src/main/ai-service.ts`、
> `packages/database/task-run-repository.ts`、
> `docs/architecture/agent-kernel-and-capability-runtime.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

`AgentSession` 才是 Pi coding-agent 的产品级 Agent。低层 `Agent` 只负责循环，而 `AgentSession` 把以下能力装在同一生命周期：

- 会话消息与 JSONL 持久化；
- model/thinking/tool/system prompt 动态状态；
- Skills、prompt template、slash command；
- 扩展事件、工具 hook 和 UI binding；
- steering/follow-up 投影；
- 自动压缩、overflow recovery、自动重试；
- 直接 Bash；
- 会话树导航、分支摘要和 fork；
- 统计、reload、session name/label。

这使 Pi 的入口非常简单，也使 `AgentSession` 超过 3500 行，成为明显的 God Object。Tessera 应学习它对 lifecycle 和消息顺序
的严谨处理，但不应复制这种职责集中方式。

## 1. 构造时建立的关键接线

`AgentSession` 构造后主要做三类绑定。

### 1.1 Agent 事件到会话事件

它订阅低层 `AgentEvent`，先把事件交给 ExtensionRunner，再向外部 listener 发 `AgentSessionEvent`。在 `message_end`：

- user/assistant/toolResult 会写入 SessionManager；
- custom message 根据可见性和时机写入；
- assistant error 仍保留为历史事实。

在 `turn_end`，延迟的 custom message 才被 flush，从而避免 extension 消息插到 assistant tool call 与对应 ToolResult 中间。

### 1.2 工具前后 hook

低层 Agent 的 `beforeToolCall`/`afterToolCall` 被接到 ExtensionRunner 的 `tool_call`/`tool_result`：

- 调用前可以改参数或阻止；
- 调用后可以改 content/details/isError；
- hook 异常按具体路径转成阻止或 extension error。

这提供了 permission-gate、sandbox adapter、遥测等扩展点，但政策依赖同进程任意代码，且多个扩展链式修改后最终参数不易审计。

### 1.3 每个下一 turn 刷新

`AgentSession` 给 Agent 注入 `prepareNextTurn`。它在下次模型调用前：

1. 检查是否需要 threshold compaction；
2. 重新读取当前 system prompt；
3. 重新计算 active tools；
4. 读取当前 model/thinking。

因此扩展在运行中增删工具、reload 资源或切模型，不需要销毁 Agent 才能影响下一 turn。动态性很强，但也意味着一个 run 内
能力可能漂移；旧主链没有不可变 capability snapshot。

## 2. prompt 入口不是简单追加用户消息

`prompt()` 的顺序包括：

```text
识别扩展 command / built-in command
  -> 拒绝手工 compaction 期间的新 prompt
  -> input extension event：handled / transform / continue
  -> 展开 /skill:name 或 prompt template
  -> streaming 中要求显式 steer/followUp
  -> 校验 model 与认证
  -> 必要时处理上一次 aborted response 后的压缩
  -> before_agent_start
       ├─ 注入 custom messages
       └─ 为本 run 临时改 system prompt
  -> Agent.prompt / Agent.continue
  -> post-run：retry / compaction / queued continuation
```

这保证 slash command 不会错误进入模型，Skill/template 在持久化前被展开，扩展可在 Agent 开始前注入一次性上下文。

局限是输入解释、命令系统、能力装配、模型认证和 Agent 执行都进入同一个方法；难以对“原始用户输入”“解析后的请求”“送给
模型的消息”分别建立稳定审计。

## 3. custom message 的顺序协议

扩展可以发送 custom message，并选择：

- 当前不忙时作为独立下一 run；
- streaming 时 steer；
- streaming 时 follow-up；
- `nextTurn`；
- 仅写 session entry，不进入模型。

最关键的实现细节是：模型工具批次尚未完成时，普通 custom message 会延迟到 `turn_end`，不能出现在 assistant tool call 和
ToolResult 之间。Pi 把 Provider 消息语法当成硬约束，而不是 UI 展示顺序。

Tessera 的领域事件、审批 UI 和运行过程说明也不应被随意转回模型消息。需要分别定义：

- run ledger event；
- UI projection；
- 可进入下一模型 step 的 bounded context item。

## 4. 自动重试与 overflow recovery

Pi 区分两条路径：

### 4.1 普通可重试错误

限流、过载和服务端错误使用设置中的 `maxRetries/baseDelayMs` 指数退避。失败 assistant message 已写入完整会话，但在 retry 的
active context 中移除，避免模型再次看到同一错误响应。重试有 start/end event，并可单独 abort。

### 4.2 上下文溢出

Context overflow 不走普通 retry，而是：

1. 检测 error 或可恢复的 length stop；
2. 从 active context 移除失败 assistant response；
3. 执行 overflow compaction；
4. 最多继续原 turn 一次；
5. 第二次仍失败则给出明确恢复建议。

若 response 已成功但 usage 越过阈值，只压缩上下文，不重跑已完成 response。这样避免重复工具调用或重复文本。

优点是重试与历史事实分离；局限是“从 active context 移除”是进程内投影规则，旧 JSONL 本身没有 operation record 精确表示
重试意图。崩溃恢复主要恢复消息树，不恢复正在退避或正在压缩的动作。

## 5. model、thinking 与工具变更

- `setModel()`、thinking level 变化会写专门 Session entry；
- 恢复会话时优先恢复历史 model/thinking，认证或模型缺失时选择 fallback 并提示；
- 扩展工具、SDK 工具和 built-in tool 合并成 registry；
- allowlist/denylist 决定 active tools；
- 工具变化触发 system prompt 重建。

工具冲突采用“先注册者获胜 + diagnostic”，而不是覆盖。这个规则确定且安全于静默覆盖，但 package/extension 顺序因此影响最终
工具集合，仍需在 UI/审计中暴露来源。

Pi 的 active tools 可以在 run 中途变化。Tessera 的 RunPolicy 已在每个 `prepareCall/prepareStep` 动态收窄，不过对安全相关能力
应采用“本 run 上限冻结、每 step 只能继续收窄”的规则，不能让 reload 或 Skill 扩大已开始 run 的权限。

## 6. 直接 Bash 是第二条执行入口

Interactive/RPC 的 `!command` 可以不经过模型 tool call，直接由 `AgentSession` 执行 Bash，并保存 `bashExecution` custom
message。若 Agent 正在 streaming，结果会延迟到 turn end 再进入上下文，继续维护消息配对。

这个功能对终端用户实用，但产生两个问题：

1. 同一 Session 同时存在“模型工具 Bash”和“用户直接 Bash”两种执行来源；
2. 安全、审计和资源预算需要覆盖两条路径。

Tessera 若未来提供命令能力，用户手动终端和 Agent 命令必须是不同 capability/actor，但都进入同一可信执行账本；不能让 UI
快捷入口绕过审批和 workspace lease。

## 7. reload 与失效

`reload()` 会：

- shutdown 并 invalidate 旧 ExtensionRunner；
- 重新加载 settings/resources/providers/tools；
- 重建 system prompt；
- 重新发 session start。

Extension context 的动作函数在 runner 失效后会拒绝操作，避免旧异步 handler 在新会话上继续写状态。这是同进程扩展体系里很
必要的防迟到机制。

但 invalidate 只是运行时 guard，不是隔离。扩展在 factory 或 handler 中自行持有的 Node 资源、全局变量和子进程仍需扩展配合
cleanup。

## 8. `AgentSession` 的职责债务

可以把现有成员拆成至少六个聚合：

```text
RunController        prompt / abort / retry / queue / idle
ContextCoordinator   system prompt / messages / compaction
CapabilityRuntime    tools / skills / extensions / providers
SessionRepository    entries / tree / fork / stats
CommandRuntime       slash command / template / direct bash
ProjectionPublisher  session events / extension events / UI binding
```

Pi 将它们放在同一个类中的现实收益是共享大量私有状态、改功能快、SDK 入口简单；代价是：

- 状态组合难以穷举测试；
- reload/switch/abort/compaction 的互锁依赖调用顺序；
- extension ABI 需要直接暴露类的许多动作；
- crash recovery 很难从一个巨大内存对象反推未完成动作；
- 新 Harness 必须重新设计更细的 durable record 才能继续演进。

## 9. Tessera 对照

| 领域 | Pi | Tessera 当前状态 | 建议 |
| --- | --- | --- | --- |
| 产品执行聚合 | 巨型 `AgentSession` | `task-agent.ts`、`agent-runtime.ts`、主进程服务、DB 分担 | 继续按端口拆分 |
| Run 策略 | 会话当前设置可在下一 turn 刷新 | `TaskRunPolicy` 已有类型和逐步路由 | 冻结上限、逐步只收窄 |
| 重试 | 会话内自动重试 | Provider/运行错误已分类，通用 retry 策略仍有限 | 先定义幂等和副作用边界 |
| 压缩 | 自动阈值/overflow/manual | ContextManifest 估算与拒绝已实现，通用压缩规划 | 增加显式 compaction entry/projection |
| 扩展 | 同进程代码可改几乎所有环节 | Skills/MCP/领域工具分层 | 不开放同等宽的 arbitrary-code ABI |
| 持久化 | message/tree 为主，运行动作内存态 | SQLite run/event 已实现 | 保持 run 为一等事实 |

## 10. 对 Tessera 的建议

1. 不引入 `TesseraAgentSession` 巨型类；先明确上表六个职责的协议。
2. 把 `agent-runtime.ts` 中工作区、研究、内容、MCP 工具装配拆成 Capability Adapter，但仍由统一 `createTaskAgent` 驱动。
3. 定义 run-level maximum capability snapshot；Skill、路由和阶段策略只能收窄。
4. 给 retry/compaction/approval/abort 建立独立状态与事件，避免只从 assistant message 反推。
5. 任何可进入模型的自定义上下文都经过 Context Compiler，领域事件默认只进入账本和 UI。
6. terminal condition 必须等待事件持久化与 effects draining，而不是只等模型 stream 结束。
