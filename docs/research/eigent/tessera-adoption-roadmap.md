# Tessera 吸收路线图

> 研究输入：Eigent 固定提交 `d3089558c6e0021eed58270b49893835b02ec4e9` 的十二个专题源码分析
>
> Tessera 基线：当前工作区源码、`design.md` 与 `docs/architecture/`
>
> 本文性质：研究结论与实施建议，不自动把“建议”升级为 Tessera 已实现架构事实

## 1. 总结判断

Eigent 最值得 Tessera 学习的是完整的 Agent 产品对象和反馈闭环，而不是 Python/CAMEL 技术栈：

- Space/Project 给任务稳定工作范围；
- Run/Task 把一次执行从聊天消息中独立出来；
- Progress 让用户理解目标进度；
- Execution Context 让能力与资料可见；
- Agent Folder/Preview 让产物在执行中可检查；
- Workforce 把委派与并行显性化；
- Skill/MCP 把能力扩展做成可管理对象；
- Browser、Trigger 与 Remote Control 把 Agent 扩展到长期任务和外部系统。

Eigent 同时展示了原型走向长期产品时最容易积累的债务：renderer、Electron main、本地 Brain、远端 Server 和文件系统
各保存一部分事实；同一配置有多份副本；UI 从日志、消息和目录轮询反推运行状态；浏览器预览、Agent CDP target 与 Cookie
profile 缺少同一 identity；Trigger 把 Pub/Sub 投递误当成唯一执行；附件把 raw path 当资源；多 Agent 复制过宽权限。

Tessera 当前不需要追赶“功能入口数量”。它已经具备更适合作为底座的能力：

- TypeScript 单主 Agent runtime；
- Electron renderer 无 Node、窄 IPC；
- 主进程解析路径、Secrets 和工具；
- SQLite `task_runs` 与有序 run events；
- 每轮冻结 RunPolicy 与资源摘要；
- AI SDK 标准 Tool Part、审批与中止；
- Markdown 工作区、正式 Artifact、写入 Diff/版本复核/原子应用；
- 模型类型、模态、能力三态与 endpoint binding；
- MCP 安全配置与用户 Skill 托管导入。

因此路线图的主线应是：

```text
先统一 Run 事实
  → 再把事实做成 Run Inspector
  → 再补资源、计划、产物和上下文预算
  → 再引入浏览器与有界委派
  → 最后让自动化和远程执行复用同一 Run
```

不是先分别实现一个 Browser 页、Workforce 页、Schedule 页和 Memory 页，再想办法把它们接回聊天。

## 2. 优先级方法

本路线图按五个维度排序：

1. **事实先于投影**：没有稳定 identity/event 的能力，不先做漂亮 UI；
2. **权限先于自治**：资源 scope、approval、lease 未闭环，不增加自动执行深度；
3. **复用先于分叉**：所有入口最终创建标准 Tessera Run，不建立第二套 Agent runtime；
4. **可恢复先于并行**：单 Run 的取消、重启、迟到副作用未可靠，不上多 Agent/多设备；
5. **用户价值先于拓扑复杂度**：先给用户可检查的进度、上下文和产物，再做 Agent 图与画布。

优先级含义：

| 等级 | 含义 |
| --- | --- |
| P0 | 后续多个领域共同依赖；不完成会形成新事实分叉 |
| P1 | 可独立交付明显用户价值，并为高阶 Agent 能力建立协议 |
| P2 | 在 P0/P1 之上扩展自治、输入类型或执行资源 |
| P3 | 需要真实用例与运营基础后再投入，避免架构先行 |

## 3. 当前能力基线

| 领域 | Tessera 当前状态 | 已有优势 | 关键缺口 |
| --- | --- | --- | --- |
| 系统边界 | 已实现主骨架 | 单 Electron 主控、窄 IPC、renderer 无 Node | 统一不可变 RunContext 仍需显式化 |
| 模型/供应商 | 部分实现 | 品牌/协议/连接/模型分层，能力三态、模态、类型、endpoint binding | 连接级 probe、版本化 catalog、retired/replacement |
| Agent runtime | 部分实现 | AI SDK `ToolLoopAgent`、动态 tools、标准 Part、取消/恢复 | Capability resolution、effects-draining、通用计划 |
| 运行观测 | 部分实现 | Run/event 持久化、实际模型/工具/usage、消息级检查 | 常驻 Inspector、计划/资源使用/Artifact 事件 |
| Skills | 部分实现 | 标准 `SKILL.md`、托管导入/扫描、启停、RunPolicy、渐进加载 | 版本/更新、workspace scope、附属资源、评测 |
| MCP | 部分实现 | 三种传输、Secrets、信任、发现、逐工具停用、逐次审批 | Run 快照、Resources/Prompts、OAuth、usage/audit |
| 工作区/文件 | 部分实现且边界较强 | Markdown 事实源、主进程路径解析、写入 Diff/复核/原子写 | Run Artifact Manifest、overlay transaction、多文件批次 |
| 附件/资源 | 部分实现 | 图片/当前文档、resource summary、动态资源关系 | 通用托管附件、版本/hash、解析、usage/citation |
| 研究/RAG | 领域研究已实现；通用 RAG 未开始 | 网页 source/evidence/finalization 有 provenance | parser/chunk/index/retrieval/citation 通用链 |
| Context/Compaction | 未形成通用链 | 模型上下文与输出事实已存在 | 输入预算、压缩 marker、分层摘要、工具结果瘦身 |
| 长期 Memory | 未开始 | SQLite 与领域状态适合作为控制层 | 候选/确认/provenance/scope/删除与 UI |
| 浏览器/CDP/Cookie | 低权限网页读取已实现；交互浏览器未开始 | Research Web Reader 有受控网络边界 | BrowserSession/Context/Target、身份、下载与预览 |
| 委派/多 Agent | 窄的只读研究委派部分实现 | 子 Agent 已作为标准 tool 接入 | 通用 DelegationTask、child run、预算/权限/投影 |
| 调度/Trigger | 未开始 | 标准 Run、SQLite、审批、资源绑定可复用 | Invocation、RunRequest、Lease、后台调度、幂等 |
| UI/进度审查 | 部分实现 | 对话、Artifact tray、Run popover、Diff review | Run selector、常驻 Progress/Context/Files/Pending |

