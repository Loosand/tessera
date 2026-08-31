# Tessera 吸收 Pi Agent 设计路线图

> 研究输入：Pi 固定提交 `853a80d26c90a14c1886f0ebb8ffaae133ca2185` 的九个 Agent 专题源码分析
>
> Tessera 基线：当前工作区源码与 `docs/architecture/`
>
> 本文性质：研究结论与实施建议，不自动把建议升级为 Tessera 已实现架构事实

## 1. 总结判断

Pi 对 Tessera 最有价值的不是“用更少代码做一个 coding agent”，而是证明了一组分层原则：

- Agent loop 可以只负责 model -> tool -> model；
- 产品消息和 Provider message 可以分离；
- 会话完整历史、当前 branch 与当前 context projection 可以分离；
- active tools、system prompt 与下一 turn 可以动态协调；
- Interactive、RPC、JSON、SDK 可以复用同一 Session 语义；
- 文件/Shell 工具可以依赖可替换 operations/ExecutionEnv；
- steering 与 follow-up 是不同的运行控制语义。

Pi 也展示了“薄 Kernel”最容易掩盖的成本：所有复杂度会进入宿主。当前 `AgentSession` 同时承担产品编排、持久化、压缩、重试、
扩展、模型、Skills、工具、Bash 和树导航；任意扩展同进程执行并可改 Provider/context/tool；默认工具继承用户权限；旧 Session
主要恢复对话树，不恢复进行中的 durable operation。

Tessera 当前已经具备比 Pi 更适合桌面知识工作产品的底座：

- AI SDK `ToolLoopAgent` 与标准 Tool Part；
- 类型化 `TaskRunPolicy` 和逐 step `prepareCall/prepareStep`；
- ContextManifest 分项估算与出站前预算阻断；
- SQLite `task_runs` 与有序 events；
- renderer 无 Node、主进程窄能力；
- workspace 相对路径、分页读取、人工审批、base hash、冲突复核和原子写；
- Skill 托管导入、MCP trust/secrets/逐次审批；
- 运行错误、工具错误和实际 usage 的公开脱敏协议。

所以路线图不是迁移到 Pi runtime，而是：

```text
保留 AI SDK Kernel
  -> 明确 Run Controller 与 Capability Snapshot
  -> 建 Context Compiler 和 projection marker
  -> 补运行中输入与 branch 语义
  -> 抽工具/资源 adapter
  -> 在可靠副作用边界之上评估 durable resume
```

## 2. 采纳矩阵

| Pi 设计 | 采纳结论 | Tessera 落点 |
| --- | --- | --- |
| 薄 `Agent`/agentLoop | 采纳原则，不采纳实现 | 继续使用 AI SDK `ToolLoopAgent` |
| `prepareNextTurn` 动态刷新 | 有条件采纳 | `prepareCall/prepareStep`；run 上限冻结、step 只收窄 |
| 产品消息 -> LLM 消息转换 | 采纳 | Context Compiler / projection adapter |
| JSONL append-only tree | 采纳树和投影思想，不采纳主存储 | SQLite message/event parent relation |
| compaction marker + retained tail | 采纳 | 版本化 ContextProjection/CompactionRecord |
| steering/follow-up 双队列 | 采纳协议语义 | 运行控制命令与持久事件 |
| AgentSession 巨型聚合 | 拒绝 | 拆 Run/Context/Capability/Repository/Projection |
| ExtensionRunner 全面 hook | 只采纳冲突诊断和失效 | 不开放任意同进程策略插件 |
| Skill catalog + 按需全文 | 采纳 | L0/L1/L2 Skill 资源模型 |
| read/edit/write operations 分离 | 采纳 | `@tessera/agent-runtime` 与 AI SDK adapter |
| 默认 Bash/绝对路径/直接覆盖 | 拒绝 | 独立受控脚本 capability，保持审批和 workspace scope |
| Project Trust | 仅作资源装载信任 | 不替代权限、审批、sandbox |
| ModelRuntime generation guard | 采纳 | catalog/probe/credential synchronization |
| AgentHarness durable records | 观察并吸收 schema 思路 | 不依赖未完成实现，不提前迁移 |
| RPC 内部 Session ABI | 采纳 command/result 分离，不采纳耦合面 | 版本化公开 Run protocol |

