# 编辑器与 Markdown 同步

> 代码源头：`apps/desktop/src/renderer/src/components/editor/`、
> `apps/desktop/src/renderer/src/hooks/use-workspace.ts`、`apps/desktop/src/main/index.ts`
>
> 状态：基础人工写作与顶层区块操作已实现；嵌套/多块操作、CodeMirror 和 Agent Diff 处于规划阶段。

## 目标

编辑器需要在不配置 Agent 的情况下完成日常 Markdown 写作。AI 辅助复用同一份文档、保存和撤销语义，
不能建立只能由对话面板修改的正文副本。

用户可以从空白文档开始手写，也可以让 Agent 从材料生成提纲或初稿。两条路径最终进入同一个编辑表面：

```text
人工输入 ----------------------\
                               -> Markdown 草稿 -> 审查与保存 -> 本地文件
Agent 建议 -> 文本补丁 -> 接受 --/
```

## 分层

1. `RichTextEditor` 将 Markdown 正文解析为 TipTap 文档，在输入静默期后重新序列化。
2. `useWorkspace` 持有完整草稿、脏状态、flush 注册、串行保存队列和外部冲突状态。
3. Electron 主进程校验路径和磁盘版本，并在同目录内原子替换文件。

编辑器组件不读取文件、不访问数据库，也不直接调用 IPC。TipTap 是内存中的编辑投影，Markdown 文件是正文事实源。

## 编辑表面

文档只有即时预览和 Markdown 源码两种编辑状态，不维护独立预览页。两种状态共享草稿、自动保存、冲突检测和
窗口关闭协议，并可通过顶栏入口或 `⌘/` 切换。

编辑器偏好状态：

- **已实现**：默认编辑模式、拼写检查、正文字体、基础字号和正文宽度保存在渲染层轻量偏好中；它们只改变
  编辑投影，不修改 Markdown 内容。
- **规划**：浮动目录、Frontmatter 可视化开关、标题级别标记、彩色与可折叠标题、可折叠列表和标签美化。
  设置页先展示禁用入口并明确能力状态，不保存不会生效的伪偏好。

当前即时预览支持：

- 一至三级标题、段落、引用和分隔线；
- 粗体、斜体、下划线、删除线、链接和行内代码；
- 无序列表、有序列表和任务列表；
- 代码块和 GFM 表格；
- 斜杠命令以紧凑分组菜单插入常用块，并显示对应 Markdown 语法提示；
- YAML frontmatter 的拆分与无损拼回。

区块是 TipTap 文档中的运行时交互单位，不额外保存块 JSON。

- **已实现**：顶层区块共用一个浮动手柄；点击选择整块，可检索菜单支持复制、删除、上下移动，以及正文和一至三级标题转换。
- **已实现**：指针拖动显示目标线，并用一次 ProseMirror transaction 完成重排；删除唯一块时保留可编辑空段落。
- **实现边界**：手柄使用单一浮层、事件委托和逐帧 hover 定位，不为每个块创建 React NodeView。当前操作直接使用
  TipTap/ProseMirror transaction，未引入会连带 Collaboration、Yjs 与 NodeRange 的 Drag Handle 依赖链。
- **规划**：嵌套区块、多块连续选择、跨块剪贴板和键盘区块导航；需要真实多块语义时再评估 NodeRange。

## 同步与保存

- 连续输入停止 300ms 后生成 Markdown 草稿，避免每次按键都执行全文序列化和顶层 React 更新。
- 保存、切换文档、切换模式和关闭窗口会先 flush 待处理编辑。
- flush 记录调度时的文档路径，旧文档结果不能写入新文档。
- 父级回传相同草稿时不重复调用 `setContent`，避免光标跳动和更新循环。
- 已激活的源码和即时预览表面在模式切换时保持挂载；切换文档时只保留当前文档实例。
- 自动保存串行写入；保存期间产生的新草稿会在前一次写入完成后继续保存。
- 磁盘内容在没有本地修改时刷新；发生外部修改冲突时暂停自动保存，由用户选择重新载入。
- 顶栏显示文件名和保存状态；重命名必须留在工作区、保留 `.md` 扩展名并拒绝覆盖已有文件。
- 侧栏文件树合并 Markdown 文档与真实目录索引，因此空目录仍然可见；文件和文件夹右键菜单通过窄 IPC 执行新建、重命名、复制路径、Finder 定位和移到废纸篓。

## 长文档保护

达到 100,000 字符的文档默认使用源码模式，不挂载 TipTap。用户可以明确覆盖保护。源码模式后续替换为
CodeMirror 6 时，仍需延迟物化完整字符串，并复用当前 flush、保存和冲突协议。

性能评测至少区分文本长度、块数量和复杂节点数量，重点记录输入到下一帧、Markdown 序列化、文档切换、滚动和
内存峰值。块手柄使用单一浮层和事件委托，避免为每个段落常驻 React root、observer 和拖放监听器。

## 性能基准

> 状态：真实 Electron renderer 基准、结构化报告与预算检查已实现；默认工程检查尚不阻断性能预算。

