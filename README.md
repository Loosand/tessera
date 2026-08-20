# Tessera

Tessera 是一个本地优先、可编程的阅读工作台，用于处理 Markdown、订阅源和 AI 辅助研究。

## 技术栈

- Electron 桌面外壳
- Bun workspace 与任务执行
- React + TypeScript 渲染层
- 兼容 Node.js/Bun 的 TypeScript 核心包
- 通过稳定的 `AgentRuntime` 边界接入可替换的 Agent 运行时

打包后的 Electron 主进程运行在 Electron 内置的 Node.js 中。Bun 负责依赖管理、脚本、测试，
以及按需启动独立进程，不作为 Electron 主进程的运行时。

## 常用命令

```bash
bun install
bun run dev
bun run format
bun run lint
bun run typecheck
bun run test
bun run build
bun run check
```

`bun run check` 依次执行 Biome、类型检查、测试和构建，是提交前的完整检查入口。

## 工作区

```text
apps/desktop            Electron 主进程、预加载脚本和 React 渲染层
packages/contracts      IPC 与领域共享契约
packages/core           应用级核心服务
packages/agent-runtime  可替换的 Agent 运行时接口
packages/skills         SKILL.md 发现与加载契约
packages/ui             共享 React 组件与设计系统
```

项目许可证将在开源与商业策略明确后确定。

## 项目文档

- [设计规范](design.md)
- [系统架构](docs/architecture.md)
- [分形文档规范](docs/architecture/fractal-documentation-guide.md)
- [协作约定](AGENTS.md)
