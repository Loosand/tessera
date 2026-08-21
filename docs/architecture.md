# Tessera 系统架构

> 代码源头：`apps/desktop/src/main/index.ts`、`packages/agent-runtime/src/index.ts`、
> `packages/database/client.ts`
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
- **已实现**：Markdown 文件作为内容事实源，主进程通过工作区边界读取并原子写入。
- **已实现**：文档重命名由主进程校验文件名和工作区边界，并拒绝覆盖同名文件。
- **已实现**：Drizzle + SQLite 已接入主进程生命周期，用于恢复最近工作区等本地状态。
- **已实现**：最近工作区列表、切换和 Finder 定位通过窄 IPC 暴露，渲染层不接触数据库或任意系统路径。
- **已实现**：主窗口允许缩至 `520 × 420`，渲染层在窄宽度下自动收起工作区侧栏并将按需面板改为覆盖显示。
- **已实现**：窗口级工作区会话负责文件监听，渲染层在外部修改与本地草稿冲突时停止自动保存。
- **已实现**：TipTap 负责即时预览编辑和延迟 Markdown 转换，草稿 flush 与串行保存由工作区层统一处理。
- **已实现**：窗口关闭和应用退出先通过窄 IPC 请求渲染层 flush、保存当前草稿，保存成功后主进程才继续关闭；失败或冲突会取消本次关闭。
- **规划**：Agent 写入在权限层和 Diff 层批准前只是一项提案。
- **已实现**：核心包兼容 Node.js/Bun；Bun 专用 API 必须位于显式适配器后方。
- **规划**：未来可通过 N-API、WASM 或独立进程引入 Rust，不改变领域契约。

## 包边界

初始基建有意保持较少的包数量。当前已有 `contracts`、`core`、`agent-runtime`、`database`、
`skills` 和 `design-system`。当真实实现需要独立依赖或生命周期时，再提取 `filesystem`、`library`、`reader`、
`editor`、`feeds`、`activity`、`permissions`、`diff` 与具体的 Agent 适配器。

不要只为目录整齐提前拆包；边界必须由安全性、运行时、依赖方向或独立测试需求驱动。
