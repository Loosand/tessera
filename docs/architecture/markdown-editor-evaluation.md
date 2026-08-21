# Markdown 编辑器技术路线评估

> 代码源头：`apps/desktop/src/renderer/src/components/editor/`、
> `apps/desktop/src/renderer/src/hooks/use-workspace.ts`、`apps/desktop/src/main/index.ts`
>
> 外部样本：Glyph 0.2.1、Typora 官方技术文档与更新日志、本机 Typora 1.10.9 应用包。
>
> 状态：调研结论；TipTap 基础编辑与延迟序列化已实现，CodeMirror、区块操作、主题 ABI 与性能基准处于规划状态。

## TL;DR

Tessera 的目标不是通用富文本编辑器，也不是给 Markdown 源码旁边加一个预览窗。产品在交互上参考 Notion 的
区块化体验：内容单元可以被插入、选择、转换和重排；在编辑呈现上参考 Typora：用户直接在排版结果上输入，
Markdown 标记按上下文显隐，不维护独立预览页。两项参考只定义目标体验，不代表复制其内部实现。

Tessera 已经使用 TipTap 提供即时预览编辑，并将 Markdown 文件保留为内容事实源。当前实现可以处理常用
Markdown，并已把完整正文序列化移出每次编辑交易，改为输入静默期或显式 flush 执行。结构化编辑因此获得了
稳定的选区、撤销和表格操作，同时仍有源码规范化、未知语法损失和长文档 O(N) 物化等风险。

Glyph 与 Typora 提供了两组互补样本。Glyph 使用 TipTap 处理结构化编辑，同时维护 CodeMirror 源码模式、
Markdown 前后处理、自定义语法桥接和大量交互扩展。Typora 在 macOS 上使用原生 Cocoa 外壳与系统 WebKit，
使用 CodeMirror 编辑源码和代码块，并通过稳定的 HTML/CSS 选择器支持主题。它的更新日志也持续记录图片、
数学、视频、滚动、查找和代码块带来的专项性能问题。

当前决策是保留 TipTap，并把它限定为 Markdown 的结构化编辑投影；源码模式改用 CodeMirror 6，完整 Markdown
字符串不再随每次交易同步生成。主题能力独立设计成版本化 ABI。数学与图表分别使用 MathJax、Mermaid 等专用
渲染器，并在进入视口或用户开始编辑时加载。区块首先是运行时交互边界，不自动成为新的持久化格式。后续是否
实现按块源码保留或持久块 ID，需要先通过兼容性语料、交互原型和性能基准评估。

## 背景与问题

Tessera 的编辑器同时面对四类约束：

1. Markdown 文件由用户和外部工具共同维护，不能把编辑器内部状态当成唯一副本。
2. 内容需要以语义块被操作，同时保留块内接近普通文字处理器的连续输入体验。
3. 即时预览需要可靠处理 Markdown 标记显隐、选区、IME、撤销、表格、粘贴和浏览器差异。
4. 主题、搜索、数学、图表和后续 Agent Diff 会继续增加文档表面的复杂度。

这次调研回答四个问题：

1. TipTap、源码型编辑器和 Typora 式混合编辑器分别保存了哪些信息，又会丢失哪些信息？
2. 编辑器性能主要消耗在哪些路径，库的体积是否是主要变量？
3. Typora 的主题能力依赖哪些稳定接口，能否迁移到 Tessera？
4. Tessera 近期应该保留、替换或新增哪些模块？

## 目标体验与模型分层

「万物皆区块」和「即时编辑即时预览」作用在不同层次。把两者都塞进持久化模型，会让内部状态与 Markdown
产生双向同步问题；把两者都当成 CSS 效果，又无法定义拖动、撤销和选区语义。Tessera 采用三层模型：

