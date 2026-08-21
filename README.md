# Tessera

> 免费、开源、本地优先的 AI 研究与写作 Agent。

Tessera 把资料收集、理解、研究和写作放进同一个连续工作流：Agent 帮你阅读材料、追踪线索、整理观点并提出修改，
你在真正可编辑的 Markdown 文档中完成判断与创作。

它面向「从资料收集、深入理解到成稿创作」的连续 Agent 场景，并选择了不同的基础：核心应用免费开源，
工作区和正文默认保存在本地，用户自选模型与供应商，Agent 对文件的修改必须经过可见的 Diff 和人工批准。

## 为什么是 Tessera

- **本地数据属于你**：Markdown 是正文事实源，文件保存在用户选择的目录中，不锁进 Tessera 的专有格式。
- **Agent 不能越过你落笔**：读取、搜索和修改使用明确的能力边界；写入先展示候选内容与源码 Diff，再由用户批准。
- **不绑定一家模型**：支持多个远程模型供应商和兼容协议，用户持有自己的 API Key；本地模型与离线流程在后续规划中。
- **没有 AI 也能完整写作**：TipTap 即时预览、CodeMirror 源码模式、自动保存、冲突保护和 Markdown 主题均可独立使用。
- **核心应用免费开源**：Tessera 不以订阅解锁本地编辑和 Agent 基础能力；第三方模型 API 可能由对应供应商单独收费。
- **输出可以随时离开**：最终成果始终是普通 Markdown，可以继续使用 Git、任意编辑器或其他自动化工具处理。

## 目标工作流

```text
本地文档 / 网页 / PDF / 订阅源
              ↓
       Research Agent
   搜索 · 阅读 · 比较 · 核查
              ↓
      引用、提纲与 Markdown 草稿
              ↓
       人工编辑与 Diff 审批
              ↓
       用户工作区中的本地文件
```

Tessera 当前聚焦研究与文档写作，不计划复制图片、Slides、视频和网页生成工作室。它更关心一条可信的主线：
材料从哪里来、Agent 做了什么、哪些内容发给了模型，以及最终由谁批准写入。

## 数据与安全边界

| 数据或操作 | 当前边界 |
| --- | --- |
| Markdown 正文 | 保存在用户选择的本地工作区，是内容事实源。 |
| 工作区、任务与审计状态 | 保存在本地 SQLite；可重建索引不能替代原始 Markdown。 |
| API Key | 由 Electron `safeStorage` 加密；不以明文写入数据库，也不回传给渲染层。 |
| 普通 Chat | 只发送用户显式输入、上传内容和当前对话历史，不自动读取工作区。 |
| 工作区 Agent | 只有在用户主动运行后，才通过受限工具读取所需 Markdown，并把模型完成任务所需的内容发送给所选供应商。 |
| Agent 写入 | 先冻结候选内容和基准版本，显示 Markdown 渲染结果与源码 Diff，批准后才原子写入并记录审计。 |

本地优先不等于所有推理都在本机完成。使用远程模型时，相关请求仍会发送到用户配置的供应商，并受该供应商的
隐私政策约束；Tessera 会持续把出站范围、权限和审计做成可检查的产品能力。

## 当前进展

- **已实现**：Electron 安全外壳、本地 Markdown 工作区、TipTap 即时预览、按需加载的 CodeMirror 6 源码编辑、
  Typeset 主题定制、自动保存、外部修改冲突处理、SQLite 数据层和模型供应商安全配置。
- **部分实现**：普通 Chat 与工作区 Agent 已接入统一运行时，支持本地 Markdown 读取/搜索、只读研究子 Agent、
  可点击引用、运行恢复和 Markdown Diff 审批写入；Skill 选择与加载仍在演进。
- **下一阶段**：网页/PDF 等材料采集、引用核查、编辑器内文本补丁、CodeMirror 真实 renderer 基准、MCP、Shell、
  durable Agent 续跑、本地版本历史和已有 Git 工作区支持。
- **尚未承诺**：公开发布时间、正式开源许可证和商业分发边界。

状态标签只描述仓库当前能力，不代表发布时间承诺。更细的能力边界见[产品说明](docs/product.md)和
[系统架构](docs/architecture.md)。

## 技术栈

- Electron、React、TypeScript
- Bun workspace 与 Turborepo
- Tailwind CSS、Base UI、shadcn/ui 源码组织方式
- TipTap、CodeMirror 6 与 Markdown
- AI SDK 与可替换的 `AgentRuntime`
- Drizzle ORM、SQLite、Electron `safeStorage`

打包后的 Electron 主进程运行在 Electron 内置的 Node.js 中。Bun 负责依赖管理、脚本、测试和按需启动的独立进程，
不作为 Electron 主进程运行时。

## 本地开发

```bash
bun install
bun run dev
bun run check
```

`bun run check` 依次执行格式检查、lint、类型检查、测试和构建。需要单独运行某一阶段时，可使用
`bun run format`、`bun run lint`、`bun run typecheck`、`bun run test` 或 `bun run build`。

当前 TipTap renderer 性能可使用 `bun run benchmark:editor`，Markdown 解析块数曲线与 CPU 热点可分别使用
`bun run benchmark:editor:parser`、`bun run benchmark:editor:parser:cpu`。CodeMirror 源码模式的真实 renderer 基准
仍在下一轮编辑器工作中。

在 Apple Silicon macOS 上生成用于内部验证的 ad-hoc 签名 DMG 和 ZIP：

```bash
bun run dist:mac
```

产物写入 `apps/desktop/dist/`。ad-hoc 签名构建仅用于本地或内部验证；公开分发需要 Developer ID 签名与 Apple 公证。
发行脚本会拒绝未打包的工作区 TypeScript 运行时依赖，并只携带 Electron、编译产物和 SQLite 原生模块；macOS 发行包只保留中英语言资源，DMG 使用 ULMO 压缩。

如果当前网络无法下载 Electron 预构建文件，可以在安装时临时指定镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ bun install
```

## 仓库结构

```text
apps/desktop            Electron 主进程、预加载脚本和 React 渲染层
packages/contracts      IPC 与跨进程共享契约
packages/core           平台无关的应用核心
packages/agent-runtime  可替换 Agent 运行时契约
packages/database       SQLite 本地索引与运行状态
packages/skills         SKILL.md 发现、加载与权限契约
packages/design-system  共享组件与视觉系统
```

## 文档

- [产品边界](docs/product.md)
- [设计规范](design.md)
- [系统架构](docs/architecture.md)
- [编辑器与 Markdown](docs/architecture/editor.md)
- [AI 对话与工作区 Agent TODO](docs/architecture/ai-chat-agent-todo.md)
- [AI 供应商与模型发现](docs/architecture/ai-providers.md)
- [本地数据库](docs/architecture/database.md)
- [本地版本历史与 Git 工作区支持](docs/architecture/local-version-history-and-git-workspaces.md)
- [协作约定](AGENTS.md)

## 开源与费用

Tessera 的核心桌面应用计划以免费开源方式发布。正式许可证会在公开发布前确定；模型供应商、联网搜索或其他第三方
服务产生的费用由用户与对应服务商直接结算，不是 Tessera 的功能订阅费。
