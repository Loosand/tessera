# UI、进度审查与信息架构

> 研究对象：Eigent `d3089558c6e0021eed58270b49893835b02ec4e9`
>
> Tessera 对照：任务对话、文档 AI 侧栏、Artifact 导航、Run 检查浮层与 Diff 审批已实现；持续可见的 Run Inspector、任务进度和实际执行上下文部分未实现

## 1. 结论先行

Eigent 的 UI 优势不只是“卡片好看”，而是把 Agent 产品中不同密度、不同时间尺度的信息放进了不同表面：

- 左侧处理 Space、Project 与入口导航；
- 中央对话/文档承载用户目标、过程解释和最终内容；
- 右侧 Session Side Panel 持续展示当前 Run 的进度、Execution Context、Agent Folder 与 Agent Pool；
- 可选的中间 Preview Panel 承载文件、浏览器、Terminal 和 Canvas 等工作表面；
- 对话内 Task Card 保留比右侧 Progress 更细的任务状态和控制；
- Workforce 的折叠/展开表面把多 Agent 复杂度留给需要查看的人。

这套信息架构解决了 Agent 产品最常见的两个问题：用户不知道“现在做到哪了”，也不知道“系统到底用了什么”。截图中
的右侧审查栏因此很值得 Tessera 学习。

但 Eigent 的展示层比运行事实层走得更远：

1. Progress 只把 `completed` 与“其他”区分开，丢失运行中、失败、阻塞、跳过和重分配等真实状态；
2. “Referenced Files”是用户附加过的文件，不是 Agent 实际读取过的文件；
3. Agent Folder 混合消息推导文件和项目级目录轮询，无法证明文件属于当前 Run；
4. Skill/MCP 由 renderer 解析 toolkit 日志字符串和当前配置反推，历史展示可能漂移；
5. Agent Pool 的旋转工具标签适合表达活跃感，但不是可追溯的审计记录；
6. Preview 中 Review 仍是空占位，Canvas 只是两个初始节点的本地 React Flow 示例；
7. 同一计划同时存在 Task Card 和 Side Panel Progress 两种投影，状态语义不一致。

Tessera 不应复制这些推断链。更合适的策略是：保留现有 `task_runs + ordered run events + frozen
RunPolicy + resource summary + tool parts + approval` 事实链，把它投影成一个持续可见的 **Run Inspector**。也就是学习
Eigent 的产品位置与分层，不把 renderer 变成第二个运行时。

## 2. 研究范围与关键源码

### 2.1 Eigent

- 会话总布局：`Eigent: src/components/Session/index.tsx`
- 会话标题与 Run 选择：`src/components/Session/HeaderBox/index.tsx`、`TurnTabs.tsx`
- 右侧容器：`SessionSidePanel.tsx`、`SessionSidePanelHeader.tsx`、`sessionSidePanelLayout.ts`
- Single/Workforce 投影：`SingleAgent/SingleAgentSidePanel.tsx`、`Workforce/WorkforceSidePanel.tsx`
- 折叠卡片：`SidePanelAccordionBox.tsx`
- 进度：`SidePanelSections/ProgressSection.tsx`
- 执行上下文：`ExecutionContextSection.tsx`、`buildContextItems.ts`
- Agent 文件：`AgentFolderSection.tsx`、`collectSidePanelOutputFiles.ts`、`useProjectOutputFiles.ts`
- Agent Pool：`AgentPoolSection.tsx`
- Preview：`PreviewPanel/index.tsx`、`tabKinds.tsx` 及 `tabs/` 下各视图
- Preview 状态：`src/store/pageTabStore.ts`
- 对话内计划：`src/components/ChatBox/TaskBox/TaskCard.tsx`
- 对话阶段投影：`src/components/ChatBox/UserQueryGroup.tsx`
- Workforce 工作视图：`Workforce/FoldedPanel/index.tsx`、`ExpandedOverlay.tsx`
- 视觉 token：`src/style/token.css`、`src/style/index.css`、`tailwind.config.js`

### 2.2 Tessera

