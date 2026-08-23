# Eigent 深度源码研究

> 研究对象：本地 `.local/eigent`
>
> 固定提交：`d3089558c6e0021eed58270b49893835b02ec4e9`
>
> 提交时间：2026-08-15 01:34:57 +08:00
>
> Tessera 对照基线：当前工作区源码与 `docs/architecture/` 中标记的实现状态
>
> 研究状态：已完成

## 研究目标

这组文档不做功能截图集，也不把 Eigent 当作可以整体照搬的模板。目标是回答四个问题：

1. Eigent 的 AI Agent 能力实际由哪些进程、对象、状态和协议共同实现？
2. 每个领域的关键链路在哪里，UI 展示与真实运行状态是否一致？
3. 哪些设计已经经受了多轮任务、文件写入、浏览器和多智能体协作的复杂度，值得 Tessera 学习？
4. 哪些实现带有安全、双事实源、上下文膨胀、运行时漂移或产品心智成本，不应照搬？

最终产物是面向 Tessera 的源码级设计输入：每个专题独立成文，最后汇总为分阶段路线图。研究结论只有同步进
`docs/architecture/` 并结合 Tessera 代码验收后，才会成为 Tessera 的架构事实。

## 证据与标记约定

### Eigent 证据

- `Eigent: backend/app/...::symbol` 表示固定提交中的 Python Brain 源码。
- `Eigent: server/app/...::symbol` 表示远端业务服务源码。
- `Eigent: electron/...::symbol` 表示 Electron 主进程或 preload 源码。
- `Eigent: src/...::symbol` 表示 React renderer 源码。
- 配置、测试和迁移同样是证据；README 只用于补充意图，不覆盖源码行为。

本地 `.local/` 不进入 Tessera 版本库，因此文档记录仓库相对路径、符号和固定 commit，而不使用会在其他机器失效
的本地链接。需要复核时，在 `.local/eigent` 执行：

```bash
git checkout d3089558c6e0021eed58270b49893835b02ec4e9
rg "目标符号" backend server electron src
```

### 结论类型

- **源码事实**：可由固定提交中的代码、测试或配置直接确认。
- **研究推断**：由多个事实推导出的架构或产品意图，会明确写出推断依据。
- **Tessera 建议**：结合当前 Tessera 边界给出的选择，不代表已经实现。

### Tessera 状态

| 标记 | 含义 |
| --- | --- |
| 已实现 | 当前代码已具备主链路，并有相称的验证或文档证据 |
| 部分实现 | 有可运行骨架，但存在关键缺口、临时边界或未闭环状态 |
| 规划 | 架构文档已经定义，但当前主链路尚未完成 |
| 未开始 | 当前代码和架构文档都没有形成可依赖的实现承诺 |

## 专题地图

| 专题 | 重点问题 | 状态 |
| --- | --- | --- |
| [系统、技术栈与运行时边界](system-stack-and-runtime-boundaries.md) | Electron、React、Local Brain、远端 Server 如何分工，打包和安全代价是什么 | 已完成 |
| [Agent 运行时与工具装配](agent-runtime-and-tool-assembly.md) | 单智能体从请求到模型、工具循环、SSE 事件的完整链路 | 已完成 |
| [模型、供应商与能力路由](models-providers-and-capability-routing.md) | 模型配置如何进入 CAMEL，工具/搜索/多模态能力如何决定 | 已完成 |
| [工作群与多智能体调度](workforce-and-multi-agent-orchestration.md) | Workforce 的规划、角色、任务图、事件、恢复与人工干预 | 已完成 |
| [上下文、记忆与压缩](context-memory-and-compaction.md) | 短期历史、持久记忆、摘要、Token/字符预算和续轮策略 | 已完成 |
| [工作区、文件与 Artifact](workspace-files-and-artifacts.md) | Space/Project/Run、四种工作目录、overlay/apply、文件审查 | 已完成 |
| [MCP 与 Connectors](mcp-and-connectors.md) | 配置、发现、传输、工具装配、用户选择、密钥与审批 | 已完成 |
| [Skills 系统](skills-system.md) | 扫描、导入、配置、渐进加载、Agent 绑定和项目同步 | 已完成 |
| [浏览器、CDP 与 Cookie](browser-cdp-and-cookie-management.md) | 托管浏览器池、外部浏览器、会话隔离、Cookie 导入和预览 | 已完成 |
| [附件、执行上下文与 RAG](attachments-execution-context-and-rag.md) | 上传材料如何落盘、进入提示词、侧栏可见和后续追溯 | 已完成 |
| [调度、Trigger 与远程控制](scheduling-triggers-and-remote-control.md) | Schedule/Webhook/Slack 如何触发 Agent，后台任务如何恢复 | 已完成 |
| [UI、进度审查与信息架构](ui-progress-inspection-and-information-architecture.md) | 三栏布局、Progress、Execution Context、Agent Folder、Review/Terminal/Browser | 已完成 |
| [Tessera 吸收路线图](tessera-adoption-roadmap.md) | 跨领域对象、依赖顺序、风险门槛和近期可交付切片 | 已完成 |

## 当前总判断

Eigent 最值得学习的不是 CAMEL 这个依赖本身，而是它已经把 Agent 产品拆成了一组可见的长期对象：Space、
Project、Run/Task、Agent/Worker、Execution Context、Artifact、Progress、Trigger。用户在截图里看到的右侧审查栏，
不是纯装饰；它在产品上把“计划进度、实际使用的技能/MCP/引用文件、Agent 生成文件”分成三个可核验区域。这个
信息架构值得 Tessera 吸收。

但 Eigent 的工程实现存在明显分层债务：Electron renderer、主进程、Local Brain、远端 Server 都保存部分状态；
桌面端默认把用户目录直接作为 Agent 工作目录；MCP 配置在 Electron 与 Brain 有重复读写实现；Electron 暴露的
Node/IPC 边界过宽；本地 Brain 默认没有真实鉴权。这些问题说明 Tessera 应学习其产品对象和反馈闭环，同时坚持
窄 IPC、受控领域工具、差异预览、单一控制事实源和运行期冻结策略。

## 第一轮可复用原则

1. **RunContext 必须冻结**：一次运行使用的工作区、模型、工具、Skills、MCP、浏览器和权限不能被界面中途修改。
2. **执行上下文必须可见**：在任务侧栏展示实际使用过的能力和资源，而不是只展示发送前选择。
3. **进度与日志分层**：Progress 面向用户目标，工具活动面向过程，底层日志面向诊断，三者不能混成一个时间线。
4. **文件变更先暂存后应用**：吸收 Eigent 的 base hash、冲突检测和原子替换，但不采用默认 `direct-write`。
5. **单 Agent 是默认心智**：多智能体作为复杂任务的执行策略和可展开视图，不强迫用户先选组织结构。
6. **扩展能力按运行过滤**：MCP/Skill 的安装、启用、Agent 绑定和本次实际使用是不同状态。
7. **浏览器是独立资源**：CDP 实例、Cookie profile、可见预览和 Agent 工具权限需要独立生命周期与审计。

## 研究完成门槛

- 每个专题都有端到端数据流，而不只是文件列表。
- 每个重要结论至少有一个实现源和一个调用方或测试作为交叉证据。
- 明确区分桌面本地模式、Web 模式和远端服务能力。
- 对照 Tessera 当前代码与架构文档，避免把规划写成已实现。
- 最终路线图为每项建议给出依赖、风险、验收和不采纳项。
