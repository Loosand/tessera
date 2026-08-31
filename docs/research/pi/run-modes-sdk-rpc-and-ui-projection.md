# Pi 运行模式、SDK、RPC 与 UI 投影

> Pi 证据：`packages/coding-agent/src/main.ts::main`、
> `packages/coding-agent/src/modes/print-mode.ts::runPrintMode`、
> `packages/coding-agent/src/modes/json-event.ts::toJsonEvent`、
> `packages/coding-agent/src/modes/rpc/rpc-mode.ts::runRpcMode`、
> `packages/coding-agent/src/modes/rpc/rpc-types.ts::RpcCommand`、
> `packages/coding-agent/src/modes/interactive/interactive-mode.ts::InteractiveMode`、
> `packages/coding-agent/src/core/sdk.ts::createAgentSession`、
> `packages/coding-agent/src/core/agent-session-runtime.ts::AgentSessionRuntime`
>
> Tessera 对照：`packages/ai/src/server/agent-runtime.ts`、
> `packages/ai/src/server/chat-runtime.ts`、`packages/ai/src/react/use-electron-chat.ts`、
> `apps/desktop/src/main/ai-service.ts`、`packages/contracts/src/index.ts`
>
> 状态：固定提交源码分析已完成

## 结论先行

Pi 的四种模式不是四个 Agent：Interactive、Print/JSON、RPC 和 SDK 都操作 `AgentSession`；差异主要在输入协议、事件编码、
扩展 UI 能力和进程生命周期。这使模式间的模型、工具、压缩、会话和扩展语义高度一致。

Tessera 最应学习的是“UI 是 Session event 的投影”；不应复制的是把内部大对象直接作为长期 RPC ABI。Pi 的 RPC 很实用，但
命令/事件与 `AgentSession` 内部概念紧密耦合，且 JSONL stdout 需要严格背压与输出接管。

## 1. 四种入口

| 模式 | 输入 | 输出 | 生命周期 |
| --- | --- | --- | --- |
| Interactive | TUI editor、快捷键、slash command | TUI message/tool/status/overlay | 长会话 |
| Print | CLI 一次或多次 prompt | 最终 assistant text | 处理完退出 |
| JSON | CLI prompt | 全量 JSON event stream | 处理完退出 |
| RPC | stdin JSONL command | stdout response + event + extension UI request | 常驻子进程 |
| SDK | Node API 调用 | callback/subscription/state | 由宿主管理 |

README 称四种模式时把 Print/JSON 作为同类 single-shot；源码上 JSON 复用 `runPrintMode()`，只是订阅事件并编码。

## 2. Print/JSON 的边界

`runPrintMode()`：

1. 从 `AgentSessionRuntime` 取得 session；
2. bind extensions，提供 new/fork/navigate/switch/reload actions；
3. JSON 模式订阅所有 Session events，并为 stdout 背压挂 Agent listener；
4. 顺序 prompt initialMessage 和追加 messages；
5. text 模式只输出最后 assistant 的 text content；
6. error/aborted 返回非零 exit；
7. finally dispose runtime、清理 signal handler 和 flush stdout。

Session replacement 时会重新 bind 新 Session，证明 mode 持有的是 runtime host，而不是捕获初始 Session 永不变化。

JSON 输出前可先写 Session header，再写 event；它适合 shell pipeline，但调用方必须理解同一 stdout 中 header/event 的联合协议。

## 3. RPC 协议

RPC 用 JSON Lines，而不是标准 JSON-RPC。command 可带 id，response 回显 id 和 command，AgentSessionEvent 异步穿插输出。

主要 command：

- prompt/steer/follow_up/abort/clear_queue/new_session；
- get_state/messages；
- set/cycle model 和 thinking；
- steering/follow-up mode；
- compact/auto compaction；
- retry control；
- Bash；
- session stats/export/switch/fork/clone/tree/entries/name；
- commands discovery。

这个协议完整暴露 Pi 的交互能力，嵌入方不需模拟键盘和 TUI。

### 3.1 response 与 event 分离

`prompt` response 只表示命令已接受，后续 agent/message/tool events 表示实际运行。调用方不能把 response success 当成 Agent 已
完成。长期任务协议中这是正确区分。

### 3.2 Extension UI bridge

扩展调用 select/confirm/input/editor 等 UI 时，RPC 发 `extension_ui_request`，客户端再回
`extension_ui_response`。请求支持 id、timeout、AbortSignal；notify/status/widget/title 可 fire-and-forget。

部分 TUI 能力在 RPC 不支持，例如组件 factory、custom footer/header、原始 terminal input、working indicator。API 因此是
best-effort capability，不是所有 mode 完全等价。

### 3.3 stdout 边界