- 统一任务表面：`apps/desktop/src/renderer/src/components/tasks/conversation/task-page.tsx`
- 文档右侧 AI 面板：`agent-sidebar.tsx`
- 单次运行检查：`run-inspection-popover.tsx`
- 运行检查投影：`apps/desktop/src/main/task-run-inspection.ts`
- 运行检查契约：`packages/contracts/src/index.ts::TaskRunInspection`
- 正式产物入口：`task-artifact-tray.tsx`
- 写入审查：`chat-parts/agent-change-review.tsx`
- 观测事实源：`docs/architecture/ai-observability.md`
- 任务/工作区绑定：`docs/architecture/task-navigation.md`

## 3. 页面骨架：导航、工作面和审查面

### 3.1 结构

Eigent 的桌面主界面可以抽象为：

```text
┌──────────────┬────────────────────────────────────────────────────────────┐
│ Space/Project│ Session Header：返回、Token、Preview、Run N、折叠          │
│ Sidebar      ├──────────────────────┬──────────────────┬─────────────────┤
│              │ Chat / Result        │ Preview（可选）   │ Run Inspector   │
│ Workspace    │ 用户目标与回答       │ File/Browser/     │ Progress        │
│ Context      │ Task Card            │ Terminal/Canvas   │ Context         │
│ Schedule     │ Composer             │                  │ Agent Folder    │
│ Trigger      │                      │                  │ Agent Pool      │
└──────────────┴──────────────────────┴──────────────────┴─────────────────┘
```

外层 Workspace 左栏可折叠并可调整宽度。Session 中央 Preview 通过 resizable panel 插入聊天与右侧面板之间；右侧面板
默认固定约 360 px，上限约为 viewport 的 40%，折叠后只保留约 40 px 的控制条。

这不是传统“三栏后台”的机械套用。三类区域的时间尺度不同：

| 区域 | 核心对象 | 时间尺度 | 用户动作 |
| --- | --- | --- | --- |
| 左侧导航 | Space、Project、入口 | 跨 Run | 切换工作范围 |
| 中央主内容 | 消息、计划、答案 | 当前目标 | 发起、追问、阅读 |
| Preview | 文件、网页、Terminal | 当前活动/Artifact | 检查、交互、比较 |
| 右侧 Inspector | Run、进度、上下文、文件、Agent | 当前 Run | 观察、定位、审查 |

所以右栏不是另一个导航栏，也不应塞进供应商设置、MCP 安装等控制面配置。它回答的是“这一轮发生了什么”。

### 3.2 Tessera 当前布局

Tessera 目前有两种任务表面：

- 独立 `TaskPage`：中央最大宽度约 3xl 的消息流与 composer；
- 文档内 `AgentSidebar`：固定 380 px 的 AI 对话面板，支持切换当前项目历史任务和新建任务。

文档右栏的目标是“围绕当前文档协作”，不是运行审查。把 Eigent 全部右栏内容直接塞进现有 `AgentSidebar` 会导致
职责混乱，也会把 380 px 变成消息、计划、上下文、文件和审批的拥挤混合区。

建议保留两个概念：

1. **AI Collaboration Surface**：现有对话与 composer；
2. **Run Inspector**：可在任务页右侧常驻，在文档窄侧栏中以抽屉/分段面板打开。

它们可以共享 `RunInspectionProjection`，但不是同一个组件硬塞两种密度。

## 4. Run/Turn 的选择与时间定位

### 4.1 Eigent 的 `Run N`

当 Project 中有多个 turn 时，标题栏显示 `Run N` 下拉：

- 遍历该 Project 所有 chat stores 和 tasks；
- 以 task `createdAt` 排序后得到序号；
- 下拉按最新优先展示 prompt 摘要和状态点；
- 选择后写入 `sidePanelSelectedTurnByProject`；
- 同时发出 `scrollToTurnRequest`，让中央聊天滚动到对应 turn；
- 手动选择有约 5 秒窗口，避免 viewport 自动同步立即抢回选择。

它解决了一个关键语义：右侧栏不是永远展示“当前正在运行的最新任务”，而是展示用户此刻正在查看的 Run。

