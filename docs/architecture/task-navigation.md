# 任务会话与导航

> 代码源头：`packages/contracts/src/index.ts`、`packages/database/schema.ts`、
> `packages/database/task-session-repository.ts`、`apps/desktop/src/main/task-service.ts`、
> `apps/desktop/src/main/read-only-agent-tools.ts`、`packages/ai/src/server/agent-runtime.ts`、
> `packages/ai/src/react/use-electron-chat.ts`、`apps/desktop/src/main/index.ts`、
> `apps/desktop/src/renderer/src/hooks/use-tasks.ts`、`apps/desktop/src/renderer/src/components/app-shell.tsx`、
> `apps/desktop/src/renderer/src/components/task-page.tsx`
>
> 状态：部分实现。普通 Chat、工作区 Agent、Markdown Diff 审批、任务运行事件恢复和消息历史已实现；Shell、MCP、真正跨进程续跑与多窗口接管尚未实现。

## 地位

任务是 Chat 与 Agent 共用的产品会话。任务导航只决定会话归属和恢复位置，不向模型隐式提供工作区内容。
普通 Chat 即使关联到某个工作区，也只能发送用户显式输入和当前历史；只有 Agent 运行时可以使用主进程注入的工作区工具。

## 模式与工作区

- `chat` 可以不绑定工作区；一级侧栏的“新任务”默认创建这种独立草稿，只有从工作区二级页面新建时才关联当前工作区。
- “草稿”只是未绑定 Chat 的导航标签，不创建工作区记录、磁盘目录或隐式文件上下文。
- `agent` 必须绑定工作区。renderer 显式提交预期工作区 ID，主进程与当前窗口会话重新核对；工作区根路径只留在主进程闭包内。
- mode 在首条消息前通过任务输入框内的分段控件选择；任务首次保存后不可切换。
- Agent 仅允许使用已声明支持工具调用的模型；缺少工作区或工具能力时必须阻止发送并明确说明，禁止降级到普通 Chat。
- 恢复 Agent 任务或开始运行前，主进程重新核对任务绑定与窗口当前工作区。

## 持久化

`task_sessions` 保存 mode、可选工作区、标题、状态与时间；`task_messages` 按序保存应用自有的版本化消息 JSON。
消息契约保留正文、reasoning、来源、附件、工具状态、审批状态以及助手消息使用的供应商和模型。
模型运行输入使用经主进程校验的完整 `UIMessage` 历史，再由 AI SDK `convertToModelMessages` 转换；工具结果与审批响应可以进入下一轮，应用元数据仍不会自动变成模型正文。

任务直到发送第一条消息时才落库。保存输入必须显式携带可空的工作区 ID：`null` 表示独立草稿；非空值必须与主进程当前窗口打开的工作区一致，防止渲染层把任务绑定到任意路径。

运行中的消息快照只保存已经稳定的历史消息；若末尾助手消息仍在流式生成，renderer 不把这段未完成内容写入任务快照。页面返回时由后台事件重放重建这条助手消息，避免“数据库里的半条消息 + 重放增量”造成正文和思考过程重复。运行完成后再保存完整助手消息。

旧开发版本曾把普通 Chat 快照写入 `agent_sessions` / `agent_events`。`0002-task-sessions` 只迁移带
`chat.snapshot` 的会话，保留消息顺序；既有 Agent 专用表不被重写。

## 导航流程

```text
一级侧栏新任务
  -> 创建 workspaceId = null 的内存草稿
  -> 首次发送时保存为独立 Chat

工作区二级侧栏新任务
  -> 创建绑定当前工作区的内存草稿
  -> 首次发送时保存为工作区 Chat

主页最近任务 / 工作区任务列表
  -> 独立任务直接打开；绑定任务必要时先打开对应工作区
  -> 按 task id 从主进程读取版本化消息
  -> 以 task id 重建 useChat 状态
  -> 若主进程仍有该任务的运行，则订阅实时事件并恢复有序事件快照
  -> 流式状态变化后节流保存任务消息和状态
```

跨工作区打开任务使用待打开 task id，等待工作区切换完成后再读取任务，避免旧工作区 effect 覆盖恢复结果。打开独立任务时保留窗口当前工作区会话，但任务导航与保存都保持未绑定状态。

## 对象上下文菜单

一级侧栏、工作区聚合页与二级工作区侧栏中的任务和工作区共享同一组右键命令，菜单操作直接作用于被右键点击的对象，不依赖当前选中项。

- 对话提供打开、重命名和删除。重命名立即同步最近任务、工作区任务列表及当前任务标题；删除先由 Electron 原生确认框确认，再中止该任务仍在进行的模型运行，删除会话与级联消息。若删除的是当前任务，界面留在相同导航范围并创建一个未落库的新 Chat 草稿。
- 工作区提供打开、在 Finder 中显示、复制路径和从最近列表移除。“移除”只写入工作区的隐藏时间，不删除本地目录、索引或任务；用户再次打开同一路径时会清除隐藏状态并重新进入最近列表。
- 工作区当前仍在窗口中打开时，从最近列表移除不会关闭工作区或清空编辑状态；它只影响后续最近列表和启动恢复候选。

