# Eigent MCP 与 Connectors

> Eigent 证据：`backend/app/service/mcp_config.py`、`backend/app/controller/mcp_controller.py`、
> `backend/app/agent/tools.py::get_mcp_tools`、`backend/app/agent/factory/mcp.py`、
> `backend/app/agent/factory/toolkit_assembler.py::_mcp_config`、
> `backend/app/agent/toolkit/mcp_search_toolkit.py`、`backend/app/model/chat.py`、
> `backend/app/hands/capabilities.py`、`server/app/model/mcp/`、
> `server/app/domains/mcp/service/mcp_user_service.py`、`server/app/domains/mcp/api/`、
> `server/app/core/validator/McpServer.py`、`electron/main/utils/mcpConfig.ts`、
> `electron/main/index.ts`、`src/pages/Connectors/ConnectorGateway.tsx`、
> `src/pages/Connectors/components/AddConnectorDialog.tsx`、
> `src/pages/Connectors/components/AddCustomConnectorDialog.tsx`、
> `src/store/chatStore.ts::buildConnectorGatewayMcpConfig`、
> `src/components/Session/SidePanelSections/buildContextItems.ts`、
> `src/components/Session/SidePanelSections/ExecutionContextSection.tsx`
>
> Tessera 对照：`apps/desktop/src/main/mcp-service.ts`、
> `apps/desktop/src/renderer/src/components/mcp-settings.tsx`、
> `packages/ai/src/server/agent-runtime.ts::createExternalAgentToolSet`、
> `packages/contracts/src/index.ts`、`packages/database/schema.ts`、
> `packages/database/mcp-server-config-repository.ts`、`docs/architecture/mcp.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Eigent 的 MCP 不是一套实现，而是三代连接机制并存：

1. **本地自定义 MCP**：Electron 与 Brain 共同直接读写 `~/.eigent/mcp.json`；
2. **Server MCP 市场**：数据库维护分类、官方条目、安装命令和用户安装记录，renderer 再把启用项同步到本地 JSON；
3. **Connector Gateway**：Server 暴露统一的 providers/connections/OAuth/action 管理面，并在每次 Run 中动态注入一个
   `streamable_http` MCP gateway。

产品上最值得 Tessera 学习的是第三代的统一 Connector 心智：用户看到的是 Notion、Google Drive、Slack 等“可连接应用”，
而不是被迫理解 command、transport 和 JSON；不同 provider 的 OAuth/API key/custom credential 由统一表单描述，连接成功后
所有 actions 经一个 MCP gateway 提供给 Agent。右侧 Execution Context 又只显示本任务**实际调用过**的 MCP，而不是把整个安装
库列为已使用，这种区分非常重要。

工程上却不应照搬 Eigent 的本地链路。`mcp.json` 中 command、args、env、URL 都是明文；Electron 与 Python 各有一份几乎相同的
读写/normalize 代码；Server `McpUser.env` 也是普通 JSON；renderer 可以拿到并回填 env；安装、启用、Agent 绑定、本 Run 注入和
实际调用的状态分散在 Server DB、磁盘 JSON、worker store、Chat payload 和 runtime event 中。MCP 工具一旦注入 CAMEL Agent 就会
自动执行，没有 Tessera 现有的逐工具人工审批。

Tessera 当前 MCP 安全主链明显更成熟：三种传输、safeStorage、信任与启用分离、主进程连接池、工具分页发现、逐工具停用、调用前
再次核对、输出限额和秘密脱敏、AI SDK `needsApproval = true` 都已实现。当前真正应该吸收的是 Eigent 的 Connector 产品层、按任务
绑定、实际使用投影、OAuth 和 Resources/Prompts，而不是重写底层 MCP client。

## 1. 先分清五层状态

MCP 产品最容易把“已经安装”误写成“Agent 可以随时使用”。建议用五层状态解释 Eigent：

| 层 | 问题 | Eigent 对应 |
| --- | --- | --- |
| Catalog | 有哪些可选连接？ | Server `Mcp` 市场、Connector providers |
| Installation / Connection | 用户是否配置或授权？ | `McpUser`、gateway connection、`mcp.json` |
| Enablement | 当前应用是否启用？ | `McpUser.status`、本地 JSON 是否存在 |
| Run binding | 本次 Run/哪个 Worker 能看到？ | `Chat.installed_mcp`、`NewAgent.mcp_tools`、Hands allowlist |
| Invocation | 本次是否真的调用？ | toolkit runtime events → Execution Context |

这五层必须分别建模。服务器“已连接”不等于本次 Run 已绑定；本次 Run 可见不等于模型真的调用；一次调用成功也不应倒推出整台服务器
可信或未来自动批准。

Eigent 的 UI 已经部分理解这一点：Execution Context 注释明确说，worker 配置只用于分类 hint，只有 `ACTIVATE_TOOLKIT` 等运行事件才生成
实际使用条目。但配置数据本身仍没有统一对象贯穿五层。

## 2. 第一代：`~/.eigent/mcp.json`

### 2.1 文件格式

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "some-mcp"],
      "env": { "API_KEY": "..." }
    }
  }
}
```

