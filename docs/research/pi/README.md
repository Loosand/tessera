# Pi Agent 深度源码研究

> 研究对象：本地 `.local/pi`
>
> 主研究范围：`.local/pi/packages/coding-agent`
>
> 固定提交：`853a80d26c90a14c1886f0ebb8ffaae133ca2185`
>
> 提交时间：2026-08-28 23:56:06 +02:00
>
> 包版本：`@earendil-works/pi-coding-agent@0.84.4`、`@earendil-works/pi-agent-core@0.84.4`、`@earendil-works/pi-ai@0.84.4`
>
> Tessera 对照基线：当前工作区源码与 `docs/architecture/` 中标记的实现状态
>
> 研究状态：已完成

## 研究目标

这组文档研究 Pi 的 Agent，不把它简化成“一个 while loop”，也不把终端 UI 当作 Agent 本身。目标是回答五个问题：

1. `coding-agent` 如何把低层模型/工具循环组装成可连续使用、可分支、可压缩、可嵌入的产品会话？
2. `Agent`、`AgentSession`、`AgentSessionRuntime`、`SessionManager` 与 `ModelRuntime` 各自拥有什么状态和边界？
3. 工具、扩展、Skills、项目上下文和供应商如何在每个 turn 前进入模型输入？
4. Pi 的轻量来自哪些有效抽象，又把哪些复杂度和安全责任交给了宿主或用户？
5. Tessera 已经采用 AI SDK、SQLite、窄 IPC、审批和工作区能力端口后，还应该从 Pi 学什么、不应学什么？

研究以 `packages/coding-agent` 为主体。`packages/agent` 只用于解释 `Agent`/`agentLoop` 以及尚未完成的 `AgentHarness`；
`packages/ai` 只作为 Model、Provider、消息与流协议的下游依赖，不展开供应商协议实现。

## 证据与标记约定

### Pi 证据

- `Pi coding-agent: packages/coding-agent/src/...::symbol` 表示产品级 Agent 会话、工具、扩展或入口源码。
- `Pi agent-core: packages/agent/src/...::symbol` 表示低层 Agent loop 或下一代 Harness 合约。
- `Pi ai: packages/ai/src/...::symbol` 表示模型、消息、Provider 或流式契约。
- `CHANGELOG.md` 和 `docs/*.md` 只用于确认公开意图、兼容范围或安全声明；运行事实仍以源码和测试为准。

本地 `.local/` 不进入 Tessera 版本库，因此文档记录仓库相对路径、符号和固定 commit，而不使用其他机器会失效的本地链接。
需要复核时，在 `.local/pi` 执行：

```bash
git checkout 853a80d26c90a14c1886f0ebb8ffaae133ca2185
rg "目标符号" packages/coding-agent packages/agent packages/ai
```

### 结论类型

- **源码事实**：可由固定提交的代码、测试、配置直接确认。
- **研究推断**：由多个源码事实推导出的架构或演进方向，会写明依据。
- **Tessera 建议**：结合当前 Tessera 边界给出的选择，不代表已经实现。

### Tessera 状态

| 标记 | 含义 |
| --- | --- |
| 已实现 | 当前代码已具备主链路，并有相称验证或文档证据 |
| 部分实现 | 有可运行骨架，但存在关键缺口、临时边界或未闭环状态 |
| 规划 | 架构文档已经定义，但当前主链路尚未完成 |
| 未开始 | 当前代码和架构文档都没有形成可依赖的实现承诺 |

## 专题地图

| 专题 | 重点问题 | 状态 |
| --- | --- | --- |
| [系统、包结构与运行时边界](system-stack-and-runtime-boundaries.md) | 入口、包依赖、cwd 绑定、主链与新 Harness 如何分层 | 已完成 |
| [Agent Kernel、循环与工具执行](agent-kernel-loop-and-tool-execution.md) | turn、队列、工具批次、并发、事件与失败如何推进 | 已完成 |
| [AgentSession 产品编排](agent-session-orchestration.md) | 会话、扩展、重试、压缩、动态能力和生命周期如何汇总 | 已完成 |
| [会话树、持久化与恢复](session-tree-persistence-and-recovery.md) | JSONL 树、分支、迁移、上下文投影和恢复边界 | 已完成 |
| [上下文、系统提示词与压缩](context-system-prompt-and-compaction.md) | 活跃工具如何进入提示词，长会话如何摘要和保留尾部 | 已完成 |
| [工具、文件、Shell 与安全](tools-files-shell-and-security.md) | 默认工具真实权限、预算、并发、Project Trust 与隔离 | 已完成 |
| [扩展、Skills 与能力装配](extensions-skills-and-capability-assembly.md) | 资源发现、扩展事件面、渐进加载、冲突与供应链风险 | 已完成 |
| [模型、Provider 与运行时路由](models-providers-and-runtime-routing.md) | Provider 组合、认证、模型恢复、scope 与请求变换 | 已完成 |
| [运行模式、SDK、RPC 与 UI 投影](run-modes-sdk-rpc-and-ui-projection.md) | 四种入口是否共享语义，嵌入协议如何控制会话 | 已完成 |
| [Tessera 吸收路线图](tessera-adoption-roadmap.md) | 采纳顺序、明确拒绝项、验证门槛和近期切片 | 已完成 |

