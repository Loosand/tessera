# 任务会话与导航

> 代码源头：`packages/contracts/src/index.ts`、`packages/database/schema.ts`、
> `packages/database/task-session-repository.ts`、`apps/desktop/src/main/task-service.ts`、
> `apps/desktop/src/main/ai-chat-error.ts`、
> `apps/desktop/src/main/read-only-agent-tools.ts`、`apps/desktop/src/main/mcp-service.ts`、`packages/skills/src/index.ts`、`packages/ai/src/server/agent-runtime.ts`、
> `packages/ai/src/server/task-interaction-tools.ts`、`packages/ai/src/react/use-electron-chat.ts`、`apps/desktop/src/main/index.ts`、
> `apps/desktop/src/renderer/src/hooks/use-tasks.ts`、`apps/desktop/src/renderer/src/components/app-shell.tsx`、
> `apps/desktop/src/renderer/src/components/task-page.tsx`、
> `apps/desktop/src/renderer/src/components/task-composer.tsx`、
> `apps/desktop/src/renderer/src/components/task-capability-picker.tsx`、
> `apps/desktop/src/renderer/src/components/chat-parts/`
>
> 状态：部分实现。不可删除默认空间、上次 Space 恢复、作用域任务导航，以及无工作区与工作区任务共用的 AI SDK `ToolLoopAgent` 和类型化 call options / `prepareCall` 已实现；逐轮 Skill、保守自动意图、受信任 RunPolicy、动态资源、Artifact、内容项目工具、问题暂停/续跑、研究计划、研究状态续跑、回答后引申问题、本地消息赞踩、Markdown Diff、MCP 审批、运行恢复和消息历史已实现。Shell、通用步骤级 durable replay 与多窗口接管尚未实现。

## 地位

任务是用户持续推进问答、研究、写作和项目整理的产品会话。目标形态中，Chat/Agent 不再是任务级模式：所有回复由统一 Agent runtime 执行，每一轮根据意图、显式资源、模型能力和权限决定是否使用工具。任务导航只决定会话的发现与恢复位置，不隐式授予正文或目录权限。

当前代码仍保留内部 mode 和初始单一工作区字段作为迁移期兼容归属，但所有生成进入同一入口；当前轮是否获得工作区工具由眼下打开且已授权的工作区决定，实际资源另存逐轮关系。Skill 已改为逐轮选择，会话字段只保存下一轮默认值。目标模型见[统一创作 Agent 与内容存储探索](unified-creation-agent.md)，本节必须同时区分已实现行为与规划迁移。

## 目标会话模型（规划）

- Task 保存一条连续对话，不要求创建时选择或永久绑定 Chat/Agent。
- 每次用户提交创建独立 `task_run`，固化本轮实际创作方式、Skill、模型路由、联网策略、工具集合、资源快照和审批策略。
- 创作方式默认自动，研究/写作/问答只覆盖之后发起的运行；同一任务可以自然地从问答进入研究、写作和项目整理。
- Task 可以没有工作区，也可以动态关联一个或多个 Workspace、Document、Attachment；每个 run 只看到当时明确可见和已授权的资源。
- 当前文档继续作为可见、可移除附件加入；进入文档侧栏可以默认附加编辑器最新草稿，但不能静默读取未附加正文。文档 Header 只提供侧边对话开关，右栏拥有独立精简 Header 与可持久化调宽边界；任务历史和新建统一通过一级 Space 侧栏进入，不在右栏重复导航。通过 Artifact 切换到产物项目时保留原任务，工作区资源刷新只更新可选任务列表，不重置当前会话。
- Agent 创建 Artifact、创建 Workspace 或移动文档后，更新 Task 的当前作用域和资源关联，不复制消息历史或强迫用户新建任务。
- 所有任务最终使用 AI SDK `ToolLoopAgent`；无需工具时直接生成文本，权限由 RunPolicy 与主进程资源边界决定，不由任务 mode 决定。

## 当前兼容模型（已实现）