远程服务使用 `{ "url": "..." }`；新 Connector Gateway 则额外使用 `type: "streamable_http"`、headers 和 timeout。
`args` 为兼容旧数据可以是 JSON string 或逗号分隔 string，读取时归一成字符串数组。

### 2.2 双 writer

`electron/main/utils/mcpConfig.ts` 和 `backend/app/service/mcp_config.py` 都直接操作同一个文件，并各自实现：

- 文件不存在时创建默认结构；
- JSON 读取失败回落空配置；
- args normalize；
- add/remove/update；
- 整文件同步覆盖。

这带来四类风险：

1. 两进程并发 read-modify-write 会丢更新；
2. 没有临时文件、fsync、lock 或 schema version，崩溃可留下半文件；
3. 两份 normalize 逻辑将随版本漂移；
4. 读取损坏只静默变空，用户可能误以为连接被删除。

Electron preload 又直接暴露 `mcpInstall/remove/update/list`，参数使用 `any`；虽然操作在主进程，契约仍宽。Brain 同时公开本地 `/mcp/*`
CRUD，进一步增加入口数量。

Tessera 已经以 `packages/contracts` 窄 IPC + 主进程 service + SQLite repository 形成单 writer，不应引入 JSON mirror。导入/导出应是显式
操作，不是运行事实源。

### 2.3 秘密管理

Eigent 本地 `env` 原样写入 JSON；MCP remote OAuth 的缓存目录通过 `MCP_REMOTE_CONFIG_DIR` 统一到 `~/.mcp-auth` 或按 email 目录。这样能避免
每个任务重复登录，但没有把“凭据归属、授权范围、过期/撤销状态”和普通环境变量分开。

Server `McpUser.env` 也是 JSON，API output 会返回 env；renderer 的配置表单会把它复制进 state。这与“秘密永不回 renderer”的边界相反。

Tessera 当前做法更正确：env/headers 经 Electron `safeStorage` 加密，公开配置只有 `envConfigured` / `headersConfigured`；编辑留空表示保留，
安全存储不可用时拒绝写新秘密；连接错误和输出都会替换已知 secret value。后续 OAuth token 也应复用这个 SecretRef 边界，而不是新增明文字段。

## 3. 第二代：MCP 市场与用户安装

### 3.1 Catalog 模型

Server `Mcp` 保存：分类、名称、key、说明、主页、local/remote 类型、上下线状态、排序、server name 和 `install_command`。分类 API 支持筛选；
列表支持 keyword/category/mine 和分页；install endpoint 带 rate limiter。

`install_command` 典型结构仍是 command/args/env。市场安装时复制到 `McpUser`：

- 用户 ID 和 catalog MCP ID；
- name/key/description 快照；
- command/args/env 或 remote URL；
- enabled/disabled 状态。

复制快照使 catalog 后续变化不会静默改写用户配置，这是优点；同时意味着漏洞修复、弃用或供应链告警没有升级/迁移通道。

### 3.2 自定义导入

Local import 用 Pydantic 验证 `command: string`、`args: string[]`、可选 env；Remote import 只要求 server name/url。导入逐项记录 imported/failed。
但是 validator 没有限制：