## 3. 当前能力基线

| 领域 | Tessera 状态 | 已有能力 | 对照 Pi 后的缺口 |
| --- | --- | --- | --- |
| Agent Kernel | 已实现 | ToolLoopAgent、动态工具、停止条件、repair、标准流 | 产品特例仍较多，缺 capability registry |
| Run 策略 | 部分实现 | TaskRunPolicy、工具 scope、Skill/研究阶段路由 | 缺不可变 capability/model/resource snapshot |
| Context | 部分实现 | 每 step ContextManifest、分项估算、超限阻断 | 缺查询/排序/摘要/裁剪和 projection marker |
| 运行持久化 | 已实现主链 | task_runs、ordered events、inspection、中断恢复 | 缺 durable operation/action 与 replay classification |
| 会话 branch | 未开始 | Task/session/message identity 已有 | 缺 parent/leaf/branch summary 协议 |
| 运行中输入 | 未开始 | 有结构化提问和审批 | 缺 steer/follow-up queue |
| 文件能力 | 部分实现且边界较强 | 有界读、搜索、审批、版本冲突、原子写 | 缺确定性 patch/edit tool |
| 脚本/Shell | 规划 | 架构已要求固定入口、白名单和审批 | 缺隔离执行器与产物协议 |
| Skills | 部分实现 | 托管导入、启停、run 选择、正文 instructions | 缺 L2 resources/assets/scripts 路由与版本 |
| 扩展/MCP | 部分实现 | MCP trust/secrets/逐工具启停/审批 | 缺统一 descriptor/snapshot，不应增加任意代码 hook |
| 模型 | 部分实现 | 类型/模态/能力三态、endpoint binding、实际模型持久化 | probe generation、route snapshot、partial-success 错误 |
| UI 投影 | 部分实现 | 标准 Part、工作过程、审批、run explanation | 缺常驻 Context/Projection/Compaction/Branch 解释 |

## 4. 目标边界

```text
TaskSession
  ├─ MessageTree / BranchPointer
  └─ TaskRun
       ├─ FrozenRunContext
       │    ├─ ModelRouteSnapshot
       │    ├─ CapabilitySnapshot（上限）
       │    ├─ ResourceBinding[]
       │    ├─ AuthorizationSnapshot
       │    └─ ContextPolicy
       │
       ├─ RunController
       │    ├─ model step
       │    ├─ steer / follow-up queue
       │    ├─ retry / compact
       │    └─ abort / effects draining
       │
       ├─ ContextCompiler
       │    ├─ ContextProjection
       │    └─ ContextManifest
       │
       ├─ ExecutionGateway
       │    ├─ Capability Adapter
       │    ├─ approval / version / lease
       │    └─ bounded ToolResult
       │
       └─ Ordered RunEvent Ledger
            ├─ conversation projection
            ├─ execution projection
            ├─ context/compaction projection
            └─ diagnostic projection
```

关键不变量：

1. `TaskSession` 是会话容器，不是权限容器。
2. Run 开始后 capability/model/resource 上限冻结；阶段策略只能收窄。
3. ContextProjection 可丢失，完整事实不可被 summary 覆盖。
4. UI event、领域 event、Provider message 是不同投影。
5. abort 模型流不代表副作用结束；terminal 前处理 effects draining。
6. third-party instruction/code 不能扩大授权。

## 5. P0：先拆运行边界，不加新自治

### P0-A：`FrozenRunContextV1`

#### 目标

把目前分散在 `TaskRunPolicy`、模型 route、资源摘要、Skill、MCP/工作区工具装配中的当轮事实合并为主进程生成的不可变快照。

#### 最小字段

