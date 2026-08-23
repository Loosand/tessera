# AI 运行可观测性

> 代码源头：`apps/desktop/src/main/ai-devtools.ts`、`apps/desktop/src/main/index.ts`、
> `apps/desktop/src/preload/index.ts`、`apps/desktop/src/renderer/src/components/settings-page.tsx`、
> `apps/desktop/src/renderer/src/components/chat-message.tsx`、
> `apps/desktop/src/renderer/src/components/run-inspection-popover.tsx`、
> `apps/desktop/src/renderer/src/components/chat-parts/reasoning-part.tsx`、
> `apps/desktop/src/main/task-run-inspection.ts`、
> `apps/desktop/src/main/ai-chat-chunk-coalescer.ts`、
> `packages/ai/src/server/task-agent.ts`、`packages/ai/src/server/follow-up-questions.ts`、`packages/database/schema.ts`、
> `packages/database/task-run-repository.ts`、`packages/contracts/src/index.ts`
>
> 状态：部分实现。开发环境的 AI SDK 官方 DevTools、统一 Agent 观测标识、空 reasoning 摘要处理、版本化运行/工具错误、SQLite 脱敏运行汇总及消息级按需运行解释已实现；有限保留的生产诊断事件与历史列表仍在规划。

## 决策

开发期 AI 运行日志优先采用 AI SDK 7 的标准 Telemetry 集成与官方 `@ai-sdk/devtools`，不平行维护另一套 Agent step/tool 调试协议。Electron 主进程在开发环境启动时全局注册 `DevToolsTelemetry()`；统一 `ToolLoopAgent` 使用稳定的 `id` 与 `functionId`，因此普通回答、研究、写作和工作区动作进入同一条观测链路。

产品运行汇总使用同一个 `ToolLoopAgent` 的标准 `onStepEnd` / `onEnd` 生命周期，而不是从 UI chunk 反推。正常完成时以 `onEnd` 的聚合 usage 和 finish reason 为准；运行中和取消前以已完成 step 快照保留可得指标。回答后的结构化引申问题属于同一用户可见 run 的非关键模型后处理，其 usage、缓存、步骤数和模型耗时在发出最终 `finish` 前并入汇总；主调用的 call ID、完成原因、首输出延迟和工具计数保持不变。主进程只把无正文的汇总写入 `task_runs`：SDK call ID、统一/原始完成原因、输入/输出/推理 Token、缓存读写 Token、步骤数、工具调用数、首输出延迟、模型/本地工具耗时与任务总耗时。

Viewer 按需启动，不阻塞 Tessera 首屏。设置页只在开发构建显示「开发者 → AI 运行日志」，点击后由窄 IPC 请求主进程启动官方本地 Viewer，并在系统浏览器打开 `http://localhost:4983`。渲染层不获得 Node.js、进程路径或日志文件读写权限。

用户可解释性不依赖开发者 Viewer。每个助手回复在 metadata 中保存对应 `requestId`；完成态消息操作栏只显示一个
“运行信息”图标，打开后经 `task-run:read(taskId, requestId)` 按需读取脱敏投影。主进程先验证任务归属，再返回
实际模型、RunPolicy/Skill、资源摘要、按 `toolCallId` 去重的工具计数、结束/失败原因、用量与耗时；不返回 prompt、
正文、完整工具输入输出、绝对路径或密钥。初始化阶段在 `task_run` 建立后失败时也先追加类型化错误事件，再结束运行，
因此不会出现“前端看见失败但运行历史没有原因”的断层。

公开流事件用于恢复和 UI，而不是 Token 级追踪。主进程在分配 `sequence`、写 SQLite 和广播 IPC 前，把同一 ID 的连续
`text-delta`、`reasoning-delta` 或同一 tool call 的 `tool-input-delta` 合并到至少 160 字符；遇到不同类型/ID、工具
结果、失败、`finish` 或异常收口时先刷新尾部。合并不改变 AI SDK `onStepEnd` / `onEnd` 指标，也不跨语义边界重排，
因此调试 Viewer 仍可观察供应商原始生成，而产品恢复链不会被数万条逐 token 事件淹没。对优化上线前已经持久化的
高密度历史，恢复接口在只读快照中执行同一合并并生成临时连续序号；这只降低 renderer 回放压力，不修改 SQLite
中的原始事件、`lastSequence` 或黄金审计依据。

```text
ToolLoopAgent / generateText / streamText
  +-> AI SDK registerTelemetry(DevToolsTelemetry())
  |    -> 开发目录 .devtools/generations.json
  |    -> @ai-sdk/devtools 本地 Viewer :4983
  |    -> 设置页窄 IPC 只负责“启动并打开”
  +-> onStepEnd / onEnd
       -> 主进程关联 requestId
       -> SQLite task_runs 脱敏运行汇总
       -> task-run:read 只读投影
       -> 消息操作栏按需 popover
  +-> UIMessageChunk delta 合并
       -> 有序 task_run_events + IPC
       -> 任务恢复与 renderer
```

