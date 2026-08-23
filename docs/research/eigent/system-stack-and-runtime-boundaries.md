# Eigent 系统、技术栈与运行时边界

> Eigent 证据：`package.json`、`electron-builder.json`、`electron/main/init.ts`、
> `electron/main/index.ts`、`electron/preload/index.ts`、`backend/pyproject.toml`、`backend/main.py`、
> `backend/app/router.py`、`server/pyproject.toml`、`server/main.py`、`src/context/ConnectionContext.tsx`
>
> Tessera 对照：`package.json`、`apps/desktop/`、`packages/ai/`、`packages/agent-runtime/`、
> `packages/contracts/`、`docs/architecture/unified-creation-agent.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Eigent 桌面版不是“Electron 里嵌一个 Agent SDK”，而是三套运行系统的组合：

```text
React renderer
  │ REST + SSE                         │ Electron IPC
  ▼                                    ▼
Local Brain（FastAPI + CAMEL）       Electron main
  │ HTTPS API                           │ 文件、进程、PTY、CDP、窗口
  ▼                                    │
Remote Server（FastAPI） <─────────────┘ 部分登录/配置/历史链路
  │
PostgreSQL + Redis + Celery
```

- Electron 主进程负责应用生命周期、Python Brain 启停、原生文件/终端、CDP 浏览器、窗口和更新。
- renderer 通过 REST/SSE 直接与本机 Brain 通信，MCP 和 Skills 新接口也已从 IPC 迁到 Brain REST。
- Local Brain 承载 CAMEL Agent/Workforce、工具、工作目录、记忆、MCP/Skill 装配与 SSE 事件。
- Remote Server 承载用户、配置、历史、Space/Project、MCP 市场、触发器、远程控制与协作所需的持久状态。

这套选择让 Python Agent 生态和 Electron 产品能力都能快速扩张，也导致部署、版本、鉴权、状态一致性和诊断边界
显著复杂。Tessera 当前基于 TypeScript + Electron + AI SDK 的单语言主运行时更适合现阶段，不应为了复刻 Eigent
而立即引入 Python/CAMEL；真正值得学习的是稳定对象、RunContext 和可见执行反馈。

## 1. 四层系统职责

### 1.1 React renderer

主要技术选择：

| 领域 | 选择 | 作用 |
| --- | --- | --- |
| UI | React 18、TypeScript、Vite 5 | 桌面和 Web 共用界面 |
| 状态 | Zustand 5 | Chat、Project、Space、Skills、页签和运行态 |
| 服务端缓存 | TanStack React Query 5 | Trigger 等远端查询 |
| 组件 | Radix UI、Tailwind CSS、CVA | 基础交互和主题 |
| 复杂视图 | React Flow、Monaco、xterm | 工作群图、文件预览/编辑、终端 |
| 流式 | `@microsoft/fetch-event-source` | POST SSE、断线重试和长任务事件 |
| 内容 | React Markdown、Marked、DOMPurify、Mammoth | Markdown 与 Office/文件预览 |
| 布局/动效 | resizable panels、Motion、GSAP | 三栏工作区、折叠面板和动效 |

`ConnectionProvider` 在桌面模式通过 `get-backend-port` IPC 获取 Local Brain 端口，随后把
`http://localhost:<port>` 写入 renderer 的 connection store；Web 模式使用 `VITE_BRAIN_ENDPOINT`。这说明 renderer
与 Brain 的主协议是 HTTP，而不是 Electron IPC。IPC 仍负责操作系统能力。

### 1.2 Electron main

`electron/main/init.ts::startBackend` 在 5001–5050 之间选择端口，使用打包的 Python/uv 环境启动：

```text
python -m uvicorn main:api --port <port> --loop asyncio
```

启动流程还会：

- 从应用环境文件解析远端 `SERVER_URL`；
- 注入代理、日志目录和打包资源路径；
- 轮询 Local Brain health，成功后向 renderer 广播 `backend-ready`；
- 在应用退出或重启时清理 Python 子进程；
- 打包 `node-pty`、Python backend、预构建 Python/Node 运行时和示例 Skills。

