# Agent 产品反馈层：Progress、Execution Context 与 Artifact

> 代码源头：`packages/contracts/src/index.ts`、`apps/desktop/src/main/task-run-inspection.ts`、
> `apps/desktop/src/renderer/src/components/tasks/messages/chat-message.tsx`、
> `apps/desktop/src/renderer/src/components/tasks/messages/chat-parts/task-run-activity.tsx`、
> `apps/desktop/src/renderer/src/components/tasks/messages/run-inspection-popover.tsx`、
> `apps/desktop/src/renderer/src/components/tasks/artifacts/task-artifact-tray.tsx`、
> `apps/desktop/src/main/content-library-service.ts`
>
> 状态：**P5 一期已实现。** 当前提供事件驱动的 Progress、实际 Execution Context 和稳定 Artifact 预览；
> 公开 Plan、版本 Diff、child run 与 Browser 有明确触发条件，但没有空运行时或伪数据。

## 1. 决策

Tessera 吸收 Eigent 的产品反馈层，不吸收它的 Workforce 作为 Agent Kernel。产品反馈只投影已经发生的运行事实：

```text
RunPolicy + task_run_events + TaskArtifact
                    |
                    v
          主进程只读安全投影
          /        |         \
   Progress   Execution Context   Artifact
          \        |         /
             renderer 展示
```

UI 不是第二套状态机。页面切换、renderer 重挂载或应用重启后，同一个 `requestId` 必须从 SQLite Run/Event 与
Artifact 关系恢复出相同结果；不得解析模型旁白、reasoning、目录扫描或开发者日志猜测状态。

## 2. Progress

### 2.1 实时活动

对话中的工作过程只读取 AI SDK Part 的公开类型和状态：

- `input-streaming` / `input-available` 显示当前工具动作，例如“正在读取文件”“正在运行工作区命令”；
- 工具已经完成、模型仍在继续时显示“正在整理结果”；
- 只有非终态 reasoning Part 且没有更具体工具活动时显示通用“正在分析”，不读取 reasoning 正文生成标签；
- 运行中保持过程展开和像素动效，用户能继续查看结构化工具活动。

### 2.2 最终状态

完成后过程默认折叠，标题显示本轮已收口工具动作数和实际耗时，例如“已完成 2 个动作 · 12.4s”。按需运行详情
从持久化事件生成：

- phase：`working / waiting / completed / failed / cancelled / interrupted`；
- `currentToolName`：尚未收口的最新已接受工具；
- `completedActionCount / totalActionCount`：按 `toolCallId` 去重的终态/总动作数；
- 结构化提问和未完成人工审批是 `waiting`，不是成功或失败。

Progress 不显示模型私密推理，也不把工具名改写为用户目标步骤。当前没有新运行可写入的公开 Plan 事实源，因此
一期不从用户文本或工具序列推断“步骤 1/2/3”。复杂任务若需要可编辑 Plan，必须由独立版本化公开数据产生，不能
恢复已删除的 Research 计划工具或增加一个只为 UI 服务的第五核心工具。

## 3. Execution Context

运行详情明确分为“执行上下文”和“诊断”。执行上下文只展示本轮实际模型、Skill、RunPolicy、已调用工具，以及
成功事件能够证明的文件、Web 和 MCP：

| 类别 | 事实源 | 脱敏规则 | 上限 |
| --- | --- | --- | ---: |
| 文件 | 成功 `read/edit/write` 的 `path`；Bash 结果的 `changedFiles` | 只接受工作区相对路径，拒绝绝对路径、盘符、NUL 与 `..` | 32 |
| Web | `source-url` 事件；成功 `read-web-source` 输入 | 只保留小写 hostname，删除 scheme 之外的路径、credentials、query、fragment | 16 |
| MCP | 成功结束且工具名以 `mcp__` 开头 | 只保留稳定工具 ID，不返回服务器配置、输入、输出或 Secret | 16 |

任一类别超限时设置 `truncated=true`；原始持久化事件不删除。失败、拒绝或只有模型输入但没有成功结果的工具仍可在
“实际工具”归因中看到，但不会被宣传为成功使用的文件/Web/MCP 上下文。

