# Eigent 模型、供应商与能力路由

> Eigent 证据：`src/lib/llm.ts::INIT_PROVODERS`、`src/lib/providerModels.ts`、
> `src/store/cloudModelStore.ts`、`src/pages/Agents/Models.tsx`、`src/lib/modelConfig.ts`、
> `server/app/model/provider/provider.py`、`server/app/domains/model_provider/service/provider_service.py`、
> `backend/app/controller/model_controller.py`、`backend/app/component/model_validation.py`、
> `backend/app/agent/agent_model.py`、`backend/app/agent/factory/toolkit_assembler.py`
>
> Tessera 对照：`packages/ai/src/provider-catalog.ts`、`packages/ai/src/model-capabilities.ts`、
> `packages/ai/src/server/model-discovery.ts`、`packages/ai/src/model-routing.ts`、
> `packages/ai/src/server/provider-config-service.ts`、`docs/architecture/ai-providers.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Eigent 的模型管理目标很明确：**只有真实完成一次工具调用的模型，才适合 Eigent 的 Agent**。它没有只测试“能否聊”，
而是建立 CAMEL `ChatAgent`，要求模型调用一个本地验证工具，并校验工具结果。这一点比单纯 `/models` 目录可靠。

但它的模型事实模型仍然很弱：

- 自带供应商记录只有 provider、单个 model type、endpoint、key、prefer、valid 和一个泛化 JSON；
- 远端 `/models` 只保留 ID、context length、max completion tokens，并用文本输出粗判 chat；
- cloud catalog 虽然预留 `capabilities`，固定提交中没有任何消费方；
- 不表达输入/输出模态、推理、结构化输出、原生搜索、端点绑定和能力来源；
- API Key 从远端数据库返回 renderer，再由 renderer 明文转发给 Local Brain；`encrypted_config` 这个字段名并不代表
  该 JSON 在这条 CRUD 链路中已加密。

因此，对用户之前关心的“上下文、工具、Agent、联网、对话/向量/图片/视频”问题，Tessera 当前的三态模型能力和端点
绑定设计已经明显优于 Eigent。Eigent 真正值得补入 Tessera 的，是**可重复的真实工具能力探测**和**模型退役/替换目录**。

## 1. Eigent 实际存在三套模型来源

### 1.1 Eigent Cloud catalog

`cloudModelStore` 从托管接口 `/api/v1/cloud-models?kind=chat` 读取：

```ts
{
  id,
  display_name,
  model_type,
  model_platform,
  provider_family,
  kind,
  capabilities?,
  is_default?,
  sort_order?,
  min_plan_key?,
  min_app_version?,
  replaced_by_model_id?
}
```

它使用 ETag/version、60 秒 stale-while-revalidate、本地 Zustand persist、legacy fallback 和 retired replacement。用户选择
已下线模型时，先查 `replaced_by_model_id`，否则回到当前 default。这个“目录版本 + 退役迁移”是成熟产品需要的能力。

固定提交的开源 Server 中没有 `/cloud-models` 实现，说明这个 catalog 来自 Eigent 托管控制面，而不是仓库内可完整复现
的 server domain。文档不能据此推断其服务端校验、签名或发布流程。

虽然类型中有 `capabilities`，源码搜索没有找到模型路由或 UI 对该字段的读取；它目前只是透传/预留字段。

### 1.2 用户 BYOK providers

renderer 内建 `INIT_PROVODERS`，覆盖 Gemini、OpenAI、Anthropic、Grok、DeepSeek、OpenRouter、AWS Bedrock、Azure、
OpenAI Compatible 等。每个入口可以声明默认 API host、附加凭据字段和可选 `modelsEndpoint`。

Server `Provider` 表只有：

```text
provider_name
model_type
api_key
endpoint_url
encrypted_config JSON
prefer
is_valid
```

这表示一条 provider 配置只选择一个主模型，无法原生表达“同一连接拥有一组可启停模型”和模型级用户覆盖。
`encrypted_config` 同时装 AWS/Azure constructor 参数与 `model_config_dict`，命名和职责都过载。

### 1.3 Local models

本地入口包括 Ollama、vLLM、SGLang、LM Studio、llama.cpp。Ollama 从 `/api/tags` 解析模型，其他 OpenAI-compatible
实现从 `/v1/models` 取 ID。最终仍保存成 Provider 记录，API Key 使用 `not-required` 占位。

这里的优点是云端和本地模型最终都进入 CAMEL `ModelFactory`；缺点是同一 Provider schema 被迫同时表示远端秘密、
本地地址、OAuth subscription 和托管 cloud model，类型边界模糊。

## 2. `/models` 发现保留了什么

只有声明 `modelsEndpoint` 的部分 BYOK 供应商会自动发现模型。解析器读取 OpenAI-compatible payload：

- `id`
- `architecture.input_modalities`
- `architecture.output_modalities`
- `context_length`
- `max_completion_tokens`

但归一化后只保留：

```text
ProviderModelInfo = {
  id,
  contextLength?,
  maxCompletionTokens?
}
```

`isChatCapable()` 的策略是：没有 architecture、没有 output modalities 或 outputs 包含 `text` 都视为 chat；只有明确的
TTS/image/video-only 才过滤。这是合理的保守目录策略，却没有把“未知”保留下来，也没有区分 embedding/rerank/realtime。

更关键的是，`ProviderModelCombobox` 只显示 provider 分组和 model name，context/max completion 没有进入选项 UI，选中
后也只保存 model ID。模型目录 cache 直接存 localStorage，密钥则必须先存在 renderer 才能由 renderer 直连供应商拉取目录。

Tessera 当前把远端目录发现放在主进程、限制响应体/超时并清洗错误，比 Eigent 的 renderer 直连方式更符合 Electron
安全边界。

## 3. 真实工具能力验证

### 3.1 验证步骤

`POST /model/validate` 不是简单 ping，执行五阶段：

```text
1. initialization
   校验 platform / model type / key 形态