- 默认空间是 `workspaceId = null` 的不可删除虚拟 Space，不创建工作区记录、磁盘目录或隐式文件上下文；其中的 `chat` 任务均按空归属列出。
- 文件工作区继续使用真实 `workspaceId`。主进程把最后选择的默认空间或文件工作区 ID 保存为非敏感应用设置；首次启动与失效目录回退默认空间，窗口创建时恢复仍可访问的上次工作区。
- 侧栏顶部 Space 菜单固定把默认空间放在第一项，随后列出最近文件工作区和系统目录选择入口；侧栏主体连续显示当前 Space 的最近任务，以每批 20 条的“加载更多”渐进追加，区块标题右侧用“查看全部任务 ›”进入完整列表，不单独占用一级菜单。文件 Space 中最近任务区最多占侧栏可用高度的 45% 并独立滚动，文件树使用剩余高度独立滚动，不能因任务增多而被推到长列表之后。“全部任务”页面通过同一个当前 Space IPC 契约按每页 20 条查询总数和内容，列表占满可用高度，分页栏固定在页面底部；它必须越过旧 100 条列表上限，不得在已截断数组上假分页。打开任务或文档只切换主画布，不再进入工作区二级侧栏；空任务页在同一作用域展示最多五个最近任务。
- 全局与 Space 内的最近任务都按最后一次真实对话更新倒序排列；单纯打开、恢复历史消息或补齐模型缓存不刷新 `updated_at`，相同快照保存也必须在主进程保持幂等。切换历史任务时消息区在首次可见前直接定位到最新消息，不能先显示开头再跳到底部。
- 侧栏“新任务”只在当前主画布是尚未持久化的任务草稿时选中；打开已保存对话时只选中对应任务行，两者不得同时呈现 active 状态。文档 AI 侧栏打开已保存任务时沿用同一任务行选中语义。
- `agent` 必须绑定工作区；文件工作区打开流程和文档 AI 侧栏创建的草稿默认使用 Agent。renderer 显式提交预期工作区 ID，主进程与当前窗口会话重新核对；工作区根路径只留在主进程闭包内。
- 内部 mode 由任务来源自动确定，任务首次保存后不可切换。旧任务继续保留原 mode，不做破坏性迁移。
- 创作方式与内部 mode 正交：`null` 表示自动，`research` / `writing` 对应两份内置 Skill，`question-answering` 是不加载 Skill 的问答行为标记。四个快捷项集中在创作方式浮层，运行前后均可切换；进行中的 run 保持冻结策略，会话保存之后运行的默认值，运行记录保存本轮实际值。
- 能力策略由创作方式与请求期模型事实自动派生：自动和写作优先使用可用的深度推理与原生联网，不支持时安全回落；研究必须同时具备深度推理与原生联网，否则阻止发送，并获得更高搜索额度与计划工具；问答固定关闭联网并使用供应商默认推理。工作区 Agent 把原生联网工具与受限工作区工具放入同一个工具循环。图片、视频等专用生成能力接入后使用独立工具或模型路由，不扩张为任务模式。
- Skill 仍不授予权限。自动启用能力只注册当前模型/端点已经验证、且当前内部 mode 允许的工具；写作不能绕过 Markdown Diff 审批。
- Agent 仅允许使用已声明支持工具调用的模型；缺少工作区或工具能力时必须阻止发送并明确说明，禁止降级到普通 Chat。
- 恢复 Agent 任务或开始运行前，主进程重新核对任务绑定与窗口当前工作区。

以上约束只描述当前代码，不能继续扩展为目标产品模型。迁移期间旧任务保持原 mode 与权限语义；新领域工具不得通过修改旧 `workspace_id` 偷渡跨工作区访问。

## 持久化

