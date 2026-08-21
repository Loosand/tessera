# Tessera 系统架构

> 代码源头：`apps/desktop/src/main/index.ts`、`apps/desktop/src/preload/index.ts`、
> `packages/agent-runtime/src/index.ts`、`packages/ai/src/index.ts`、`packages/ai/src/server/index.ts`、`packages/skills/src/index.ts`、
> `packages/database/client.ts`
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

## 运行时边界

### 渲染层

- **已实现**：渲染层运行在沙箱中，不直接访问 Node.js、文件系统或数据库。
- **已实现**：平台操作只通过 `packages/contracts` 定义的预加载接口调用。
- **已实现**：TipTap 与源码表面共享同一份 Markdown 草稿和保存协议。
- **部分实现**：主导航「新任务」已接入普通 Chat 与工作区 Agent，支持模式锁定、模型、思考、Chat 联网/图片、Markdown、来源、工具状态、停止、重试、完整工具历史、文件引用跳转、任务/运行事件恢复，以及 Markdown 渲染 Diff 审批。
- **部分实现**：Agent 的只读范围、工具访问路径和失败状态使用独立可见语义；建议、权限请求和 Diff 仍需可审查界面。

### 主进程与核心层

- **已实现**：主进程解析并校验工作区路径，读取/新建/重命名/原子写入 Markdown，并支持真实目录索引、目录新建/重命名、复制路径、Finder 定位和经系统确认后移入废纸篓。
- **已实现**：窗口级会话管理文件监听、外部修改冲突、最近工作区和关闭前保存握手。
- **已实现**：SQLite 随主进程生命周期打开和关闭，渲染层不持有连接。
- **已实现**：AI 模型目录请求经类型化 IPC 进入主进程，具备 URL 校验、总超时、响应体上限和错误脱敏。
- **规划**：采集、全文索引、权限、Diff 与审计通过核心服务暴露窄接口。
- **规划**：所有出站请求记录目标、目的和数据范围。

### Agent 与 Skills

- **已实现**：`AgentRuntime` 泛型端口已承载 AI SDK `ToolLoopAgent` 的类型化 `UIMessageChunk` 异步流、取消信号和审批事件；产品运行链路不再绕过独立端口。
- **部分实现**：`@tessera/ai` 独立封装 OpenAI 兼容、Anthropic 兼容、DeepSeek、Grok 与 OpenRouter。已实现普通对话、受限工作区读写工具循环、AI SDK 标准工具审批和只读研究子 Agent；MCP、Shell 与 durable 自动续跑尚未接入。
- **已实现**：Agent 工作区根目录只存在于主进程闭包；Markdown 列表、读取、搜索、当前文档和经批准写入统一执行真实路径、符号链接、文件类型、版本冲突与资源上限校验。删除、重命名、Shell 和任意 MCP/网络工具保持不可达。
- **部分实现**：`packages/skills` 已定义用户级、工作区级 Skill 描述和权限声明，尚未实现发现与执行。
- **规划**：Skill 只描述工作流和所需资源；具体权限在每次执行时由 Tessera 判断。
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
  -> 搜索 / 抓取 / 本地材料读取权限
  -> 来源与原文保存到工作区
  -> 跨材料分析与引用
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
| `skills` | `SKILL.md` 描述、作用域和权限契约 |
| `database` | SQLite 连接、迁移、索引与运行状态 |
| `design-system` | 语义 token、交互原语和共享组件 |

只有独立的安全边界、运行时、依赖或测试生命周期出现后，才新增包。应用依赖包，包不反向依赖 `apps/`。

## 相关文档

- [产品边界](product.md)
- [编辑器与 Markdown](architecture/editor.md)
- [本地数据库](architecture/database.md)
- [本地版本历史与 Git 工作区支持](architecture/local-version-history-and-git-workspaces.md)
- [插件系统](architecture/plugin-system.md)
- [AI 供应商与模型发现](architecture/ai-providers.md)
- [AI 对话与工作区 Agent 实施 TODO](architecture/ai-chat-agent-todo.md)
- [设计规范](../design.md)