- command allowlist/绝对路径；
- 参数数量和长度；
- URL scheme、userinfo、localhost/private network；
- env key/value 数量和大小；
- 同名去重和稳定 ID；
- imported config 默认应该 disabled/untrusted。

源码会把导入项直接设为 enabled。对于 stdio，这等价于允许用户粘贴的数据启动本地程序；“用户主动导入”可以构成配置意图，但仍不应自动成为
Run 可执行能力。Tessera 当前保存停用草稿、显式 trust 后才能 enable 的两步状态更安全。

### 3.3 市场与本地运行的桥

Server 安装记录不是 Brain 的直接事实源。renderer 加载 `McpUser`，打开开关时通过 Electron `mcpInstall()` 把配置写进本地 `mcp.json`；关闭时从
JSON 删除。Server status 与本地文件因此可能漂移：

- Web/另一台设备的 installed 状态不代表当前 Brain 已配置；
- 本地写失败后 Server UI 仍可能显示 enabled；
- 本地 JSON 被编辑/删除后 Server 记录不更新；
- env 同时存在 Server DB、renderer state、本地 JSON。

这说明跨设备 Connector 必须区分 cloud connection 与 execution-node availability，不能通过“同步配置文本”完成。

## 4. 第三代：Connector Gateway

### 4.1 产品对象

Gateway provider 元数据包含：

- service、displayName、description、icon、homepage、category；
- auth types 与结构化 auth definitions；
- credential fields、secret 标记、OAuth scopes、client config fields；
- actions 与本地可执行/catalog-only 数量；
- connection name、auth type、configured、virtual/default、profile 和 granted scopes。

renderer 用这些 schema 生成同一套“浏览连接器→查看 actions→选择认证方式→输入字段/OAuth→连接”的 UI。相较要求用户填写 MCP JSON，这更接近普通用户
心智，也能为以后 Marketplace、企业策略和权限说明提供位置。

### 4.2 OAuth 与连接状态

OAuth 流由 Server 创建 authorization URL，renderer 打开 popup，再刷新 provider connection 状态；API key/custom credential 通过统一 connect endpoint。
连接后 UI 展示 profile 和 granted scopes。源码固定提交中 gateway 的 Server 实现不在当前仓库可见路径里，renderer 只通过 `/api/v1/connectors/*` 和 capability
flag 访问，因此以下部分不能由本地代码确认：token 如何加密、OAuth state/PKCE、refresh token 生命周期、action 到 MCP tool 的权限映射。

文档必须把“前端协议已存在”与“服务端安全实现不可见”分开，不能仅凭 UI 判断完整。

### 4.3 一个 Gateway MCP 注入全部已连接应用

每次正常 Run 启动前，renderer 检查 server capability；启用且不是 local proxy 时构造：

```text
mcpServers.connector_gateway = {
  type: streamable_http,
  url: {serverApiBase}/connectors/mcp,
  headers.Authorization: Bearer {当前 token},
  timeout: 180
}
```

它被合并到每个 Worker 的 `mcp_tools`，Single Agent 的 `installed_mcp` 也得到 gateway。优点是：

- Agent 只维护一个协议连接；
- OAuth token/第三方 credential 可以留在 Gateway；
- 新 provider/action 不需要发桌面版；
- cloud/web execution 不依赖本地 stdio。

代价是 gateway 成为高权限聚合边界：一个 MCP server 可以代表所有已连接应用，MCP tool namespace、connection choice、scope、租户隔离、审计和 revoke 必须在
Server 强制执行。renderer 把用户 Bearer token 放进 Run payload，再由 Brain MCP client使用；本地 Brain 的日志/异常和子进程边界必须确保不会泄露 header。

### 4.4 Tessera 可吸收的抽象

Tessera 不必把 Connector 与 MCP Server 合成一个数据库表。更清晰的是：

```text
ConnectorProvider      用户看到的应用/服务
ConnectorConnection    用户授权的某个账号与 scopes
Capability             tools/resources/prompts/actions
McpEndpointBinding     该 connection 通过哪个 MCP endpoint 暴露
RunCapabilityBinding   本次 Run/Agent 允许哪些 capability
Invocation             实际调用、批准与结果摘要
```