`task_sessions` 保存兼容 mode、下一轮可选 `skill_id` 默认值、可选工作区、标题、状态、等待输入标记与时间；`task_messages` 按序保存应用自有的版本化消息 JSON。由于已发布迁移中的旧状态列带固定 `CHECK`，`waiting-input` 在物理层兼容编码为 `status = running` 加 `waiting_for_input = 1`，仓储读写时统一映射为公开状态；后续迁移不重写用户已有表。
消息契约保留正文、reasoning、来源、附件、工具状态、审批状态、版本化 `data-follow-up-questions`，以及助手消息使用的供应商、模型、本轮 `requestId` 和可选本地反馈。正常完成回答后的 2–4 个引申问题随助手消息持久化，刷新或重启后仍恢复为“继续探索”；用户点击只把完整问题带入输入框，不自动提交。赞踩以 `positive` / `negative` 和更新时间写入对应助手消息 metadata，支持改投与撤销；它不作为 prompt 内容发送，不上传供应商，也不宣称参与训练。完成消息可通过轻量图标按需读取归属校验后的脱敏运行解释；同一份记录也为历史消息的“已工作”区块恢复准确耗时，模型、Skill、资源、工具和结束/失败原因不会以常驻诊断文字挤占对话正文。当前 Markdown 草稿以 `text/markdown` Data URL 作为可见用户附件持久化，单份限制 256 KiB；服务端在模型转换前解码并包入明确的“材料而非系统指令”边界，避免依赖供应商对文本文件的兼容性。图片继续保留原文件 Part。
模型运行输入使用经主进程校验的完整 `UIMessage` 历史，再由 AI SDK `convertToModelMessages` 转换；工具结果与审批响应可以进入下一轮，应用元数据仍不会自动变成模型正文。
主进程校验 IPC 请求中的本轮 Skill，但不再要求它等于会话默认值；当前 Skill 正文通过 AI SDK call options 注入 `instructions`，不伪装为用户消息，也不把未选中 Skill 放入模型上下文。renderer 不再发送联网/推理开关，主进程按持久化模型事实生成实际 RunPolicy；`0009-task-run-policy` 保留可查询兼容列，`0010-task-run-context` 保存完整策略与不含正文/绝对路径的资源摘要，旧 run 的新增字段保持未知而不伪造历史。

目标持久化采用向前兼容迁移：保留已发布的 `task_sessions.mode`、`skill_id` 和 `workspace_id` 供旧任务恢复；新运行把实际策略固化到 `task_runs`，并通过规划中的 `task_resource_bindings` / `artifacts` 记录动态资源。旧列不原地重写，Markdown 正文也不迁入任务数据库。

任务直到发送第一条消息时才落库。保存输入必须显式携带可空的工作区 ID：`null` 表示独立草稿；非空值必须与主进程当前窗口打开的工作区一致，防止渲染层把任务绑定到任意路径。

运行中的消息快照只保存已经稳定的历史消息；若末尾助手消息仍在流式生成、等待引申问题后处理或工具输入仍在增量到达，renderer 不把这段未完成内容写入任务快照。页面返回时由后台事件重放重建这条助手消息，避免“数据库里的半条消息 + 重放增量”造成正文和思考过程重复。完整的工具请求和工具输出属于稳定历史，自动续轮期间继续保留；回答后 Data Part 到达并发出 `finish` 后，再保存完整助手消息。

## 等待用户输入与自动续跑

`request-user-input` 与写入审批解决不同问题：前者只收集无法合理推断、会决定核心语义的选择，不执行服务端副作用；平台、篇幅、风格、语气、受众、文章角度、输出格式、资料范围和个性化偏好由模型采用合理默认值，不得触发提问。客户端问题工具不提供 `execute`，所以 AI SDK 在工具请求完成后结束当前模型请求。此时 renderer 保存包含完整问题输入的助手消息，并把任务标记为 `waiting-input`；普通输入框不再提交竞争消息，但用户仍可在专用卡片里回答、跳过或关闭。

回答被写成同一 tool call 的类型化输出；`useChat` 只在最后一个 step 的客户端问题已经获得输出时自动发送下一轮，普通工具完成不会误触发额外请求。每次调用的 Schema 只接受一个问题；下一轮根据持久化消息识别当前用户请求已经询问过，并从工具集中移除 `request-user-input`，因此模型不能连续追问。完整流程如下：

```text
模型调用 request-user-input
  -> 当前模型请求以工具调用结束
  -> task_messages 保存问题 Part，task_sessions 进入 waiting-input
  -> 用户回答/跳过/关闭
  -> renderer addToolOutput
  -> 带工具输出的下一轮自动发送
  -> 新的稳定消息覆盖等待态，任务恢复 running/completed
```

