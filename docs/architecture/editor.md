# 编辑器与 Markdown 同步

> 代码源头：`apps/desktop/src/renderer/src/components/documents/editor/`、
> `apps/desktop/src/renderer/src/hooks/use-workspace.ts`、`apps/desktop/src/main/index.ts`
>
> 状态：基础人工写作、CodeMirror 源码表面、兼容性保护与顶层区块连续多选已实现；嵌套操作和编辑器内 Agent 文本补丁处于规划阶段，聊天内文档 Diff 审批已实现。

## 当前迭代状态

| 能力 | 状态 | 当前边界 |
| --- | --- | --- |
| Typeset Markdown 主题 | **已实现** | 设置页支持精选本地字体、字号、行高、区块流、版心、参考预设、随机搭配和实时预览；不写入 Markdown 正文。 |
| TipTap 即时预览 | **已实现** | 常用 Markdown、GFM 表格、任务列表、斜杠菜单、顶层连续区块选择和结构化剪贴板已覆盖；原始 HTML、脚注和定义式链接仍进入源码保护。 |
| CodeMirror 源码模式 | **已实现** | 按需加载，支持 Markdown 高亮、行号、折叠、搜索、括号匹配、历史、自动换行、Tab 缩进、IME 安全同步、文档会话恢复和引用跳行；不提供底部工具栏。 |
| TipTap 真实 renderer 基准 | **已实现** | 已覆盖打开、输入、序列化、滚动、堆内存和块密度退化，预算检查暂不进入默认工程门禁。 |
| CodeMirror 真实 renderer 基准 | **规划** | 下一轮补充打开、连续输入、文档切换、滚动、系统快捷键、selection 和中文 IME 指标。 |
| 嵌套区块操作 | **规划** | 当前多选、拖动和结构操作只承诺文档直接子节点。 |
| 编辑器内 Agent 文本补丁 | **规划** | 复用聊天内已实现的冻结候选、源码 Diff、人工审批与审计协议。 |

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
2. `SourceCodeEditor` 按需加载 CodeMirror 6，以 Markdown 源码状态直接编辑同一份草稿。
3. `useWorkspace` 持有完整草稿、脏状态、flush 注册、串行保存队列和外部冲突状态。
4. Electron 主进程校验路径和磁盘版本，并在同目录内原子替换文件。

编辑器组件不读取文件、不访问数据库，也不直接调用 IPC。TipTap 是内存中的编辑投影，Markdown 文件是正文事实源。

## 编辑表面

文档只有即时预览和 Markdown 源码两种编辑状态，不维护独立预览页。两种状态共享草稿、自动保存、冲突检测和
窗口关闭协议，并可通过顶栏入口或 `⌘/` 切换。

源码模式使用按需加载的 CodeMirror 6：首次进入后在当前文档内保持挂载，提供 Markdown 高亮、行号、折叠、括号匹配、
搜索、历史、自动换行和 Tab 缩进。选区与滚动按文档身份恢复；大纲与聊天引用通过窄跳行事件定位 CodeMirror 行，
不读取编辑器 DOM。主题继续消费 Typeset 的等宽字体、字号、行高、版心和语义颜色。

编辑器偏好状态：

- **已实现**：默认编辑模式、拼写检查，以及 Typeset 的标题/正文/等宽字体、基础字号、行高、区块流和版心保存在
  渲染层 `v2` 轻量偏好中；它们只改变编辑投影，不修改 Markdown 内容，旧版 `v1` 正文字体、字号和宽度偏好会只读迁移到等价配置。
- **已实现**：即时预览使用项目持有的 Typeset CSS，通过 `size`、`leading` 与 `flow` 三项节奏变量派生标题、正文、
  列表、引用和代码关系；设置页使用同一 CSS 与精选本地字体实时预览，参考预设采用 `Nunito Sans / Oxanium / 18px / 1.9 / 1em / 70ch`，随机搭配只从已评审字体组合和可读节奏中采样；`measure` 以 `ch` 作用于编辑器布局，TipTap 选区、任务列表与表格滚动使用局部适配。
- **规划**：浮动目录、Frontmatter 可视化开关、标题级别标记、彩色与可折叠标题、可折叠列表和标签美化。
  设置页先展示禁用入口并明确能力状态，不保存不会生效的伪偏好。

当前即时预览支持：

- 一至三级标题、段落、引用和分隔线；
- 粗体、斜体、下划线、删除线、链接和行内代码；
- 无序列表、有序列表和任务列表；
- 代码块和 GFM 表格；表格单元格内的文本管道符、行内代码管道符与链接文字可以稳定往返；
- 斜杠命令以紧凑分组菜单插入常用块，并显示对应 Markdown 语法提示；
- YAML frontmatter 的拆分与无损拼回。