本地自定义 MCP 仍可作为一种 endpoint；Gateway 也是一种 endpoint；内置领域 API 可以不经过 MCP，却对用户呈现同一 Connector 产品层。

## 5. MCP 如何进入 Agent

### 5.1 Run payload

`Chat.installed_mcp` 和每个 `NewAgent.mcp_tools` 都是 `{mcpServers: ...}`。renderer 在 Run 开始前把 gateway 和 Worker 配置合并。Hands capability 可以按 MCP server name
过滤，remote execution 由 execution cluster 决定哪些 MCP 可用。

这比全局配置直接注入所有 Agent 前进了一步：不同 Worker 可以拥有不同 connector。可是配置仍包含 command/env/header 明文，是“运行配置传输”，不是稳定 capability ID。

Tessera 当前 `createAgentTools()` 会把所有 enabled+trusted server 的 enabled tools 注入有 workspace 的 Agent，没有 per-task selection。后续最需要补的正是 Run binding：

- 默认自动模式只开放用户在本轮选择/策略允许的服务器或工具；
- Run 开始时冻结 `{serverId, configFingerprint, toolName, inputSchemaHash}`；
- 历史显示“当时可用”与“实际调用”；
- 设置中途停用仍要在执行前拒绝，这一点现有代码已实现。

### 5.2 CAMEL MCPToolkit

通用路径创建 `MCPToolkit(config_dict, timeout=180)`，connect 后取得 FunctionTools。Single Agent assembler、Workforce MCP Agent 和自定义 Worker 都会走这条路径；专用
Notion/Google Drive/Gmail toolkit 则把固定 MCP 配置包装成领域 toolkit。

主要问题：

- 连接错误通常被吞掉并返回空 tools，用户只看到 Agent 能力缺失；
- `get_mcp_tools()` 返回 tools 后没有显式保存 toolkit 到 Run lifecycle，也没有统一 disconnect；
- 每个 Worker/Agent 可能为同一个 endpoint 重复 connect；
- timeout 固定 180 秒，未区分 connect/list/call；
- 没有 listTools pagination/output size 等应用级保险丝；
- server name 配置进入 `tool_names`，真实 function names 与 server identity 的映射不稳定。

Tessera 主进程按连接配置 fingerprint 复用 client，配置变化/停用/删除/退出会 close；停用服务器的测试连接结束即释放；listTools 最多 20 页，call 有 timeout、abort 和 1 MiB
上限。这套 lifecycle 不需要向 CAMEL 看齐。

## 6. Search MCP Agent 的真实作用

Workforce 固定创建一个 MCP Agent。即使没有已安装 MCP，它仍拥有 `McpSearchToolkit.search_mcp_from_url()`：模型可按关键词查询 `MCP_URL` 市场，结果通过 queue 发送到 UI；
system prompt 要求找到后通过 GUI 问用户是否安装。聊天运行中还支持 `/install-mcp` Action，把新连接的 tools 动态 `add_tools()` 到已有 MCP Agent。

这是一种“能力缺失时由 Agent 找插件”的早期实现，思路有价值，但安装不应由模型自由选择配置文本：

- Agent 可以提出缺少的 capability；
- 应用匹配可信 catalog/provider；
- UI 展示发布者、权限、transport、command、scopes 和风险；
- 用户安装后只成为 configured/untrusted 或 connected，是否绑定当前 Run另行决定；
- 已运行 Agent 不应原地变更 tool schema；更安全的是结束当前 step，用新的 Run/Agent tool snapshot 继续。

Tessera 后续可以提供“需要连接某应用”结构化建议，不必保留专职 MCP 搜索 Agent。

## 7. 调用授权：Eigent 的核心缺口

Eigent 的确认机制主要用于澄清任务、安装或登录；固定提交中没有一条通用 MCP tool-call approval protocol。工具被添加到 CAMEL Agent 后，模型可直接执行。Hands 只回答某 server 是否允许，并不评估 tool、参数、目标资源和风险。

这意味着：

- 用户启用一个 GitHub/Notion server 后，读与写 actions 的执行边界相同；
- MCP annotations 没有进入审批策略；
- Connector OAuth scopes 只是连接权限，不能代替本次操作授权；
- 多 Worker 会扩大同一连接的调用面；
- prompt 中“优先用已连接应用”可能增加自动调用频率。