### 4.2 优点

- 右侧审查内容与中央阅读位置联动；
- 历史 Run 不需要进入日志页面才能查看；
- 单 Agent 与 Workforce 共用同一选择机制；
- live dot、完成/失败状态点让历史列表具有最小状态感。

### 4.3 风险

Eigent 的 `Run` 实际上是 Project 内按创建时间编号的 task/turn，不是稳定的领域对象：

- 序号依赖本地收集和排序，数据缺失或重排会改变展示身份；
- 多 chat store 去重依赖 task ID；
- 状态来自可变 store，而不是冻结的 Run record；
- “Run”与 CAMEL Task、Project turn、chat task 的术语边界不严。

Tessera 已有稳定 `taskId + requestId`。建议 UI 显示“运行 3”，但深链、IPC 和选择状态必须保存 `requestId`，序号只是
当前任务内的投影。选择规则应是：

```text
显式用户选择 > 当前 viewport 对应 requestId > 正在运行 requestId > 最新 requestId
```

手动选择锁定不建议只用固定 5 秒；应在“用户点击回到最新运行”或 viewport 明确跨越到另一个用户轮次时解除。

## 5. 右侧面板的四个区块

### 5.1 Progress

### 数据链

`ProgressSection` 接收当前 task 的 subtasks，过滤空内容，按原顺序展示。折叠状态显示圆点与连接线；展开后显示每个
subtask 文本。点击任意条目会调用 `requestTaskBoxFocus(projectId, taskId)`，展开并滚动中央 Task Card。

### 好的地方

- 用户目标级进度与模型/tool token 流分离；
- 折叠后仍能通过圆点数量感知计划规模；
- 点击可回到更详细的内联计划；
- 结构简单，稳定占据第一屏位置。

### 真实性缺口

右栏只有 `completed` 是完成圆，其余状态都成为同一种未完成圆。源码的 Task Card 实际支持：

- running；
- completed；
- failed；
- blocked；
- skipped；
- waiting；
- reassigned。

右栏因此不是 Task Card 的忠实紧凑投影。用户无法区分“还没开始”“正在做”“失败了”“等我输入”。点击也只定位到
整张 Task Card，不定位到具体 subtask。

### Tessera 应采用的模型

不要从 assistant 文本或 tool name 推断进度。需要一个显式计划协议：

```text
PlanPublished
PlanStepAdded | PlanStepUpdated | PlanStepRemoved
PlanStepStarted | PlanStepBlocked | PlanStepCompleted | PlanStepFailed | PlanStepSkipped
PlanRevised
```

每个 step 至少有 `stepId`、`title`、`status`、`order`、可选 `parentStepId`、`agentId`、`startedAt`、`completedAt`、
`reason`。右栏与内联 Task Card 读取同一投影，只改变信息密度。

状态视觉必须至少区分：等待、运行、完成、需用户输入、阻塞、失败、跳过。颜色只是辅助，图标、文本与 `aria-label`
必须同时表达状态。

### 5.2 Execution Context

### Eigent 展示什么

Execution Context 分成三类：

1. Skills；
2. MCP Tools；
3. Referenced Files。

产品意图非常正确：展示本次执行真正使用的能力与材料，而不是设置页中所有已启用项。

### 实际数据来源

`buildContextItems` 遍历 agent task/toolkit 事件：

- 对 `SkillToolkit.load_skill`，从 toolkit message 中尝试解析 JSON、Python repr 或被拼接的参数文本；
- 普通 toolkit 再利用 worker 的 `mcp_tools`、当前 `selectedTools` 与 Skills store 做字符串分类；
- user messages 与 pending task 上的 attachments 全部成为 Referenced Files。

这造成三种不同置信度被画成相同的行：

| UI 条目 | 实际含义 | 置信度 |
| --- | --- | --- |
| Skill | 观察到一次推测为 `load_skill` 的 toolkit 日志 | 中 |
| MCP | 观察到 toolkit，并由当前配置猜测为 MCP | 中/低 |
| Referenced File | 用户附加过，不代表读取 | 低 |

