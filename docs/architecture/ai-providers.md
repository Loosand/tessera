# AI 供应商与模型发现

> 代码源头：`packages/ai/src/provider-catalog.ts`、`packages/ai/src/server/provider-config-service.ts`、
> `packages/ai/src/model-capabilities.ts`、`packages/ai/src/server/model-discovery.ts`、
> `packages/ai/src/model-routing.ts`、
> `packages/ai/src/server/ai-sdk-runtime.ts`、`packages/ai/src/server/chat-runtime.ts`、
> `packages/database/ai-provider-config-repository.ts`、`packages/contracts/src/index.ts`、
> `apps/desktop/src/main/ai-service.ts`、`apps/desktop/src/main/index.ts`、
> `packages/ai/src/react/ai-settings.tsx`、
> `packages/ai/src/react/ai-provider-settings.tsx`、`packages/ai/src/react/model-editor-dialog.tsx`、
> `packages/ai/src/react/use-electron-chat.ts`
>
> 状态：部分实现。

## 范围

首批只支持远程 API：OpenAI 兼容、Anthropic 兼容、DeepSeek、Grok 与 OpenRouter。本地模型和外部 Agent 是不同运行边界，不在当前 Connection type 中混排。

这里区分四层事实与一个请求期解析器：模型事实描述类型、模态、固有能力和 Token 限额；供应商事实声明鉴权、目录与可实现的端点；供应商模型绑定描述模型在各端点上的投递能力；连接实例只保存名称、Base URL、密钥和用户覆盖。请求发送前由有效能力解析器计算模型、供应商、端点、连接与产品策略的交集。协议适配器、供应商品牌和连接实例不是同一个概念；运行时始终以 `configId` 解析具体凭据，不能只用 `providerId` 猜测用户选择的是哪一组配置。

OpenAI 兼容与 Anthropic 兼容适配器允许创建多条具名连接；DeepSeek、Grok 与 OpenRouter 是带官方默认值的单例连接。当前持久化仍把已归一化模型随连接保存，版本化远端模型注册表与真正的稀疏差异存储尚未实现。

## 设置交互边界

- `AI` 菜单只控制 AI 全局可用性和工具建议权限。
- `模型供应商` 菜单使用紧凑目录与常驻内容区的主从布局；目录提供全部连接入口，内容区在总览和单个连接详情之间切换。兼容协议可以添加多条具名连接，官方服务保持单例。
- 供应商切换不离开当前工作区，并显式复位详情滚动位置；长模型目录保留粘性工具栏，模型按已启用与未启用分组。
- 模型目录最终只有一个模型时，该模型在首次发现时自动启用；目录包含多个模型时，新发现模型默认停用，重新同步保留已有模型的显式开关状态。工具栏提供作用于完整目录的全部启用与全部停用操作。
- 供应商和模型图标直接按需加载 `@lobehub/icons` 的精选品牌组件；模型图标按完整模型 ID 匹配常用品牌，未知 ID 显示中性头像，包根的完整图标目录不会进入首屏或发行 bundle。
- 任务输入区的模型选择器使用按供应商分组的浮层，同时显示模型头像、能力摘要和选中状态；联网、工具调用与思考强度由逐轮创作方式和请求期模型路由自动派生，不要求用户维护专业开关。
- 模型目录同步只要求 API 根地址。OpenRouter 的官方公共目录在首次进入详情时自动同步；其他目录若要求鉴权，则在输入 API Key 后重试。目录发现是可选能力：兼容端点返回 404/405 时保留连接和已保存模型，只提示用户手动添加完整模型 ID，不把目录缺失误报为推理连接失效。
- 每个模型都可打开统一编辑对话框，维护显示名称、模型类型、输入/输出模态、工具调用/推理/结构化输出、上下文和最大输入/输出 Token；字段同时展示目录、供应商、用户覆盖或未知来源。供应商端点及原生联网能力只读展示，不把联网重新保存为模型固有开关。
- Chat 模型选择器只接收 `chat` 类型；Embedding、Rerank、图片、视频、语音和实时模型保留在供应商目录中管理，但不会混入对话入口。
- 模型同步、手动增删、单个启停和批量启停成功后立即保存完整模型目录；主进程广播配置变更，任务页的应用级共享快照自动从 SQLite 轻量重读。任务页不会在挂载或视图激活时请求远端模型目录；远端同步只由设置页的显式操作与公共目录首次初始化触发，已有显式启停选择不被覆盖。
- Base URL、供应商/模型启用状态和模型元数据保存到 `userData/tessera.sqlite3`；启动时与供应商默认值合并恢复。
- 最近选择的默认模型只持久化不含密钥的 `configId::modelId` 本地界面偏好；历史任务仍以助手消息元数据恢复各自使用的模型。
- 新输入的明文 API Key 只短暂存在于表单内存；保存后 renderer 仅接收 `apiKeyConfigured`，不会回显密钥。