```ts
type FrozenRunContextV1 = {
  version: 1
  identity: { taskId: string; requestId: string; userTurnId: string }
  model: ModelRouteSnapshot
  policy: TaskRunPolicy
  capabilities: CapabilitySnapshot[]
  resources: ResourceBindingSnapshot[]
  authorization: AuthorizationSnapshot
  contextPolicy: ContextPolicySnapshot
}
```

#### 验收

- settings/Skill/MCP/workspace 在运行中变化不扩大当前 run 权限；
- inspection 能展示脱敏实际快照；
- restart 后旧 run 仍按当时 version 解释；
- renderer 不能提交绝对路径、Secrets 或最终工具集合。

### P0-B：Run Controller 状态拆分

#### 目标

避免 `agent-runtime.ts` 演进为 Pi 式 `AgentSession`。先定义状态机和端口，不要求立刻搬文件：

```text
preparing -> running -> awaiting-input/approval
          -> compacting/retrying
          -> cancelling -> effects-draining
          -> completed/failed/cancelled/interrupted
```

#### 验收

- 模型完成、tool effects、event flush、message save 分别有收口测试；
- retry 不重放已提交副作用；
- abort 后迟到 ToolResult 不能更新已失效 run，但进入审计；
- Context、Capability、Repository 和 UI projection 不通过一个巨型类互相访问私有状态。

### P0-C：Capability Registry V1

#### 目标

统一内建工具、Skill、MCP 和领域 command 的最小描述符，不移动执行实现：

```ts
type CapabilityDescriptor = {
  id: string
  kind: "tool" | "skill" | "mcp" | "workflow" | "script"
  summary: string
  source: CapabilitySource
  requiredPermissions: string[]
  resourceKinds: string[]
  sideEffect: "none" | "reversible" | "commit"
  resultBudget: ResultBudget
}
```

#### 验收

- active tool 与 prompt guideline 同源；
- 同名冲突有稳定 owner/diagnostic；
- Run Inspector 区分 installed/enabled/visible/used；
- descriptor 只服务发现和策略，不自动授权。

## 6. P1：Context Compiler 与压缩闭环

### P1-A：ContextProjection V1

#### 目标

把现有 ContextManifest 从“估算与拒绝”提升为“有界编译结果”。编译优先级：

1. 安全约束和当前用户请求；
2. 未完成审批、结构化提问和领域状态；
3. 最近消息与当前文档；
4. 当前 Skill 和 active tool schemas；
5. 相关证据、历史 summary、bounded tool results；
6. 次要背景。

#### 验收

- 不破坏 tool call/result、citation/evidence、approval request/response 配对；
- manifest 记录每类预算、移除/摘要原因，不保存正文；
- Provider payload 可在开发诊断中脱敏复核；
- current projection 可由事实源重新生成。

### P1-B：CompactionRecord V1

#### 字段

- source message/event range；
- previous summary reference；
- retained tail；
- summary model/usage；
- unresolved items；
- Artifact/approval/tool result refs；
- projection version 和裁剪原因。

#### 验收

- compaction 不删除原消息、run event、证据或文档；
- “已完成/已写入”只来自结构化成功事实；
- 手工、threshold、overflow 三种原因区分；
- overflow 最多 retry 一次，且不重复写入工具；
- 摘要失败不会损坏当前会话投影。

### P1-C：ToolResult reducer

为 read/search/MCP/research/write/content command 分别生成：

- 模型用 bounded summary；
- UI 用结构化 detail；
- 审计用脱敏事实；
- Artifact/resource 引用。

不采用 Pi 的统一“每个 tool result 取前若干字符”作为长期策略。

## 7. P1：运行中输入与会话树

### P1-D：Steer / Follow-up 协议

#### 语义

- steer：当前工具批次结束、下一模型 step 前消费；
- follow-up：当前 run 正常走到无工具/steer 后消费；
- request-user-input/approval：运行主动暂停等待，不属于两种普通 queue。

#### 持久事件

```text
queue-enqueued
queue-cancelled
queue-consumed
queue-cleared-by-abort
```

