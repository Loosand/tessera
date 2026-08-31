# Pi 系统、包结构与运行时边界

> Pi 证据：`packages/coding-agent/src/main.ts::main`、
> `packages/coding-agent/src/core/agent-session-services.ts::createAgentSessionServices`、
> `packages/coding-agent/src/core/agent-session-services.ts::createAgentSessionFromServices`、
> `packages/coding-agent/src/core/agent-session-runtime.ts::AgentSessionRuntime`、
> `packages/coding-agent/src/core/sdk.ts::createAgentSession`、
> `packages/coding-agent/src/server/create-harness.ts::createCodingAgentHarness`、
> `packages/agent/src/harness/agent-harness.ts::AgentHarness`
>
> Tessera 对照：`packages/ai/src/server/task-agent.ts`、`packages/ai/src/server/agent-runtime.ts`、
> `packages/agent-runtime/src/workspace-file-capabilities.ts`、
> `docs/architecture/agent-kernel-and-capability-runtime.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Pi 不是单包 Agent。`coding-agent` 是产品宿主，`agent-core` 是低层循环与正在演进的 Harness 合约，`pi-ai` 是模型和
Provider 适配。当前生产主链仍是 `AgentSession -> Agent -> agentLoop`；`AgentHarness` 是接口先行、关键执行路径尚未完成的
下一代 scaffold。

Pi 最值得学习的系统边界不是“终端应用很小”，而是两点：

1. 所有入口都复用同一个会话对象，不为 TUI、JSON、RPC、SDK 各建一套执行语义。
2. cwd 变化会重建 Settings、Resources、Models 和 Session，而不是只修改一个字符串继续使用旧服务。

## 1. 包职责

| 包 | 当前职责 | 不承担什么 |
| --- | --- | --- |
| `packages/ai` | Model/Provider、消息、流、认证、重试和通用模型目录 | 产品会话、工作区工具、TUI、Skills |
| `packages/agent` | `Agent` 状态机、agent loop、工具契约；另含下一代 Harness/Session scaffold | 项目资源发现、模型登录 UI、旧会话文件管理 |
| `packages/coding-agent` | CLI/SDK/RPC/TUI、`AgentSession`、旧 JSONL 会话、资源、扩展、Skills、内置工具和模型运行时 | Provider 协议底层细节 |
| `packages/tui` | 终端布局、输入与渲染原语 | Agent 状态与会话事实 |

依赖方向总体健康：产品层依赖 Agent 和 AI，低层 Agent 不反向依赖 coding-agent。不过 `coding-agent` 内部的
`AgentSession` 聚合了过多产品职责，包边界清楚不代表类边界同样清楚。

## 2. CLI 启动不是直接 new Agent

`main()` 的关键顺序如下：

```text
解析 CLI 与迁移
  -> 确定 mode、目标 session 和最终 cwd
  -> 创建预信任 ResourceLoader
  -> 只加载全局/用户/CLI 扩展与 context files
  -> 解析 Project Trust
  -> 以信任结果重新加载项目资源
  -> createRuntime(effective cwd)
  -> AgentSessionRuntime
  -> Interactive / Print / JSON / RPC
```

“先确定最终 cwd，再构造 cwd-bound service”是重要细节。若用户恢复另一目录的会话，Pi 不会先用启动目录加载项目模型、
设置和扩展，再把 session cwd 替换掉。Project Trust 也按目标 cwd 重新解析。

### 2.1 两阶段项目资源加载

信任前允许加载：

- context files；
- 用户/全局扩展；
- CLI 显式扩展。

信任后才允许项目 `.pi/settings.json`、项目扩展、Skills、prompts、themes、SYSTEM/APPEND_SYSTEM 和项目 package 安装进入
最终资源集。用户扩展可以处理 `project_trust` 事件，但项目扩展不能在自己被信任前参与决定。

这是一个合理的输入装载顺序，不过它只避免仓库在启动阶段静默执行项目扩展，不限制后续模型使用内置工具访问哪些路径。

## 3. `AgentSessionServices` 与 `AgentSession` 分开创建

`createAgentSessionServices()` 先构造：

- `cwd` 与 agentDir；
- `SettingsManager`；
- `ModelRuntime`；
- `DefaultResourceLoader`；
- 扩展 Provider 注册；
- 可用模型快照和诊断。

`createAgentSessionFromServices()` 再根据已解析的模型、tool allow/deny、初始 thinking、session manager 等选项创建
`AgentSession`。这个两段工厂把“cwd 绑定的基础设施”和“当前会话实例”分开，既服务 CLI，也允许 SDK 注入自定义实现。

局限是它仍返回一组相互知道很多内部细节的可变服务；没有一个不可变 `RunContext` 固化本次请求真正使用的资源和策略。

## 4. `AgentSessionRuntime` 是 cwd 生命周期宿主

`AgentSessionRuntime` 不只是 `session` 的 holder。切换、新建、fork 或导入会话时，它会：

1. abort 并等待当前运行、重试和压缩收口；
2. 发出 extension shutdown；
3. 让旧 Session/Runner context 失效；
4. 按目标会话 cwd 重建 Settings、ModelRuntime、ResourceLoader 和 AgentSession；
5. 重新绑定当前 Interactive/Print/RPC 宿主。

因此扩展闭包、项目设置、模型目录与相对路径不会在跨 cwd 切换后继续指向旧目录。这是比“在 Session 上暴露 setCwd”可靠得多的
边界。

Tessera 的工作区由主进程授权并通过 capability closure 注入，已经避免 renderer 自由改根路径；仍可借鉴这个原则：
Workspace/Space 切换必须替换整个运行绑定，任何旧 capability、resource handle 和 approval context 都应失效。

## 5. 当前主链与下一代 Harness

### 5.1 当前可运行主链

```text
AgentSessionRuntime
  -> AgentSession
       -> Agent
            -> agentLoop
                 -> streamFn / ModelRuntime
                 -> AgentTool.execute
