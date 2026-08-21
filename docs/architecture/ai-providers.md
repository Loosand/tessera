# AI 供应商与模型发现

> 代码源头：`packages/ai/src/provider-catalog.ts`、`packages/ai/src/server/provider-config-service.ts`、
> `packages/ai/src/model-capabilities.ts`、`packages/ai/src/server/model-discovery.ts`、
> `packages/ai/src/server/ai-sdk-runtime.ts`、`packages/ai/src/server/chat-runtime.ts`、
> `packages/database/ai-provider-config-repository.ts`、`packages/contracts/src/index.ts`、
> `apps/desktop/src/main/ai-service.ts`、`apps/desktop/src/main/index.ts`、
> `packages/ai/src/react/ai-settings.tsx`、
> `packages/ai/src/react/ai-provider-settings.tsx`、`packages/ai/src/react/use-electron-chat.ts`
>
> 状态：部分实现。

## 范围

首批只支持远程 API：OpenAI 兼容、Anthropic 兼容、DeepSeek、Grok 与 OpenRouter。本地模型和外部 Agent 是不同运行边界，不在当前 Connection type 中混排。

这里区分三个对象：协议适配器负责请求格式和鉴权约定，连接实例保存名称、Base URL 与密钥，模型属于某个连接。OpenAI 兼容与 Anthropic 兼容适配器允许创建多条具名连接；DeepSeek、Grok 与 OpenRouter 是带官方默认值的单例连接。运行时始终以 `configId` 解析具体连接，不能只用协议 `providerId` 猜测用户选择的是哪一组凭据。

## 设置交互边界

- `AI` 菜单只控制 AI 全局可用性和工具建议权限。
- `模型供应商` 菜单使用紧凑目录与常驻内容区的主从布局；目录提供全部连接入口，内容区在总览和单个连接详情之间切换。兼容协议可以添加多条具名连接，官方服务保持单例。
- 供应商切换不离开当前工作区，并显式复位详情滚动位置；长模型目录保留粘性工具栏，模型按已启用与未启用分组。
- 模型目录最终只有一个模型时，该模型在首次发现时自动启用；目录包含多个模型时，新发现模型默认停用，重新同步保留已有模型的显式开关状态。工具栏提供作用于完整目录的全部启用与全部停用操作。
- 供应商和模型图标直接按需加载 `@lobehub/icons` 的精选品牌组件；模型图标按完整模型 ID 匹配常用品牌，未知 ID 显示中性头像，包根的完整图标目录不会进入首屏或发行 bundle。
- 任务输入区的模型选择器使用按供应商分组的浮层，同时显示模型头像、能力摘要和选中状态；思考强度等普通单选仍使用原生控件。
- 模型目录同步只要求 API 根地址。OpenRouter 的官方公共目录在首次进入详情时自动同步；其他目录若要求鉴权，则在输入 API Key 后重试。目录发现是可选能力：兼容端点返回 404/405 时保留连接和已保存模型，只提示用户手动添加完整模型 ID，不把目录缺失误报为推理连接失效。
- 模型同步、手动增删、单个启停和批量启停成功后立即保存完整模型目录；主进程广播配置变更，任务页自动重新读取。每次进入新任务视图时，后台重新请求所有已启用且已配置密钥的供应商目录并保存结果，而不是只重读 SQLite；已保存目录为空时只启用第一个发现模型，已有显式启停选择不被覆盖。
- Base URL、供应商/模型启用状态和模型元数据保存到 `userData/tessera.sqlite3`；启动时与供应商默认值合并恢复。
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
  -> 归一化模型 ID、名称、所有者和可用限额
  -> 设置页合并列表并保留已有启用状态
  -> 单模型目录自动启用；多模型目录的新模型默认停用
  -> 立即持久化模型目录并广播配置变更
  -> 任务页重新筛选可用模型
