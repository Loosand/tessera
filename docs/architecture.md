# Tessera 系统架构

> 代码源头：`apps/desktop/src/main/index.ts`、`packages/agent-runtime/src/index.ts`
>
> 状态：部分实现。

## 产品边界

Tessera 管理用户文档、工作区权限、本地索引、活动历史和最终文件写入。Agent 运行时可以提出操作，
但不能绕过 Tessera 核心层。

```text
Electron 渲染层
      ↓ 类型化 IPC
Electron 主进程 / Tessera 核心
      ├── 工作区与文件
      ├── SQLite 与搜索
      ├── 订阅源与活动
      ├── 权限与审计
      └── 经审查的文件写入
              ↓ AgentRuntime
         原生实现 | 外部适配器 | 后续适配器
```

## 运行时规则

- **已实现**：渲染层不直接访问 Node.js 或文件系统。
- **已实现**：Electron 使用 `contextIsolation`、沙箱渲染层和窄预加载接口。
- **规划**：Markdown 文件作为内容事实源。
- **规划**：SQLite 保存可重建索引与运行状态。
- **规划**：Agent 写入在权限层和 Diff 层批准前只是一项提案。
- **已实现**：核心包兼容 Node.js/Bun；Bun 专用 API 必须位于显式适配器后方。
- **规划**：未来可通过 N-API、WASM 或独立进程引入 Rust，不改变领域契约。

## 包边界

初始基建有意保持较少的包数量。当前已有 `contracts`、`core`、`agent-runtime`、`skills` 和 `ui`。
当真实实现需要独立依赖或生命周期时，再提取 `filesystem`、`storage`、`library`、`reader`、
`editor`、`feeds`、`activity`、`permissions`、`diff` 与具体的 Agent 适配器。

不要只为目录整齐提前拆包；边界必须由安全性、运行时、依赖方向或独立测试需求驱动。
