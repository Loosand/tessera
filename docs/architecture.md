# Tessera 系统架构

> 代码源头：`apps/desktop/src/main/index.ts`、`apps/desktop/src/preload/index.ts`、
> `packages/agent-runtime/src/index.ts`、`packages/ai/src/index.ts`、`packages/ai/src/server/index.ts`、`packages/skills/src/index.ts`、
> `packages/database/client.ts`、`apps/desktop/src/main/user-skill-service.ts`
>
> 状态：部分实现。

## 目标与边界

Tessera 管理本地工作区、文档、索引、Agent 权限和最终文件写入。外部 Agent、模型和 Skill 可以提出操作，
但不能绕过主进程的工作区与权限边界。

```text
网页 / 订阅源 / 外部模型             本地文件
          |                            |
          | 明确的网络与权限边界        | 工作区路径边界
          v                            v
     采集与研究适配器              Markdown / 附件
                \                    /
                 Tessera 核心层
        工作区 | 索引 | 权限 | Diff | 审计
                    |
          类型化 IPC / AgentRuntime
                    |
       阅读器 | 编辑器 | Agent 协作界面
```

Markdown 是正文事实源。SQLite 保存工作区登记、可重建索引和运行状态。编辑器、Agent 对话和数据库都不能持有
无法从工作区恢复的正文唯一副本。

目标产品只保留一个自然对话入口：每轮通过统一 Agent runtime 按需直接回答、联网、加载 Skill、创建文档或
整理项目，Chat/Agent 不再是任务级产品模式。内容存储仍处于探索阶段；当前暂以“托管内容库中的 Markdown +
SQLite 控制层”作为可逆实验基线，同时保留数据库正文和完全开放外部工作区两种候选。完整边界见
[统一创作 Agent 与内容存储探索](architecture/unified-creation-agent.md)。

## 运行时边界

### 渲染层

- **已实现**：渲染层运行在沙箱中，不直接访问 Node.js、文件系统或数据库。
- **已实现**：平台操作只通过 `packages/contracts` 定义的预加载接口调用。
- **已实现**：渲染层 CSP 保持脚本与主动连接同源，只额外允许以无 Referer 的 HTTPS 图片请求加载联网搜索来源 favicon。
- **已实现**：TipTap 与按需加载的 CodeMirror 6 源码表面共享同一份 Markdown 草稿、flush 和保存协议。
- **部分实现**：主导航「新任务」与文档 AI 侧栏复用同一 TaskPage、流式协议和消息历史；界面只提供自动/研究/写作/问答创作方式，并支持显式当前文档草稿/图片附件、来源、工具状态、消息内持久化失败与重试、内容 Operation 聚合、文件引用跳转、任务/运行事件恢复和 Markdown 渲染 Diff 审批。所有任务已使用共用动态配置的 AI SDK Agent，旧 Chat/Agent 字段只暂存内部资源作用域；自动意图识别和动态资源关联仍待实现。
- **部分实现**：Agent 的只读范围、工具访问路径和失败状态使用独立可见语义；建议、权限请求和 Diff 仍需可审查界面。

### 主进程与核心层

- **已实现**：主进程解析并校验工作区路径，读取/新建/重命名/原子写入 Markdown，并支持真实目录索引、目录新建/重命名、复制路径、Finder 定位和经系统确认后移入废纸篓。
- **已实现**：窗口级会话管理文件监听、外部修改冲突、最近工作区和关闭前保存握手。
- **已实现**：SQLite 随主进程生命周期打开和关闭，渲染层不持有连接。
- **已实现**：AI 模型目录请求经类型化 IPC 进入主进程，具备 URL 校验、总超时、响应体上限和错误脱敏。
- **部分实现**：MCP 配置经类型化 IPC 进入主进程；stdio、Streamable HTTP 与 SSE 连接、工具发现/逐项停用、safeStorage 秘密隔离和连接池已实现，Resources、Prompts、OAuth 与运行日志待实现。
- **已实现**：用户可以经系统目录选择器导入单个标准 `SKILL.md` 目录，或受限递归扫描上级目录、预览有效/重复/已安装项后批量导入；扫描绝对路径只存在于短时主进程会话。主进程限制文件类型/体积并原子复制到应用托管目录，SQLite 保存启用状态，删除使用系统废纸篓。用户 Skill 只注入 instructions，不执行附带脚本或扩大权限。
- **规划**：采集、全文索引、权限、Diff 与审计通过核心服务暴露窄接口。
- **部分实现（探索）**：当前混合基线由主进程领域服务协调内容库根目录、Inbox、项目创建、文档移动、结构检查与 SQLite；真实文件数据库重启验收已覆盖 Task、Artifact、Workspace、Markdown 和 Operation 审计恢复。模型只获得稳定 ID 和受限相对路径；领域工具继续保持后端无关，以便与数据库或完全外部工作区候选比较。
- **规划**：所有出站请求记录目标、目的和数据范围。

### Agent 与 Skills