RPC 会接管 stdout，所有协议输出必须经过 raw output guard，并在高水位时让 Agent listener 等待背压。任何扩展或依赖直接
`console.log` 都可能破坏协议，因此进程嵌入的真正边界不仅是 JSON type，还包括 stdout 所有权。

Tessera 使用窄 IPC/stream callback，不应让任意 extension 共享协议 stdout；如果未来提供 remote protocol，应使用独立 transport
channel 与版本化 envelope。

## 4. SDK

`createAgentSession()` 允许注入：

- cwd、agentDir；
- SessionManager 或 in-memory session；
- ModelRuntime/settings/resource loader；
- model/thinking；
- built-in tool allow/deny 或自定义 tools；
- extensions、custom system prompt；
- streamFn、transport、retry/timeout 等。

默认 active tools 是 read/bash/edit/write。SDK 直接返回 AgentSession 以及加载结果/diagnostic，宿主订阅 Session events、调用
prompt/abort/compact/setModel 等。

它的优势是复用完整 coding-agent，而不是要求嵌入方自己拼 Agent core。代价是公开面几乎等于内部 Session 能力，升级需要
维护广泛行为兼容；同进程 SDK 也继承所有文件、Shell、extension 权限。

## 5. InteractiveMode 是 projection + controller

InteractiveMode 很大，但它不拥有 Agent 真相。它：

- 将 Session state/messages 渲染为 TUI；
- 将 AgentSessionEvent 映射为 streaming message、tool component、retry/compaction indicator；
- 处理 editor、快捷键、autocomplete、overlay、theme；
- 把 `/resume`、`/compact`、`/model`、`!bash` 等动作调用回 Session/Runtime；
- Session replacement 后重绑定；
- extension UI 通过 adapter 操作 TUI。

这比 UI 自己从日志猜 Agent 状态健康。仍然存在大量显示逻辑知道具体 event/message 类型，RPC/TUI 各有自己的 projection
适配，新增内部 event 需要同步多个消费者。

## 6. JSON event 的稳定性边界

`toJsonEvent()` 主要把内部事件转换成可序列化对象，保留 message/tool 生命周期。它不是与内部完全独立的领域事件 taxonomy。
因此：

- 对调试和自动化足够直接；
- 外部客户端容易获得完整能力；
- 内部 AgentMessage/Tool details 演进会推动协议演进；
- 工具输出、路径和模型内容可能原样离开进程；
- 产品恢复不能只依赖消费者是否收到了 stdout 尾部。

Tessera 已用公开 `AiChatStreamChunk` 与版本化错误，SQLite 保存 run events。应继续区分：AI SDK 原生流 part、产品领域事件、
诊断事件、远端协议 envelope。

## 7. 模式一致性与不一致性

### 一致

- 同一 AgentSession/Agent loop；
- 同一 SessionManager；
- 同一 model/tool/resource/compaction/retry；
- 同一 session switching runtime；
- 同一扩展核心事件。

### 不一致

- non-interactive 无 Project Trust prompt，依赖保存决策/default/CLI override；
- Print 的 extension UI 基本不可交互；
- RPC 只能桥接部分 UI；
- TUI 有直接键盘、overlay、renderer 和 shell UX；
- SDK 是否设置 CLI child process markers 取决于宿主，不自动等同 CLI。

这说明“共用 runtime”不等于“所有 mode 能力相同”。协议需要 capability negotiation 或明确降级。

## 8. Tessera 对照

| Pi 模式原则 | Tessera 当前状态 | 建议 |
| --- | --- | --- |
| 多入口共用 Session | Electron renderer/主进程共用统一 ToolLoopAgent | 保持单主链 |
| command accepted != run finished | stream/run record 已区分运行状态 | remote/automation 继续复用 requestId/runId |
| UI 消费结构化事件 | UI 使用 AI SDK Part +公开 chunk | 不从 reasoning 文本猜工具状态 |
| Session switch 重绑 runtime | Task/Space 导航与工作区 service 已分层 | 旧 capability/approval context 显式失效 |
| RPC extension UI | 当前审批/提问走类型化 chunk | 远端时保留 request/response correlation |
| stdout 背压 | 曾遇 15552 事件背压并已合并 delta | 继续做 event budget/合并，不复制 raw event 洪流 |

## 9. 建议

1. 所有未来入口——桌面、automation、remote runner、CLI——都创建标准 Tessera TaskRun，不建第二 Agent runtime。
2. 协议 response 只表示接受/拒绝，终态由 run event 明确表示。
3. UI prompt、approval、tool part、artifact 使用稳定 ID 关联，不依赖显示顺序。
4. remote protocol 版本化并支持 capability negotiation；不直接序列化内部类和任意 tool details。
5. event publisher 负责背压、delta 合并和终态 flush；领域事件不复制 AI SDK 已有生命周期。
6. Session/Workspace replacement 先 abort/drain，随后令旧 handler、resource lease 和 UI binding 失效。
