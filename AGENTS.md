# Tessera 协作约定

本文件约束整个仓库。进入子目录后，还要读取并遵守距离目标文件最近的 `.folder.md`。

## 语言

- 项目文档、代码注释、提交给维护者的说明优先使用中文。
- 标识符、标准协议名、库名和无法准确翻译的术语保留英文。
- 注释说明约束、原因和边界，不复述代码表面行为。

## 命名

- 手写文件和目录统一使用小写 kebab-case，例如 `setting-section.tsx`、`agent-runtime/`。
- React 组件、类型和类在代码中继续使用 PascalCase。
- 标准文件名与工具约定不改写，例如 `README.md`、`AGENTS.md`、`SKILL.md`、`package.json`。
- 生成文件遵循生成器的命名，禁止为了形式统一手工修改。

## 源文件契约

新增或修改手写源文件时，在文件开头维护以下 Header。配置文件、纯样式文件、声明文件和生成文件可免除。

```ts
/**
 * [INPUT]: 本文件依赖的外部输入与契约
 * [OUTPUT]: 本文件向外提供的能力
 * [POS]: 本文件在所属模块中的位置
 * [DOC]: 与行为同步的设计或架构文档
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */
```

## 目录文档

每个承担独立职责的目录使用 `.folder.md` 描述局部地图，并保留以下章节：

1. `地位`：目录在系统中的角色。
2. `逻辑`：数据流、依赖方向或核心流程。
3. `约束`：该目录必须遵守的边界。
4. `成员清单`：直接成员及其职责，不递归复制下层细节。
5. `触发器`：什么变化必须同步这份文档。

涉及跨目录机制时，在 `docs/architecture/` 编写深文档，并用「已实现」「部分实现」「规划」标记能力状态。

## UI 体系

- 以 [design.md](design.md) 为设计与交互事实源。
- 组件分层为 `tokens → primitives → base → patterns → features`。
- `packages/ui/src/primitives/` 使用 Base UI 行为原语，并采用 shadcn/ui 的源码持有与组合方式。
- 业务应用不得直接导入 Base UI；基础交互必须经过 `@tessera/ui` 暴露。
- 样式使用 Tailwind CSS 与语义 token；避免在业务组件内重复硬编码颜色、圆角和阴影。
- 富文本选用 TipTap，复杂动效选用 Motion；只在对应功能开始实现时引入依赖。

## 工程约束

- Biome 是唯一的格式化与 lint 工具，不新增 ESLint 或 Prettier。
- Electron 渲染层不得直接访问 Node.js、文件系统或数据库。
- IPC 必须经过 `packages/contracts` 定义的窄接口。
- Markdown 文件是内容事实源；SQLite 保存可重建索引和运行状态。
- Agent 写入必须经过权限、差异预览和审计边界。
- 第三方依赖必须遵守许可证，不复制许可证不兼容的源码。

## 完成检查

```bash
bun run format
bun run lint
bun run typecheck
bun run test
bun run build
```

改动结束前还要检查 Header、最近的 `.folder.md`、文档链接和能力状态是否同步。