2. model_creation
   CAMEL ModelFactory.create(timeout=60)
3. agent_creation
   ChatAgent + 一个 get_website_content tool
4. model_call
   强制模型调用该工具一次
5. tool_call_execution
   检查 response.info.tool_calls 和精确返回值
```

只有模型产生 tool call，并且 CAMEL 真正执行工具得到预期字符串，才设置：

```text
is_tool_calls = true
is_valid = true
```

失败会区分 authentication、network、model not found、rate limit、quota、timeout、tool unsupported、tool execution failed、
invalid config 和 unknown，并保留截断后的 provider 原始错误。

### 3.2 为什么比目录声明更可靠

它同时验证：

- provider adapter 能构造；
- endpoint/key/model ID 组合可调用；
- model 能按当前协议返回工具调用；
- CAMEL 能解析并执行；
- 结果能进入 Agent response。

这实际上验证的是**连接 × 模型 × 协议适配器 × SDK 版本**的有效能力，而不是模型名称的静态属性。这个思想与
Tessera 的有效能力解析器完全相容，值得采用。

### 3.3 局限

1. 单次未调用工具可能是采样/指令遵循失败，不一定代表模型永久不支持；当前直接判 unsupported。
2. 只测一个无参数风险、同步本地工具，不测并行、多轮 tool result、结构化参数、长 schema、provider-executed tool。
3. 不测视觉、推理、结构化输出、上下文上限、联网、流式 tool delta 和取消。
4. 验证 Anthropic 默认 `max_tokens=4096`，实际 Agent 默认可能设到 128000，验证配置与生产配置不完全一致。
5. `is_valid` 与 `is_tool_calls` 最后合并成 Provider 级状态，没有保存探测时间、SDK/端点版本、证据和退化原因。

Tessera 可将其升级为按 capability 的 probe result，而不是一个总开关。

## 4. 运行时模型构造

renderer 最终把 `model_platform/model_type/api_key/api_url/model_config_dict/extra_params` 明文放入 `/chat` request。
Local Brain `agent_model()` 再为每个 Agent 合并：

```text
task default model config
  + per-worker custom model config
  + provider constructor params
  + request-time model params
  + runtime-owned cache/stream/user params