Tessera 当前所有 external MCP tools 通过 AI SDK `dynamicTool(needsApproval=true)`，用户拒绝后 instructions 禁止相似调用绕过；执行前再次读取 SQLite，服务器或 tool 已停用立即失败。这个设计应保持。

未来可在有完整审计后评估 session grant，但不能只依据 MCP `readOnlyHint` 自动批准。annotation 是不受信任 server 声明，只能用于 UI 风险提示和策略输入；实际风险还要结合 tool ID、参数、目标连接、资源范围和历史决定。

## 8. Execution Context 的产品价值与技术局限

Eigent 右侧 Execution Context 按 Skills / MCP Tools / Referenced Files 分组。构造器：

- 从 worker config 收集 server/toolkit 名称，仅作为分类 hint；
- 遍历 task/taskRunning 的 runtime toolkit activation；
- MCP toolkit name 包含 `mcp` 就归为 connector；
- 去重后展示；
- 未实际触发的配置不产生条目。

这是正确的产品原则，但当前使用 toolkit name 和字符串正则推断 identity，容易出现：专用 toolkit 名称不一致、gateway 只显示 umbrella server、实际 action/账号不明、工具事件丢失后缺项。

Tessera 应从标准 Tool Part 与 Run binding 直接生成：

```text
Connector: Notion / 工作账号
Tool: search_pages
State: proposed -> approved -> running -> completed
Scope: pages.read
Invocation: call-id / run-id
```

配置库、Run 可用清单和实际调用在 UI 上应分别叫“已连接”“本次可用”“执行上下文”，避免一排相同绿色图标混淆。

## 9. Tessera 逐项对照

| 能力 | Eigent | Tessera 当前状态 | 结论 |
| --- | --- | --- | --- |
| stdio | CAMEL MCPToolkit | 已实现，主进程无 shell 展开 | 保持 Tessera |
| Streamable HTTP | Gateway/remote config | 已实现 | 保持 Tessera |
| SSE | 兼容路径 | 已实现兼容 | 不作为新默认 |
| 配置事实源 | Server DB + JSON + stores | SQLite 单 writer | Tessera 更好 |
| Secrets | 明文 env/JSON/OAuth dir | safeStorage、renderer 不回显 | Tessera 更好 |
| Trust/Enable | import 默认 enable | 显式分离 | Tessera 更好 |
| Tool discovery | connect 后一次取 tools | 分页、annotations、检测 UI | Tessera 更完整 |
| Tool disable | 主要 server status | 逐工具 disabled list | Tessera 更完整 |
| Connection pool | Agent/Worker 各建 toolkit | 主进程 fingerprint pool | Tessera 更完整 |
| Per-call approval | 未见通用链路 | AI SDK needsApproval | Tessera 必须保留 |
| Output bounds/redaction | 未见统一边界 | 1 MiB + secret redaction | Tessera 更完整 |
| Marketplace | Server MCP catalog | 未实现 | 可借鉴产品层 |
| Connector providers/OAuth | renderer协议完整，Server实现不可见 | 规划 | 优先新增 |
| Per-run binding | Worker mcp_tools | 尚未实现 | Eigent 有产品启发 |
| Actual-use panel | toolkit runtime projection | Tool Parts 已有事实，缺统一侧栏 | 值得实现 |
| Resources/Prompts | 未见主链 | 规划 | 双方都未闭环 |

## 10. Tessera 推荐架构

### 10.1 保持现有 MCP runtime

不要为了 Connector Gateway 替换 `mcp-service.ts`。它继续负责：endpoint config、secret resolution、transport、connection pool、capability discovery、call bounds、redaction 和 shutdown。

新增 Connector 层只负责 provider/connection/scopes 和 endpoint binding；Agent runtime 最终仍接收统一 `ExternalAgentTool`。

### 10.2 `RunCapabilityManifest`

Run 开始时冻结：

```text
connections[{ connectorId, connectionId, displayName, scopeSummary }]
mcpEndpoints[{ serverId, configFingerprint, transport }]
tools[{ publicToolId, serverId, originalName, schemaHash, approvalPolicy }]
resources[]
prompts[]
```