## 后台运行与断线恢复

生成运行归主进程所有，不归 `TaskPage`、React 路由或某次 `ReadableStream` 订阅所有。renderer 离开任务页、组件卸载或 AI SDK 关闭本地响应流时，只移除当前事件订阅；用户点击停止时，Transport 先调用独立的取消 IPC，再停止 AI SDK 本地状态机。任务删除、窗口销毁和应用退出也会中止对应运行。

每个主进程事件都携带 `taskId`、`requestId` 与单调递增的 `sequence`，并追加到该运行的内存事件日志。任务页使用 AI SDK `resume: true`：返回页面时先建立实时订阅，再请求 `resumeAiChat(taskId)` 快照，按序重放快照和请求期间收到的实时事件，并用 sequence 去重，最后继续消费实时增量。

```text
页面 A 开始生成
  -> 主进程创建 task run 并持续写入有序事件
  -> 页面 A 离开，只解除 renderer 订阅
  -> 模型与主进程继续生成
  -> 页面 A 返回，先订阅实时事件，再读取运行快照
  -> 按 sequence 重放并去重
  -> 恢复到实时流，完成后持久化完整消息
```

运行元数据和每个有序事件同时写入 SQLite。页面切换优先从主进程内存续接；应用意外退出后，启动恢复会把未结束运行标记为 `interrupted`，追加可见错误事件并重放中断前进度。模型供应商的原始网络流和内存 `ToolLoopAgent` 不能跨进程继续，因此恢复不会自动重放写工具；用户从已恢复消息继续或重试。真正从模型步骤检查点自动续跑仍需桌面适配的 durable runtime，多窗口接管也尚未实现。

## 工作区 Agent 运行时

- AI SDK `ToolLoopAgent` 通过 `@tessera/agent-runtime` 的泛型 `AgentRuntime` 端口运行；主 Agent 获得四个只读 Markdown 工具、一个需要审批的写工具和一个只读研究子 Agent 工具，根路径不进入 IPC、renderer 或模型提示词。
- 工具只遍历可见的 `.md` / `.markdown`，忽略隐藏目录、`.git`、`.tessera`、`node_modules` 和遍历时遇到的符号链接。
- 每次直接读取都会重新执行相对路径、真实路径与扩展名校验；`../`、绝对路径、隐藏路径和指向工作区外部的符号链接均不可用。当前文档只作为相对路径提示传入，读取时执行相同校验。
- 单文件读取上限为 256 KiB；文件列表最多返回 500 项、最多扫描 2,000 项；搜索最多扫描 8 MiB 并返回 100 个匹配，触顶时返回结构化 `truncated`、上限和跳过文件信息。
- 单轮最多执行 8 个步骤，每步最多生成 4,096 token，累计模型用量达到 80,000 token 或总运行达到 120 秒时停止；渲染层停止操作复用现有中止信号。
- 工具输入、资源相对路径、完成或失败状态通过版本化消息 Part 展示并持久化，不把冗长工具结果直接展开成消息正文。
- 回答中的相对 Markdown 链接可跳转到文档和源码行；路径仍由主进程在真正读取时复核。
- provider 的 reasoning ID 只保证步骤内有效，渲染层按消息内 Part 位置生成唯一 React key，避免多步骤流式追加时复用或复制旧思考节点。
- `write-workspace-document` 使用 AI SDK `toolApproval`。审批请求到达 renderer 前，主进程把路径、基准内容/版本、完整候选内容、模型与工具调用冻结到 SQLite；聊天内可切换渲染后文档和源码 Diff。
- 批准后的新 turn 携带完整审批 Part；主进程对账冻结提案后，工具再次校验真实路径、内容哈希和磁盘版本并原子替换。拒绝不执行，冲突不覆盖，应用重启不会自动执行待审批写入。
- `delegate-workspace-research` 按 AI SDK 子 Agent 模式运行独立只读上下文，只把摘要返回主 Agent；子 Agent 没有写工具或审批能力。
- 删除、重命名、Shell 和 MCP 外部工具仍未注册；它们需要独立权限与配置面，不能借用 Markdown 写审批扩大能力。

## 后续

- 记录完成原因、token 用量和每轮耗时。
- 为长会话增加上下文裁剪或摘要，但不改写持久化的用户原文。
- 为中断的 Agent 增加桌面 durable 步骤检查点，在不重放已执行副作用的前提下自动续跑。
- 建设 MCP 服务器配置/权限网关与 Shell 独立审批面；默认保持关闭。