历史 Run 还会被当前 Skills/MCP 配置重新分类。配置改变后，旧 Run 的解释可能漂移。

### Tessera 的机会

Tessera 已冻结 `TaskRunPolicy` 与 `TaskRunResourceSummary`，并从有序事件计算实际模型、工具次数、失败和拒绝。当前
`RunInspectionPopover` 已能展示：

- 实际 provider/model；
- Skill 与联网、reasoning、tool scope；
- 工作区、当前文档与附件数量；
- 实际工具调用、失败和拒绝；
- finish reason、失败原因、时长与 token。

这个事实基础比 Eigent 更可靠，但目前只在 assistant 消息操作栏的信息图标后按需加载，发现性和持续性不足。

下一步应补充结构化 usage 事件，而不是让右栏解析已有字符串：

```text
run.resource.bound       配置时绑定
run.resource.sent        实际进入模型上下文
run.resource.read        工具真实读取
run.resource.cited       最终答案引用
run.capability.loaded    Skill/MCP 已装配
run.capability.used      某工具实际调用
run.context.compacted    上下文发生压缩
run.permission.decided   用户批准/拒绝
```

每个条目在 UI 中标记来源：`已配置`、`已加载`、`已使用`、`已引用`，不能用一个模糊的“Execution Context”覆盖。

推荐的分组扩大为：

- 模型与能力策略；
- Skills 与 MCP；
- 工作区、当前文档、附件；
- 浏览器身份与网络来源；
- 上下文窗口、压缩与记忆注入；
- 权限批准、拒绝与越界拦截。

默认只显示用户能理解的摘要，展开后再显示事件证据和时间。

### 5.3 Agent Folder

### Eigent 的实现

Agent Folder 合并两类来源：

1. `collectSidePanelOutputFiles` 从顶层 task、计划/running subtasks、agent assignment、messages 和 final summary 中收集
   `FileInfo`；
2. `useProjectOutputFiles` 在运行期间每约 5 秒轮询本地 IPC 或远端 `/files`，结束后再延迟拉取一次项目文件。

结果按相对路径去重，点击后打开 File Preview。这种产品入口很好：产物不会淹没在聊天文本里，用户可以在执行中看到
文件逐步出现。

### 关键误差

- 目录扫描是 Project 级，不是 Run 级；
- 右侧选择历史 Run 时仍可能显示其他 Run 生成的文件；
- message 中提到路径不等于文件由 Agent 创建；
- 已创建、已修改、已删除和只是引用的文件没有区分；
- 没有 base hash、writer、tool call、approval 和 commit 状态；
- polling 发现文件的时间不等于写入时间。

### Tessera 对照与建议

Tessera 的 `TaskArtifactTray` 已展示正式 `TaskArtifact`，并从对话直接打开项目文档；写入工具通过
`AgentChangeReview` 展示冻结候选内容、逐行 Diff、批准/拒绝，并在主进程复核磁盘版本后原子写入。这比 Eigent 空的
Review Tab 更完整。

但 Artifact Tray 只在 composer 上方横向显示正式产物，不是完整 Run 文件视图。建议新增 `RunArtifactManifest`：

```text
artifactId / requestId / kind / relativePath / mediaType
originToolCallId / producingAgentId
operation: create | update | delete | export
state: proposed | awaiting-approval | applied | conflicted | rejected | failed
baseHash / resultHash / createdAt / updatedAt
```

Inspector 的“文件与产物”区块只读这个 Manifest。目录中后来发现的未归属文件可以放到“工作区变化”次级分组，并明确
标记“归属未知”，不能伪装成本 Run 产物。

### 5.4 Agent Pool

### Eigent 的呈现

Agent Pool 只出现在 Workforce：

- 已分配 Agent 排在前面；
- inactive Agent 降低透明度；
- 当前使用 toolkit 以轮换标签展示；
- tool 结束后仍保留最少约 1.5 秒，让极快调用不至于完全看不见；
- 折叠状态仍显示活跃 Agent/工具的紧凑预览。

这是很好的“活跃感”设计。多 Agent 系统如果只输出最终文本，用户会把等待理解成卡死。