```

值得注意的策略：

- Anthropic/Bedrock 默认 `cache_control=5m`；
- OpenAI 默认 `prompt_cache_key=project_id`；
- subscription auth 不发送 store，并在 401 时刷新；
- OpenAI-family stream 自动 `include_usage`；
- Browser Agent 对部分 provider 关闭 parallel tool calls；
- Workforce 的每个自定义 Worker 可以绑定独立 Provider/model。

这是一套 provider workaround 集合，不是显式 capability routing。Browser Agent 关闭并行工具来自角色经验规则，
多模态 toolkit 则在 factory 中按 platform 名称决定是否创建 OpenAI image/audio tool。工具能力与 provider 分支散落，
没有一个可解释的有效能力交集。

## 5. Agent-ready 的产品策略

Eigent 设置页只在 `res.is_tool_calls && res.is_valid` 时保存/启用成功，并提示工具调用是使用 Eigent 的必要条件。
这把产品承诺变得简单：普通可聊天但不能调用工具的模型不是 Eigent 可用模型。

优点：

- 避免用户选中一个只能聊天的模型后，Agent 静默失败；
- 工作群所有角色都可以假设基础 tool calling；
- 设置页有真实可操作的验证反馈。

代价：

- 模型类型和产品能力被强绑定，无法提供无工具问答降级；
- “支持工具”被误当成“适合 Agent”，没有考虑上下文、可靠性、循环、成本、结构化输出和取消；
- 连接一个模型只得到总 valid，没有持续健康与能力漂移管理。

Tessera 现有 `agentReady` 推导更合理：它不持久化为模型开关，而由 chat 类型、当前端点、工具能力验证和产品边界计算。

## 6. 原生联网与工具调用没有分清

Eigent 的联网主要来自：

- SearchToolkit；
- BrowserToolkit；
- WebFetchToolkit；
- MCP search/connectors；
- 部分外部 server capability。

它不是根据某个模型端点的原生 web search 能力路由。在固定提交中，没有类似
`provider × model × endpoint × official/custom` 的原生搜索事实，也没有把 server-side search tool 与普通 function call
分开。因此把 Eigent 用作“DeepSeek 哪个端点能联网”的参考会得出错误方向。

这恰好印证 Tessera 当前架构修正：联网不是模型布尔属性，而是端点投递能力与产品工具能力的组合。

## 7. 模态和上下文的表达缺口

| 问题 | Eigent 固定提交 | 后果 |
| --- | --- | --- |
| 对话/Embedding/Rerank | cloud catalog 有自由字符串 `kind`，UI 过滤 chat；BYOK 无模型 kind | 非 chat 模型无法统一管理 |
| 图片/视频/音频模型 | 有 multi-modal toolkits，但不属于模型目录统一类型 | 生成工具与模型事实分叉 |
| 输入模态 | `/models` 读取后丢弃 | 不能判断图像附件是否可直接发送 |
| 输出模态 | 只用于是否包含 text 的过滤 | 无法路由图片/音频/视频结果 |
| Context | 部分 `/models` 读取并只留在临时 cache | 不进入运行时预算/压缩策略 |
| Max output | 同上 | 实际由用户 JSON 或 provider workaround 控制 |
| Tool calling | 真实验证，但只存 Provider valid | 无模型级三态、时间和证据 |
| Reasoning | 无统一事实 | 只通过 provider params/模型行为 |
| Structured output | 无统一事实 | 无法作为 Agent planner 路由条件 |
| Native search | 无端点绑定 | 依赖外部 toolkit，不表达 provider 原生搜索 |

用户之前指出的模型管理问题，在 Eigent 中并没有解决；LobeHub/Cherry Studio 的 UI 可编辑能力只是产品表面，真正需要
的是 Tessera 文档里已经定义的模型/供应商/端点/连接/运行策略五层事实。

## 8. 密钥与配置边界

Server 的 `ProviderOut` 继承 `ProviderIn`，响应包含 `api_key`。renderer 加载 provider 列表后把 key 放进 React form，
创建 Worker 时又通过 `buildAgentModelConfigFromProvider()` 把 key 放进 per-agent config，发往 localhost Brain。

`encrypted_config` 在该链路中只是 JSON 列，Provider service 直接保存/返回，没有在 domain service 中调用加密器。即使
部署层对数据库或传输另有保护，renderer 仍拿到明文 key。它与 Electron subscription credential store 是两套不同边界。

Tessera 当前 `safeStorage` + SQLite ciphertext + renderer 只见 `apiKeyConfigured` 的方案更安全，应保持：

- 模型发现、验证和生成都在主进程解密；
- renderer 永不重新获得已保存 key；
- Worker/子 Agent 只引用 `providerConfigId`，不复制 credentials；
- MCP env、browser cookies 和 provider keys 最终进入统一 secret reference，但各领域仍可独立管理生命周期。

## 9. Tessera 对照

| 领域 | Eigent | Tessera 当前状态 | 结论 |
| --- | --- | --- | --- |
| Provider/Connection | 单条 Provider 混合配置与模型 | 已区分供应商品牌、协议适配、连接实例 | Tessera 结构更清晰 |
| 模型目录 | 托管 catalog + 部分 `/models` + localStorage | 内建目录 + 主进程发现 + SQLite | 保持主进程事实源 |
| 能力模型 | 预留 capabilities，基本不消费 | 三态 capability、模态、类型、来源 | Tessera 已领先 |
| 工具验证 | 真正执行一次 CAMEL tool | 主要依赖内建/远端/用户覆盖，运行验证有限 | 借鉴 probe |
| 原生搜索 | 外部 toolkit 为主，无 endpoint binding | 已建 provider/model/endpoint 交集 | 不退回模型布尔开关 |
| Agent-ready | Provider valid = tool call 成功 | 动态推导 | 动态推导更正确 |
| Retired model | 版本、替换和 default fallback | 版本化注册表仍规划 | 借鉴 catalog migration |
| 密钥 | Server 返回 renderer，再发 Brain | safeStorage，renderer 不回显 | 坚持 Tessera 边界 |

## 10. 建议 Tessera 增加的能力探测

建议将探测结果建模为：

```text
CapabilityProbeResult {
  connectionId
  modelId
  endpointId
  adapterVersion
  capability
  status: supported | unsupported | inconclusive | failed
  testedAt
  expiresAt?
  latencyMs
  publicErrorCode?
  evidenceSummary
}
```

首批探测分层：

1. **连接探测**：认证、model exists、最小文本响应。
2. **工具探测**：单工具、多轮 tool result、结构化参数、流式。
3. **结构化输出探测**：schema adherence，不与工具调用混为一项。
4. **模态探测**：最小图片输入；生成模型另走对应 endpoint。
5. **原生搜索探测**：只针对供应商明确的 server-side endpoint，记录来源 Part 是否可解析。

探测不能覆盖用户显式 `unsupported`，也不能把网络失败判成 capability unsupported。静态目录仍负责上下文和模态等不应
频繁付费探测的事实，真实 probe 补充协议兼容证据。

## 11. 建议的模型事实合并顺序

```text
versioned builtin registry
  + signed/controlled registry update
  + provider /models remote signals
  + connection-specific probe evidence
  + user field overrides
  -> EffectiveModelCapabilities at request time