Electron 仍直接拥有大量功能性 IPC：文件读取、目录选择、命令/PTY、MCP 旧配置、Skill 配置路径、浏览器 profile、
Cookie、CDP pool、打开外部编辑器等。其 preload 还暴露通用 `ipcRenderer.invoke/on/send`，这削弱了
`contextIsolation` 的实际安全价值。

### 1.3 Local Brain

Local Brain 固定 Python 3.11，核心依赖 `camel-ai[eigent]==0.2.91a5`、FastAPI、Uvicorn、OpenAI SDK、Qdrant client
和 OpenTelemetry。它不是纯代理层，而是桌面 Agent 的业务运行时：

- 构建单 Agent 与 Workforce；
- 按请求装配文件、终端、浏览器、搜索、MCP、Skill、RAG、图片和子 Agent 工具；
- 建立 RunContext、TaskLock、工作目录和记忆；
- 以 SSE 发送任务拆解、Agent 状态、工具调用、结果、Token 和完成事件；
- 暴露 Workspace、MCP、Skills、文件和消息路由 REST API。

`backend/app/router.py::register_routers` 为 health 之外的路由统一挂上 Brain auth dependency，但默认 provider 仍是
`NoneAuth`。这是“预留鉴权插槽”，不是已经存在的安全边界。

### 1.4 Remote Server

Remote Server 固定 Python 3.12，使用 FastAPI、SQLModel、PostgreSQL、Redis 和 Celery。其领域目录说明它负责：

- 用户、登录、订阅和模型供应商配置；
- Chat history/step/snapshot/share；
- Space、Project、folder binding、overlay 和 apply；
- MCP 目录、用户安装和 proxy；
- Schedule、Webhook、Slack trigger 与执行记录；
- Remote control 和 remote sub-agent provider。

本地 Brain 与远端 Server 并非同一可执行服务，也没有共享完全相同的依赖版本：Server 的 Python/CAMEL 版本分别为
3.12 和 0.2.90a6，Local Brain 为 3.11 和 0.2.91a5。Server 还把 CAMEL 指向 `feat-trigger` Git rev。源码事实表明
两层存在运行时漂移风险，测试需要分别覆盖。

## 2. 桌面、本地部署与 Web 不是同一形态

### 桌面默认形态

```text
打包 Electron
  + 打包 Local Brain/Python runtime
  + Eigent 托管 Remote Server（默认 URL）
```

Local Brain 在用户设备执行工具和文件操作，远端 Server 保存账户、Space/Project 等云端控制状态。只启动桌面客户端
并不等于完全本地。

### 完整本地部署

Server 提供 Docker Compose，可自行部署 PostgreSQL/Redis/Celery/Server，再让 Electron/Brain 指向自建 URL。其运维
成本和桌面端打包 Python 的成本叠加。

### Web 形态

renderer 可通过 `vite.config.web.ts` 构建 Web 版，`ConnectionProvider` 从环境变量解析 Brain endpoint，并用 session ID
区分连接。Web 不能依赖 Electron IPC，因此文件、浏览器和本地进程能力必须由远端/沙箱 hands 提供；源码中的
`hands/`、router layer 和 channel 抽象正是在弥补这一差异。

## 3. Agent 请求的跨进程主链路

一次桌面任务大致经过：

```text
Chat input
  -> chatStore 收集 Project/Space、模型、Workers、MCP、Skills、附件、CDP browsers
  -> POST /chat，fetch-event-source 建立 SSE
  -> chat_controller 建立 RunContext + TaskLock + workdir
  -> chat_service 选择 single-agent 或 workforce
  -> toolkit assembler / factories 创建 CAMEL Agent 与工具
  -> CAMEL 执行模型和工具循环
  -> listener 归一化为 SSE step/action
  -> chatStore 以 taskId 锁定连接并更新 Zustand 状态
  -> Chat、Workflow、右侧审查栏、Preview tabs 分别消费投影状态
  -> Remote Server 保存历史、步骤、Space/Project/Artifact 等控制数据
```