## 已实现链路

```text
设置页配置草稿 / 可选新 API Key
  -> DesktopApi.saveAiProviderConfig
  -> preload 窄接口
  -> Electron 主进程 IPC handler
  -> @tessera/ai/server 配置校验与 safeStorage 加密
  -> SQLite ai_provider_configs

设置页检查/同步模型目录
  -> 主进程优先采用当次新 Key，否则解密已保存 Key
  -> @tessera/ai/server 模型发现适配器
  -> 供应商 /models REST 接口
  -> 归一化模型 ID、名称、类型、输入/输出模态、固有能力、端点绑定和可用限额
  -> 设置页合并列表并保留已有启用状态
  -> 单模型目录自动启用；多模型目录的新模型默认停用
  -> 立即持久化模型目录并广播配置变更
  -> 任务页重新筛选可用模型
```

模型发现不用 `generateText`，因此目录检查和刷新不会产生推理费用，也不能证明推理接口一定可用。生成运行时通过另一个边界 `createAiSdkLanguageModel` 建立：OpenAI 兼容与 OpenRouter 使用 `@ai-sdk/openai-compatible`，Anthropic Messages 使用 `@ai-sdk/anthropic`，DeepSeek 普通对话使用 `@ai-sdk/deepseek`，DeepSeek Responses 使用 `@ai-sdk/openai`，Grok 使用 `@ai-sdk/xai`。

DeepSeek V4 在官方连接上的普通对话明确绑定 `openai-chat-completions`；创作方式请求原生联网时，有效能力解析器优先选择官方 `anthropic-messages`，并注册 DeepSeek 支持的 `web_search_20260209` 服务端工具。原因是实际运行证据显示 DeepSeek Responses 会产生 reasoning token 和加密续轮状态，却不返回 AI SDK 可展示的 reasoning summary；官方 Anthropic 兼容说明则明确支持 `thinking`、`server_tool_use`、`web_search_tool_result` 和工具续轮，AI SDK 也会把它们直接归一化为 reasoning 与工具 Part。`openai-responses` 仍作为同一官方模型的搜索端点回退；由于 `deepseek-v4-*` 不在 `@ai-sdk/openai` 的内建模型能力表中，该回退通过标准 `providerOptions.openai.forceReasoning` 声明推理模型语义，但不能把只有 `encrypted_content` 的响应虚构成明文思考。产品策略不会在 AI SDK 适配层偷换协议，自定义 DeepSeek 代理也不会仅凭模型名称继承官方端点能力。

## 模型能力事实

模型列表 API 没有统一、可靠的能力协议。Tessera 使用“内建目录 + 远端信号 + 用户逐字段覆盖”的统一事实模型：

- 能力使用 `supported`、`unsupported`、`unknown` 三态，未知不伪装成可用。
- 模型类型使用 `chat`、`embedding`、`rerank`、`image-generation`、`video-generation`、`text-to-speech`、`speech-to-text` 与 `realtime`；输入输出模态独立使用 `text`、`image`、`audio`、`video` 与 `vector`。
- 模型固有能力目前维护 `functionCall`、`reasoning` 与 `structuredOutput`；视觉输入属于输入模态，原生搜索属于端点绑定，不再混入同一个能力对象。
- OpenRouter 返回的 `architecture.input_modalities` 与 `supported_parameters` 可补充模态、推理、工具和结构化输出；普通模型目录仅返回 ID 时，由保守的内建目录补足常见模型。
- 手动输入、远端目录、持久化与生成运行时共用 512 字符模型 ID 边界；远端 Token 限额只接受正安全整数，拒绝小数和超出 JavaScript 安全整数范围的值。
- 能力与模型字段分别携带 `builtin`、`remote`、`custom` 或 `unknown` 来源；用户覆盖优先于供应商目录，内建规则升级后只重新计算未覆盖字段。
- `agentReady` 不持久化，由“对话模型 + 当前端点可用 + 工具调用已验证 + 产品运行边界”推导。原生联网同理由“供应商 × 模型 × 端点 × 官方/自定义连接”推导。
- 目前 Anthropic 官方 Messages、DeepSeek 官方 V4 Responses/Anthropic 与 Grok 官方 Responses 的已验证原生搜索进入运行时。兼容中转、旧版 DeepSeek、OpenAI Chat Completions 和 OpenRouter 不会仅凭模型名称伪装联网能力。