```

模型发现不用 `generateText`，因此目录检查和刷新不会产生推理费用，也不能证明推理接口一定可用。生成运行时通过另一个边界 `createAiSdkLanguageModel` 建立：OpenAI 兼容与 OpenRouter 使用 `@ai-sdk/openai-compatible`，Anthropic、DeepSeek 和 Grok 分别使用 `@ai-sdk/anthropic`、`@ai-sdk/deepseek` 与 `@ai-sdk/xai`。DeepSeek 普通对话仍走 OpenAI 格式适配器；V4 模型开启联网时切到官方 Anthropic 兼容端点，以使用服务端 Web Search tool。DeepSeek 把 Web Search 次数耗尽错误包装成单元素数组，与 Anthropic 协议的单对象定义不同；主进程只在 DeepSeek 官方 `/anthropic` 响应进入 SDK Schema 前归一化这一种已知差异，正常搜索结果数组和其他内容不改写。

## 模型能力事实

模型列表 API 没有统一、可靠的能力协议。LobeHub 也没有只依赖供应商 `/models`：其开源仓库在本地 `model-bank` 中维护 `vision`、`reasoning`、`search`、`functionCall` 等能力，并把搜索实现区分为 `tool`、`params` 与 `internal`。Tessera 采用同样的“本地能力库 + 远端信号 + 用户配置”思路，但保持最小首版：

- 能力使用 `supported`、`unsupported`、`unknown` 三态，未知不伪装成可用。
- OpenRouter 返回的 `architecture.input_modalities` 与 `supported_parameters` 可补充图片、思考和工具能力；普通模型目录仅返回 ID 时，由保守的内建规则补足常见模型。
- 能力携带 `builtin`、`remote`、`custom` 或 `unknown` 来源；内建规则升级后会重新计算，不让旧推断永久固化。
- 目前 Anthropic 兼容模型、DeepSeek V4 与 Grok 的已验证原生搜索进入运行时：Anthropic 使用 Web Search tool；DeepSeek V4 仅在官方 `api.deepseek.com` 上切到 Anthropic 兼容协议及服务端 Web Search tool；Grok 切到 xAI Responses API 与 Web Search tool。OpenAI 兼容、旧版 DeepSeek、自定义 DeepSeek 代理和 OpenRouter 不会仅凭模型名称伪装联网能力。

参考实现与类型事实来自 LobeHub 官方仓库的 [模型能力类型](https://github.com/lobehub/lobehub/blob/canary/packages/model-bank/src/types/aiModel.ts)、[搜索能力决策](https://github.com/lobehub/lobehub/blob/canary/packages/model-bank/src/utils.ts) 与 [Google 模型目录示例](https://github.com/lobehub/lobehub/blob/canary/packages/model-bank/src/aiModels/google.ts)。

## 普通对话运行时

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

普通对话只发送用户显式输入、上传图片与当前对话历史，不读取工作区。主进程会把供应商明确返回的 reasoning 增量按 AI SDK Part 原始顺序送入 renderer，界面以默认展开、可折叠且最大高度 12rem 的紧凑 Markdown 过程块展示；长内容在块内独立滚动，流式追加只在用户仍贴近末尾时自动跟随。正文与 reasoning 共享禁用原始 HTML 的语义渲染器。reasoning 不作为下一轮对话历史回传，也不把供应商未返回的内部思维链补写成可见内容。

开启联网搜索后，主进程保留供应商 `web_search` 的查询、工具输出与 URL 来源 Part；renderer 按同一助手消息聚合真实搜索次数、去重来源和执行状态，过滤非 http(s) URL，并以可展开过程轨迹呈现。每个来源先通过 HTTPS 请求站点 `/favicon.ico`，失败后请求 Favicon.im，二者均失败时回退通用图标；图片懒加载且不发送 Referer。普通问答和写作每轮最多搜索 5 次，研究 Skill 每轮最多 15 次，运行时再以 20 次作为防御性硬上限；额度耗尽由工具结果表达，不能因供应商兼容差异升级为整轮 Schema 崩溃。供应商用于续轮引用的加密内容保留在工具历史中，不进入可见界面；没有真实工具 Part 时不根据 reasoning 文本伪造搜索活动。供应商原始校验错误在公开前映射为可操作文案，不向 renderer 暴露 Schema、堆栈或凭据。

路由切换和组件卸载只断开 renderer 订阅，不中止主进程 `AbortController`；返回任务页时 AI SDK 的 resumable stream 入口读取主进程事件快照并按 sequence 去重重放。只有用户显式停止、任务删除、窗口销毁或应用退出会取消运行。该机制当前使用主进程内存日志，保证页面级续流，但不保证 Electron 进程退出后的恢复。

任务页启动时先轻量读取本地配置；首次显示及每次从其他视图返回新任务视图时执行后台模型目录同步。配置变更事件只执行轻量配置重读。多个供应商并行同步时会分别保存成功结果并汇总错误，配置事件与同步请求并发时只采用最后一次有效结果。

## 端点与鉴权

| 供应商 | 默认 API 根地址 | 模型目录与鉴权 |
| --- | --- | --- |
| OpenAI 兼容 | `https://api.openai.com/v1` | 推导 `/models`，Bearer |
| Anthropic 兼容 | `https://api.anthropic.com/v1` | 尝试 `/models?limit=1000`，官方地址使用 `x-api-key`；兼容地址可从 Bearer 回退到原生头；404/405 表示目录能力缺失，不代表 Messages API 不可用 |
| DeepSeek | `https://api.deepseek.com` | 官方根地址推导 `/models`，Bearer；V4 开启联网时生成端点切到 `/anthropic`，使用 `x-api-key` |
| Grok | `https://api.x.ai/v1` | 推导 `/models`，Bearer |
| OpenRouter | `https://openrouter.ai/api/v1` | 推导 `/models`；公共目录可匿名读取，存在 Key 时附加 Bearer |