| 层次 | 产品目标 | 技术边界 |
| --- | --- | --- |
| 交互层 | 以语义块插入、选择、转换、重排和组合内容 | TipTap/ProseMirror node、transaction、selection 与 command |
| 呈现层 | 在排版结果上直接编辑，按上下文显隐 Markdown 标记 | decoration、NodeView、轻量语法提示与聚焦状态 |
| 持久化层 | 与文件、Git、外部编辑器和 Agent 交换可审查的文本 | Markdown 文件、最小文本补丁、显式 flush 与冲突协议 |

区块不是「每一层 DOM 都包一个 React 组件」，而是具有独立操作语义的内容单元。第一阶段至少覆盖段落、标题、
列表项、引用、代码块、表格、分隔线、图片、数学和图表。粗体、链接、行内代码等仍是块内 mark；列表、引用和
表格允许嵌套块，不为了视觉统一把它们压平成顶层数组。

这一定义导出以下交互契约：

1. Enter、Backspace 与 Tab 分别具有可预测的拆分、合并和层级行为。
2. 块手柄、斜杠菜单、键盘命令与拖放调用同一套 ProseMirror command。
3. 多块选择、复制、删除、复制副本和拖动重排形成单次可撤销 transaction。
4. 块内文本选择优先于块选择，中文 IME composition 期间不切换投影或重建 NodeView。
5. 运行时块 key 只服务 DOM 对齐、拖放和选区；若未来需要可分享的块链接，持久 ID 必须进入可审查的
   Markdown 协议，不能只存在于 TipTap JSON 或 SQLite。
6. 普通状态显示排版结果；仅在焦点、歧义或损失风险出现时暴露必要标记，完整源码编辑交给 CodeMirror。

Notion 在这里是交互参照，Typora 是编辑呈现参照。本文没有把两者当作可验证的技术选型证据。

## 已有实现

### Tessera

- **已实现**：TipTap + `@tiptap/markdown` 负责常用 Markdown 的解析、编辑和序列化。
- **已实现**：YAML frontmatter 在进入富文本编辑器前被拆出，保存时再拼回。
- **已实现**：源码模式与富文本模式共享草稿、冲突检测和原子写入协议。
- **已实现**：`shouldRerenderOnTransaction: false` 避免 React 随每次 TipTap 交易刷新编辑器表面。
- **已实现**：输入停止 300ms 后才生成完整 Markdown；保存、切换与关闭前显式 flush。
- **已实现**：达到 100,000 字符的文档默认进入源码模式，用户可以明确覆盖保护。
- **部分实现**：往返测试覆盖常用格式和 GFM 表格，但没有覆盖未知 HTML、脚注、定义式链接和源码风格保留。
- **规划**：源码模式从 `<textarea>` 替换为 CodeMirror 6。
- **规划**：主题 ABI、复杂块懒加载和编辑器性能基准。

当前富文本更新路径是：

```text
浏览器输入
  -> ProseMirror transaction
  -> TipTap onUpdate
  -> 安排 300 ms 内容同步
  -> 输入静默或显式 flush
  -> getMarkdown() 序列化完整正文
  -> 拼回 frontmatter
  -> React 保存完整草稿字符串
  -> 700 ms 后经 IPC 写入文件
```

这条路径已经避免每次按键都执行完整树遍历和顶层 React 更新。剩余成本是每次静默期或强制 flush 仍会执行
O(N) 序列化与字符串分配；连续输入、频繁模式切换和大文档显式保存仍需纳入基准。

### Glyph 样本

本次检查的 Glyph 归档版本为 0.2.1。它同时依赖 TipTap 3、CodeMirror 6、Lezer、KaTeX、Mermaid 和多个
自定义编辑器扩展。`src/components/editor/` 约有 131 个 TypeScript 文件、2.3 万行代码和 20 个测试文件。

这组代码呈现了几类较稳定的工作量：