这张表的含义不是“缺的都要做”。后续每个阶段都必须以真实用户场景、失败注入和权限验证决定是否继续。

## 4. 目标对象图

所有专题应收敛到以下对象关系：

```text
Workspace / Project
    │
    ├── ContextResource ── ResourceVersion ── IndexGeneration
    │          │                  │                 │
    │          └──── RunResourceBinding ── ResourceUsageEvent ── Citation
    │
TaskSession ── UserTurn
    │
    └── TaskRun
          ├── FrozenRunContext
          │     ├── ModelRoute + EffectiveCapabilities
          │     ├── CapabilityRef[] (native / Skill / MCP / browser)
          │     ├── ResourceBinding[]
          │     ├── ApprovalPolicy
          │     ├── ContextBudgetPolicy
          │     └── ExecutionLeaseRef?
          │
          ├── Ordered RunEvent Ledger
          │     ├── conversation projection
          │     ├── plan/progress projection
          │     ├── execution-context projection
          │     ├── artifact/approval projection
          │     └── diagnostics projection
          │
          ├── Plan / PlanStep
          ├── ToolCall / Approval
          ├── RunArtifactManifest
          ├── DelegationTask ── ChildRun
          ├── BrowserSessionRef
          └── MemoryCandidate

AutomationDefinition ── Invocation ── RunRequest ── ExecutionLease ── TaskRun
```

关键约束：

- `TaskSession` 是用户对话容器，不是权限容器；
- `TaskRun` 是一次实际执行事实；
- `FrozenRunContext` 只在 Run 开始时解析，设置变化只影响下一 Run；
- Capability 的安装/启用/本 Run 可见/实际使用是四种状态；
- Resource 的附加/可用/读取/检索命中/引用/产出是六种状态；
- Artifact 是 Run 显式产物，不等于目录中碰巧出现的文件；
- ChildRun、ScheduleRun 和远程 Run 仍是标准 TaskRun；
- renderer 只消费投影，不解析路径、Secrets、tool log 或目录归属。

## 5. 横向不变量

### 5.1 Identity

跨领域引用必须使用稳定 ID：

- taskId、requestId/runId、userTurnId；
- resourceId、resourceVersionId、bindingId；
- capabilityId、serverId、toolId、skillVersionId；
- planId、stepId、delegationId、artifactId、approvalId；
- browserSessionId、browserContextId、targetId；
- automationId、invocationId、runRequestId、lease token。

展示序号、模型名、文件名、server name、Agent name 都不是关系键。

### 5.2 Snapshot 与版本

历史必须按当时事实解释：

- 模型 catalog 更新不回写旧 Run；
- MCP/Skill 启停不改变旧 Run 的 capability snapshot；
- 文件修改不改变已绑定 ResourceVersion；
- Browser Cookie 变化不修改旧 Run 的 identity/授权记录；
- Automation 更新创建 definition version，旧 Invocation 保留旧版本；
- Memory fact 修订保留 provenance 与 superseded relation。

### 5.3 Event

Run 事件需要满足：

- task/run/sequence 唯一；
- 可重复读取和从 `afterSequence` 续订；
- schema version 与稳定公开错误；
- 不保存 prompt、完整正文、Secrets 或不受限工具输出；
- 领域事件不复制 AI SDK 已经有的 token/tool delta；
- UI projection 可从快照 + event 重建；
- live animation 可以有本地缓冲，但不能改变领域状态。

### 5.4 Permission

权限解析为交集：

```text
应用能力上限
∩ 用户配置/信任
∩ Workspace/Resource 授权
∩ Skill 声明需求
∩ 模型/endpoint 实际能力
∩ 本 Run policy
∩ 自动化 permission envelope（若有）
∩ child delegation scope（若有）
```

任何一层都只能收窄。Skill、MCP annotation、Agent 自述和模型输出均不能扩大权限。

### 5.5 Side effect

所有副作用工具至少关联：

- run/lease identity；
- toolCallId；
- approvalId 或预授权依据；
- target resource version/base hash；
- idempotency key；
- result/commit state；
- late-result handling。