单次模型请求对应的 `task_run` 已经正常结束，而整个 `task_session` 可以继续等待用户；二者不共用一个“运行中”语义。应用重启后，持久化的工具请求仍呈现同一问题卡片，用户作答即可继续，不需要重放已经结束的模型请求。

旧开发版本曾把普通 Chat 快照写入 `agent_sessions` / `agent_events`。`0002-task-sessions` 只迁移带
`chat.snapshot` 的会话，保留消息顺序；既有 Agent 专用表不被重写。

## 当前导航流程（已实现）

```text
启动 / 切换 Space
  -> 主进程恢复或保存 default / workspaceId
  -> renderer 加载 workspaceId = null 或当前文件工作区的任务列表
  -> 创建属于当前 Space 的内存草稿

当前 Space 新任务
  -> 默认空间首次发送时保存为无目录 Chat
  -> 文件工作区首次发送时保存为工作区 Agent

文档 AI 侧栏
  -> 复用当前工作区任务与同一个 TaskPage 会话实现
  -> 作为独立可调宽列呈现，文档 Header 只负责开关
  -> 默认把编辑器最新草稿作为可移除附件
  -> 关闭或切换到完整任务页时按 task id 断线恢复

Space 落地页 / 侧栏最近任务
  -> 只列出当前 Space 任务
  -> 按 task id 从主进程读取版本化消息
  -> 以 task id 重建 useChat 状态
  -> 若主进程仍有该任务的运行，则订阅实时事件并恢复有序事件快照
  -> 流式状态变化后节流保存任务消息和状态
```

跨工作区兼容入口使用待打开 task id，等待 Space 切换完成后再读取任务，避免旧工作区 effect 覆盖恢复结果；切到默认空间时主进程关闭当前文件监听会话，再读取空归属任务。

## 目标连续流程（规划）

```text
一级侧栏新任务
  -> 创建无资源的内存草稿
  -> 首次发送时保存 Task 和首个 Run
  -> ToolLoopAgent 零工具回答或按策略联网

同一任务要求写作
  -> 下一 Run 自动或显式选择写作 Skill
  -> 当前混合实验中，若没有目标 Workspace，则使用已授权内容库的“未归档”
  -> 创建 Markdown Artifact 并附加到当前 Task
  -> TaskPage 打开对话 + 文档协作视图

同一任务要求独立项目
  -> 创建本地 Workspace
  -> 移动 Artifact，更新资源关联和索引
  -> 当前作用域切换到新 Workspace
  -> 原 Task、消息和运行历史继续使用
```

工作区聚合页可以根据资源关联展示 Task，但导航归属不能成为权限事实；打开任务时仍由主进程按本轮资源快照重新解析授权。

## 对象上下文菜单

统一 Space 侧栏中的任务与文件树使用各自的对象右键命令，菜单操作直接作用于被右键点击的对象，不依赖当前选中项。

- 对话提供打开、重命名和删除。重命名立即同步最近任务、工作区任务列表及当前任务标题；删除先由 Electron 原生确认框确认，再中止该任务仍在进行的模型运行，删除会话与级联消息。若删除的是当前任务，界面留在相同导航范围并按是否绑定工作区创建新的 Chat 或 Agent 草稿。
- 工作区提供打开、在 Finder 中显示、复制路径和从最近列表移除。“移除”只写入工作区的隐藏时间，不删除本地目录、索引或任务；用户再次打开同一路径时会清除隐藏状态并重新进入最近列表。
- 工作区当前仍在窗口中打开时，从最近列表移除不会关闭工作区或清空编辑状态；它只影响后续最近列表和启动恢复候选。

## 后台运行与断线恢复

生成运行归主进程所有，不归 `TaskPage`、React 路由或某次 `ReadableStream` 订阅所有。renderer 离开任务页、组件卸载或 AI SDK 关闭本地响应流时，只移除当前事件订阅；用户点击停止时，Transport 先调用独立的取消 IPC，再停止 AI SDK 本地状态机。任务删除、窗口销毁和应用退出也会中止对应运行。