1. `useNoteEditor.ts` 处理 frontmatter、Markdown 同步延迟、编辑器销毁前 flush、选区恢复、粘贴和图片占位。
2. `wikiLink.ts` 同时实现 tokenizer、`parseMarkdown`、`renderMarkdown`、DOM、命令和输入规则。
3. `wikiLinkMarkdownBridge.ts` 使用前后处理与 sentinel 保留空白、自定义 HTML、颜色、高亮和转义形式。
4. `RawMarkdownEditor.tsx` 单独使用 CodeMirror，并在 120 ms 延迟后生成完整 Markdown，卸载前强制 flush。
5. decoration、代码预览、数学、Mermaid、图片和折叠状态均有独立的增量或异步处理。

Glyph 因此可以作为一项实现侧证据：TipTap 承担了结构化文档、事务、选区和编辑视图，自定义 Markdown 语义、
源码同步与产品交互仍需要项目代码维护。

### Typora 样本

官方资料与本机应用包可以确认以下技术边界：

- **已确认**：macOS 版使用原生 Cocoa 文档应用和系统 WebKit/WKWebView；本机 1.10.9 应用约 41 MB。
- **已确认**：Windows/Linux 公开版本使用 Electron，官方曾以性能为由升级 Electron 版本。
- **已确认**：源码模式和代码块使用 CodeMirror。
- **已确认**：数学与图表分别依赖 MathJax、Mermaid 等专用渲染器。
- **已确认**：主题以 CSS 文件和相关本地资源组成，并通过 `#write`、`mdtype`、`.md-*`、CodeMirror class
  与 `@media print` 控制正文、源码、复杂节点和导出。
- **本机观察**：应用资源包含 `finder-worker.js` 和 arm64/x64 两套 ripgrep 二进制。由此可以推测，全局文件
  搜索至少有一部分工作会离开正文编辑循环；公开资料没有说明完整调用路径。
- **未确认**：即时预览编辑内核是否基于某个未公开的通用编辑框架。Typora 闭源，不能只根据 DOM 或主题
  接口断言它完全从零实现。

Typora 在 2019 年从旧 WebView 迁移到 WKWebView。官方测试中，两者的速度和内存接近；迁移动机主要是旧 API
弃用、后续系统能力和 IME。官方同时说明，相比 Chromium/Electron，系统 WebView 可以减少包体和启动时间。
这组信息适合解释平台基线，不能直接证明某一种 Markdown 编辑模型更快。

## 评估维度

### 1. 文档模型与源码保真

TipTap/ProseMirror 将文档保存为受 schema 约束的节点树。树可以表达「这是一级标题」，但通常不会保留标题
原来使用 ATX 还是 Setext 写法。列表标记、围栏长度、引用式链接、空行数量等词法信息也可能在解析时丢失。

使用 Tessera 当前扩展组合做解析—序列化实验，得到以下结果：

| 输入 | 序列化结果 | 影响 |
| --- | --- | --- |
| Setext 标题 | ATX 标题 | 源码风格变化 |
| `*` 列表 | `-` 列表 | 源码风格变化 |
| 四反引号围栏 | 三反引号围栏 | 源码风格变化 |
| 定义式链接 | 行内链接 | 共享定义关系丢失 |
| `<details>` | 转义后的文本 | 语义变化 |
| 脚注 | 被解释成普通链接结构 | 语义变化 |

CodeMirror 的文档值始终是原始字符串。解析器即使不认识某种语法，也不会因为用户编辑相邻内容而改写它。
代价是表格、列表、粘贴和结构化命令需要落实为文本范围和补丁。

Typora 式混合编辑器可以把源码保留为事实源，同时按光标位置显示或隐藏 Markdown 标记。它需要持续维护源码
offset、视觉块、DOM selection 和 IME composition 的映射。表格、嵌套列表、未闭合语法和跨块选区会扩大这部分
状态空间。

### 2. 编辑事务、选区与 IME

ProseMirror 使用不可变文档、transaction、step mapping 和 selection mapping 表达修改。浏览器负责一部分原生
光标和输入行为，ProseMirror 再把 DOM 变化转换成交易。这类能力可以减少中文 IME、双向文本、撤销分组和跨节点
选区的基础工作量。

