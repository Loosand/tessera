# 编辑器与 Markdown 同步

> 代码源头：`apps/desktop/src/renderer/src/components/editor/`、
> `apps/desktop/src/renderer/src/hooks/use-workspace.ts`、`apps/desktop/src/main/index.ts`
>
> 状态：基础能力已实现。

## 边界

Markdown 文件是内容事实源，TipTap 只是内存中的编辑模型。三个层次分别负责：

1. `RichTextEditor` 将 Markdown 正文解析为 TipTap 文档，并在交易后重新序列化为 Markdown。
2. `useWorkspace` 持有完整草稿、脏状态、自动保存队列和外部冲突状态。
3. Electron 主进程校验工作区路径、比较修改时间并执行原子写入。

编辑器组件不读取文件、不保存数据库，也不直接调用 IPC。

## Markdown 往返

基础 schema 集中在 `editor-extensions.ts`，当前包含 StarterKit、任务列表、表格和官方 Markdown 扩展，支持：

- 一至三级标题；
- 粗体、斜体、下划线、删除线和链接；
- 无序列表、有序列表和任务列表；
- 引用、行内代码与代码块。
- GFM 表格及行列增删。

完整文档进入编辑器前会拆分 YAML frontmatter。即时预览编辑层只编辑正文，输出时再将原 frontmatter
拼回，从而避免编辑普通正文时丢失文件属性；源码模式仍编辑完整 Markdown。

文档详情页不拆分独立的编辑页和预览页。默认状态以排版结果直接编辑，Markdown 源码是第二种状态，
两者共享同一份草稿、保存队列与冲突协议。用户可通过顶栏按钮或 `⌘/` 在两种状态间切换。

输入空段落中的 `/` 会打开块级命令菜单；继续输入可过滤命令，方向键移动选择，回车执行，
Escape 关闭。菜单只调用编辑器命令，不读写文件，也不创建另一套内容模型。

## 同步规则

- 用户交易完成后立即生成新的 Markdown 草稿，文件自动保存仍由工作区层延迟触发。
- 父级回传相同草稿时不重复调用 `setContent`，避免光标跳动和交易循环。
- 磁盘内容在无本地修改时更新，使用 `emitUpdate: false` 替换编辑器文档。
- 切换文档会销毁旧 TipTap 实例并以新路径为 key 创建实例，避免跨文档复用 schema 状态。
- 本地草稿与磁盘变更冲突时暂停自动保存，由用户选择重新载入。
- 顶栏显示当前文件名和保存状态；文件名入口通过主进程打开系统原生面板，并在工作区内安全重命名，禁止覆盖已有文件。
- 文档切换会记录窗口内历史，前进与后退在切换前先完成当前草稿保存。
- 工作区侧栏可从同一文档集合派生文件树或最近修改列表，并从当前草稿实时提取 Markdown 标题大纲。
- 大纲项在即时预览编辑中滚动到对应标题，在源码模式中定位到对应 Markdown 行。

## 自动化保障

`markdown-document.test.ts` 覆盖 frontmatter 拆分、CRLF 规范化、空正文、常用格式和 GFM
表格的解析—序列化往返；`workspace-sidebar-model.test.ts` 覆盖侧栏排序、文件树和大纲提取。
新增 schema 扩展前必须先补相应的 Markdown 往返用例。

## 后续能力

- 图片附件、数学公式与代码高亮需要各自的 Markdown 往返测试后再加入 schema。
- 源码模式后续替换为 CodeMirror，并复用相同草稿与保存协议。
- 补充未知 HTML、嵌套列表及复杂表格的兼容性用例。