### 不应混淆的两类信息

tool 标签的最小展示时间由组件本地 timer 与可变 nested store 协调，适合动画，不适合审计。必须区分：

- **presence projection**：谁正在做什么，允许平滑、延迟消失和聚合；
- **activity ledger**：哪个 Agent 在什么时间调用哪个工具，必须由事件事实构建。

Tessera 将来实现工作群时，可以在 Agent Pool 顶层只显示角色、当前 step 与即时活动；点击 Agent 后打开活动历史、输入
资源、输出 Artifact、token/cost 和失败详情。不要在主视图滚动所有 tool event。

## 6. 对话内 Task Card 与右栏 Progress

Eigent 保留了两种计划密度：

| 表面 | 用途 | 信息 |
| --- | --- | --- |
| Task Card | 过程中的详细计划/控制 | 状态、筛选、编辑、进度条、Agent/工具活动 |
| Side Progress | 持续概览 | 标题、完成圆点、跳转 |

两层设计本身合理。问题是它们没有共享完整状态映射。Task Card 支持大量状态，右栏却只认完成/未完成。

Tessera 应建立一个 `PlanProjection`，再提供三种视图：

1. `PlanInlineCard`：首次发布、重大修订和需要用户决策时出现在对话；
2. `PlanInspectorSection`：持续概览和快速定位；
3. `PlanDetailView`：复杂层级、重分配、失败和事件时间线。

三者必须由同一个 `stepId` 深链。右栏点击具体 step 应滚动到对应内联卡或打开详情，而不是只聚焦整张任务卡。

## 7. Preview Panel：工作表面，不是审查栏

### 7.1 Tab 模型

Preview 支持：

- chooser；
- browser；
- file；
- review；
- terminal；
- canvas。

标签默认宽 176 px，可缩到 92 px，之后横向滚动。它实现了 roving tabindex、左右/Home/End 键导航、hover 与 keyboard
focus 下的关闭按钮。这些细节说明 Preview 被当成真正的工作台，而不是临时弹窗。

### 7.2 File

Agent Folder 或消息中的文件可以在中间 Preview 打开；File Tab 还能“跳转到上下文”。价值在于用户不离开任务就能
查看产物，且聊天、审查栏和文件保持并列。

Tessera 已有文档工作区与 Artifact 导航，不需要再造通用文件 viewer。更合适的是让 Inspector 的 Artifact 点击调用
现有文档打开机制；只有 PDF、图片、网页快照等非 Markdown 资产才进入独立 Preview。

### 7.3 Browser

`PreviewBrowserLayer` 常驻挂载，只切换可见性，以保留 webview 历史和页面状态。这种体验优于每次开合销毁浏览器。
但浏览器专题已经确认：用户看到的 Preview 与 Agent 实际控制目标不天然是同一个 CDP target。

Tessera 必须在 Preview 标明：

- 浏览器 session/profile；
- 当前 target/tab；
- “Agent 正在控制”或“仅预览”；
- 是否共享 Cookie；
- 最近一次 Agent 动作。

否则“我看到的页面”会被误认为“Agent 正在操作的页面”。

### 7.4 Terminal

Preview Terminal 有两类：

- 在 Space root 或 Project folder 打开的交互 shell；
- 某 Agent 的只读终端/日志流。

它们应在视觉和权限上明确区分。Eigent 的桌面 host 能力较宽，交互 shell 通过 renderer 桥调用主进程。Tessera 应继续
遵守窄 IPC：PTY 在主进程，renderer 只持有 terminal session ID；cwd 必须是经过解析的 workspace root；环境变量、命令
写入、外链打开和关闭都要通过显式契约。Agent terminal 默认只读，不能因为用户看得到就意味着 renderer 获得 Node。

### 7.5 Review 与 Canvas 的真实状态

固定提交中的 `ReviewTab` 明确写着 intentionally blank，没有 Diff 内容。`CanvasTab` 只有 React Flow 的 `Start → Idea`
两个初始节点，节点状态留在组件内，不能持久保存，也未接入 Agent 计划图。