用户只配置 API 根地址。若误填 `chat/completions`、`responses`、`response` 或 `messages` 完整端点，适配器会回退到同一 API 根下的模型目录；不提供独立 models URL 输入。模型同步不强制要求 Key，适配器只在 Key 非空时发送认证头；远端返回 401/403 时由界面原样提示需要凭据。兼容服务可能只实现生成接口而没有标准模型目录；此时用户通过手动模型 ID 完成配置，后续真实生成请求才是推理链路的判断依据。

## 安全边界

- API Key 不写 localStorage、不以明文写数据库或日志；SQLite 的 `api_key_ciphertext` 只保存 Electron `safeStorage.encryptString()` 结果。
- 系统安全存储不可用时，普通配置仍可保存，但包含新 Key 的保存会被拒绝，禁止降级为明文。
- 列表 IPC 只返回 `apiKeyConfigured`；目录检查、模型同步和后续生成在主进程按需解密，不把持久化 Key 发回 renderer。
- 保存时未输入新 Key 会保留旧密文；删除配置会同时删除 Base URL、模型状态和密文。配置变更事件用于多窗口和任务页重新读取，任务页并发刷新只接受最后一次请求结果。
- 公共模型目录请求不携带空的 `Authorization` 或 `x-api-key` 请求头。
- 主进程只接受已知供应商、http(s) URL，拒绝 URL 内嵌凭据、查询参数和片段。
- 请求总超时 15 秒，响应体最多 2 MiB，错误消息截断并替换可能回显的 API Key。
- 渲染层不直接调用供应商 API，也不导入 `@tessera/ai/server`；唯一的外部资源例外是 CSP 限定的 HTTPS 来源 favicon 图片请求。

## 后续能力

- **部分实现**：普通对话已接入流式生成、显式取消、页面断线恢复、Markdown、来源、图片和模型能力控件；任务消息数据库已实现，运行日志仍仅保存在主进程内存，应用重启恢复、用量与耗时记录尚未实现。
- **规划**：为出站 AI 请求记录不含密钥和正文的目标、目的与数据范围审计事件。