取消模型流不等于取消外部副作用。执行器需要 `active → cancelling → effects-draining → terminal` 的可解释状态，迟到结果
必须经过当前 run/lease/version 复核。

## 6. 依赖图

```text
P0-A Frozen RunContext + CapabilityRef
 ├── P0-B Run Event Taxonomy / Projection API
 │    ├── P0-C Run Inspector V1
 │    ├── P1-A Plan / Pending Actions
 │    ├── P1-B Resource Usage / Artifact Manifest
 │    ├── P2-E Delegation / Agent Pool
 │    └── P3-B Automation / Lease
 │
 ├── P1-C Model Capability Probe + Catalog Version
 ├── P1-D MCP/Skill Run Snapshot
 ├── P2-A Context Budget / Compaction
 └── P2-D BrowserSession Identity

P1-B Resource Versioning
 ├── P2-C General Attachments / Parser
 │    └── P3-A RAG / Citation
 ├── P2-D Browser Downloads/Uploads
 └── P3-C Trigger Payload Resources

P1-A Plan + P0-B Events
 └── P2-E Bounded Delegation
      └── P3-D Multi-Agent DAG / Workforce UI（仅在证据充分时）

P0-A + P0-B + reliable cancellation
 └── P3-B Automation / RunRequest / Lease
      └── P3-C Webhook / Remote Runner
```

这意味着 Browser、Workforce 和 Schedule 可以分别做 UI prototype，但不能进入正式自动执行主链，直到共享 identity、event、
resource 和 lease 完成。

## 7. P0：统一 Run 事实与可见审查

### P0-A：显式 `FrozenRunContext`

#### 目标

把目前分布在 `TaskRunPolicy`、资源摘要、model route、动态 tool assembly 和调用参数中的当轮事实，合并成一个主进程生成、
可版本化、可脱敏持久化的上下文。

#### 建议字段

```ts
type FrozenRunContextV1 = {
  version: 1
  identity: { taskId: string; requestId: string; userTurnId: string }
  model: ModelRouteSnapshot
  capabilities: CapabilitySnapshot[]
  resources: RunResourceBindingSnapshot[]
  approvalPolicy: ApprovalPolicySnapshot
  contextBudget: ContextBudgetSnapshot
  workspace: WorkspaceBindingSnapshot | null
  browser: BrowserBindingSnapshot | null
  invocation: InvocationRef | null
  parentRun: ParentRunRef | null
  resolvedAt: number
}
```

公开 inspection 只返回安全摘要；完整内部 snapshot 也不能包含 API Key、Cookie、明文 MCP env、绝对路径或附件正文。

#### 迁移策略

- 保留现有 RunPolicy/resource summary 列兼容历史；
- 新 Run 双写新 snapshot 与必要的查询列；
- read projector 对历史输出 `coverage=partial`；
- 稳定后再决定是否迁移旧列，不在同一改动强制重写历史数据。

#### 验收

- renderer 只提交 `configId/modelId` 和稳定选择，不提交 key/base URL/path；
- 运行中停用 MCP、修改 Skill 或切换工作区不会改变本 Run snapshot；
- 旧 Run 在 catalog/config 更新后仍能解释当时的有效能力；
- snapshot schema 有 round-trip、redaction、历史兼容测试。

### P0-B：事件分类与投影 API

#### 目标

在现有 AI Chat 有序事件旁增加少量领域事件，覆盖现有 Part 无法表达的计划、资源使用、Artifact、委派和上下文压缩。

#### 事件集合第一版

```text
run.context.resolved
run.status.changed
plan.published / plan.step.changed / plan.revised
resource.bound / resource.read / resource.cited
capability.loaded / capability.used
artifact.proposed / artifact.applied / artifact.rejected / artifact.conflicted
approval.requested / approval.decided
context.compacted
delegation.created / delegation.status.changed
```

并非一次全部实现。先定义 envelope、version、identity、sequence 和公共错误，再按专题增加 payload。

#### 投影边界

- `conversation projection` 继续由 AI SDK UIMessage/Tool Part 构建；
- `RunInspectionProjection` 只聚合安全摘要；
- `diagnostics projection` 有有限保留且默认不可见；
- 原始正文和工具大输出不复制进事件 ledger；
- renderer 不把事件重新保存成第二个持久 store。

#### 验收

- 应用重启后投影与运行结束前 UI 语义一致；
- 事件乱序/重复/损坏有测试；
- 15k+ delta 的真实研究运行不让 renderer 每事件全量重算；
- `afterSequence` 订阅可以补齐断线区间；
- 旧版本未知事件被跳过且 coverage 明示 partial。

### P0-C：Run Inspector V1

#### 用户切片

只用现有事实先交付：

- 任务内 Run selector；
- 状态、实际 provider/model；
- Skill、联网、reasoning、tool scope；
- 工作区、当前文档、附件数量；
- 实际工具调用、失败、拒绝；
- finish/failure、duration、token/cache；
- 历史 coverage 提示；
- 消息 info icon 打开并定位完整 Inspector。

#### UI 位置

- 宽任务页：右侧常驻 360–400 px，可折叠；
- 文档 AI Sidebar：顶部状态按钮打开 overlay Inspector，不与 380 px 对话并排常驻；
- 窄屏：全屏 sheet；
- “回到实时”与用户固定历史 Run 显式区分。