所以不能根据 Tab 图标或产品入口判断能力已实现。Tessera 当前 `AgentChangeReview` 已具备：

- 冻结候选内容；
- Diff 与文档预览切换；
- 行号与增删统计；
- 长 Diff 截断提示；
- 冲突前的人工批准/拒绝；
- 主进程复核后原子写入。

这部分应坚持 Tessera 现有实现，只需把待审批项汇总进 Inspector，并让 Preview/文档区能够打开同一审批对象。

Canvas 只有在 Tessera 真正需要可编辑计划图、白板或多 Agent DAG 时再引入；不要为了视觉完整先放空入口。

## 8. Workforce 的折叠与展开

Eigent 没有强迫所有用户看 Agent 图。默认折叠视图聚焦当前工作的 Agent；展开 Overlay 才展示更大的 Workforce
工作空间、Browser Agent 或 Terminal Agent 视图。

折叠视图还有一个细致规则：系统默认自动跟随最新工作的 Agent；用户手动选择某个 Agent 后，自动跟随暂停一段时间，
避免内容不断跳走。这种“系统追踪 + 用户锁定”的冲突在 Run 选择、Agent 选择和日志自动滚动中都会出现。

Tessera 可以统一为一个 `FollowMode`：

```text
follow-live     自动跟随最新活动
pinned          用户固定到某 Run/Agent/step
follow-paused   用户正在阅读历史，保留“回到实时”按钮
```

不要用每个组件各自的 5 分钟/5 秒 timer 隐式决定。模式应可见，且切回实时是显式动作。

## 9. 视觉系统为何显得“像产品”

### 9.1 不是某个阴影，而是一致的层级语法

Eigent 的整体观感来自组合：

- Inter 用于正文，Palatino LT 用于少量展示标题；
- 浅灰/暖白大背景，强色主要留给状态和关键动作；
- 44 px 左右的紧凑标题条；
- 8 px 左右的内部节奏与 12–16 px 圆角表面；
- 极细低对比边框，更多依靠背景层级而不是密集分割线；
- 面板开合、状态出现、Agent 活跃等结构变化才使用动效；
- `prefers-reduced-motion` 有降级；
- 折叠卡片仍保留摘要，不让信息完全消失。

### 9.2 Token 工程

`token.css` 包含 raw token 与语义 token；Tailwind 配置从 `tokens/manifest.json` 构造颜色映射和 safelist，并为 running、
pending、error、reassigning、completed、blocked、paused、skipped、cancelled 等状态定义语义色。仓库还提供 token/theme
检查脚本。

这与 Tessera 的 `tokens → primitives → base → patterns → features` 方向一致。值得借鉴的是状态词汇完整、颜色集中治理，
而不是复制其变量名。

### 9.3 也存在视觉技术债

- token 数量非常大，理解成本高；
- 新旧 hard-coded class 与 token class 并存；
- 同时依赖 `framer-motion` 和 `motion`；
- 全局 blur、backdrop 与 inset shadow 使用较重；
- 多层圆角卡片在窄屏可能形成“卡片套卡片”；
- 状态 token 很丰富，但 Progress 组件没有完整消费。

Tessera 应先定义 Agent 领域状态 token，再由已有 design system 组件消费；不要为了“像 Eigent”引入第二套 motion 或复制
大规模 token 表。

## 10. 可访问性与响应式

Eigent 有不少可取细节：

- accordion 使用 `aria-expanded`；
- Preview tabs 使用 `role=tablist/tab` 和 roving tabindex；
- icon button 带 label；
- keyboard focus 能显露 tab close；
- reduced motion 有处理；
- panel 可以折叠而不是直接挤压中央内容。

但可访问性不能停留在 primitive：

- Progress 不能只以颜色/空心圆表达状态；
- 旋转 toolkit 标签应有稳定的文字摘要，避免 screen reader 被频繁更新；
- live region 只播报关键转换，不播报每个 token/tool delta；
- Referenced File 若不可点击，不应呈现 hover affordance；
- 折叠 Agent Pool 的动画不能替代 Agent 状态文本。

Tessera 建议的宽度策略：

