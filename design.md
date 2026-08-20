# Tessera 设计规范

> 状态：部分实现。本文是 Tessera 视觉、交互与组件体系的事实源。

## 设计目标

Tessera 的界面首先服务阅读、整理和可审查的 AI 协作。内容应比容器更显眼，层级应比装饰更清楚，
操作结果应可理解、可撤销、可追踪。

## 核心原则

1. **任务优先**：先明确用户正在读什么、改什么、确认什么，再决定界面形态。
2. **排版建立层级**：优先使用字号、字重、间距和对齐组织信息，减少靠边框和底色制造层级。
3. **连续画布**：阅读区、编辑区和列表保持连贯，避免卡片套卡片；卡片只表达真正独立的对象。
4. **克制用色**：默认以中性色构成界面，强调色只表达选择、状态、警告和可执行动作。
5. **默认静止**：动效仅用于解释状态变化、保持空间连续性或确认操作；尊重减少动态效果设置。
6. **原生可访问**：使用语义控件、可见焦点、键盘操作和足够对比度，不用 `div` 模拟按钮。
7. **桌面密度**：保持桌面知识工具所需的清晰密度，同时为阅读正文保留稳定、宽松的行长和留白。

## 组件体系

```text
语义 tokens
    ↓
primitives：Base UI 行为原语 + shadcn/ui 源码组织方式
    ↓
base：Button、Input、Dialog、Tooltip、Switch 等通用组件
    ↓
patterns：SettingSection、SettingRow、Sidebar、Toolbar、EmptyState
    ↓
features：Reader、Editor、Library、Activity、Agent、Diff
```

| 层面 | 选型 | 约束 |
| --- | --- | --- |
| 无样式原语 | Base UI | 仅在 `packages/ui/src/primitives/` 内直接使用 |
| 组件组织 | shadcn/ui，`new-york` 方向 | 组件源码归项目所有，按 Tessera token 调整 |
| 样式 | Tailwind CSS | 业务层优先组合语义类，避免任意值扩散 |
| 图标 | Hugeicons | 通过统一 Icon 包装层控制尺寸、描边与无障碍属性 |
| 动效 | Motion | 只用于状态与空间关系，普通 hover/press 优先 CSS |
| 富文本 | TipTap | Markdown 仍是内容事实源，编辑器状态不能替代文件 |
| 源码与 Diff | CodeMirror | 用于 Markdown 源码、代码片段与差异检查 |
| 复杂数据 UI | TanStack | 按需使用 Query、Table、Virtual，不预装未使用模块 |

上述选型中，组件分层与 `@tessera/ui` 边界已建立；Base UI、Tailwind、TipTap、Motion、CodeMirror
和图标包装层目前是规划能力，在首个真实组件需要时逐项接入。

## Token 与主题

- token 分为原始值和语义值；组件只消费 `background`、`foreground`、`muted`、`border`、
  `accent`、`danger` 等语义 token。
- 明暗主题共享语义名称，不在组件内分叉主题逻辑。
- 圆角、阴影、层级和动效时长统一定义；浮层阴影不能成为普通容器的默认样式。
- 默认字体使用系统 UI 字体；代码与文件路径使用等宽字体。
- 正文阅读宽度以约 60–68 个字符为基准，再根据中文排版和侧栏状态做视觉校正。

## 布局与交互

- 桌面主框架由侧栏、标签/导航区、内容画布和按需出现的右侧面板组成。
- 设置页采用稳定的左侧导航与右侧内容栏；使用 `SettingSection` 和 `SettingRow` 形成一致节奏。
- 主要操作与当前对象相邻；破坏性操作必须明确标记并提供确认或撤销路径。
- Agent 建议、文件 Diff、权限请求和最终写入必须在视觉上区分，不能伪装成普通聊天文本。
- 首屏、窄窗口、明暗主题、键盘导航和减少动态效果均属于验收范围。

## 代码约定

- 文件与目录使用小写 kebab-case，例如 `setting-section.tsx`；组件名仍为 `SettingSection`。
- 通用组件不接受与业务绑定的状态名称；业务语义在 patterns 或 features 层组合。
- 公开组件必须有清晰的 props 类型、焦点行为、禁用状态和可访问名称。
- 项目文档与代码注释优先使用中文，契约 Header 和目录地图遵循 [AGENTS.md](AGENTS.md)。
- 格式化与 lint 统一使用 Biome。

## 参考边界

本规范参考 [Vercel design.md](https://vercel.com/design.md) 对信息层级、排版、克制表面和真实界面
验证的原则。组件使用 Base UI + shadcn/ui 实现。