#### 暂不做

- 不展示假的 Progress；
- 不把附件列表称为已引用；
- 不轮询工作区目录生成 Agent Folder；
- 不上空 Browser/Canvas/Review Tab；
- 不做自由 JSON 事件查看器。

#### 验收

用户能在不看开发日志的情况下回答：这次实际用什么模型、是否联网、能访问什么、哪些工具失败/被拒绝、为何结束。

## 8. P1：计划、资源、产物和扩展事实

### P1-A：统一 Plan 与 Pending Actions

#### 背景

Tessera 的研究工作流已有显式 plan，其他任务没有通用 plan。Eigent 证明 Progress 很有价值，也证明从 task store 降格成
完成/未完成会误导。

#### 方案

- 抽象稳定 `Plan/PlanStep`，但允许简单任务完全无计划；
- 研究 plan 适配为同一 projection，不丢失研究领域字段；
- step 状态至少支持 pending/running/waiting-input/blocked/completed/failed/skipped/cancelled；
- approval、request-user-input、conflict 独立聚合为 Pending Actions；
- inline card、Inspector 和未来 Agent graph 共用 stepId。

#### 验收

- 状态不由 reasoning 文本推断；
- step 变化有 actor、time、reason；
- 点击 Inspector step 能定位对话中的计划/结果；
- 等待用户输入与失败在折叠状态仍可见；
- 无计划的短问答不制造三个假步骤。

### P1-B：Resource Version、Usage 与 Artifact Manifest

#### 背景

这是附件、RAG、Browser 下载、Execution Context、Agent Folder 和自动化 payload 的共同底座。

#### 第一版范围

- 将当前文档与现有图片输入映射到 `ContextResource/ResourceVersion`；
- Run 开始建立 `RunResourceBinding`；
- 工具读取时记录 `resource.read`；
- 正式 Artifact 写 `RunArtifactManifest`；
- 写入审批关联 artifact/toolCall/base hash；
- UI 区分 Attached/Available/Used/Cited/Produced。

#### Artifact 状态

```text
proposed → awaiting-approval → applied
                         ├── rejected
                         ├── conflicted
                         └── failed
```

目录发现但没有 writer/toolCall 的文件标为 `unowned-change`，不能归入当前 Run。

#### 验收

- 历史 Run 打开同一 ResourceVersion；
- current document 变更不会静默改写旧 Run；
- Inspector 文件列表不会串入其他 Run；
- Artifact 可以追到产生工具、审批和最终 hash；
- 删除/冲突/拒绝不伪装成成功产物。

### P1-C：模型能力 Probe 与 catalog 生命周期

#### 首批 Probe

1. 最小文本/认证；
2. 单 tool call 与 tool result 续轮；
3. structured output；
4. image input；
5. provider-native web search endpoint 与 source parts。

结果使用 `supported/unsupported/inconclusive/failed`，记录 connection/model/endpoint/adapter version/test time。网络失败不写
unsupported，用户显式 override 不被 probe 擅自覆盖。

#### Catalog

- builtin registry 版本；
- controlled update；
- retired/replacement；
- remote `/models` signal；
- connection-specific evidence；
- field-level user override；
- effective facts 在 RunContext 冻结。

#### 验收

- DeepSeek 是否有 native search 不再由 provider 名或 Anthropic endpoint 单分支决定；
- tool support、agent-ready 与连接认证不再共用一个布尔值；
- chat/embedding/rerank/image/video 类型不会进入错误入口；
- UI 能显示目录、远端、probe、用户覆盖各自来源。

### P1-D：MCP/Skill 运行快照与 Usage

#### MCP

- Run snapshot 保存 server stable ID、server config version、tool stable ID、transport/approval policy 摘要；
- 实际调用记录 `capability.used`，不保存完整参数/输出；
- 历史 UI 不用当前 server 名或 tool toggle 重算；
- Resources/Prompts 后续作为显式 Resource，不静默注入；
- OAuth token 继续留主进程 Secret store。

#### Skill

- 用户 Skill 增加 content hash/version、更新/回滚策略；
- Run snapshot 关联实际版本；
- workspace discovery 只产生候选，不自动信任/安装；
- references/assets 按需读取并产生 resource usage；
- scripts 在独立执行安全模型完成前保持不可执行；
- 建立固定任务与行为评测，不只校验 frontmatter。

#### 验收

- “已安装、已启用、本 Run 已加载、实际使用”可区分；
- 删除/更新 Skill 后历史 Run 仍显示原版本摘要；
- MCP 运行中被停用时后续调用拒绝且事件可解释；
- renderer 不解析 SkillToolkit/MCP 日志字符串。

## 9. P2：上下文、通用附件、浏览器与有界委派

### P2-A：Context Budget 与 Compaction

#### 原则

先做可确定的上下文预算，再做长期 Memory。Memory 不能被用来掩盖无界历史拼接。

#### 预算层

```text
system/instructions reserve
latest user turn reserve
tool schema reserve
expected output reserve
active resource reserve
conversation history budget
tool result budget
```

预算使用 effective model context/max input/max output，并记录 tokenizer/估算方式和安全余量。

#### 压缩策略