CodeMirror 也提供不可变状态、transaction、composition 处理和选区映射，但它的基本单位是文本位置。对源码
编辑而言，这个模型更直接；对可交互表格、任务项和嵌套 NodeView，则需要额外组件或另一种编辑表面。

直接基于裸 `contenteditable` 实现即时预览，会同时承担浏览器 DOM 差异、选区恢复和 Markdown 投影。除非编辑器
体验本身成为产品的长期研发重点，这条路径暂时不适合作为 Tessera 的基础实现。

区块化并不要求放弃 ProseMirror 的连续文档。相反，块选择和拖动应该表示为 selection、decoration 与 transaction，
块内输入继续使用原生文本选区。若为每个块建立独立编辑器或 React 状态，跨块选择、撤销、IME、复制粘贴和嵌套
结构都会重新变成应用层问题。

### 3. 自定义 Markdown 语法

TipTap 中的一种新 Markdown 语法通常需要同时提供：

1. tokenizer；
2. `parseMarkdown`；
3. schema node 或 mark；
4. `renderMarkdown`；
5. DOM 或 NodeView；
6. 命令、输入规则和键盘行为；
7. 粘贴、复制和拖放处理；
8. 往返与交互测试。

CodeMirror 可以先保留未知源码，再逐步增加语法识别、HighlightStyle、completion、decoration 和命令。它降低了
「暂时不支持」带来的数据风险，但不会自动提供可视化编辑行为。

### 4. 主题 ABI

主题能力取决于编辑器是否公开稳定的语义 DOM 和样式变量。TipTap、CodeMirror 与自定义编辑器都能提供这类接口，
但接口一旦对外发布，就需要独立于内部 NodeView 和库版本长期维护。

Typora 的主题协议包括：

```text
#write                         正文容器
[mdtype="heading"]            块语义
.md-fences                    代码块
.md-meta-block                frontmatter
.md-focus                     当前编辑块
.cm-s-inner                   代码块源码
.cm-s-typora-default          完整源码模式
@media print                  打印与 PDF
```

Tessera 当前使用 `.rich-text-content`、标准 HTML 标签、`data-type="taskList"` 和 TipTap 的 `.tableWrapper`。
普通排版规则容易适配，代码块、任务项、frontmatter、数学、图表和源码模式的 DOM 契约仍未定义。

区块交互还需要稳定的 `data-block-type`、`data-block-selected`、`data-block-active` 和拖放状态契约。块手柄、菜单与
选择框属于编辑器 chrome，不应被正文主题任意重排；主题可以控制块内容、间距和状态色，但不能改变命中区域、
拖放锚点与无障碍语义。

建议将主题协议拆成两层：

1. 普通主题使用语义变量和稳定节点选择器，只影响文档表面。
2. 高级主题允许受限自定义 CSS 和本地字体/图片，并明确网络 URL、全局 UI 覆盖和导出行为。

Typora 主题可以通过导入器转换一部分选择器，并报告不兼容规则。直接承诺任意 Typora CSS 可用，会把 Typora 内部
DOM 也变成 Tessera 的维护约束。

### 5. 性能

性能需要分别观察平台基线、输入路径、滚动、复杂块和文件搜索。

| 场景 | TipTap / ProseMirror | CodeMirror 6 | Typora 式混合编辑 |
| --- | --- | --- | --- |
| 普通短文输入 | 增量交易，通常稳定 | 增量文本更新，通常稳定 | 取决于投影实现 |
| 超长纯文本 | 完整文档 DOM 与插件成本增加 | 只渲染视口，较有优势 | 需要自行实现分块与懒加载 |
| 表格与任务项 | 结构化节点和选区已有基础 | 需要文本命令或组件 | 需要专项行为 |
| Markdown 保存 | 完整序列化容易形成 O(N) 热点 | 原始文本可直接保存 | 取决于源码是否保持为事实源 |
| 图片、数学、图表 | NodeView 数量和布局是主要变量 | widget/preview 是主要变量 | 专用渲染器和布局是主要变量 |
| 主题样式 | 整篇 DOM 对宽泛选择器较敏感 | 视口 DOM 限制样式计算范围 | 取决于渲染块数量 |

