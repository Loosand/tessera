# AI 运行可观测性

> 代码源头：`apps/desktop/src/main/ai-devtools.ts`、`apps/desktop/src/main/index.ts`、
> `apps/desktop/src/preload/index.ts`、`apps/desktop/src/renderer/src/components/settings-page.tsx`、
> `apps/desktop/src/renderer/src/components/chat-message.tsx`、
> `apps/desktop/src/renderer/src/components/chat-parts/reasoning-part.tsx`、
> `packages/ai/src/server/task-agent.ts`、`packages/database/schema.ts`、
> `packages/database/task-run-repository.ts`、`packages/contracts/src/index.ts`
>
> 状态：部分实现。开发环境的 AI SDK 官方 DevTools、统一 Agent 观测标识、空 reasoning 摘要处理和 SQLite 脱敏运行汇总已实现；产品内运行历史查询、错误码与细粒度生产事件仍在规划。

## 决策

开发期 AI 运行日志优先采用 AI SDK 7 的标准 Telemetry 集成与官方 `@ai-sdk/devtools`，不平行维护另一套 Agent step/tool 调试协议。Electron 主进程在开发环境启动时全局注册 `DevToolsTelemetry()`；统一 `ToolLoopAgent` 使用稳定的 `id` 与 `functionId`，因此普通回答、研究、写作和工作区动作进入同一条观测链路。

产品运行汇总使用同一个 `ToolLoopAgent` 的标准 `onStepEnd` / `onEnd` 生命周期，而不是从 UI chunk 反推。正常完成时以 `onEnd` 的聚合 usage 和 finish reason 为准；运行中和取消前以已完成 step 快照保留可得指标。主进程只把无正文的汇总写入 `task_runs`：SDK call ID、统一/原始完成原因、输入/输出/推理 Token、缓存读写 Token、步骤数、工具调用数、首输出延迟、模型/本地工具耗时与任务总耗时。

Viewer 按需启动，不阻塞 Tessera 首屏。设置页只在开发构建显示「开发者 → AI 运行日志」，点击后由窄 IPC 请求主进程启动官方本地 Viewer，并在系统浏览器打开 `http://localhost:4983`。渲染层不获得 Node.js、进程路径或日志文件读写权限。

```text
ToolLoopAgent / generateText / streamText
  +-> AI SDK registerTelemetry(DevToolsTelemetry())
  |    -> 开发目录 .devtools/generations.json
  |    -> @ai-sdk/devtools 本地 Viewer :4983
  |    -> 设置页窄 IPC 只负责“启动并打开”
  +-> onStepEnd / onEnd
       -> 主进程关联 requestId
       -> SQLite task_runs 脱敏运行汇总
```

## 数据与安全边界

- **已实现**：DevTools 只在 `app.isPackaged === false` 时注册和开放；生产包不启动 Viewer，也不显示开发者入口。
- **已实现**：日志由官方集成保存在当前开发进程工作目录下的 `.devtools/generations.json`，并由 `.gitignore` 排除。
- **已实现**：Viewer 只监听 `localhost`；主进程退出时清理由 Tessera 启动的 Viewer 子进程。
- **已实现**：IPC 只返回成功或脱敏后的启动错误，不把 API Key、Node 能力或任意日志路径暴露给 renderer。
- **已实现**：`task_runs` 只保存模型/策略、资源摘要和数值型运行汇总，不保存 prompt、正文、完整工具输入输出或密钥；缓存读/写 Token 分列，避免把供应商缓存命中误判为界面模型目录缓存。
- **重要限制**：官方 DevTools 为调试可读性记录 prompt、output 与工具输入输出，可能包含用户正文和工作区材料。它只适合开发机器，不能作为生产审计仓库、同步服务或用户可见历史。
- **规划**：生产诊断采用独立的结构化、有限保留、默认脱敏事件，记录 run/task/provider/model、阶段、状态、用量和耗时，不默认保存正文、Diff、密钥、Authorization Header 或完整工具输出。

## reasoning 展示语义

模型支持推理强度，不等于供应商一定返回可展示的推理摘要。部分 Responses 兼容端点只发送 `reasoning-start` / `reasoning-end`，没有任何 `reasoning-delta`。这类生命周期事件仍可用于 SDK 内部步骤和日志诊断，但不能生成真实界面内容。

- **已实现**：同一回复中的多个空 reasoning 生命周期聚合为一个紧凑的“思考中 / 思考完成”阶段外壳；不因每次搜索前后的空生命周期刷出重复状态。
- **已实现**：只有 reasoning 文本非空时才出现可展开正文；流式但尚无文本时只显示整体阶段状态。
- **已实现**：工具活动由真实 Tool Part 表达，不根据 reasoning 文本或空生命周期伪造搜索、读取或执行记录。
- **已实现**：provider-executed 联网工具按 AI SDK 标准 `output.action` / `output.sources` 恢复查询与打开页面；不能因工具 `input` 为空而只显示次数、不显示过程。
- **约束**：阶段状态不等于推理正文；不得用占位文案冒充模型推理，不得把内部链式思维补写成可见内容。

## 与任务持久化的关系

DevTools 不是任务事实源。`task_sessions` / `task_messages` 仍负责用户可见会话，`task_runs` 与主进程事件检查点负责运行恢复、产品状态和脱敏运行汇总；`.devtools/generations.json` 仅用于开发诊断，可以随时清空。未来的产品内运行历史查询只能读取受控的 SQLite 汇总与领域审计，不能直接读取或迁移 DevTools 的明文调试数据库。

## 后续验收

- **已实现**：统一记录 `taskId`、`requestId`、实际供应商/模型、完成原因、usage、缓存读写与耗时，同时保持正文不进入运行汇总。
- 将 IPC、MCP 和文件写入审批的诊断事件关联到同一 run，但不复制 AI SDK 已经提供的 step/tool 语义。
- 为异常中断、额度耗尽、用户停止、等待审批和正常完成提供稳定状态码。
- 增加调试日志清理入口与保留上限；生产版继续保持开发者 Viewer 不可用。