当前 schema 会改写原始 HTML、脚注和定义式链接。编辑器在忽略 frontmatter、代码围栏、缩进代码与行内代码后检测
这些语法，并默认保持源码模式，避免仅打开即时预览就静默改变原文。用户仍可从保护提示明确覆盖；这只是已知风险的
内容安全边界，不等同于即时预览已支持这些语法。

区块是 TipTap 文档中的运行时交互单位，不额外保存块 JSON。

- **已实现**：顶层区块共用一个浮动手柄；点击选择整块，`Shift` 点击扩展连续范围。手柄获得焦点后可用方向键导航，
  `Shift` 加方向键扩展或收缩范围。
- **已实现**：可检索菜单支持复制 Markdown、剪切、创建副本、删除、上下移动，以及单块正文和一至三级标题转换；
  `⌘/Ctrl+C` 与 `⌘/Ctrl+X` 使用当前编辑器序列化器向系统剪贴板写入 Markdown。剪切只在写入成功且文档未变化时删除范围。
- **已实现**：粘贴不含网页 HTML 的安全 Markdown 时，标题、列表、引用、代码块、表格、多段正文和常用行内格式解析为
  ProseMirror 结构；网页富内容优先走原生粘贴，原始 HTML、脚注和定义式链接不被强制解析。
- **已实现**：创建副本、删除、移动和拖拽在多选时把整个连续范围作为一次 ProseMirror transaction。删除全部块时
  保留可编辑空段落。
- **实现边界**：手柄使用单一浮层、事件委托和逐帧 hover 定位，不为每个块创建 React NodeView。当前操作直接使用
  TipTap/ProseMirror transaction；连续范围只包含文档直接子节点，列表项和引用内部不会被误当成独立顶层块。选择外观是短生命周期
  交互状态，不保存第二份正文，也未引入会连带 Collaboration、Yjs 与 NodeRange 的 Drag Handle 依赖链。
- **规划**：嵌套区块与真实 renderer 键盘、指针和系统剪贴板集成测试；需要跨层级范围语义时再评估 NodeRange。

## 同步与保存

- 连续输入停止 300ms 后生成 Markdown 草稿，避免每次按键都执行全文序列化和顶层 React 更新。
- 中文 IME composition 期间暂停静默期计时，不读取拼音等中间态；composition 结束后只提交最终文本。显式保存、
  切换模式和关闭窗口仍可强制 flush 当前内容。
- CodeMirror 的普通 transaction 直接更新 Markdown 草稿；composition 期间不向 React 发出中间字符串，结束后只提交最终状态。
- 保存、切换文档、切换模式和关闭窗口会先 flush 待处理编辑。
- flush 记录调度时的文档路径，旧文档结果不能写入新文档。
- 父级回传相同草稿时不重复调用 `setContent`，避免光标跳动和更新循环。
- 已激活的源码和即时预览表面在模式切换时保持挂载；切换文档时只保留当前文档实例。
- 自动保存串行写入；保存期间产生的新草稿会在前一次写入完成后继续保存。
- 磁盘内容在没有本地修改时刷新；发生外部修改冲突时暂停自动保存，由用户选择重新载入。
- 顶栏显示文件名和保存状态；重命名必须留在工作区、保留 `.md` 扩展名并拒绝覆盖已有文件。
- 一级 Space 侧栏在最近任务下直接合并 Markdown 文档与真实目录索引，因此空目录仍然可见；打开文档只替换主编辑画布，不进入独立工作区二级导航。文件和文件夹右键菜单通过窄 IPC 执行新建、重命名、复制路径、Finder 定位和移到废纸篓。

## 长文档保护

正文达到 100,000 字符或估算达到 750 个 Markdown 块的文档默认使用源码模式，不挂载 TipTap。字符与块数保护均先排除 frontmatter，
再扫描正文行结构，把段落边界、标题、列表项、引用、表格行和围栏代码视为压力信号，但不解析围栏代码内部内容。用户可以明确覆盖保护。
源码模式已使用 CodeMirror 6 的可视区域虚拟渲染，并复用当前 flush、保存和冲突协议；`useWorkspace` 仍持有完整 Markdown
字符串，后续需要把 CodeMirror 打开、输入、文档切换和滚动指标加入真实 renderer 基准，再判断是否需要进一步延迟物化。

性能评测至少区分文本长度、块数量和复杂节点数量，重点记录输入到下一帧、Markdown 序列化、文档切换、滚动和
内存峰值。块手柄使用单一浮层和事件委托，避免为每个段落常驻 React root、observer 和拖放监听器。

## 性能基准