参考实现与类型事实来自 LobeHub 官方仓库的 [模型能力类型](https://github.com/lobehub/lobehub/blob/canary/packages/model-bank/src/types/aiModel.ts)、[搜索能力决策](https://github.com/lobehub/lobehub/blob/canary/packages/model-bank/src/utils.ts) 与 [Google 模型目录示例](https://github.com/lobehub/lobehub/blob/canary/packages/model-bank/src/aiModels/google.ts)。

## 当前普通对话运行时

```text
useChat + Electron ChatTransport
  -> preload start/resume/cancel/event 窄接口
  -> 主进程确认供应商已启用、模型已启用且能力匹配
  -> safeStorage 按需解密 Key
  -> AI SDK streamText
  -> 主进程记录带 task/request/sequence 的有序事件
  -> renderer 实时消费，或返回页面时重放后续接实时增量
  -> Markdown 消息界面
```

普通对话只发送用户显式输入、显式 Markdown/图片附件与当前对话中可稳定重放的历史，不读取未附加的工作区内容。持久化消息依然完整保留 UI Part，但模型输入投影仅向供应商重放旧助手的可见正文；当前审批/自动续轮或显式失败续跑才保留已终止工具 Part，防止缺少供应商私有元数据的历史协议导致整个对话持续 400。主进程会把 Markdown 附件解码为带“材料而非系统指令”边界的受限文本，并把供应商明确返回的 reasoning 增量按 AI SDK Part 原始顺序送入 renderer；界面只为非空 reasoning 摘要显示默认展开、可折叠且最大高度 12rem 的紧凑 Streamdown 过程块。只返回 reasoning start/end 而没有 delta 的兼容端点在同一回复内聚合成一个阶段状态，不重复渲染空正文。长内容在块内独立滚动，流式追加只在用户仍贴近末尾时自动跟随。正文、reasoning 与 Agent 结果预览共享禁用原始 HTML 的 Streamdown 渲染边界，流式态负责修复未闭合 Markdown 并平滑已到达 renderer 的新增字符；Transport 的事件粒度和合并策略仍由上游协议决定。reasoning 不作为下一轮对话历史回传，也不把供应商未返回的内部思维链补写成可见内容。

无工作区与工作区请求现在都使用 `ToolLoopAgent`，并通过共用 `task-agent.ts` 的 `callOptionsSchema` / `prepareCall` 消费受信任 RunPolicy；差异只剩主进程实际注入的资源工具集合。无需工具时直接生成正文，需要时按每轮策略调用搜索、Skill 和受限领域工具。供应商适配与消息 Part 协议不因存储方案变化而分叉。

实现前必须核对当前锁定 AI SDK 的随包 docs/source。每轮模型、instructions、active tools、provider options 和审批优先通过类型化 call options / `prepareCall` 配置；step 内调整使用 `prepareStep`，循环限制使用 `stopWhen`，观测使用生命周期回调。现有 Electron `ChatTransport` 只补足跨进程 IPC、后台事件持久化和 reconnect；不得平行实现 Agent loop、消息 Part、审批状态机或 React chat 状态。

自动与写作方式会在请求期模型路由确认原生搜索可用时启用 `web_search`，研究 Skill 同样启用并获得更宽预算，问答预设始终关闭；renderer 只用同一纯策略解析器做发送前预检，IPC 不再接受 `reasoning` / `webSearch` 能力命令，主进程会根据已保存模型事实重新生成实际 RunPolicy。同一搜索工具既可进入无工作区任务，也可与工作区工具共同进入 Agent 的工具循环。主进程保留工具输出与 URL 来源 Part；renderer 优先按 AI SDK provider-executed 工具的标准 `output.action` / `output.sources` 读取查询、打开页面和来源，同时兼容旧供应商的 `input.query` 与结果数组，按同一助手消息聚合真实搜索次数、去重来源和执行状态，过滤非 http(s) URL 与供应商内部调用标识，并以可展开过程轨迹呈现。每个来源先通过 HTTPS 请求站点 `/favicon.ico`，失败后请求 Favicon.im，二者均失败时回退通用图标；图片懒加载且不发送 Referer。自动与写作每轮最多搜索 12 次，研究 Skill 每轮最多 30 次，运行时再以 50 次作为防御性硬上限；额度耗尽必须按 AI SDK 标准降级为 `tool-output-error`，兼容端点即使误发顶层错误，也要在模型继续产出完整正文时保留答案并正常结束，不能升级为整轮 Schema 崩溃。供应商用于续轮引用的加密内容只在同一模型运行的内部工具历史中保留，不进入可见界面；没有真实工具 Part 时不根据 reasoning 文本伪造搜索活动。供应商原始校验错误在公开前映射为可操作文案，402 单独提示充值/切换连接且不标记可重试，不向 renderer 暴露 Schema、堆栈或凭据。

原生搜索 Part 只证明供应商执行了搜索或报告了页面动作，不自动证明 Tessera 已取得并保存页面正文。只有 URL、摘要、
结果数组或不透明加密上下文时，来源在研究领域仍是“已发现”；供应商明确返回可核查页面内容时才可归一化为“已阅读”。
跨供应商的读取、证据与完成语义由[研究工作流与证据链](research-workflow.md)统一定义，不能由 renderer 根据动画或模型旁白猜测。

路由切换和组件卸载只断开 renderer 订阅，不中止主进程 `AbortController`；返回任务页时 AI SDK 的 resumable stream 入口读取主进程事件快照并按 sequence 去重重放。只有用户显式停止、任务删除、窗口销毁或应用退出会取消运行。该机制当前使用主进程内存日志，保证页面级续流，但不保证 Electron 进程退出后的恢复。

任务页模型状态是 renderer 应用级单例快照。首次订阅从 SQLite 轻量读取；后续任务页挂载立即复用旧快照，同时后台重读 SQLite，加载失败也保留可用旧模型。设置页保存或同步模型后由配置变更事件串行触发重读，不再用远端目录请求版本作废刚返回的本地缓存；只有尚无快照时显示“正在加载模型”。

## 端点与鉴权

| 供应商 | 默认 API 根地址 | 模型目录与鉴权 |
| --- | --- | --- |
| OpenAI 兼容 | `https://api.openai.com/v1` | 推导 `/models`，Bearer |
| Anthropic 兼容 | `https://api.anthropic.com/v1` | 尝试 `/models?limit=1000`，官方地址使用 `x-api-key`；兼容地址可从 Bearer 回退到原生头；404/405 表示目录能力缺失，不代表 Messages API 不可用 |
| DeepSeek | `https://api.deepseek.com` | 官方根地址推导 `/models`，Bearer；普通对话绑定 Chat Completions，V4 原生联网优先绑定可返回 thinking 的 Anthropic Messages，Responses 作为官方搜索回退 |
| Grok | `https://api.x.ai/v1` | 推导 `/models`，Bearer |
| OpenRouter | `https://openrouter.ai/api/v1` | 推导 `/models`；公共目录可匿名读取，存在 Key 时附加 Bearer |

用户只配置 API 根地址。配置持久化、目录发现和生成运行时共用同一 URL 校验：最多 2,048 字符，只接受不含账号、密码、查询参数或片段的完整 http(s) URL。若误填 `chat/completions`、`responses`、`response` 或 `messages` 完整端点，适配器会回退到同一 API 根下的模型目录；不提供独立 models URL 输入。模型同步不强制要求 Key，适配器只在 Key 非空时发送认证头；远端返回 401/403 时由界面原样提示需要凭据。兼容服务可能只实现生成接口而没有标准模型目录；此时用户通过手动模型 ID 完成配置，后续真实生成请求才是推理链路的判断依据。

## 安全边界

- API Key 不写 localStorage、不以明文写数据库或日志；SQLite 的 `api_key_ciphertext` 只保存 Electron `safeStorage.encryptString()` 结果。
- 新输入和已加密保存的 API Key 在持久化、目录发现与生成请求前都会校验为可打印 ASCII；包含中文、空格、换行或说明文字时返回可操作提示，不把运行时 `ByteString` 异常暴露给用户。
- 系统安全存储不可用时，普通配置仍可保存，但包含新 Key 的保存会被拒绝，禁止降级为明文。
- 列表 IPC 只返回 `apiKeyConfigured`；目录检查、模型同步和后续生成在主进程按需解密，不把持久化 Key 发回 renderer。
- 保存时未输入新 Key 会保留旧密文；删除配置会同时删除 Base URL、模型状态和密文。配置变更事件用于多窗口和任务页重新读取；同一 renderer 内的模型重读串行合并，避免竞态丢弃 SQLite 快照。
- 公共模型目录请求不携带空的 `Authorization` 或 `x-api-key` 请求头。
- 主进程只接受已知供应商、http(s) URL，拒绝 URL 内嵌凭据、查询参数和片段。
- 请求总超时 15 秒，响应体最多 2 MiB，错误消息截断并替换可能回显的 API Key。
- 渲染层不直接调用供应商 API，也不导入 `@tessera/ai/server`；唯一的外部资源例外是 CSP 限定的 HTTPS 来源 favicon 图片请求。

## 后续能力

- **部分实现**：普通对话已接入流式生成、显式取消、页面断线恢复、Markdown、来源、图片和模型能力控件；任务消息数据库已实现。开发环境已用 AI SDK 官方 DevTools 持久化明文调试 run/step/tool/usage/timing，产品侧已按 run 保存 Token、缓存、步骤、工具和耗时数值汇总，恢复仍依赖 SQLite 检查点与主进程短期事件；独立的生产诊断事件层、有限保留策略和聚合查询尚未实现。
- **规划**：为出站 AI 请求记录不含密钥和正文的目标、目的与数据范围审计事件。
- **规划**：把内建模型目录升级为可版本化、可验证更新的注册表，并把连接中的模型持久化改为相对于注册表和供应商模型绑定的稀疏用户差异。