#### 验收

- 重启/abort 后不会把旧 queue 消息投给错误 run；
- UI 清楚显示“纠偏当前运行”和“排队下一请求”；
- tool call/result 中间不插入普通消息；
- queue item 有稳定 ID 和 actor。

### P1-E：Message tree 基础模型

若真实用户场景确认需要 branch，再为 message/summary 建 parentId 和 branch pointer。首版只做：

- 从旧节点创建新 leaf；
- 原分支不删除；
- branch label；
- 不自动生成摘要。

不要同时引入 multi-lane Agent。先验证用户是否真正使用分支，而不是把 Pi 的终端工作流直接映射到 Tessera。

## 8. P2：工具与执行环境

### P2-A：确定性 `propose-workspace-edits`

吸收 Pi `edit` 的优点：一组基于同一原始版本、不重叠、唯一匹配的 edits。不同点：

```text
tool input edits + base hash
  -> 主进程解析完整候选
  -> 生成 Diff/Proposal
  -> 用户批准
  -> canonical target queue
  -> 再次 version check
  -> atomic apply
```

模型不直接写磁盘，edit 失败不产生半修改。

### P2-B：Skill L2 Resource Router

- references 按片段读取；
- assets 以稳定 resource ID 传递；
- templates 由明确 renderer 处理；
- scripts 只通过下一项 runner；
- 每个资源绑定 source/hash/version/usage event。

### P2-C：受控 Script Runner

只有在以下边界完成后实现：

- 固定已导入 skillId/scriptId，不接受任意命令字符串；
- 参数 schema；
- 固定 runtime 与只读 Skill 目录；
- 临时输出目录；
- cwd/环境变量/网络/工作区写入白名单；
- timeout、输出预算、进程树终止；
- 逐次审批与产物 manifest；
- run lease 和迟到副作用处理。

Pi 的 `ExecutionEnv` 可作 adapter 参考，但 Tessera 不向模型暴露通用 FileSystem/Shell。

## 9. P2/P3：Durable operation 与远端入口

Pi AgentHarness 的 operation records 值得作为 failure matrix 输入：

```text
operation_started
step_attempt
tool_started(replay=safe|never)
abort_requested
queue_enqueued
operation_finished
usage
```

Tessera 已有 Run/Event 主链，后续只在真实后台/automation/remote runner 需要时补：

- action intent record；
- replay classification；
- idempotency key；
- execution lease；
- suspended/deferred handle；
- resume decision。

不以“AgentHarness 已公开”为迁移理由。必须等 Pi 或 Tessera 自身通过 crash-point 测试后再扩大自动恢复。

## 10. 模型运行时改进

### P1/P2：Catalog generation 与 route snapshot

- catalog/probe 每次刷新带 generation；
- 迟到发布不能覆盖新连接；
- credential commit 与 runtime sync 返回 partial-success；
- run 记录 connection、endpoint binding、provider/model、capability evidence、catalog version；
- fallback 必须显示并进入 inspection。

Pi 的 pattern/alias 适合 CLI；Tessera 产品关系始终使用 stable ID，只有导入时解析文本名称。

## 11. 明确不采纳

### 11.1 不重写 Agent loop

AI SDK 已提供 Pi loop 对应能力，并额外承载 Tessera 的标准 UI Part、`needsApproval`、Provider 兼容和 Telemetry。重写会形成第二套
事实和测试面。

### 11.2 不默认开放 Bash

任意 command、绝对路径、继承环境和默认无 timeout 与 Tessera 安全边界冲突。即使未来有 sandbox，Shell 也只属于明确
capability pack。

### 11.3 不复制同进程 Extension API

不允许第三方代码任意修改 Provider payload/header、工具参数/结果、Session 和 UI。Skills、MCP、Script、Domain command 使用
各自受控协议。

### 11.4 不把 Project Trust 当权限

资源安装信任、模型工具可见、具体调用批准和 OS 隔离必须分别建模。

### 11.5 不把 JSONL 变成主事实源