1. 优先去除可重取的 tool 大输出，只保留结构化摘要与 resource/artifact refs；
2. 对旧 turn 生成带 coverage 的 conversation summary；
3. 保留当前目标、未完成 plan、用户约束、审批结果、引用与失败；
4. 写 `context.compacted` marker，记录 covered event range、input/output token、model/version；
5. 原始消息/Run event 仍持久存在，压缩只影响送模上下文；
6. compaction 失败时降级或显式阻止，不无限截断尾部。

#### 验收

- token 预算而非字符硬阈值决定；
- 任何未完成 step、审批、用户约束不会因压缩消失；
- 重启后可复用相同 marker，不重复花费压缩；
- 用户可在 Inspector 看到发生过压缩及覆盖范围；
- 跨模型切换会按新窗口重算，不把旧摘要当完整历史。

### P2-B：长期 Memory 最小闭环

#### 候选而非自动事实

```text
MemoryCandidate
  → validate/scope/provenance
  → user-confirmed or policy-approved MemoryFact
  → retrieval/injection event
  → correction/supersede/delete
```

首批只考虑用户稳定偏好与 Project 决策，不保存临时任务状态、Secrets、未经确认的模型推断或大段原文。

#### Scope

- user preference；
- workspace/project fact；
- task-local summary；
- domain state（研究 plan/evidence 继续留领域表，不复制进通用 Memory）。

#### 验收

- 每个 fact 有来源、confidence、scope、created/confirmed/superseded；
- 注入某 Run 时产生 usage event；
- 用户可查看、修改、删除和关闭 scope；
- 删除后不会因旧 summary 或 vector index 再注入；
- prompt 中区分用户确认事实与 Agent 推断。

### P2-C：通用附件与 Parser

#### Admission

- 系统选择器在主进程返回文件；
- 流式复制到托管 staging，计算 hash；
- 拒绝 symlink、special file 和范围外路径；
- declared MIME、extension、magic bytes 交叉检查；
- 单文件、总字节、页数、解压和解析预算；
- 原始内容不通过 renderer/日志/base64 长期传递。

#### Parser

- 第一批 Markdown/TXT/PDF；
- parser 受 CPU/内存/输出预算限制；
- raw、extracted text、structure、thumbnail 分离；
- tool 使用 `read-resource` 按页/段读取；
- 内容标记 untrusted data 和 provenance。

#### 验收

- Run 重放读取相同字节版本；
- 文件被修改/删除不破坏已绑定版本；
- Renderer/Prompt/日志没有绝对路径；
- Execution Context 能从 Available 升级为 Used；
- 恶意/超大文件失败不会阻塞主进程或污染长期 Memory。

### P2-D：托管 BrowserSession

#### 分层

```text
BrowserIdentity（用户批准的账号/用途）
  → BrowserSession（生命周期、执行位置、权限）
    → BrowserContext（profile/cookie/storage isolation）
      → BrowserTarget（tab/page/CDP target）
        → BrowserArtifact（download/screenshot/snapshot）
```

#### 实施顺序

1. 保留现有低权限 Web Reader；
2. 增加独立 managed profile，不导入用户默认浏览器 Cookie；
3. 可见 Browser Preview 绑定同一 session/target；
4. 高风险动作通过标准 tool approval；
5. 下载进入 ContextResource staging，上传只允许显式 ResourceVersion；
6. 会话、target、域名、动作和 Artifact 进入 Run Inspection；
7. 外部 CDP attach、Cookie 导入、多 Worker 共享最后考虑。

#### 验收

- UI 能证明预览 target 就是 Agent target；
- Cookie/Storage 永不进入 renderer 或 prompt；
- profile 隔离有自动化测试；
- 关闭/取消/崩溃能清理或安全恢复 session；
- 下载/上传都有 resource provenance；
- 用户能看到 Agent 正在控制、最近动作和登录 identity。

### P2-E：有界 Delegation

#### 不做固定角色工作群开关

根 Agent 通过标准 `delegate-task` 工具提出：

- objective；
- resourceRefs；
- capabilityRefs；
- deliverable contract；
- dependency IDs；
- max steps/token/deadline；
- reason for delegation。

主进程做 parent permission 交集，创建 child Run；child 默认最大深度 1、低并发、无继承 Secrets、无任意 write。返回根 Agent
的是结构化 deliverable 与 Artifact refs，不是完整 child conversation。

#### UI

- 只有实际委派后出现 Agent 区块；
- 默认显示角色/目标/current step/presence；
- 点击显示活动 ledger、资源、产物、token/cost；
- live toolkit 标签可平滑显示，但事实来自 child event；
- follow-live/pinned/follow-paused 显式化；
- React Flow 仅在真实 DAG 有三条以上依赖分支且线性列表难以理解时使用。

#### 验收

- child 权限是 parent 的严格子集；
- parent cancel 会协调 child cancel/effects draining；
- child 重试不会重复副作用；
- token、并发、deadline 是硬上限；
- 单 Agent 可以完成时路由不会制造 Workforce；
- 所有 Agent/Progress/Artifact 视图可从同一 event ledger 恢复。

## 10. P3：RAG、自动化与远程执行

### P3-A：Project RAG 与 Citation

只有 ResourceVersion、Parser 和 Usage 先完成后再做：