每个主进程事件都携带 `taskId`、`requestId` 与单调递增的 `sequence`，并幂等追加到运行日志；SQLite 的 `lastSequence` 只前进、不因迟到或重复事件倒退。正文、推理和工具参数的同类连续 delta 在编号与持久化之前按稳定阈值合并，遇到不同 ID/类型、工具结果、引申问题、错误或结束事件先刷新，因此减少事件数量但不改变恢复顺序。只有已持久化任务挂载时启用 AI SDK `resume`：返回页面先建立实时订阅，再请求 `resumeAiChat(taskId)` 快照，按连续序号合并快照和请求期间收到的实时事件；重复事件忽略，乱序事件暂存到缺失序号到达后再交给 AI SDK。已结束快照存在序号缺口或缺少终止事件时写入可见 `resume-failed`，不静默关闭。尚未首次发送的内存草稿不请求恢复；主进程遇到不存在的任务或没有活动流时正常返回空结果，不进入错误状态。

```text
页面 A 开始生成
  -> 主进程创建 task run 并持续写入有序事件
  -> 页面 A 离开，只解除 renderer 订阅
  -> 模型与主进程继续生成
  -> 页面 A 返回，先订阅实时事件，再读取运行快照
  -> 按 sequence 重放并去重
  -> 恢复到实时流，完成后持久化完整消息
```

运行元数据和每个有序事件同时写入 SQLite。页面切换优先从主进程内存续接；应用意外退出后，启动恢复会把未结束运行标记为 `interrupted`，追加带稳定 code、phase 与 retryable 的可见错误事件并重放中断前进度，同时把非等待中的 task session 收口到对应终态。若最新运行已经结束、但 renderer 尚未来得及把对应 `requestId` 写入助手消息，恢复接口仍会重放这次终态运行；renderer 保存完整助手消息后，同一运行不再被识别为待恢复，避免重复注入。读取历史事件时只在返回快照中临时合并连续 delta 并重新生成连续序号，SQLite 原始审计序列不改写。启动、流式和恢复阶段的异常都先在 AI SDK 字符串化前分类，嵌套 RetryError 的稳定类别与安全 HTTP 状态进入 `data-task-error`，未知供应商载荷使用脱敏公开文案；初始化在 `task_run` 建立后失败时也先持久化同一失败事件。工具输入或执行失败继续使用 AI SDK 标准 Tool Part 状态，并额外写入可恢复的 `data-tool-error`（稳定 code、retryable、`toolCallId`、`toolName`）；消息 UI 不重复渲染第二张失败卡，诊断与审计仍可读取结构化 Part。

模型供应商的原始网络流和内存 `ToolLoopAgent` 不能跨进程继续，因此恢复不会自动重放写工具。消息级续跑先覆盖最常见
断点：用户重试失败助手消息时，Transport 在 AI SDK 删除该消息前暂存非 preliminary 的成功 Tool Part；新 request 把
它们补到输入末尾，主进程复核消息 ID、可重试失败和成功结果，再把 `continuedFromMessageId` 写入资源摘要。模型因此从
已完成工具结果之后继续，未完成工具、写入和审批不会重放。研究方式在此基础上再提交 `regenerateMessageId`，主进程从
持久化 metadata 解析旧 `requestId`，把 `resumedResearchRequestId` 写入资源摘要，并克隆计划、来源元数据、证据、推荐
和覆盖状态；网页正文仍不复制。这仍不是自动步骤级 durable runtime，多窗口接管和无用户动作的后台 checkpoint 续跑
尚未实现。

## 工作区 Agent 运行时