```

- 用户覆盖只覆盖对应字段，不复制整份模型对象。
- capability 保留来源和验证时间。
- endpoint binding 独立于模型固有能力。
- RunContext 固化本次 effective facts，后续目录更新不回写历史 run。
- 退役模型通过 replacement mapping 提示迁移，但不能静默改写历史消息使用的 model ID。

## 12. 可直接转化为任务的结论

1. 在现有模型详情中增加“已验证”而非只有“目录/用户覆盖”的能力来源。
2. 新增连接级最小 tool-call probe，保存时间、adapter、endpoint 和 inconclusive 状态。
3. 将模型注册表做版本化与 retired/replacement 映射，借鉴 Eigent cloud catalog 的迁移体验。
4. 保持模型目录请求在主进程，不让 renderer 持 key 直连供应商。
5. 运行时只接收 `configId + modelId`，不允许 renderer 发送 key、base URL 和 provider params。
6. 在上下文预算专题中使用 effective context/max output，不把 `/models` 临时结果留在 UI cache。

## 13. 明确不照搬

- 不用一个 `is_valid` 同时表示认证、模型可调用和 Agent-ready。
- 不把能力塞进无 schema 的 `encrypted_config`。
- 不把 API Key 返回 renderer，也不把明文 key 复制进 Worker config。
- 不只凭文本输出判断模型类型，也不丢弃 `/models` 已返回的模态信息。
- 不把 SearchToolkit 能联网等同于模型端点支持原生搜索。
- 不用 provider 名称分支替代统一 endpoint/capability resolver。