```text
Resource change
  → parse job
  → chunk manifest
  → embedding job
  → versioned index generation
  → retrieve
  → optional rerank
  → typed hits
  → citation
```

#### 约束

- IndexDefinition 冻结 embedding connection/model/dimension、parser/chunker version、distance metric、privacy policy；
- SQLite 保存可重建 control state，向量数据不是内容事实源；
- 更换 embedding 建新 generation 后原子切换；
- 模型只调用 query，不任意创建 collection 或写 raw memory；
- RetrievalHit 带 resource version/chunk/locator/score；
- retrieved 不自动等于 cited。

#### 验收

- 修改只重建受影响版本；
- 删除资源后旧 chunk 不可检索；
- citation 能打开固定页/标题/span；
- 本地/远端 embedding 隐私策略可见；
- 不同向量维度不混写。

### P3-B：本地 Automation

#### 前置条件

- standard Run 可从持久 RunRequest 启动；
- FrozenRunContext/permission envelope；
- cancellation/effects draining；
- Run Inspector；
- workspace write 的 draft/approval 策略；
- invocation input 可转 ContextResource。

#### 第一批

- `this-device`；
- 一次性/每日 Schedule；
- IANA timezone、DST/misfire/deadline；
- SQLite Invocation/RunRequest/ExecutionLease；
- `(automationId, scheduledFor)` 唯一键；
- renderer 关闭不影响 main scheduler；
- 重启恢复 pending/leased；
- 首版写入只产 draft，不无人值守 apply。

#### 验收

- 多窗口、睡眠、重启、时钟变化时 occurrence 最多执行一次；
- missed/late/skipped/failed 有可解释记录；
- Automation 更新不改变已创建 Invocation；
- 用户能从 Invocation 打开标准 Run Inspector；
- 预算与权限上限不能被 Skill/Agent 扩大。

### P3-C：Webhook、Connector 与 Remote Control

- 各来源实现 `verify/deriveIdempotencyKey/normalize/filter/redactForAudit`；
- HMAC、replay window、rate/size/schema 限制；
- payload 作为 untrusted ContextResource；
- 返回 202 + Invocation status，不同步等待 Agent；
- Remote command 也进入 Invocation/RunRequest；
- stable device identity、capability token、expiry/revocation/audit；
- pending command 重连补投，executor 以 command/run ID 去重；
- lease heartbeat + fencing token 防旧执行器迟到覆盖。

远端实时步骤只投影脱敏 Run Event，不把 prompt、Cookie、Secrets 和完整本机路径送控制面。

#### 验收

- 外部同一事件重试十次只有一个 Invocation；
- A 断网、B 获得 lease、A 恢复时旧 fencing token 无法提交副作用；
- 分享/设备授权撤销立即生效；
- Secret 不进入 renderer、普通日志或模型；
- Trigger/Remote 不维护独立 Agent 状态机。

### P3-D：完整 Workforce/DAG 的进入门槛

只有满足以下证据才进入：

1. 有界 delegation 的真实任务显示两个以上 child 并发稳定带来质量或时延收益；
2. 用户确实需要修改计划依赖和重分配，而不是只想看进度；
3. child 的恢复、预算、权限、取消和 side effect 幂等通过故障测试；
4. 线性 Plan 不能表达三条以上依赖关系；
5. 成本与 token 可按 Agent/step 归因；
6. 单 Agent fallback 保持可用。

届时再实现 DAG scheduler、replan、Agent Pool expanded canvas 和更复杂的 worker profiles。不要把 React Flow 图本身当成进入
理由。

## 11. UI 交付序列

### UI-1：现有事实常驻化

- Run selector；
- Overview；
- actual model/policy/resources/tools；
- usage/timing/failure；
- coverage；
- responsive Inspector。

### UI-2：进度与待处理

- Plan steps；
- waiting input/approval/conflict；
- inline ↔ Inspector 深链；
- follow-live/pinned。

### UI-3：上下文与产物

- Configured/Loaded/Used/Cited；
- Resource version；
- Artifact states；
- Diff/preview/open location；
- compression/memory injection summary。

### UI-4：执行资源

- Browser target/identity；
- Agent presence；
- read-only terminal activity；
- Invocation/device/lease；
- detailed event history on demand。

### 视觉原则

- 复用 Tessera semantic token 与 design-system 分层；
- 状态颜色、图标和文字同时表达；
- 结构变化才使用 Motion；
- 折叠保留关键信号；
- 不引入第二套 motion/token；
- 不用卡片数量替代信息层级；
- 所有漂亮的“已使用/已完成/已生成”都必须有事件事实。

## 12. 建议的首批工程 Epic

以下顺序可以直接转成工程规划，但每个 Epic 仍需在 `docs/architecture/` 建立正式设计并拆成可验收 PR。

### Epic 1：Run Context 与 Inspection Contract（P0）

交付：

- `FrozenRunContextV1`；
- `CapabilitySnapshot`；
- inspection coverage；
- 历史兼容 projector；
- redaction/round-trip tests。

退出条件：现有所有 task run 都能返回 complete 或明确 partial 的安全 inspection。

### Epic 2：Run Inspector V1（P0）

交付：