CodeMirror 6 不会为大文档渲染完整 DOM。它维护完整文档和高度信息，只绘制视口附近的行。这个模型适合源码、
日志、生成文档和大范围查找。调用方如果仍在每次交易后执行 `doc.toString()` 并把完整字符串写入 React，仍会重新
引入 O(N) 字符串分配，因此源码模式也需要延迟物化和显式 flush。

ProseMirror 会复用没有变化的文档节点和 DOM。Tessera 已经在边界层把 transaction 与 Markdown 物化拆开，
`onUpdate` 只安排延迟任务，输入静默或显式 flush 时才调用 `getMarkdown()`。下一阶段需要测量 O(N) 物化在长文档、
强制保存和频繁切换中的尾延迟，再判断是否引入按块序列化。

区块化界面本身也可能制造额外成本。如果每个块常驻一个 React root、块手柄、ResizeObserver 和拖放监听器，
短段落很多的文档会比同字节数的长段落文档更早退化。Tessera 应优先使用单一浮动块手柄、事件委托、视口内
decoration 和按需 NodeView；不能把「每块一个组件」当作「万物皆区块」的必要条件。

### 6. 外部修改、Git 与 Agent Diff

结构化树适合执行「标题降级」「插入表格行」「给选区添加链接」等语义操作。最终文件如果由完整 serializer 生成，
未触碰区域也可能发生格式变化，使 Git Diff 和 Agent 审查包含额外噪声。

源码模型更容易表达最小文本补丁、外部编辑器冲突和逐行 Diff。因此，后续 Agent 文件修改应基于 Markdown 文本补丁
提出建议，不把 TipTap JSON 或完整序列化结果直接作为写入协议。

## 性能风险清单

Typora 更新日志记录的专项优化可以作为 Tessera 的预备测试项：

1. **图片**：大量图片会增加解码内存、固有尺寸测量和布局次数。Typora 1.2 曾以 85 张、总计 72.5 MB 的样本
   专门优化 macOS 编辑性能。
2. **数学**：大量公式会增加解析、字体加载、SVG/DOM 生成和重新编号成本。Typora 1.3 记录过对应输入延迟。
3. **视频与 HTML**：媒体尺寸、加载事件和自定义 DOM 会触发布局；Typora 1.4 对含 `video` 的文档做过专项优化。
4. **查找替换**：同步扫描、正则匹配和全部结果 decoration 可能阻塞编辑线程；Typora 1.4 修复过查找挂起。
5. **滚动**：图片、复杂 CSS、selection overlay 和整篇 DOM 共同影响帧时间；Typora 1.9 优化过 macOS 14 滚动。
6. **代码块**：常驻 CodeMirror 实例、语法高亮和自动高度计算会叠加成本；Typora 1.10 修复过代码块末行输入挂起。
7. **大文件恢复**：应用启动时自动恢复上次超大文档可能再次触发挂起。需要安全模式、恢复上限或延迟打开。
8. **IME**：composition 期间重新解析和替换 DOM 会导致光标跳跃或输入延迟。Typora 多个版本持续修复 IME。
9. **块级 chrome**：每块常驻手柄、菜单、observer 和拖放监听器会让成本随块数增长，而不是只随文本字节增长。
10. **跨块操作**：多块选择、拖动与撤销如果拆成多次交易，会增加布局、历史记录和序列化次数。

这些风险不由某一个编辑器库单独决定。Tessera 应通过懒加载、changed ranges、worker、结果上限和恢复策略分别处理。

## 设计决策

### 决策一：保留 TipTap 富文本编辑

- **已实现**：常用 Markdown、任务列表和表格使用 TipTap。
- **约束**：TipTap 是 Markdown 的结构化编辑投影，不能成为内容事实源。
- **目标交互**：以语义 node 作为块边界，补齐块手柄、插入、转换、重排和多块选择；块内仍是连续文本编辑。
- **实现边界**：使用单一浮动 chrome 和 ProseMirror transaction，不为每个块创建独立编辑器或持久 React 状态。
- **已实现**：交易后安排 300ms 延迟同步，Markdown 序列化发生在输入静默期、保存或显式 flush。
- **待评估**：按块保留原始源码，只序列化发生语义变化的块。