- **已实现**：`AgentRuntime` 泛型端口已承载 AI SDK `ToolLoopAgent` 的类型化 `UIMessageChunk` 异步流、取消信号和审批事件；产品运行链路不再绕过独立端口。
- **部分实现**：统一运行时遵守 AI SDK 标准优先：已使用 `ToolLoopAgent`、类型化 call options / `prepareCall`、`activeTools`、`stopWhen`、工具 `needsApproval` 与 `useChat`；`prepareStep`、`InferAgentUIMessage` 和完整生命周期观测仍待接入。Tessera 只维护 Electron transport、持久化恢复、领域资源和权限适配，`AgentRuntime` 保持薄端口。
- **部分实现**：`@tessera/ai` 独立封装 OpenAI 兼容、Anthropic 兼容、DeepSeek、Grok 与 OpenRouter。已实现普通对话、供应商已验证的原生联网、受限工作区读写工具循环、AI SDK 标准工具审批、只读研究子 Agent，以及主进程注入的 MCP 动态工具；Shell 与 durable 自动续跑尚未接入。
- **部分实现**：所有任务已收敛到 `ToolLoopAgent`，`toolChoice = auto` 允许零工具直接回答；主进程 RunPolicy 已按显式创作方式、内部作用域和已验证模型能力决定 Skill、联网、推理、工具作用域与预算，用户 turn 自动意图、规范化资源关系和更细权限输入仍待实现。
- **部分实现**：研究方式的 P0 可信闭环已实现：运行时强制先发布结构化计划，供应商搜索只登记候选来源，主进程受限 Reader 深读公开网页，来源/证据/覆盖状态绑定 run 持久化，完成检查决定完整或部分结果，消息按真实 Tool Part 显示进度；来源推荐/保存、研究工作文档与隔离浏览器后备仍待实现，详见[研究工作流与证据链](architecture/research-workflow.md)。
- **已实现**：Agent 工作区根目录只存在于主进程闭包；Markdown 列表、读取、搜索、当前文档和经批准写入统一执行真实路径、符号链接、文件类型、版本冲突与资源上限校验。Agent 只能获得请求期路由验证通过的供应商原生搜索，以及用户显式信任、启用并逐次批准的 MCP 工具；删除、重命名和 Shell 保持不可达。
- **部分实现**：`packages/skills` 已实现标准 `SKILL.md` 校验、内置/用户级/工作区级描述、权限声明和内置渐进式加载注册表；研究、写作及已启用用户 Skill 的正文按本轮选择经 call options 注入并固化到 `task_run`。用户目录手动扫描已实现，用户 turn 自动选择、工作区级自动发现、更新与版本仍待实现。
- **已实现**：Skill 只描述工作流和所需资源，不提升任务权限；具体工具由运行策略、显式资源、模型能力、主进程边界与人工审批共同决定。
- **规划**：Agent 对文件的修改以文本补丁提出，批准后由核心层写入。

## 已实现的数据流

```text
用户输入
  -> TipTap transaction
  -> 延迟生成 Markdown 草稿
  -> 工作区串行保存队列
  -> 类型化 IPC
  -> 主进程校验磁盘版本与工作区路径
  -> 同目录原子替换
```

文件监听发现外部修改时，无本地草稿则刷新文档；存在本地草稿时暂停自动保存并提示冲突。窗口关闭和应用退出前，
主进程请求渲染层提交待处理编辑并保存，失败或冲突会取消关闭。

## 规划的数据流

```text
研究问题
  -> AgentRuntime
  -> 结构化研究计划
  -> 搜索并发现候选来源
  -> 选择来源并读取网页 / 本地材料
  -> 证据、冲突、覆盖与不确定性记录
  -> 跨材料分析、引用与来源推荐
  -> 用户确认后保存材料或研究笔记
  -> 对当前 Markdown 提出补丁
  -> 用户审查 Diff
  -> 核心层写入并记录审计事件
```

采集结果、引用和 Agent 事件需要使用稳定标识关联，但正文仍以可读文件保存。索引或会话损坏不能导致用户文章丢失。

## 包边界

| 包 | 职责 |
| --- | --- |
| `contracts` | IPC 与跨进程共享类型 |
| `core` | 平台无关的应用服务与领域编排 |
| `ai` | 模型供应商目录、AI SDK 适配边界与可复用 React 界面 |
| `agent-runtime` | 可替换 Agent 运行时端口 |
| `skills` | `SKILL.md` 描述、作用域、权限契约、内置注册表和用户描述符构造 |
| `database` | SQLite 连接、迁移、索引与运行状态 |
| `design-system` | 语义 token、交互原语和共享组件 |

只有独立的安全边界、运行时、依赖或测试生命周期出现后，才新增包。应用依赖包，包不反向依赖 `apps/`。

## 相关文档

- [产品边界](product.md)
- [轻量 Agent Kernel 与能力运行时](architecture/agent-kernel-and-capability-runtime.md)
- [统一创作 Agent 与内容存储探索](architecture/unified-creation-agent.md)
- [任务会话与导航](architecture/task-navigation.md)
- [编辑器与 Markdown](architecture/editor.md)
- [本地数据库](architecture/database.md)
- [本地版本历史与 Git 工作区支持](architecture/local-version-history-and-git-workspaces.md)
- [插件系统](architecture/plugin-system.md)
- [AI 供应商与模型发现](architecture/ai-providers.md)
- [研究工作流与证据链](architecture/research-workflow.md)
- [AI 对话与工作区 Agent 实施 TODO](architecture/ai-chat-agent-todo.md)
- [Skill 系统](architecture/skill-system.md)
- [设计规范](../design.md)
