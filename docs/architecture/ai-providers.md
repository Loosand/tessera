# AI 供应商与模型发现

> 代码源头：`packages/ai/src/provider-catalog.ts`、`packages/ai/src/server/provider-config-service.ts`、
> `packages/ai/src/model-capabilities.ts`、`packages/ai/src/server/model-discovery.ts`、
> `packages/ai/src/server/ai-sdk-runtime.ts`、`packages/ai/src/server/chat-runtime.ts`、
> `packages/database/ai-provider-config-repository.ts`、`packages/contracts/src/index.ts`、
> `apps/desktop/src/main/ai-service.ts`、`apps/desktop/src/main/index.ts`、
> `packages/ai/src/react/ai-settings.tsx`、
> `packages/ai/src/react/ai-provider-settings.tsx`
>
> 状态：部分实现。

## 范围

首批只支持远程 API：OpenAI 兼容、Anthropic 兼容、DeepSeek、Grok 与 OpenRouter。本地模型和外部 Agent 是不同运行边界，不在当前 Connection type 中混排。

## 设置交互边界

- `AI` 菜单只控制 AI 全局可用性和工具建议权限。
- `模型供应商` 菜单使用紧凑目录与常驻内容区的主从布局；目录提供全部供应商入口，内容区在总览和单个供应商详情之间切换。
- 供应商切换不离开当前工作区，并显式复位详情滚动位置；长模型目录保留粘性工具栏，模型按已启用与未启用分组。
- 模型目录最终只有一个模型时，该模型在首次发现时自动启用；目录包含多个模型时，新发现模型默认停用，重新同步保留已有模型的显式开关状态。工具栏提供作用于完整目录的全部启用与全部停用操作。
- 供应商和模型图标按需加载 `@lobehub/icons` 的 `ProviderIcon` 与 `ModelIcon`；模型图标按完整模型 ID 匹配，未知 ID 仍显示默认头像，完整映射不会进入工作区首屏 bundle。
- 任务输入区的模型选择器使用按供应商分组的浮层，同时显示模型头像、能力摘要和选中状态；思考强度等普通单选仍使用原生控件。
- 模型目录同步只要求 API 根地址。OpenRouter 的官方公共目录在首次进入详情时自动同步；其他目录若要求鉴权，则在输入 API Key 后重试。
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

设置页同步/测试连接
  -> 主进程优先采用当次新 Key，否则解密已保存 Key
  -> @tessera/ai/server 模型发现适配器
  -> 供应商 /models REST 接口
  -> 归一化模型 ID、名称、所有者和可用限额
  -> 设置页合并列表并保留已有启用状态
  -> 单模型目录自动启用；多模型目录的新模型默认停用
  -> 立即持久化模型目录并广播配置变更
  -> 任务页重新筛选可用模型
```

模型发现不用 `generateText`，因此测试连接和刷新目录不会产生推理费用。生成运行时通过另一个边界 `createAiSdkLanguageModel` 建立：OpenAI 兼容与 OpenRouter 使用 `@ai-sdk/openai-compatible`，Anthropic、DeepSeek 和 Grok 分别使用 `@ai-sdk/anthropic`、`@ai-sdk/deepseek` 与 `@ai-sdk/xai`。

## 模型能力事实

模型列表 API 没有统一、可靠的能力协议。LobeHub 也没有只依赖供应商 `/models`：其开源仓库在本地 `model-bank` 中维护 `vision`、`reasoning`、`search`、`functionCall` 等能力，并把搜索实现区分为 `tool`、`params` 与 `internal`。Tessera 采用同样的“本地能力库 + 远端信号 + 用户配置”思路，但保持最小首版：

- 能力使用 `supported`、`unsupported`、`unknown` 三态，未知不伪装成可用。
- OpenRouter 返回的 `architecture.input_modalities` 与 `supported_parameters` 可补充图片、思考和工具能力；普通模型目录仅返回 ID 时，由保守的内建规则补足常见模型。
- 能力携带 `builtin`、`remote`、`custom` 或 `unknown` 来源；内建规则升级后会重新计算，不让旧推断永久固化。
- 目前只有 Anthropic 兼容模型与 Grok 的已验证原生搜索进入运行时；前者使用 Anthropic Web Search tool，后者切到 xAI Responses API 与 Web Search tool。OpenAI 兼容、DeepSeek 和 OpenRouter 不会仅凭模型名称伪装联网能力。

参考实现与类型事实来自 LobeHub 官方仓库的 [模型能力类型](https://github.com/lobehub/lobehub/blob/canary/packages/model-bank/src/types/aiModel.ts)、[搜索能力决策](https://github.com/lobehub/lobehub/blob/canary/packages/model-bank/src/utils.ts) 与 [Google 模型目录示例](https://github.com/lobehub/lobehub/blob/canary/packages/model-bank/src/aiModels/google.ts)。

## 普通对话运行时

```text
useChat + Electron ChatTransport
  -> preload start/cancel/event 窄接口
  -> 主进程确认供应商已启用、模型已启用且能力匹配
  -> safeStorage 按需解密 Key
  -> AI SDK streamText
  -> 文本、完成原因、来源与思考状态增量
  -> Markdown 消息界面