- task Run selector；
- desktop/overlay responsive surfaces；
- 现有 popover 深链；
- actual model/policy/resources/tools/usage；
- live subscription 基础。

退出条件：不打开开发 DevTools 即可解释一次失败或工具拒绝 Run。

### Epic 3：Plan/Pending Projection（P1）

交付：

- 通用 Plan event；
- 研究 plan adapter；
- Pending Actions；
- inline/Inspector single projection；
- step deep link。

退出条件：等待输入、审批、失败和阻塞在消息与 Inspector 状态一致。

### Epic 4：Resource/Artifact Provenance（P1）

交付：

- ResourceVersion/binding/usage；
- current document/image migration；
- RunArtifactManifest；
- AgentChangeProposal relation；
- Inspector context/files sections。

退出条件：任一显示为“已使用/已生成”的条目都能追到 event 与稳定版本。

### Epic 5：Capability Evidence（P1）

交付：

- model probe；
- catalog version/retirement；
- MCP/Skill Run snapshot；
- capability loaded/used；
- UI source/evidence。

退出条件：搜索/工具/结构化输出能力不依赖 provider 名硬编码，可解释 connection-specific 结果。

### Epic 6：Context Budget/Compaction（P2）

交付：

- token budget planner；
- tool result slimming；
- compaction artifact/marker；
- Inspector summary；
- long-conversation golden tests。

退出条件：超过窗口的长任务可恢复继续，未完成目标/审批/引用不丢失。

### Epic 7：Managed Attachments（P2）

交付：

- staging/hash/admission；
- Markdown/TXT/PDF parser；
- read-resource；
- usage/citation locator；
- lifecycle/cleanup。

退出条件：任意附件重放字节稳定，绝对路径不离开主进程。

### Epic 8：Managed Browser（P2）

交付：

- BrowserSession/Context/Target；
- managed profile；
- Preview identity；
- approved actions；
- download/upload resource bridge。

退出条件：可见页面与 Agent target identity 一致，Cookie 不暴露。

### Epic 9：Bounded Delegation（P2）

交付：

- DelegationTask/child Run；
- permission intersection；
- budgets/cancel；
- Agent presence/activity；
- Artifact return contract。

退出条件：最大深度 1、低并发在故障注入下不越权、不重复副作用。

### Epic 10：Automation Foundation（P3）

交付：

- Automation/Invocation/RunRequest/Lease；
- local schedule；
- restart/misfire；
- Run linkage/Inspection；
- draft-only unattended writes。

退出条件：renderer 关闭、重启、睡眠和多窗口测试都保证 occurrence 唯一。

## 13. 测试与门槛

### 13.1 契约测试

- schema version/backward compatibility；
- public projection redaction；
- stable ID and ownership；
- unknown event forward compatibility；
- Secrets/absolute-path snapshot test。

### 13.2 状态机测试

- run/plan/artifact/approval/delegation/invocation/lease 每个终态；
- cancel during model/tool/approval/write；
- late result；
- duplicate/reordered event；
- crash/restart；
- retry/idempotency；
- stale fencing token。

### 13.3 权限测试

- Skill 请求不能扩大 scope；
- MCP annotation 不能绕过 approval；
- child 权限严格交集；
- automation envelope 严格上限；
- browser target/profile 不串 session；
- resource symlink/path traversal/special file；
- connector payload/prompt injection 边界。

### 13.4 UI 故事测试

- 用户查看正在运行与历史 Run；
- 手动固定后 live update 不抢焦点；
- plan step 与 inline card 双向定位；
- Attached/Used/Cited 不混淆；
- waiting approval 在折叠状态可见；
- Artifact 冲突/拒绝不显示成功；
- Browser 预览显示真实 target identity；
- 读屏和 reduced motion；
- 窄屏 Inspector/AI Sidebar 不互相遮挡。

### 13.5 黄金任务

至少覆盖：

1. 短问答，无计划、无工具；
2. 深度研究，多次搜索/阅读/引用；
3. 当前文档修改，Diff 批准与冲突；
4. MCP 调用被批准/拒绝/失败；
5. 长对话发生 compaction 后继续；
6. PDF 读取和 citation；
7. Browser 登录、下载、上传；
8. 两个 child 并行，其中一个失败；
9. Schedule 跨重启执行；
10. 取消时外部工具迟到返回。

比较的不只是最终答案，还包括 event count、Run state、resource/artifact provenance、权限、token、恢复与 UI projection。

## 14. 需要建立的正式架构文档

研究结论获准实施时，建议按以下边界进入 `docs/architecture/`，不要直接把本文变成事实源：

1. `run-context-and-capabilities.md`：FrozenRunContext、CapabilityRef、解析交集；
2. 扩充 `ai-observability.md`：领域事件、projection、coverage、Inspector；
3. `plan-and-delegation.md`：Plan、Pending、DelegationTask、child Run；
4. `context-resources-and-artifacts.md`：ResourceVersion、Binding、Usage、Artifact Manifest；
5. `context-budget-memory-and-compaction.md`：token 预算、summary、Memory lifecycle；
6. `managed-browser.md`：identity/session/context/target/profile/action；
7. `automations-and-execution-leases.md`：Invocation、RunRequest、lease/fencing；
8. 继续扩充现有 `mcp.md`、`skill-system.md`、`ai-providers.md`，避免平行文档重复事实。