> 状态：TipTap 真实 Electron renderer 基准、结构化报告与预算检查已实现；CodeMirror 源码模式尚未纳入，默认工程检查也尚不阻断性能预算。

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
bun run benchmark:editor:parser
bun run benchmark:editor:parser:cpu
```

前者始终生成报告，后者在 `apps/desktop/benchmarks/editor-budget.json` 的绝对体验预算超限时返回非零状态。
JSON、Markdown 和带时间戳的历史报告写入被 Git 忽略的 `artifacts/benchmarks/editor/`。预算表达产品目标，不能为
迎合单次机器结果而放宽；当前已知超限未解决前，不把 check 命令并入默认 `bun run check`。

parser 命令不挂载 DOM，按 100–1500 个固定短块生成 `MarkdownManager.parse` 增长曲线；`:cpu` 聚焦 1000 块并输出
Bun CPU profile。报告写入 `artifacts/benchmarks/editor-parser/`，用于定位解析热区，不能替代真实 renderer 指标。

### TipTap 首轮基线与结论

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
超线性增长。因此 100,000 字符保护仍有必要，但只看字符数不够。

独立 profile 已验证这一退化：在 Apple M1 Pro / Bun 1.3.13 上，约 31.5k 字符、750 个短块的解析 median 为
640.6ms，约 42k 字符、1000 块为 1212.5ms，约 63k 字符、1500 块为 2858.6ms。CPU 采样显示时间主要消耗在
Marked block lexer 的 Setext 标题、HTML、表格、引用和分隔线正则反复扫描，节点转换与块数估算本身不是热点。
当前已增加 750 块近似保护；后续根据真实语料决定缓存、worker 预解析、分段解析或替换解析路径。

## Agent 修改协议

> 状态：规划。

- 选区改写、章节重组和整篇审稿都生成 Markdown 文本补丁。
- 建议界面显示修改范围、原因和使用的来源。
- 用户可以逐项接受或拒绝；接受后内容成为普通草稿。
- Agent 不能直接保存 TipTap JSON，也不能用完整序列化结果覆盖未修改区域。
- 人工和 Agent 修改共享撤销、冲突检测、关闭前保存与后续审计协议。

## 自动化保障

- `markdown-document.test.ts`：frontmatter、换行规范和常用 Markdown 往返。
- `markdown-compatibility.test.ts`：嵌套列表、复杂表格、HTML、脚注、定义式链接以及代码样例排除语料。
- `markdown-clipboard.test.ts`：连续范围 Markdown 序列化、快捷键仲裁和剪贴板失败安全。
- `markdown-paste.test.ts`：安全 Markdown 识别、网页富内容优先和结构化块粘贴 transaction。
- `typeset-preferences.test.ts`：Markdown 主题参考/随机预设、自定义值、旧设置迁移和 CSS 变量映射。
- `editor-content-sync.test.ts`：输入合并、中文 IME 暂停/恢复、文档身份和强制提交。
- `editor-interactions.test.ts`：保存/模式快捷键仲裁，以及中文 transaction 的单步撤销与重做。
- `source-code-editor-state.test.ts`：源码选区/滚动快照边界、一基准跳行和按需加载期间的请求保留。
- `editor-mode-policy.test.ts`：字符数、近似块密度、围栏代码排除和源码优先语法保护。
- `top-level-block-operations.test.ts`：顶层相邻导航、连续范围定位、复制、删除、移动、转换和真实 Markdown schema 序列化。
- `space-files-model.test.ts`：一级侧栏文件树排序、空目录保留和可展开目录路径收集。

2026-08-22 的 CodeMirror 接入验收中，编辑器目录 63 项测试、相关 Biome 检查和桌面端生产构建通过；生产构建确认
源码编辑器被拆为独立按需加载 chunk。全仓是否通过仍以当前 CI 为准，不能用这组编辑器专项结果替代仓库门禁。

新增 schema 前需要补充对应往返用例。未知 HTML、脚注和定义式链接已有检测与源码保护但尚不能在即时预览中编辑；
图片附件和数学公式仍缺少兼容性覆盖。现有 IME、键盘和撤销测试位于无 DOM 协议层，真实 Electron renderer 的
composition、selection 与系统快捷键集成仍需端到端覆盖。

## 后续顺序

1. 为 CodeMirror 补充真实 renderer 的 IME、selection、系统快捷键和长文档性能基准。
2. 在已实现的顶层连续选择、Markdown 剪贴板和拖动上，继续补充嵌套区块协议与真实 renderer 集成测试。
3. 建立编辑器内 Agent 文本补丁、引用和逐项 Diff 审查流程，并复用聊天内已经实现的审批协议。
4. 扩展图片附件、数学公式等兼容性语料；以真实长文档继续评测复杂节点性能，再决定是否引入按块源码保留。