执行上下文不包含：prompt、消息正文、reasoning、Bash command、Web query/完整 URL、MCP 参数/结果、绝对工作区根、
API Key 或环境变量。当前文档和附件数属于“输入资源”，与“实际成功使用”分开显示。

## 4. 诊断

诊断继续服务故障解释，不和用户进度混成一个区块：

- Token 与缓存读写；
- ContextManifest、压缩和预算；
- model turn、工具数、等待工具数；
- 首输出、模型、工具和总耗时；
- 结束/失败原因与 request ID；
- 供应商错误响应正文（最多 16,000 字符，只剔除 API Key / Authorization 凭据）。

数值缺失显示“未返回”，不伪造为 0。供应商错误响应正文是产品诊断唯一允许的原始载荷；请求正文、响应 Header、堆栈和工具输入输出仍不进入投影。开发者 AI SDK Viewer 是另一条更宽的明文开发诊断边界，不进入产品反馈投影。

## 5. Artifact tray

Artifact tray 只消费 SQLite 中稳定的 `TaskArtifact`：

- `created / updated / imported` 分别显示“新建 / 更新 / 导入”；
- 卡片显示文档、所属项目、Markdown 类型和安全相对路径 title；
- “预览”打开真实 Markdown 文档，并在右侧继续同一任务，不复制会话；
- 直接 `edit/write` 成功与 Bash 真实 Markdown 文件事件都可登记 Artifact；
- 临时工具文本、观察失败和非 Markdown 文件不伪装成 Artifact。

当前 Artifact 关系只指向文件现状，没有保存每次修改前后的正文快照，因此不能诚实生成历史 Diff。P5 明确保留
“打开并预览”，不把当前正文与猜测基线比较。只有本地版本历史提供稳定 before/after revision 后，tray 才能增加
“查看 Diff”，且不能恢复逐次写入审批作为替代。

## 6. 分层展示

| 层 | 用户问题 | 当前入口 |
| --- | --- | --- |
| 工具活动 | Agent 此刻在做什么？ | 回复内展开的工作过程与 Tool Part |
| Progress | 这轮是否仍在工作、等待或已结束？ | 工作过程标题；运行详情顶部 |
| Execution Context | 这轮实际用了哪些模型、Skill、工具、文件、Web、MCP？ | 运行详情中部 |
| Artifact | 产生或更新了什么可打开内容？ | 消息区底部 Artifact tray |
| 诊断 | 为什么慢、失败、超预算或中断？ | 运行详情下部 |

Reasoning 只在供应商真的返回可展示文本时作为单独 Part 呈现，不是进度事实源。

## 7. 明确不做与触发器

### 公开 Plan

当前不新增 Plan tool、空 `publicPlan` 字段或 renderer 临时计划。真实复杂任务证明需要可编辑目标步骤后，应先定义
版本化 Plan 数据、作者/更新时间、完成语义和持久化消费者；简单任务仍不强制规划。

### Child run / Delegation

当前没有证据证明单 Agent 四核心无法完成一期任务，也没有 child run 的资源交集、预算、取消、返回和持久化协议。
只有固定评测证明并行或上下文隔离带来稳定收益时，才另立有界 child run；不建设 Workforce、固定 Worker 池或 Agent 画布。

### Browser

公开 Web Reader 是低权限静态读取，不拥有登录身份、标签页或交互状态。Browser 必须另立 `BrowserSession`、身份、预览、
授权、超时和清理生命周期，不能把 Reader 的 HTTP 结果包装成“浏览器正在操作”。

## 8. 验证

- 主进程投影测试覆盖成功文件、Bash 变更路径、Web hostname、MCP、非法/绝对路径丢弃、query/工具输入不泄露、
  完成进度和结构化等待进度；
- renderer 测试覆盖工具活动标签不读取 reasoning 正文、完成动作数/耗时、Progress/Execution Context 中文标签、
  Artifact 关系与预览入口；
- 所有字段通过既有 `task-run:read(taskId, requestId)` 归属检查按需加载，不增加数据库迁移或 renderer 私有事实源。