```

普通对话只发送用户显式输入、上传图片与当前对话历史，不读取工作区。主进程只转发“已完成思考”状态，不把供应商原始 reasoning 文本送入 renderer。窗口销毁、用户停止或应用退出都会中止对应 `AbortController`。

任务页启动时先轻量读取本地配置；首次显示及每次从其他视图返回新任务视图时执行后台模型目录同步。配置变更事件只执行轻量配置重读。多个供应商并行同步时会分别保存成功结果并汇总错误，配置事件与同步请求并发时只采用最后一次有效结果。

## 端点与鉴权

| 供应商 | 默认 API 根地址 | 模型目录与鉴权 |
| --- | --- | --- |
| OpenAI 兼容 | `https://api.openai.com/v1` | 推导 `/models`，Bearer |
| Anthropic 兼容 | `https://api.anthropic.com/v1` | `/models?limit=1000`，官方地址使用 `x-api-key`；兼容地址可从 Bearer 回退到原生头 |
| DeepSeek | `https://api.deepseek.com` | 官方根地址推导 `/models`，Bearer |
| Grok | `https://api.x.ai/v1` | 推导 `/models`，Bearer |
| OpenRouter | `https://openrouter.ai/api/v1` | 推导 `/models`；公共目录可匿名读取，存在 Key 时附加 Bearer |

用户只配置 API 根地址。若误填 `chat/completions`、`responses`、`response` 或 `messages` 完整端点，适配器会回退到同一 API 根下的模型目录；不提供独立 models URL 输入。模型同步不强制要求 Key，适配器只在 Key 非空时发送认证头；远端返回 401/403 时由界面原样提示需要凭据。

## 安全边界

- API Key 不写 localStorage、不以明文写数据库或日志；SQLite 的 `api_key_ciphertext` 只保存 Electron `safeStorage.encryptString()` 结果。
- 系统安全存储不可用时，普通配置仍可保存，但包含新 Key 的保存会被拒绝，禁止降级为明文。
- 列表 IPC 只返回 `apiKeyConfigured`；测试连接、模型同步和后续生成在主进程按需解密，不把持久化 Key 发回 renderer。
- 保存时未输入新 Key 会保留旧密文；删除配置会同时删除 Base URL、模型状态和密文。配置变更事件用于多窗口和任务页重新读取，任务页并发刷新只接受最后一次请求结果。
- 公共模型目录请求不携带空的 `Authorization` 或 `x-api-key` 请求头。
- 主进程只接受已知供应商、http(s) URL，拒绝 URL 内嵌凭据、查询参数和片段。
- 请求总超时 15 秒，响应体最多 2 MiB，错误消息截断并替换可能回显的 API Key。
- 渲染层不直接发网络请求，也不导入 `@tessera/ai/server`。

## 后续能力

- **部分实现**：普通对话已接入流式生成、取消、Markdown、来源、图片和模型能力控件；会话数据库、重启恢复、用量与耗时记录仍未实现。
- **规划**：为出站 AI 请求记录不含密钥和正文的目标、目的与数据范围审计事件。