## 数据与安全边界

- **已实现**：DevTools 只在 `app.isPackaged === false` 时注册和开放；生产包不启动 Viewer，也不显示开发者入口。
- **已实现**：日志由官方集成保存在当前开发进程工作目录下的 `.devtools/generations.json`，并由 `.gitignore` 排除。
- **已实现**：Viewer 只监听 `localhost`；主进程退出时清理由 Tessera 启动的 Viewer 子进程。
- **已实现**：IPC 只返回成功或脱敏后的启动错误，不把 API Key、Node 能力或任意日志路径暴露给 renderer。
- **已实现**：`task_runs` 只保存模型/策略、资源摘要和数值型运行汇总，不保存 prompt、正文、完整工具输入输出或密钥；缓存读/写 Token 分列，避免把供应商缓存命中误判为界面模型目录缓存。
- **已实现**：正常正文后的引申问题短调用使用同一模型且无工具权限；实际 Token、缓存、步骤和模型耗时并入同一
  run，短调用失败不覆盖主回答的完成状态，也不伪造零用量。
- **已实现**：产品运行解释按 task/request 双重归属读取，UI 仅在用户点击图标后加载；损坏历史事件降级为安全的公开失败，不把原始 JSON 或内部异常交给 renderer。
- **已实现**：流式正文、推理和工具参数 delta 在产品事件层顺序安全合并；结束或异常前强制刷新，不用降低审计完整性换取 UI 性能。
- **已实现**：最新运行即使已经进入终态，只要对应助手消息尚未保存，也会从事件账本恢复一次；消息关联该
  `requestId` 后停止重放。历史高密度事件只在恢复快照中临时合并，原始审计记录保持不变。
- **重要限制**：官方 DevTools 为调试可读性记录 prompt、output 与工具输入输出，可能包含用户正文和工作区材料。它只适合开发机器，不能作为生产审计仓库、同步服务或用户可见历史。
- **部分实现**：恢复所需的结构化事件已按 run/task/sequence 保存，运行和工具失败都有稳定公开 code；尚未形成独立、有限保留的生产诊断事件层与历史列表。

## reasoning 展示语义

模型支持推理强度，不等于供应商一定返回可展示的推理摘要。部分 Responses 兼容端点只发送 `reasoning-start` / `reasoning-end`，没有任何 `reasoning-delta`。这类生命周期事件仍可用于 SDK 内部步骤和日志诊断，但不能生成真实界面内容。

- **已实现**：同一回复中的多个空 reasoning 生命周期聚合为一个紧凑的“思考中 / 思考完成”阶段外壳；不因每次搜索前后的空生命周期刷出重复状态。
- **已实现**：只有 reasoning 文本非空时才出现可展开正文；流式但尚无文本时只显示整体阶段状态。
- **已实现**：工具活动由真实 Tool Part 表达，不根据 reasoning 文本或空生命周期伪造搜索、读取或执行记录。
- **已实现**：provider-executed 联网工具按 AI SDK 标准 `output.action` / `output.sources` 恢复查询与打开页面；不能因工具 `input` 为空而只显示次数、不显示过程。
- **约束**：阶段状态不等于推理正文；不得用占位文案冒充模型推理，不得把内部链式思维补写成可见内容。

## 与任务持久化的关系

DevTools 不是任务事实源。`task_sessions` / `task_messages` 仍负责用户可见会话，`task_runs` 与主进程合并后的事件检查点负责运行恢复、产品状态和脱敏运行汇总；`.devtools/generations.json` 仅用于开发诊断，可以随时清空。当前产品内的单次运行解释只读取受控的 SQLite 汇总与领域审计，不能直接读取或迁移 DevTools 的明文调试数据库。

## 后续验收

- **已实现**：统一记录 `taskId`、`requestId`、实际供应商/模型、完成原因、usage、缓存读写与耗时，同时保持正文不进入运行汇总。
- **已实现**：助手消息关联 `requestId`，通过归属校验后的只读 IPC 按需解释实际模型、Skill、资源、工具和结束/失败原因；不把诊断长文常驻在对话 UI。
- **已实现**：启动、流式、恢复、工具失败和应用重启中断均使用稳定公开错误；重启恢复不会重放已经执行过的磁盘副作用。
- **已实现**：真实 FKJ 研究运行以 15,552 个原始产品事件暴露 renderer 背压问题；增量合并器已有顺序/尾部刷新回归测试，后续黄金运行同时比较语义指标与事件量。
- 将 IPC、MCP 和文件写入审批的诊断事件关联到同一 run，但不复制 AI SDK 已经提供的 step/tool 语义。
- 为异常中断、额度耗尽、用户停止、等待审批和正常完成提供稳定状态码。
- 增加调试日志清理入口与保留上限；生产版继续保持开发者 Viewer 不可用。