可提供脱敏、版本化的 Session 导出；运行事务、审批、事件、资源和 Artifact 仍由 SQLite/Markdown 事实层管理。

### 11.6 不先做 multi-lane / swarm

Pi 新 Harness 的 lane 仍未实现，Tessera 当前更需要单 Run 的 context、branch、cancel 和副作用闭环。多 Agent 继续走有界 child run，
不从 lane 接口反推产品需求。

## 12. 依赖顺序

```text
P0-A FrozenRunContext
  ├─ P0-B RunController 状态
  ├─ P0-C CapabilityRegistry
  │    ├─ P1-A ContextProjection
  │    │    ├─ P1-B CompactionRecord
  │    │    └─ P1-C ToolResultReducer
  │    └─ P2-B Skill Resource Router
  │         └─ P2-C Script Runner
  │
  ├─ P1-D Steer/Follow-up
  └─ P1-E Message Tree

P0-B + P1-C + reliable effects-draining
  -> P2/P3 Durable Operation / Remote / Automation

现有文件审批链
  -> P2-A propose-workspace-edits
```

## 13. 近期最小交付切片

### 切片一：冻结并解释本次 Run

- 持久化 FrozenRunContextV1；
- Run Inspector 展示实际 model、Skill、capabilities、resources、approval policy；
- 工具中途 reload 不扩大当前 run。

这是后续所有 Pi 设计输入的共同前置。

### 切片二：Context Projection 可解释化

- 把当前 ContextManifest 与实际选择的 context sections 关联；
- 对 read/search/tool result 增加 reducer；
- UI 显示“保留、摘要、移除”的类别和原因，不展示正文。

### 切片三：受控压缩

- 只支持手工 compaction；
- summary + retained tail + source range；
- 不做自动 overflow retry；
- 先验证事实一致性和回放。

### 切片四：运行中 follow-up

- 先只实现 follow-up，不实现 steer；
- 当前 run 结束后创建明确下一 run；
- queue item 持久化并可取消。

steer 会改变当前 run 的解释和权限快照，放在 follow-up 证明稳定之后。

## 14. 跨阶段验证矩阵

| 场景 | 必须验证 |
| --- | --- |
| tool call 因 length 截断 | 不执行任何不完整副作用 |
| 并行工具乱序完成 | UI 可实时，Provider/tool result 配对不乱 |
| tool 完成、result 未持久化时崩溃 | replay policy 明确，commit 工具不重复 |
| compaction 中崩溃 | 原始事实完整，可回到旧 projection |
| summary 幻觉“写入成功” | 结构化事件覆盖摘要声明 |
| workspace 切换 | 旧 capability/approval/resource handle 全失效 |
| settings/Skill/MCP 中途变化 | 当前 run 权限不扩大 |
| abort 后工具迟到 | 进入 effects-draining/audit，不污染终态消息 |
| extension/Skill 同名工具 | owner 可解释，冲突不静默覆盖 |
| Provider catalog 迟到刷新 | generation guard 阻止旧结果覆盖 |
| credential 已提交、同步失败 | 显示 partial-success，不误报未保存 |
| branch summary | tool call/result、approval、artifact 保持配对 |

## 15. 最终判断

Pi 对 Tessera 的最佳价值是一个“反复杂度参照”：Kernel 越薄，宿主越需要清楚的 Run、Context、Capability、Session 和
Execution 边界。Pi 当前主链证明了动态工具、追加树、压缩、steering、RPC 和 Skills 可以围绕薄 loop 工作；它的
`AgentSession` 债务和未完成 Harness 又证明，若这些边界没有早期拆开，下一步 durable/remote/multi-lane 会迫使系统重构。

Tessera 应利用现有 AI SDK、SQLite、审批和领域端口优势，吸收 Pi 的运行语义，不追随它的本机信任模型，也不等待或依赖其
Harness 实现。研究结论只有在对应设计同步进 `docs/architecture/` 并通过代码验收后，才成为 Tessera 的架构事实。