| 可用宽度 | Run Inspector |
| --- | --- |
| ≥ 1280 px | 右侧常驻，可调宽，默认 360–400 px |
| 900–1279 px | 可折叠右侧栏，保留 40 px 状态轨或顶部按钮 |
| 600–899 px | overlay sheet，不与文档 AI Sidebar 同时常驻 |
| < 600 px | 全屏分段页，固定“回到实时/待审批”入口 |

## 11. 信息真实性矩阵

| Eigent UI | 固定提交的数据来源 | 事实等级 | Tessera 目标来源 |
| --- | --- | --- | --- |
| Run N | Project chat stores 中 task 的创建顺序 | 推导 | `task_runs.requestId` + UI 序号 |
| Progress | task/subtask store | 部分真实，但降格状态 | Plan events 的单一投影 |
| Skill | toolkit message 字符串解析 | 推测实际使用 | `capability.loaded/used` 事件 |
| MCP | toolkit + 当前配置字符串分类 | 推测实际使用 | server/tool 稳定 ID 的 tool event |
| Referenced Files | 用户所有附件 | 已绑定，不是已读取 | Resource usage lifecycle |
| Agent Folder | message 路径 + Project 轮询 | 发现结果，归属不可靠 | Run Artifact Manifest |
| Agent live tool | nested store + 本地最小展示 timer | presence | event ledger → presence projection |
| Browser Preview | renderer webview state | 可见 target，不保证 Agent target | BrowserSession/Target binding |
| Review | 空白占位 | 未实现 | 现有 Diff approval |
| Canvas | 组件本地示例节点 | 演示 | 真正 Plan/Workflow Graph 后再实现 |

任何 Inspector 行都应能回答两个问题：

1. 这是发送前配置，还是运行中实际发生？
2. 如果是实际发生，证据事件/Artifact/approval 在哪里？

## 12. Tessera 目标 Run Inspector

### 12.1 核心对象

建议把 renderer 需要的聚合契约定义为：

```ts
type RunInspectionProjection = {
  identity: RunIdentity
  summary: RunSummary
  plan: PlanProjection
  context: ContextUsageProjection
  artifacts: RunArtifactProjection[]
  agents: AgentPresenceProjection[]
  approvals: ApprovalProjection[]
  activity: ActivityProjection[]
  coverage: InspectionCoverage
}
```

`coverage` 很重要。历史 Run 可能没有新事件，不能用空数组伪装成“没有使用”：

```ts
type InspectionCoverage = {
  policy: "complete" | "partial" | "unavailable"
  resourceUsage: "complete" | "partial" | "unavailable"
  artifacts: "complete" | "partial" | "unavailable"
  plan: "complete" | "partial" | "unavailable"
}
```

### 12.2 默认区块顺序

1. **概览**：状态、实际模型、耗时/token、停止/失败原因、回到实时；
2. **进度**：用户目标级 step，等待输入与阻塞置顶；
3. **待处理**：审批、问题、冲突；没有待处理时不占首屏；
4. **执行上下文**：实际模型、Skill/MCP、资源、网络/浏览器、压缩；
5. **文件与产物**：proposed/applied/conflicted/rejected；
6. **Agent**：只有多 Agent 时显示；
7. **活动**：按需展开的结构化时间线，不默认滚动底层日志。

Eigent 把 Agent Pool 放在 Workforce 第一块有“正在工作”的即时感；Tessera 可以在多 Agent Run 时将 Agent 摘要并入概览，
但待审批与失败必须比角色列表优先。

### 12.3 与现有 UI 的整合

- assistant 消息上的 `RunInspectionPopover` 保留，作为轻入口和定位到对应 Run 的按钮；
- 点击“查看完整运行”打开/选中 Run Inspector；
- `TaskArtifactTray` 保留正式产物快捷入口，完整状态放到 Inspector；
- `AgentChangeReview` 继续内联显示，Inspector 同时列出待审批索引；
- 文档 `AgentSidebar` 顶部增加运行状态/待处理徽标，不直接复制所有区块；
- 打开 Artifact 复用现有文档路由；非文档资产才进入 Preview；
- 后续 Workforce 仍使用同一 Inspector，只新增 Agent 区块与 step assignment。