基准使用生产构建和独立 BrowserWindow，加载与产品相同的 TipTap schema、内容样式和顶层区块手柄。窗口关闭
后台节流但保留 GPU 合成，避免把浏览器帧指标替换为 Node 定时器。固定语料将字符数、顶层块数量和复杂节点分开：

| 语料 | 主要压力 |
| --- | --- |
| 纯文本 10k / 100 块 | 日常文档基线 |
| 纯文本 100k / 1000 块 | 长文本与当前保护阈值 |
| 小块密集 100k / 2000 块 | 相近字符量下的块数量退化 |
| 复杂 Markdown 50k | 标题、列表、任务、引用、表格和代码块的 schema/DOM 复杂度 |

每个耗时指标保留原始样本、median、p95、min 和 max。当前报告包含：

- Markdown → JSON 与 JSON → ProseMirror document 两段解析耗时；
- 编辑器构造、React 表面挂载到第二个稳定 animation frame 的总耗时；
- 同步 ProseMirror transaction 与 transaction 到下一帧的输入反馈耗时；
- 全文 Markdown 序列化、顶层手柄 hover 到下一帧；
- 60 帧程序化滚动的帧间隔、超过 25ms 的慢帧率；
- 强制 GC 前后的 renderer JS heap 增量，以及报告结束时 renderer working set。

运行方式：

```bash
bun run benchmark:editor
bun run benchmark:editor:check
```

前者始终生成报告，后者在 `apps/desktop/benchmarks/editor-budget.json` 的绝对体验预算超限时返回非零状态。
JSON、Markdown 和带时间戳的历史报告写入被 Git 忽略的 `artifacts/benchmarks/editor/`。预算表达产品目标，不能为
迎合单次机器结果而放宽；当前已知超限未解决前，不把 check 命令并入默认 `bun run check`。

### 首轮基线与结论

2026-08-21 在 Apple M4、Electron 42.3.3 / Chrome 148 上得到以下 p95。数字用于确定优化方向，不代表其他机器的
承诺值；比较回归时应使用相同硬件、电源状态和 Electron 版本。

| 场景 | Markdown 解析 | PM 建树 | 打开到帧 | transaction | 输入到帧 | 序列化 | 滚动帧 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 纯文本 10k / 100 块 | 10.4ms | 0.4ms | 42.8ms | 1.0ms | 17.6ms | 0.5ms | 17.6ms |
| 纯文本 100k / 1000 块 | 635.4ms | 0.3ms | 1116.6ms | 2.5ms | 17.3ms | 6.5ms | 17.6ms |
| 小块密集 100k / 2000 块 | 3356.2ms | 1.5ms | 6416.6ms | 4.7ms | 18.1ms | 27.5ms | 17.7ms |
| 复杂 Markdown 50k | 851.8ms | 4.2ms | 1131.8ms | 3.7ms | 17.7ms | 44.2ms | 17.6ms |

结论是编辑器挂载后的输入与滚动暂时健康，主要风险发生在打开阶段。`MarkdownManager.parse` 占据几乎全部解析
时间，ProseMirror document 建树不是当前瓶颈；相近字符量从 1000 块增加到 2000 块时，解析与打开成本出现明显
超线性增长。因此 100,000 字符保护仍有必要，但只看字符数不够，后续应加入无需完整解析的近似块数保护，并为
Markdown 解析器建立独立 profile 后再决定缓存、worker 预解析或替换解析路径。

## Agent 修改协议

> 状态：规划。

- 选区改写、章节重组和整篇审稿都生成 Markdown 文本补丁。
- 建议界面显示修改范围、原因和使用的来源。
- 用户可以逐项接受或拒绝；接受后内容成为普通草稿。
- Agent 不能直接保存 TipTap JSON，也不能用完整序列化结果覆盖未修改区域。
- 人工和 Agent 修改共享撤销、冲突检测、关闭前保存与后续审计协议。

## 自动化保障

- `markdown-document.test.ts`：frontmatter、换行规范和常用 Markdown 往返。
- `editor-content-sync.test.ts`：输入合并、文档身份和强制提交。
- `editor-mode-policy.test.ts`：大文档保护阈值。
- `top-level-block-operations.test.ts`：顶层区块定位、复制、删除、移动、转换和真实 Markdown schema 序列化。
- `workspace-sidebar-model.test.ts`：侧栏排序、文件树和大纲提取。

新增 schema 前需要补充对应往返用例。未知 HTML、脚注、定义式链接、嵌套列表、复杂表格、图片附件和数学公式
仍缺少兼容性覆盖。

## 后续顺序

1. 补充 Markdown 兼容性语料和中文 IME、键盘、撤销测试。
2. 在已实现的顶层选择、转换和拖动上，继续补充嵌套区块与多块操作协议。
3. 使用 CodeMirror 6 替换当前源码输入表面。
4. 建立 Agent 文本补丁、引用和 Diff 审查流程。
5. 以真实长文档评测序列化、滚动和复杂节点性能，再决定是否引入按块源码保留。