### 决策二：源码模式采用 CodeMirror 6

- **规划**：替换当前 `<textarea>`，复用现有草稿、保存和冲突协议。
- **约束**：通过 transaction/change set 更新，避免每次按键立即生成完整字符串。
- **主题**：使用 Tessera 语义变量映射 CodeMirror `HighlightStyle`，不复制 Typora 的 CodeMirror 5 class。
- **代码块**：未聚焦时使用静态 `<pre>` 或轻量高亮，只在编辑或进入视口时创建重型实例。

### 决策三：复杂渲染器保持独立

- **规划**：数学使用 MathJax 或经评估后的兼容实现，图表使用 Mermaid。
- **约束**：解析和渲染在用户停止输入后执行；不可见块不持续重算。
- **安全**：HTML、Mermaid 和数学输出经过明确的脚本、URL 与 DOM 边界。

### 决策四：搜索离开正文编辑循环

- **规划**：工作区全文搜索使用 worker 或独立进程，并设置结果数量、片段长度和取消边界。
- **参考**：Typora 本机包包含搜索 worker 与 ripgrep；Tessera 是否采用 ripgrep 仍需结合索引、跨平台发布和许可证评估。
- **约束**：Markdown 文件保持事实源，SQLite 或搜索索引必须可以重建。

### 决策五：主题协议版本化

- **规划**：定义文档节点、编辑状态、源码语法和导出表面的稳定选择器/变量。
- **约束**：主题不能依赖 TipTap 内部 wrapper、React 组件层级或随机 class。
- **兼容**：Typora 主题通过显式导入器适配，不直接注入应用主文档。

## 性能基准计划

### 样本集

| 样本 | 规模 | 主要观察 |
| --- | --- | --- |
| 普通 Markdown | 50 KB | 日常输入、选区、自动保存 |
| 多块短文档 | 10,000 个短段落 | 块手柄、选择、事件委托、DOM 数量 |
| 长文档 | 500 KB | 序列化、React 更新、滚动 |
| 生成文档 | 2–5 MB | 打开时间、降级策略、源码模式 |
| 图片文档 | 100 张本地图片 | 解码、布局、内存峰值 |
| 数学文档 | 500 个公式 | 延迟渲染、输入响应、滚动 |
| 代码文档 | 100 个代码块 | 实例数量、高亮、自动高度 |
| 大表格 | 10,000 个单元格 | DOM、选区、命令耗时 |
| 搜索工作区 | 10,000 个 Markdown 文件 | 首个结果、取消、结果上限 |

### 指标

1. 按键到下一帧的 p50、p95、p99。
2. 单次 ProseMirror/CodeMirror transaction 同步耗时。
3. Markdown 解析、完整序列化和按块序列化耗时。
4. 首次打开、模式切换和文档切换耗时。
5. DOM 节点数量、常驻编辑器实例数量和 JS heap 峰值。
6. 连续输入期间的长任务与 GC 峰值。
7. 滚动掉帧和布局次数。
8. 外部修改、冲突和关闭窗口时的 flush 完整性。
9. 块手柄首次出现与跨块移动耗时。
10. Enter 拆分、Backspace 合并、多块删除及拖动重排的 transaction 与下一帧耗时。

基准需要固定硬件、系统、应用构建和主题。结果记录中同时保留文档大小、节点数量与复杂块数量，避免只按文件字节
比较不同结构的文档。

## 实施顺序

