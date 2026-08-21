# Tessera

Tessera 的目标是成为一个本地优先、开源的研究与写作工作台。用户可以直接阅读和编辑本地 Markdown；接入
Agent 后，可以继续完成资料采集、跨材料理解、事实核查和写作辅助。AI 生成内容与人工内容使用同一份
文档，不引入只能在应用内访问的专有正文格式。

## 产品模型

```text
Input：导入材料与主动研究
  -> Process：阅读、批注、比较、核查与形成观点
  -> Output：人工撰写或 AI 辅助完成的 Markdown 文档

Skills：为三个阶段提供可安装、可修改的工作流
Trust：约束数据出站、Agent 权限、差异审查和最终写入
```

Tessera 当前聚焦文档写作，不计划为 Slides、视频或交互网页建设专用创作器。完整产品边界见
[产品说明](docs/product.md)。

## 当前状态

- **已实现**：Electron 安全外壳、本地工作区、Markdown 即时预览与源码编辑、自动保存、外部修改冲突处理、
SQLite 基础数据层和设计系统。
- **部分实现**：`AgentRuntime`、Skill 与权限已经有领域契约，尚未形成可用的研究和写作流程。
- **规划**：网页与文档采集、主动研究、跨材料问答、引用核查、Agent Diff 和 Skill 安装执行。
- **待确定**：开源许可证与商业分发边界。

状态标签只描述仓库当前能力，不代表发布时间承诺。

## 技术栈

- Electron、React、TypeScript
- Bun workspace 与任务执行
- Tailwind CSS、Base UI、shadcn/ui 源码组织方式
- TipTap 与 Markdown
- Drizzle ORM、SQLite
- 可替换的 `AgentRuntime`

打包后的 Electron 主进程运行在 Electron 内置的 Node.js 中。Bun 负责依赖管理、脚本、测试和按需启动的
独立进程，不作为 Electron 主进程运行时。

## 开发

```bash
bun install
bun run dev
bun run check
```

`bun run check` 依次执行格式检查、lint、类型检查、测试和构建。需要单独运行某一阶段时，可使用
`bun run format`、`bun run lint`、`bun run typecheck`、`bun run test` 或 `bun run build`。

如果当前网络无法下载 Electron 预构建文件，可以在安装时临时指定镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ bun install
```

## 工作区

```text
apps/desktop            Electron 主进程、预加载脚本和 React 渲染层
packages/contracts      IPC 与跨进程共享契约
packages/core           平台无关的应用核心
packages/agent-runtime  可替换 Agent 运行时契约
packages/database       SQLite 本地索引与运行状态
packages/skills         SKILL.md 发现与权限契约
packages/design-system  共享组件与视觉系统
```

## 文档

- [产品边界](docs/product.md)
- [设计规范](design.md)
- [系统架构](docs/architecture.md)
- [编辑器与 Markdown](docs/architecture/editor.md)
- [本地数据库](docs/architecture/database.md)
- [本地版本历史与 Git 工作区支持](docs/architecture/local-version-history-and-git-workspaces.md)
- [协作约定](AGENTS.md)

项目许可证将在开源与商业策略明确后确定。