这里有两个值得 Tessera 学习的点：

1. `RunContext` 使用 Python `ContextVar` 冻结 run/project/task、工作目录、输出根、模型、搜索、CDP 和鉴权等信息，
   避免并发运行依赖全局环境变量。
2. UI 不是只渲染聊天文本，而是把同一事件流投影为目标进度、Agent 状态、工具活动、执行上下文和输出文件。

也有两个明显成本：

1. renderer 的 `chatStore.ts` 超过五千行，同时承担请求组装、SSE 生命周期、重试、事件归一化、持久化协调和 UI 状态，
   是一个高耦合状态机。
2. 同一个业务对象可能同时存在于 Zustand、Local Brain TaskLock/内存、本地 JSON、远端数据库和文件系统，恢复与冲突
   处理需要大量补丁式逻辑。

## 4. 打包与升级代价

`electron-builder.json` 开启 ASAR，并单独 unpack `node-pty`；`extraResources` 复制整个 Python backend、预构建运行时和
示例 Skills。构建前还要安装依赖、编译 Babel、修复 venv 路径和符号链接。这个方案的现实收益是用户无需另装 Python，
但带来：

- 安装包体积和构建时间上升；
- macOS/Windows/Linux 的原生依赖、签名和路径修复分叉；
- Electron、Node、Python、CAMEL、浏览器驱动都要做兼容矩阵；
- Local Brain schema 与 renderer/server 版本必须同步升级；
- 崩溃定位跨越 JS、Python、子进程和远端服务。

Tessera 当前不需要为已有 AI SDK 能力支付这组成本。只有出现必须依赖 Python 专用生态、且无法通过窄 sidecar 或 MCP
解决的核心能力时，才应重新评估 sidecar；即使引入，也应让它是可替换的能力服务，而不是第二个产品事实源。

## 5. 安全边界审查

### 5.1 Electron 权限过宽

固定提交的主窗口配置在桌面分支中包含 `nodeIntegration: true`、`webSecurity: false`、`contextIsolation: true`；部分子窗口
甚至是 `nodeIntegration: true`、`contextIsolation: false`。虽然某些 Web 分支随后会收紧配置，但默认桌面主链路仍暴露
较大攻击面。

preload 除具名 API 外，还向页面暴露通用 IPC 方法。结合主进程中的任意路径读取、命令执行、任意 cwd 的 PTY 和浏览器
控制 handler，一旦 renderer 或加载内容被攻破，影响远大于普通 Web XSS。

### 5.2 Local Brain 只绑定本机不等于安全

Electron 启动 Uvicorn 时没有显式 `--host`，默认只监听 loopback，这是有价值的第一层限制。但 Local Brain 默认
`NoneAuth`，开发/未配置 CORS 可放宽来源；任何能从本机浏览器发起请求的页面都可能探测服务。稳定 auth hook 只是未来
扩展点，不能当作当前防护。

### 5.3 Agent 文件写入缺少统一交易边界

Eigent 后续实现了 overlay/apply 和 hash 冲突检测，但 folder Space 默认 `direct-write`，终端与部分工具可以直接在用户
目录产生副作用。安全模型取决于各工具自己遵守路径和确认规则，没有统一 MutationPlan/Diff/Approval/Apply 交易边界。

### 5.4 配置密钥分散

模型配置有远端加密字段，Electron 也实现了 subscription credential store；但 MCP env 仍可进入本地 JSON，Cookie 和
浏览器 profile 又由独立路径管理。敏感数据生命周期没有统一入口。

## 6. Tessera 现状对照