### 12.4 状态更新

renderer 不应轮询目录、解析日志文本或扫描消息寻找路径。建议主进程提供：

- `task-run:inspection-read(taskId, requestId)`：初始快照；
- `task-run:inspection-subscribe(taskId, requestId, afterSequence)`：有序增量；
- `task-run:inspection-unsubscribe(subscriptionId)`；
- `task-run:artifact-open(artifactId)`；
- `task-run:focus-target(requestId, targetId)`。

增量必须复用持久 Run event sequence，重连时从 `afterSequence` 补齐。UI 动画层可以延迟消失，但不可改变领域状态。

## 13. 分阶段实施建议

### 阶段 A：把已有事实做成常驻视图

目标是不改 Agent runtime，就把现有 `TaskRunInspection` 从浮层升级为 Inspector：

- Run selector 使用 requestId；
- 概览显示状态、实际模型、Skill/Policy、资源摘要、工具统计、时长/token；
- 显示 coverage 与“历史记录不完整”；
- assistant info icon 可打开并定位完整 Inspector；
- 适配任务页常驻和文档页 overlay。

验收：用户无需翻工具日志即可回答“哪次运行、用了哪个模型、是否联网、能看哪些资源、工具是否失败”。

### 阶段 B：计划、待处理和 Artifact Manifest

- 定义 Plan event 与稳定 step ID；
- Inline Task Card 与 Inspector 共用投影；
- 将 approval/user-input/conflict 汇总为 Pending Actions；
- 建立 Run Artifact Manifest，关联 tool call、Agent 和审批；
- 从 Project 目录发现的文件明确标为 unowned change。

验收：进度状态完整；点击 step/approval/artifact 可双向定位；历史 Run 不串文件。

### 阶段 C：实际 Context Usage

- capability loaded/used；
- resource bound/sent/read/cited；
- network source、browser session/target；
- memory injection 与 context compaction；
- UI 区分配置、装配、使用、引用。

验收：Execution Context 不依赖 renderer 猜测，所有“实际使用”均可追到结构化事件。

### 阶段 D：Preview 与多 Agent

- 非 Markdown Artifact 的 File Preview；
- 受控 Browser session 与可见 target；
- Agent read-only terminal stream；
- Agent presence 与活动历史；
- follow-live/pinned/follow-paused；
- 只有实际 Workflow Graph 可编辑时才引入 Canvas。

验收：Preview 与 Agent 真实资源 identity 一致；Agent live 动画和审计 ledger 分离。

## 14. 不应照搬

1. 不从 toolkit 文本日志解析 Skill 参数；
2. 不用当前配置重新解释历史 Run；
3. 不把“用户附加”标成“实际引用”；
4. 不把 Project 目录扫描结果全部归给当前 Run；
5. 不让每个 UI 组件自行维护运行状态和自动跟随 timer；
6. 不把互动 Terminal 变成 renderer 的 Node/PTY 权限入口；
7. 不放空 Review/Canvas 入口制造能力错觉；
8. 不新增第二套 status/motion/token 系统；
9. 不让右栏 Progress 丢失失败、阻塞、等待输入等关键状态；
10. 不让漂亮的 presence 动画代替持久活动记录。

## 15. 最终判断

Eigent 已经证明：成熟 Agent UI 不能只有一条聊天流。持续可见的 Progress、Execution Context、Artifact 和 Agent 活动，
会显著降低等待焦虑，并让复杂任务具有可检查性；Preview 让“回答”扩展为“工作过程”。这套产品分层值得 Tessera
直接吸收。

Tessera 的优势是已经拥有更可靠的本地运行事实、窄 IPC、正式 Artifact 和写入审批。近期最有价值的工作不是先做
Browser/Canvas，而是把这些已有事实汇成 Run Inspector，并补齐 Plan、Resource Usage 与 Artifact Manifest 协议。
这样既能得到截图中那种清晰的三栏体验，又避免走 Eigent 通过 renderer 推断运行事实的弯路。
