# Pi 模型、Provider 与运行时路由

> Pi 证据：`packages/coding-agent/src/core/model-runtime.ts::ModelRuntime`、
> `packages/coding-agent/src/core/model-resolver.ts::resolveCliModel`、
> `packages/coding-agent/src/core/model-resolver.ts::findInitialModel`、
> `packages/coding-agent/src/core/model-resolver.ts::restoreModelFromSession`、
> `packages/coding-agent/src/core/provider-composer.ts::composeModelProvider`、
> `packages/coding-agent/src/core/sdk.ts::createAgentSession`、
> `packages/coding-agent/src/core/agent-session.ts::setModel`
>
> Tessera 对照：`packages/ai/src/routing/model-routing.ts`、
> `packages/ai/src/server/task-agent.ts`、`apps/desktop/src/main/ai-service.ts`、
> `docs/architecture/ai-providers.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Pi 的 `ModelRuntime` 不是一张静态模型表，而是 Provider 组合、credential state、远端 catalog、本地 config、extension overlay 与
可用性快照的共同运行时。它最成熟的部分是：

- built-in Provider 在没有 overlay 时保持原实现不变；
- config/extension/native provider 按 providerId 重组；
- 认证变化串行并刷新单 Provider 快照；
- 模型解析拒绝跨 Provider 的裸 ID 歧义；
- Session 保存实际 provider/model/thinking，恢复失败时显式 fallback。

它仍主要面向用户主动选择模型的 coding CLI。Tessera 还需要连接、endpoint binding、能力三态、任务模式和冻结 run route，
不能把“认证可用”当成“适合本任务”。

## 1. ModelRuntime 的内部事实

运行时持有：

- built-in Providers；
- native extension Providers；
- extension Provider config overlay；
- `models.json` config；
- credential storage 与 runtime API keys；
- model store/remote catalog；
- composition errors；
- `all`、`available`、configuredProviders、storedProviders、auth snapshot。

`all` 是已知模型，`available` 是当前认证/可用性检查后可调用模型。配置错误、组合错误和 availability refresh 错误分别保留，
最终合并为可展示 diagnostic。

## 2. Provider 组合

`recomposeProvider(providerId)` 的规则：

1. native extension provider 优先于同 ID built-in base；
2. 没有 config/extension overlay 时直接使用 base，保持原生 auth/login/stream 语义；
3. 有 overlay 时调用 composer 合并 base、models.json 与 extension config；
4. 组合失败记录错误；有 base 时退回 base，无 base 时移除该 Provider。

这个策略避免一个损坏的 overlay 让所有模型 runtime 崩溃，也避免无覆盖时包装层改变 Provider 行为。

风险是“退回 base”可能让用户以为自定义 endpoint/header 已生效，实际请求使用默认 Provider。诊断必须在模型选择和 Run Inspector
中明显展示，而不是只留日志。

## 3. catalog 与 availability 刷新

创建时默认加载 built-in catalog；只有明确允许且 `PI_OFFLINE` 未设置时才做网络刷新。刷新带 sequence guard：旧异步刷新即使
迟到也不能覆盖新快照。单 Provider credential 变化会使正在进行的全量 availability pass 失效，并只刷新相关 Provider。

这是典型的“异步发布必须按 generation 提交”设计，值得 Tessera 的模型 probe/catalog 采用。

available 不等于模型质量或能力已验证。它主要代表认证和 Provider 返回的可用模型；上下文窗口、thinking、image/tool support
来自 model metadata，仍可能与自定义 endpoint 真实能力漂移。

## 4. credential 操作

同一 providerId 的 login/logout/runtime API key 变更通过 promise queue 串行。凭据先提交，再重新组合 Provider、离线刷新模型并
检查 availability。如果提交已成功但本地同步失败，抛 `CredentialSynchronizationError`，明确表达“外部状态已变、内存状态没
同步”的部分成功。

这是比笼统 `login failed` 更可靠的错误语义。Tessera 的连接编辑/probe 也应区分：

- credential 未提交；
- credential 已提交、catalog/probe 同步失败；
- 当前 run 仍绑定旧 route；
- 下一个 run 可使用新连接。

## 5. 请求准备

每次 stream/complete 前 `prepareRequest()`：

1. 找到 Provider；
2. 为具体 model 解析 auth/baseUrl/env；
3. 合并 credential headers、configured model headers 与调用 headers；
4. 执行 extension header transform；
5. 构造最终 Provider model/options；
6. 调用 provider `stream` 或 `streamSimple`。

`AgentSession` 的 streamFn 又可接 extension provider request/response hooks、timeout、retry 和 transport。最终请求存在多个变换
点，灵活但使“真实发送了什么”难以从设置文件直接推断。

Tessera 应将最终脱敏 route snapshot 与 capability snapshot 持久化到 run；header、secret、完整 payload 不进入 renderer。

## 6. 模型引用与歧义

Pi 支持：

- `provider/modelId`；
- 裸 model ID；
- wildcard/pattern；
- alias；
- thinking level suffix；
- model scope 列表。

`resolveCliModel()` 对跨 Provider 的同名裸 ID 不按 catalog 顺序随便选：若只有一个已认证匹配可选它，否则要求用户显式 provider。
provider/model 解析失败时还有针对 OpenRouter 等“模型 ID 自身含 slash”的 fallback。

这个细节避免静默路由到错误计费账户或不可用 Provider。Tessera 的 UI 以 connection/model stable ID 选择，天然应避免裸名称作为
关系键；导入 CLI/配置时仍需同样的歧义拒绝。

## 7. 初始模型与 Session 恢复

选择优先级大致是：

1. CLI 显式 provider/model；
2. Session 保存的 provider/model；
3. scope/设置中的默认模型；
4. 已知 Provider 默认模型；
5. 可认证 fallback。

恢复模型时既检查模型是否仍存在，也检查 Provider auth；失败会输出原因和 fallback。model/thinking 的每次变更写 Session entry，
所以历史上下文和当前选择可恢复。

旧 Session 可以在一个会话中跨模型，统计也可能包含多个 Provider。Tessera 的每个 `TaskRun` 应冻结实际 route；同一
TaskSession 后续用户 turn 可选择新模型，但不能回写旧 run。

## 8. Tessera 对照

| 维度 | Pi | Tessera 当前状态 | 建议 |
| --- | --- | --- | --- |
| Provider 组合 | built-in + config + extension overlay | connection/brand/protocol/model/endpoint 分层 | 保留明确 binding，不开放任意 overlay 覆盖安全层 |
| Auth 快照 | configured/stored/environment/runtime | 主进程 Secrets 与连接 | 增加部分成功同步错误 |
| Catalog 更新 | generation guard | 版本化 catalog/probe 仍部分实现 | 采用 generation publication |
| 模型选择 | CLI pattern + session restore | UI/RunPolicy/model route | stable ID，拒绝名称歧义 |
| 能力 | model metadata 为主 | function call、模态、类型三态与 endpoint binding | 继续以 endpoint 实测为准 |
| Run 冻结 | Session 内下一 turn 可切换 | task run 已保存实际模型/策略 | 显式 FrozenModelRoute |
| 请求 hook | 扩展可改 payload/header | 主进程受控 Provider adapter | 不向第三方暴露 Secrets/payload hook |

## 9. 建议

1. 为 catalog/probe 使用 generation token，迟到结果不得覆盖新连接状态。
2. 连接 mutation 返回 typed partial-success，明确 credential commit 与 runtime synchronization。
3. `FrozenModelRoute` 记录 connectionId、endpoint binding、provider/model、capability evidence 与 catalog version。
4. 导入或文本配置解析时拒绝跨 Provider 裸 ID 歧义。
5. extension/自定义 Provider 若未来开放，必须在隔离服务中运行，不能获得主进程全量 credential store。
6. Run Inspector 展示 fallback 和 composition/probe warning，不能静默使用默认模型。