| 领域 | Eigent | Tessera 当前 | 判断 |
| --- | --- | --- | --- |
| 主 Agent 运行时 | Python CAMEL | TypeScript AI SDK `ToolLoopAgent` | 保持 Tessera 单主运行时 |
| 桌面边界 | renderer 同时用 HTTP 和宽 IPC | renderer 经 `packages/contracts` 窄 IPC | Tessera 边界更安全 |
| 运行上下文 | `ContextVar` RunContext | RunPolicy、task run、资源快照已有部分实现 | 补成统一不可变 RunContext |
| 流式 | POST SSE + Zustand 自建状态机 | AI SDK UIMessage + Electron transport/checkpoint | 继续复用 SDK 标准协议 |
| 工具生态 | CAMEL toolkit + MCP +自定义工具 | AI SDK tools + MCP/Skill/领域工具 | 概念可借鉴，不迁移框架 |
| 本地执行 | Python、PTY、CDP、文件直接执行 | 受限主进程领域服务，任意 Shell 未开放 | 保持克制，按能力逐项引入 |
| 云端控制 | FastAPI/Postgres/Redis/Celery | SQLite 本地优先 | 不为对标提前引入云后端 |
| 可见执行反馈 | Workflow + 右侧审查栏 + Preview tabs | reasoning/tool/source/artifact 已有，统一侧栏未完成 | UI 信息架构值得优先吸收 |

## 7. Tessera 应吸收的系统级设计

### 7.1 建立不可变 `TaskRunContext`

一次 run 开始时冻结：

```text
taskId / runId / userTurnId
model route + provider endpoint
workspace bindings + current document snapshot
attachment refs + artifact output root
active skills + active MCP tools + native tools
browser session ref
permission/approval policy
context budget + compaction policy
```

renderer 只提交用户选择和稳定 ID；主进程解析真实路径、密钥和有效能力。运行中 UI 改动只影响下一次 run。

### 7.2 用一个事件事实源生成多个 UI 投影

不要复制 Eigent 的巨型 store。建议以已持久化、带 sequence 的 run event 为事实源，建立纯投影：

```text
RunEvent log
  ├─ conversation projection
  ├─ progress projection
  ├─ execution-context projection
  ├─ artifact/file projection
  └─ diagnostics projection
```

UI 可以像 Eigent 一样丰富，但状态归一化和恢复应留在主进程/共享包，而不是塞进页面 store。

### 7.3 扩展使用统一能力注册表

Skill、MCP、内建工具、浏览器、附件读取都投影为运行时 capability，但安装配置保持各自领域模型。RunContext 记录的是
本次解析后的 `CapabilityRef[]`，右侧执行上下文展示“实际使用”，而非仅展示“已启用”。

### 7.4 Sidecar 设立进入门槛

未来若引入 Python，应满足：

1. 能力无法由 TypeScript、MCP 或独立外部工具可靠提供；
2. sidecar 只经版本化窄协议访问，不读取 Tessera SQLite；
3. 主进程仍是 run、权限、审批和审计事实源；
4. 有健康检查、兼容协商、取消、超时、崩溃恢复和发行矩阵；
5. 可以关闭或替换 sidecar 而不丢用户内容。

## 8. 明确不照搬

- 不把 CAMEL Workforce 直接引入 Tessera 主运行时。
- 不让 renderer 同时维护一套业务 HTTP 客户端和宽泛 Electron IPC。
- 不暴露原始 `ipcRenderer`、任意路径或任意命令执行。
- 不让 Local HTTP 服务以无鉴权、宽 CORS 方式承载高权限工具。
- 不把同一配置分别写入 Electron JSON、Python JSON 和远端数据库。
- 不让 Agent 默认在用户目录 `direct-write`。
- 不用 UI 动画或 Agent 自述替代可恢复的结构化事件。

## 9. 后续专题依赖

本篇只确定系统边界。后续文档将分别回答：

- Agent/Workforce 如何构造、调度并发出事件；
- RunContext 之外的会话历史、持久记忆和压缩如何协作；
- Workspace overlay/apply 是否覆盖所有写入路径；
- MCP/Skill/浏览器如何进入某个 Agent 的实际工具集合；
- 右侧 Progress、Execution Context、Agent Folder 如何从状态生成，而不是静态卡片。