- AI SDK `ToolLoopAgent` 通过 `@tessera/agent-runtime` 的泛型 `AgentRuntime` 端口运行；主 Agent 获得共享客户端问题工具；只有当前请求明确涉及工作区/文档、显式携带 Markdown 材料，或确实承接上一轮工作区工具结果时，才组合四个只读 Markdown 工具、一个需要审批的写工具和一个只读研究子 Agent 工具。MCP 动态工具仍由主进程按配置注入，研究 Skill 额外获得无副作用的计划展示工具。根路径和 MCP 秘密不进入 IPC、renderer 或模型提示词，结构化交互工具也不扩大文件或网络权限。
- 工具只遍历可见的 `.md` / `.markdown`，忽略隐藏目录、`.git`、`.tessera`、`node_modules` 和遍历时遇到的符号链接。
- 每次直接读取都会重新执行相对路径、真实路径与扩展名校验；`../`、绝对路径、隐藏路径和指向工作区外部的符号链接均不可用。当前文档只作为相对路径提示传入，读取时执行相同校验。
- 单文件读取上限为 256 KiB；文件列表最多返回 500 项、最多扫描 2,000 项；搜索最多扫描 8 MiB 并返回 100 个匹配，触顶时返回结构化 `truncated`、上限和跳过文件信息。
- 普通问答/写作继续使用短运行护栏；显式研究不设置累计 Token 预算，并显式采用模型档案声明的原生最大输出，
  防止兼容 SDK 回落到 4096。研究按模型上下文窗口使用 32/48/64 步的异常循环保险丝并允许最长 30 分钟。保险丝只
  防止失控，不替代证据完成检查；渲染层停止操作复用现有中止信号。
- 工具输入、资源相对路径、完成或失败状态通过版本化消息 Part 展示并持久化，不把冗长工具结果直接展开成消息正文。
- 回答中的相对 Markdown 链接可跳转到文档和源码行；路径仍由主进程在真正读取时复核。
- provider 的 reasoning ID 只保证步骤内有效，渲染层按消息内 Part 位置生成唯一 React key，避免多步骤流式追加时复用或复制旧思考节点。
- `write-workspace-document` 使用 AI SDK `toolApproval`。工具 `inputSchema` 保持供应商兼容的顶层 `type: object`，并在运行时继续要求 update 携带读取时的版本与内容哈希；审批请求到达 renderer 前，主进程把路径、基准内容/版本、完整候选内容、模型与工具调用冻结到 SQLite；聊天内可切换渲染后文档和源码 Diff。
- 批准后的新 turn 携带完整审批 Part；工作区变更服务只对账 `write-workspace-document` 的冻结提案，不消费内容库或 MCP 的标准审批；各领域工具在自己的审计边界内继续执行。工作区工具再次校验真实路径、内容哈希和磁盘版本并原子替换。拒绝不执行，冲突不覆盖，应用重启不会自动执行待审批写入。
- `delegate-workspace-research` 按 AI SDK 子 Agent 模式运行独立只读上下文，只把摘要返回主 Agent；子 Agent 没有写工具或审批能力。
- MCP 工具只来自显式信任且启用的服务器，并经过逐工具禁用清单；每个工具固定使用 AI SDK 标准人工审批，批准后的下一轮再次核对服务器与工具仍启用。MCP annotations 只提示风险，不能自动批准；秘密和输出限制由主进程边界处理，完整设计见 [MCP 服务器与 Agent 工具边界](mcp.md)。
- 删除、重命名和 Shell 仍未注册；它们需要独立权限与配置面，不能借用 Markdown 写审批或 MCP 信任扩大能力。

## 后续

- 在现有共用 `task-agent.ts` 与受信任 RunPolicy 上增加自动意图识别和规范化动态资源关联；任何扩展继续通过 AI SDK call options / `prepareCall` 收窄，不复制 Agent loop。
- 以托管内容库 Inbox 作为当前实验实现 Artifact、项目创建和跨工作区文档移动，同时保持领域协议可替换，以便评估数据库与完全外部工作区方案。
- 记录完成原因、token 用量和每轮耗时。
- 为长会话增加上下文裁剪或摘要，但不改写持久化的用户原文。
- 在已实现消息级工具结果续跑与研究语义续跑之外，为通用 Agent 增加桌面 durable 步骤检查点，在不重放已执行副作用的前提下自动后台续跑。
- 把 MCP Resources / Prompts / OAuth、按任务绑定与运行策略快照接入现有权限网关；建设 Shell 独立审批面，默认保持关闭。