1. **规划**：为段落、标题、列表、引用、代码和表格定义块边界，以及拆分、合并、转换、嵌套和重排协议。
2. **规划**：补充 Markdown 兼容性语料，覆盖未知 HTML、脚注、定义式链接、嵌套列表和复杂表格。
3. **规划**：建立区块操作及输入、打开、滚动的性能样本和基准。
4. **已实现**：把 `getMarkdown()` 从每次交易移动到延迟物化与显式 flush。
5. **规划**：实现单一浮动块手柄、斜杠插入、块转换和多块选择，不引入每块独立状态。
6. **规划**：引入 CodeMirror 6 源码模式，保持保存与冲突协议不变。
7. **规划**：定义主题 ABI v1，并为富文本、源码、只读渲染和打印建立视觉回归样本。
8. **规划**：实现图片、数学和 Mermaid 的可见区加载与取消。
9. **规划**：根据语料与 Diff 结果决定是否实现按块源码保留。

## 尚未决定的事项

- TipTap 视觉模式是否允许规范化支持范围内的 Markdown，还是必须保留未修改块的原始源码。
- 列表项、引用子段落和表格单元格在块选择与拖动中的层级边界。
- 是否需要跨会话持久块 ID；如果需要，使用何种可被 Markdown、Git 和外部编辑器理解的表达。
- 数学渲染最终使用 MathJax、KaTeX，或按语法范围组合使用。
- 主题高级 CSS 使用选择器重写、Shadow DOM 还是独立 iframe 隔离。
- 全文搜索采用 SQLite FTS、ripgrep、混合索引或其他可重建实现。
- 大文档进入富文本模式的阈值，以及超过阈值后的提示和降级行为。

这些事项需要由兼容性语料、性能基准和主题原型提供输入，再更新本文与 `editor.md` 的能力状态。

## 参考资料

### 官方文档

- [ProseMirror Guide](https://prosemirror.net/docs/guide/)
- [CodeMirror System Guide](https://codemirror.net/docs/guide/)
- [TipTap Markdown 自定义扩展集成](https://tiptap.dev/docs/editor/markdown/guides/integrate-markdown-in-your-extension)
- [Typora About Themes](https://support.typora.io/About-Themes/)
- [Typora Write Custom Theme](https://theme.typora.io/doc/Write-Custom-Theme/)
- [Typora What's New 索引](https://support.typora.io/what%27s-new/)
- [Typora 0.9.73：WKWebView 迁移](https://support.typora.io/What%27s-New-0.9.73/)
- [Typora 1.2：大量图片性能](https://support.typora.io/What%27s-New-1.2/)
- [Typora 1.3：大量数学表达式性能](https://support.typora.io/What%27s-New-1.3/)
- [Typora 1.4：查找、视频与复杂块性能](https://support.typora.io/What%27s-New-1.4/)
- [Typora 1.9：滚动性能](https://support.typora.io/What%27s-New-1.9/)
- [Typora 1.10：代码块输入挂起修复](https://support.typora.io/What%27s-New-1.10/)
- [Typora Trouble Shooting：大文件恢复](https://support.typora.io/Trouble-Shooting/)

### 实现样本

- [Glyph `useNoteEditor.ts`](https://github.com/SidhuK/Glyph/blob/main/src/components/editor/hooks/useNoteEditor.ts)
- [Glyph `wikiLink.ts`](https://github.com/SidhuK/Glyph/blob/main/src/components/editor/extensions/wikiLink.ts)
- [Glyph `wikiLinkMarkdownBridge.ts`](https://github.com/SidhuK/Glyph/blob/main/src/components/editor/markdown/wikiLinkMarkdownBridge.ts)
- [Glyph `RawMarkdownEditor.tsx`](https://github.com/SidhuK/Glyph/blob/main/src/components/editor/raw/RawMarkdownEditor.tsx)

### 本机检查范围

- `/Applications/Typora.app/Contents/Info.plist`
- `/Applications/Typora.app/Contents/MacOS/Typora`
- `/Applications/Typora.app/Contents/Resources/TypeMark/`
- `/Users/loosand/Downloads/Glyph-main/`

本机文件仅用于确认安装版本、应用外壳、依赖资源和目录结构，不复制闭源实现，也不把压缩代码中的符号当成公开契约。