```

会话持久化、压缩、扩展和模型切换都在 `AgentSession` 周围发生；`Agent` 只接收已经组装好的 model、tools、messages、
systemPrompt 和 hooks。

### 5.2 `AgentHarness` 的目标形态

`AgentHarnessOptions` 已经定义：

- durable `Session`；
- `Models` 和当前 Model；
- active tools 与 tool context；
- system prompt/resource provider；
- retry/compaction/steering/follow-up；
- automatic/manual drive；
- telemetry context。

新 Session 模型进一步引入 lane、operation record、step attempt、tool started、queue record、usage record、pending write 和
stable Result/TaggedError。这表明 Pi 正试图把运行操作在开始时持久化，并为崩溃恢复、远端驱动与多 lane 做准备。

### 5.3 当前实现状态

固定提交中只有配置读取/修改、Session 查询和 close 等路径可用。以下关键路径都直接
`HarnessNotImplemented`：

- `prompt` / `skill` / `promptFromTemplate`；
- `compact` / `navigateTree` / `resume`；
- `abort` / steering / follow-up / nextRun；
- action drive、watch、lane 管理；
- 带已有 operation record 的 restore。

所以 `packages/coding-agent/src/server/create-harness.ts` 当前只能证明默认工具和 system prompt 可以适配到 Harness 接口，不能
证明 coding-agent 已经迁移到它。

## 6. Tessera 对照

| 领域 | Pi | Tessera 当前状态 | 结论 |
| --- | --- | --- | --- |
| Agent loop | 自研薄 `Agent`/`agentLoop` | AI SDK `ToolLoopAgent` 已实现 | 不重写；继续依赖标准 loop |
| 产品宿主 | `AgentSession` 可运行但职责过宽 | `agent-runtime.ts` + 主进程服务分担 | 继续拆服务，不合成巨型 Session |
| cwd 生命周期 | 切换会话时整体重建 cwd-bound services | Workspace capability 由主进程闭包绑定 | 增加显式失效/冻结测试 |
| 持久运行 | 旧 JSONL 可恢复消息树；新 Harness 仍 scaffold | SQLite run/event 与重启中断恢复已实现 | Tessera 当前事实层更适合产品运行 |
| 执行环境 | 旧工具本机实现；新 `ExecutionEnv` 可替换 | `@tessera/agent-runtime` 已有宿主无关文件端口 | 延续端口化，未来再引入脚本执行环境 |
| 嵌入 | SDK/RPC/TUI 共用 Session | Electron IPC + AI SDK stream | 保留单一 runtime 语义 |

## 7. 可采纳与不采纳

### 可采纳

- 目标 cwd 决定后再构造所有运行服务。
- Session replacement 先停止旧运行，再令旧 capability/context 失效。
- 产品入口只做协议和 UI 适配，共用同一运行对象。
- 用 typed operation/result/error 表达 expected failure。
- 将文件/Shell 后端抽为 `ExecutionEnv`，但把权限留在宿主。

### 不采纳

- 把所有产品状态集中到一个 `AgentSession` 类。
- 因 Harness 接口看起来完整就提前迁移生产主链。
- 用 Project Trust 替代运行权限、审批或隔离。
- 为追求本地可移植而把 JSONL 作为 Tessera 的主事务事实源。

## 8. 研究推断

Pi 的演进方向不是继续给 `AgentSession` 加方法，而是在 `agent-core` 中建立 durable action machine。这个方向验证了 Tessera
现有“薄 Kernel + 宿主不变量”的判断；但 Pi 的未完成状态也说明，可靠恢复不能只靠漂亮接口，必须验证 operation 开始、工具
副作用、重放安全、queue 消费和结束提交之间的每个 crash point。