秘密、绝对命令和 headers 不进入 manifest。设置中途变化不会回写 manifest；真正执行仍核对当前 enable/trust/revoke，历史因此同时能解释“当时计划可用”和“后来为何被阻止”。

### 10.3 Connector Gateway 的最小切片

第一阶段不要做大型开放市场：

1. 定义 `ConnectorProvider` / `ConnectorConnection` 公共契约；
2. 先支持一个 OAuth provider 和一个 API key provider；
3. credential 只保存在主进程/可信服务；
4. provider actions 映射到现有 MCP endpoint 或领域 adapter；
5. 设置页用 provider 图标、说明、scopes、连接身份和 actions；
6. Run 中显式选择 connection，仍逐次批准 tool call；
7. Execution Context 从 Tool Part 投影实际调用。

验收重点不是“目录里有多少应用”，而是 revoke、token refresh、账号切换、审批、错误脱敏和跨重启恢复。

### 10.4 Resources 与 Prompts

- Resources 是可引用材料，必须由用户/策略显式附加并进入资源绑定，不能连接后全部塞进 prompt；
- Prompt 是外部模板，按不受信任内容处理，不能覆盖 system policy 或扩大工具范围；
- Resource content 需要大小、media type、分页、provenance 和缓存策略；
- Prompts/Resources 的发现状态与 Tools 一样可以在 MCP 详情页展示，但“发现”不等于“本 Run 使用”。

## 11. 不应照搬的部分

1. 不让 Electron 与 runtime 两份代码读写同一个 JSON。
2. 不把 env/header/OAuth token 明文返回 renderer。
3. 不让 catalog install 自动启用或确认 trust。
4. 不把连接级 OAuth scope 当成调用级用户批准。
5. 不为每个 Worker 重建同一 MCP connection。
6. 不把连接错误吞成空工具而继续假装能力存在。
7. 不在正在执行的 Agent 实例上随意 `add_tools()`；用新 tool snapshot 续跑。
8. 不用 toolkit name 正则作为 Invocation identity。
9. 不用一个高权限 gateway umbrella 隐藏具体账号、action 和 scope。
10. 不先追求 Marketplace 数量，再补供应链、签名、权限和撤销。

## 12. 推荐实施顺序

### P0：完成现有 MCP 的 Run 闭环

- MCP server/tool 进入 task run resource snapshot；
- UI 区分 installed/enabled/available/used；
- 任务右侧展示实际 server/tool/approval/result；
- 保存有限、脱敏的 invocation metadata，不保存完整敏感输出；
- 连接失败以结构化 unavailable 暴露给 Agent 和用户。

### P1：按任务选择与 Resources/Prompts

- 任务输入区可选择本轮 Connector/Tool，而不是全局 enabled 全量注入；
- 支持 MCP Resources 的发现、预览与显式 attachment；
- 支持 Prompt 查看/采用，但当作不受信任用户内容；
- schema hash/config fingerprint 进入 Run manifest。

### P2：Connector Provider/OAuth

- 统一 provider catalog 与 connection lifecycle；
- 主进程 OAuth state/PKCE/token safeStorage/revoke；
- 多账号与 scope 可见；
- endpoint adapter 复用现有 MCP service；
- 再评估可信市场、签名 manifest 和企业 allowlist。

## 13. 最终判断

Eigent 的 MCP 演化非常有参考价值：从“让高级用户粘 JSON”走向“让普通用户连接应用”，再把所有应用聚合为 Agent 可调用的 Gateway。这说明 MCP 在产品里最终应是实现协议，而 Connector 才是用户心智；同时，运行侧必须记录本次实际使用，而不能用安装状态冒充执行上下文。

但它也展示了扩展系统的典型债务：为尽快接通市场和多 Agent，把同一配置复制到多层，把 secrets 交给 renderer，把 enable 当 trust，把 OAuth scope 当工具权限，最后难以解释一次调用究竟从哪里获得授权。Tessera 已经具备更好的底层信任和审批边界。正确路线是保留现有 MCP runtime，向上增加 Connector/Connection，向下补 Run capability manifest 和实际调用投影，而不是重做传输或回退到明文 JSON。