## 当前总判断

Pi 最值得学习的是**把 Agent Kernel 做薄，同时让产品会话拥有明确的可替换边界**。当前成熟主链可以概括为：

```text
CLI / SDK / RPC / TUI
  -> AgentSessionRuntime（cwd 与服务生命周期）
  -> AgentSession（产品编排）
  -> Agent（运行状态与队列）
  -> agentLoop（模型 turn 与工具批次）
  -> ModelRuntime / AgentTool
```

`Agent` 并不知道磁盘会话、Skills、项目上下文、模型登录、自动压缩或 UI；`agentLoop` 只处理消息、模型流、工具调用和下一
turn。这是 Pi “轻量”的真实来源。它不是把复杂度消掉，而是把复杂度推到 `AgentSession`、ResourceLoader、ExtensionRunner、
ModelRuntime 和宿主工具里。

Pi 最成熟的四个设计是：

1. **消息与事件顺序清楚**：模型流、工具执行、工具结果、steering 和 follow-up 都有显式顺序；并行工具完成顺序不改变写入上下文的源顺序。
2. **会话是追加式树，不是可变消息数组**：分支只移动 leaf，压缩只改变上下文投影，完整历史仍保留在 JSONL。
3. **能力与提示词同步**：活跃工具决定系统提示词中的工具摘要和 guideline；扩展可以在下一 turn 前动态刷新工具和模型。
4. **多入口共用同一语义核心**：Interactive、Print/JSON、RPC 和 SDK 最终都操作 `AgentSession`，而不是分别维护 Agent 状态机。

它最明显的工程债务也有四个：

1. `AgentSession` 超过 3500 行，同时承载持久化、压缩、重试、模型、工具、扩展、Skill、Bash 和树导航，已经成为产品级 God Object。
2. 扩展 ABI 可以介入上下文、Provider 请求、工具前后、UI、会话切换和消息持久化，灵活但难以解释最终送给模型与执行器的真实策略。
3. 默认 `read/edit/write/bash` 继承当前用户权限；Project Trust 只控制项目资源加载，不是调用授权或沙箱。
4. 旧 `SessionManager` 的 JSONL 适合本地可检查会话，不等于事务型运行账本；同步文件写、绝对路径和完整工具输出不适合作为 Tessera 主事实源。

## 关于 `AgentHarness` 的关键判定

当前提交已经在 `packages/agent/src/harness/` 和 `packages/coding-agent/src/server/create-harness.ts` 暴露下一代
`AgentHarness`、lane-based Session、durable operation record、ExecutionEnv 与 typed Result。接口明显是在把现有
`AgentSession` 的职责拆成可恢复、可远端、可多 lane 的运行内核。

但它**不是当前可替代主链**：`AgentHarness.create()` 遇到已有 operation record 会抛 `HarnessNotImplemented("create.restore")`，
`prompt`、`compact`、`resume`、`abort`、queue、watch、lane 等关键路径都直接返回 `HarnessNotImplemented`。CHANGELOG 也把它称为
“compile-complete scaffold”。因此本研究把它作为演进证据和接口设计输入，不把它写成 Pi 已经具备的 durable Agent runtime。

## 对 Tessera 的第一轮结论

1. 保留 AI SDK `ToolLoopAgent`，不要为了“像 Pi”而重写模型/工具循环。
2. 学习 Pi 的 `Agent`/`AgentSession` 分界，但把 Tessera 产品编排继续拆成 Context Compiler、Capability Router、Run Controller、Event Store 和领域服务，避免形成新的巨型 Session 类。
3. 优先补“上下文投影与压缩 marker”，而不是把 SQLite 历史全量重放或直接复制 Pi 的 JSONL 会话文件。
4. steering、follow-up 和 branch 应是明确产品语义，不通过 UI 临时队列或消息文本猜测。
5. 学习 active tools 与系统提示词同步，但所有工具仍由 RunPolicy、权限、工作区授权和审批交集收窄。
6. 不采用默认 Shell、绝对路径、直接覆盖写、同进程任意扩展和 Project Trust 代替权限系统。
7. 把 Pi 下一代 Harness 的 durable operation record、stable result/error、ExecutionEnv 抽象作为长期参考，但等待其实现成熟再评估协议细节。

## 研究完成门槛

- 从 CLI 启动追到 Agent turn、工具执行、持久化和 UI/RPC 事件，而不只列文件。
- 每个重要结论至少有实现源和调用方、测试、文档或相邻层作为交叉证据。
- 明确区分当前 `AgentSession` 主链与未完成 `AgentHarness` scaffold。
- 明确区分 Project Trust、工具可见、调用审批和操作系统隔离。
- 对照 Tessera 当前源码与架构状态，不把规划写成已实现。
- 路线图为每项采纳建议给出依赖、风险、验收和不采纳项。