每篇必须标注已实现/部分实现/规划，并与 contracts/database/main/renderer 的真实状态同步。

## 15. 明确不采纳清单

### 系统与状态

- 不引入 CAMEL 作为第二个主 Agent runtime；
- 不增加 renderer → local Brain 的宽 HTTP 控制面；
- 不让 renderer 访问 Node、任意路径、PTY、CDP 或 Secrets；
- 不用 Zustand 巨型 store 作为持久运行事实；
- 不让同一 MCP/Skill/Browser 配置在多个进程分别持久化。

### Run 与 UI

- 不从 Agent 自述/reasoning 推断工具活动；
- 不从字符串日志解析 Skill/MCP identity；
- 不把 attached 文件标成 used/referenced；
- 不把 Project 目录扫描结果归给当前 Run；
- 不以 presence 动画替代审计 ledger；
- 不放空 Review/Canvas 入口；
- 不让 Progress 抹平失败、阻塞和等待输入。

### 文件与 Context

- 不把 raw absolute path 当附件 ID；
- 不让发送后的附件内容漂移；
- 不默认 direct-write 用户工作区；
- 不把 parser/RAG 输出当可信系统指令；
- 不把 embedding model/维度混在无版本 collection；
- 不把模型推断自动写入长期 Memory。

### Browser/MCP/Skill

- 不导入默认浏览器全部 Cookie 作为首版；
- 不把 Preview webview 等同 Agent CDP target；
- 不因 MCP tool 声明 read-only 就自动批准；
- 不执行用户 Skill 随附脚本；
- 不让 child Agent 先继承全部父工具再做黑名单过滤。

### 调度与远程

- 不用 Pub/Sub 作为离线可靠队列；
- 不广播给用户所有在线窗口抢执行；
- 不把 socket send 称为已唯一投递；
- 不用固定 running timeout 代替真实取消；
- 不接受没有幂等、重放和 HMAC 的 webhook；
- 不让自动化继承某次手工审批为永久授权；
- 不为 Trigger/Remote 新建另一套 Agent 生命周期。

## 16. 决策检查表

任何新增 Agent 功能进入实现前逐项回答：

1. 它属于配置、Run 可见能力、实际使用还是产物？
2. 稳定 identity 是什么，历史版本如何保留？
3. 哪个进程是控制事实源？
4. renderer 得到的最小安全投影是什么？
5. 它如何进入 FrozenRunContext？
6. 需要哪些 Run event，能否从现有 Tool Part 推导而无需重复？
7. 用户在哪里看到配置与实际发生的差异？
8. 取消、重启、重复、迟到、超时怎么处理？
9. 副作用需要 approval、idempotency 或 fencing 吗？
10. Resource/Secret/Browser identity 会不会跨 scope 泄露？
11. 单 Agent/离线/无此能力时能否安全降级？
12. 是否有一个真实用户任务证明复杂度值得？

无法回答其中 identity、事实源、权限或恢复的功能，不应只凭一个新页面进入主链。

## 17. 建议立即开始的切片

综合收益、依赖与当前完成度，最适合立刻进入正式设计的不是完整 MCP 市场、Browser 或 Workforce，而是：

### “Run Inspector + Frozen Context”纵向切片

1. 以现有 `TaskRunInspection` 为兼容起点；
2. 定义 inspection coverage 与 FrozenRunContext V1；
3. 给任务内每个 requestId 建 Run selector；
4. 在宽任务页增加可折叠 Inspector；
5. 展示现有实际模型、策略、资源摘要、工具、失败、usage/timing；
6. 从消息 info icon 深链过去；
7. 为后续 Plan/Resource/Artifact 预留类型化 section，不放空 UI；
8. 用一次研究 Run、一次 MCP 拒绝、一次文档 Diff 冲突做端到端验收。

这个切片能马上吸收 Eigent 截图中最有价值的体验，同时迫使 Run identity、历史 coverage 和投影 API 先变得清楚。它不会
提前扩大文件、浏览器、Shell、MCP 或自动化权限，风险最低，也为之后每个专题提供共同落点。

第二个切片应是 `ResourceVersion + RunArtifactManifest`，第三个是 `Plan + Pending Actions`。完成这三项后，再在真实任务
数据上决定先做 Context Compaction、Managed Attachments、Browser 还是 Delegation。

## 18. 最终路线

Eigent 给 Tessera 的真正启示可以浓缩成一句话：**Agent 能力要变成用户可理解的长期对象，但这些对象必须由可恢复、
可审计、可收窄的运行事实支撑。**

Tessera 不应以功能页数量衡量追赶进度。更稳健的演进顺序是：

```text
Run identity / context / event
  → Inspector / plan / pending / artifact
  → capability evidence / resource usage
  → compaction / managed attachments / browser
  → bounded delegation
  → RAG / automation / remote execution
  → 有证据时再升级完整 Workforce
```

这样既能获得 Manus、YouMind、Eigent 那种“Agent 正在真实工作”的产品感，又能保留 Tessera 已经建立的本地优先、窄
IPC、Markdown 事实源、差异审批和单一运行账本优势，避免把未来几年都花在同步多套状态和修复权限漂移上。
