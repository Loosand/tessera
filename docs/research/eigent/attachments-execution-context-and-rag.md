# 附件、Execution Context 与 RAG

> 研究对象：Eigent `d3089558c6e0021eed58270b49893835b02ec4e9`
>
> Tessera 对照：图片与当前 Markdown 上下文已实现；Resource Binding 与运行检查部分实现；通用附件和 RAG 未开始

## 1. 结论先行

Eigent 已把附件入口做得很完整：文件选择、拖放、剪贴板粘贴、Web 上传、用户消息回显和右侧 Execution Context
均有 UI。Workforce 收到附件后会直接把任务判为复杂任务，并把附件路径写入 CAMEL Task 的 `additional_info`，使规划
Agent 和 Worker 都知道有哪些材料。单 Agent 则把路径列表拼进 prompt。这个产品链让用户能够自然地说“参考这些文件
完成任务”。

但它还不是一条可靠的 Context Resource 链：

- 桌面附件是可变的本机绝对路径，不是冻结、带 hash 的运行资源；
- Web 上传返回的 `upload://` ID 在固定提交主运行链中没有被解析为真实路径，相关 `FileAccess` 抽象没有调用方；
- Worker 得到的是路径和文件名，不是经过类型识别、抽取、切片或安全标注的内容；
- 同名文件会在 `additional_info` 字典中发生键覆盖；
- 右侧 “Referenced Files” 展示的是用户附加过的文件，不是 Agent 实际读取过的文件；
- RAG Toolkit 与附件入口没有自动接通，且新 UI 明确隐藏了 RAG 配置/选择入口；
- RAG 返回纯字符串，缺少 chunk、score、页码、source span 等可核验引用。

Eigent 的 Execution Context 最值得学习的是产品位置和“只展示实际使用的 Skill/MCP”这一意图，而不是当前的
renderer 反推算法。Tessera 应统一设计 `ContextResource → RunResourceBinding → ResourceUsageEvent → Citation`，让
“已选择、已送入模型、已被工具读取、已用于回答、已生成引用”成为五个可区分的状态。

## 2. 研究范围与证据

关键源码：

- renderer 附件状态与发送：`Eigent: src/store/chatStore.ts`、`src/components/ChatBox/index.tsx`
- 文件选择、拖放和粘贴：`Eigent: src/components/ChatBox/BottomBox/InputBox.tsx`、`src/lib/fileUtils.ts`
- Electron 文件 IPC：`Eigent: electron/main/index.ts`
- Web 上传：`Eigent: backend/app/controller/file_controller.py`
- 文件访问抽象：`Eigent: backend/app/file_access/interface.py`、`local_file_access.py`、`upload_file_access.py`
- Chat 请求模型：`Eigent: backend/app/model/chat.py`
- Workforce 附件传播：`Eigent: backend/app/service/chat_service.py`、`backend/app/utils/workforce.py`
- Single Agent 附件 prompt：`Eigent: backend/app/service/single_agent_service.py`
- Execution Context：`Eigent: src/components/Session/SidePanelSections/ExecutionContextSection.tsx`
  与 `buildContextItems.ts`
- RAG Toolkit：`Eigent: backend/app/agent/toolkit/rag_toolkit.py`、`backend/app/agent/tools.py`
- RAG 配置可达性：`Eigent: src/components/AddWorker/ToolSelect.tsx`、
  `src/pages/Connectors/ConnectorGateway.tsx`
- 任务完成后的文件同步：`Eigent: src/store/chatStore.ts::collectTaskUploadFiles/uploadTaskFiles`

## 3. 附件的两条入口链

### 3.1 桌面端：路径引用

桌面端文件选择器允许 `*`，可多选，不限制文件类型。不同入口得到路径的方式略有不同：

| 入口 | 处理 | 结果 |
| --- | --- | --- |
| 文件选择器 | `dialog.showOpenDialog` | 原始绝对路径 |
| 拖放 | renderer 用 `webUtils.getPathForFile`，main 执行 `realpathSync` | 规范化绝对路径 |
| 粘贴文件/图片 | renderer 传 bytes，main 写入系统 temp 下 `eigent-pasted` | 临时绝对路径 |

这些路径以 `File { fileName, filePath }` 存在 task/chat store 中，发送时被投影成 `attaches: string[]`。Brain 不接收
稳定附件 ID、大小、media type、hash、来源或用户授权范围。

优点是本地 Agent 可以直接通过 terminal、截图或文档工具访问大文件，不需要先复制全部内容。缺点是这个引用没有
快照语义：

- 用户发送后修改文件，Agent 读取的是新内容；
- 用户移动或删除文件，后续 Worker 会失败；
- 路径暴露用户目录结构，并可能进入 prompt、日志、持久消息与远端同步；
- 文件选择不等于文件内容安全，压缩包、设备文件、命名管道或巨型文件没有统一 admission；
- 粘贴临时文件没有观察到与 Run 绑定的清理策略；
- 普通选择器没有 `realpath`，symlink 的真实目标不进入授权事实。

### 3.2 Web 端：`upload://` 引用

Web 端先把文件 POST 到 Brain `/files`，请求必须带 `X-Session-ID`。Brain 将内容一次性读入内存，然后写入：

```text
~/.eigent/workspace/<session-id>/uploads/<safe-name>_<timestamp>
```

返回值是 `upload://<stored-name>`。这一入口有：

- 每 session 最多 20 个顶层文件；
- 单文件最大 50 MiB；
- session ID 正则与 root containment 检查；
- 文件名字符替换。

它比桌面路径链更接近受管资源，但仍有明显缺口：

- 先 `await file.read()` 再检查大小，会在拒绝前占用完整内存；
- 不检查 declared/observed MIME、扩展名或恶意内容；
- 同名加毫秒时间戳，极端并发仍可能冲突；
- 限额只数目录项，不记录删除、生命周期和总字节配额；
- 文件 ID 只是文件名协议，不带用户、session、hash 或签名；
- `X-Session-ID` 是连接级 ID，不是 Project/Run 资源 ID。

### 3.3 Web 上传链在运行时未闭环

仓库定义了 `IFileAccess`、`LocalFileAccess` 和 `UploadFileAccess`。后者能够把 `upload://` 解析到 session uploads
目录，并做 workspace containment。然而固定提交中，除定义和 path-scope 测试外，没有找到运行主链对这些类或
`resolve_path` 的调用。

Chat Controller 没有把请求的 `X-Session-ID` 写进 `Chat` 或 RunContext；`attaches` 中的 `upload://` 值原样进入
Single Agent prompt 或 CAMEL `additional_info`。因此固定提交所展示的 Web 上传 API 与 Agent 文件访问之间缺少一段
解析桥。不能仅因为 UI 显示了文件，就判断 Web Agent 能读取它。

**Tessera 可借鉴的教训：** 上传完成不是上下文绑定完成。每个附件都要经过“持久化 → 扫描 → 解析 → 运行绑定 →
工具可读”的显式状态机。

## 4. 附件如何进入 Workforce

### 4.1 附件直接改变任务路由

Workforce 模式中，只要 `attaches_to_use` 非空，任务就被强制视为复杂任务，不再调用 question classifier。这是一种
简单有效的产品启发式：带文件的请求通常需要规划、读取、提取或生成 Artifact。

但“有附件”不必然等于“需要多 Agent”。例如“这张图是什么”或“总结这段文本”适合单 Agent。将附件作为复杂度
硬开关会增加延迟、成本和规划噪声。Tessera 更适合将附件类型、数量、体积和请求意图作为路由特征，而不是决定性
条件。

### 4.2 CAMEL `additional_info`

主 Task 创建时，Eigent 构造：

```text
additional_info = {
  basename(path): path,
  ...
}
```

该对象被插入任务分解 prompt，后续 Worker 的 `PROCESS_TASK_PROMPT` 也会收到它；多轮创建新 Task 时还会复制原
`additional_info`。因此附件目录能够贯穿规划和执行。

这条设计的优点是：

- Planner 能看到可用材料并安排 Document/Multi-Modal/Developer Worker；
- 每个子任务不必重复传完整文件正文；
- 大文件不直接吃掉首次模型上下文；
- Worker 可以按需选择工具读取。

局限也很具体：

1. 两个不同目录的 `report.pdf` 会发生字典键覆盖；
2. `Path(file_path).name` 对 `upload://` 只是字符串路径语义，并未完成解析；
3. 字典只有 display name 与 raw location，没有媒体类型、大小、hash 或提取状态；
4. 所有 Worker 都看到全部路径，没有最小可见范围；
5. 路径进入 Planner prompt，用户文件名也可能包含 prompt-like 文本；
6. 无资源读取事件，系统不能确认哪个 Worker 实际消费了哪个附件。

### 4.3 Single Agent 路径

Single Agent 不走复杂度判断，而是在每轮 prompt 前拼接：

```text
Attachments:
- /absolute/path/a.pdf
- upload://b.pdf_...

User task:
...
```

它同样只告诉模型“有这个位置”，不自动读取内容。是否成功取决于装配的 terminal/browser/document 工具及当前运行
环境。对桌面绝对路径，Agent 往往可以直接 `cat` 或调用相应工具；对 Web `upload://`，工具通常不认识该协议。

## 5. 附件不是多模态消息

Eigent 的 `Chat.attaches` 只有字符串路径，附件不会自动成为模型原生 image/audio/video part。多模态处理依赖 Worker
选择和工具调用：

- Screenshot Toolkit 可按路径读图；
- Audio Analysis Toolkit 接收音频文件；
- Video 工具下载或分析视频；
- Document Agent 用 MarkItDown、Office 工具或 terminal 读取文档；
- RAG Toolkit 可接受本地文件路径或 URL，但不会自动接收附件列表。

这一区分很重要。模型“支持图片输入”和 Agent“有一个读图工具”是不同能力；路径附件、原生消息 part、解析文本和
检索索引也应是不同 representation。Eigent 当前用一个 `attaches` 字段承载了用户心智，却把转换责任留给 Planner
与模型自由决策。

## 6. 附件 admission 与权限边界

### 6.1 桌面与 Web 约束不一致

| 约束 | 桌面 | Web |
| --- | --- | --- |
| 文件数量 | 未观察到硬上限 | 每 session 20 |
| 单文件大小 | 未观察到硬上限 | 50 MiB，但整文件先入内存 |
| 类型 | `*` | 任意 |
| 路径范围 | 任意用户可选路径 | uploads root |
| 内容扫描 | 无 | 无 |
| hash/去重 | 按 `filePath` UI 去重 | 按 file ID/UI 路径去重 |
| 生命周期 | 原文件或无清理 temp | session 目录，无 Run 级清理 |

桌面系统提示甚至同时写着“本地文件操作必须在 working directory”与“可以访问文件系统任何位置”，权限语义自相
矛盾。实际 terminal/file 工具能力比附件选择范围更宽，所以“用户只授权了这些附件”并不是系统可强制的边界。

### 6.2 附件内容是不可信数据

文件内容可能包含：

- 针对 Agent 的 prompt injection；
- 超大解压比归档、递归链接与压缩炸弹；
- 恶意 Office/PDF/HTML；
- 伪造扩展名和 MIME；
- 读取时触发网络访问的外部引用；
- 隐私、凭证、Cookie 或密钥；
- 用于污染长期 RAG/Memory 的恶意指令。

Eigent 当前没有统一的 Attachment Manifest 来记录探测结果和信任级别。Tessera 应在解析器层把内容包在明确的
untrusted-data 边界内，工具返回结构化文本与 provenance，不把原文无界地拼进 system prompt。

## 7. Execution Context 的真实数据来源

### 7.1 UI 分组

右侧 `ExecutionContextSection` 把条目分成：

1. Skills；
2. MCP Tools；
3. Referenced Files。

没有数据时显示“跟踪任务中使用的 Skills、MCP 与引用文件”。布局本身很优秀：它把能力和资料从对话日志中抽出，
让用户在进度旁持续看到本次运行的上下文边界。

### 7.2 Skill 的“实际使用”推导

renderer 遍历 `agent.tasks[].toolkits` 与 `taskRunning[].toolkits`。遇到 `SkillToolkit.load_skill` 时，它从工具事件的
字符串 message 中解析 JSON 或 Python repr 参数，提取真正的 Skill 名称；`list_skills` 不展示。

这是一个值得学习的产品原则：配置、枚举和实际加载是不同状态，Execution Context 应展示后者。

但实现依赖 renderer 解析日志字符串：

- 参数格式有 JSON 与 Python repr 两套；
- deactivate 时结果会拼到 message 后面；
- 后端可能截断到 500 字符；
- toolkit/method 命名改变会让 UI 静默漏项。

更稳妥的协议应由 runtime 发结构化 `resource.used` 事件。

### 7.3 MCP 的“实际使用”推导

普通 Toolkit 只有在运行事件中出现才可能展示。renderer 再用 worker 的 `mcp_tools`、`selectedTools` 和当前 skills
store 作为分类 hint，通过标准化名称和 `skill`/`mcp` 子串判断它属于 Skill 还是 Connector。

它比直接展示所有已配置 MCP 更真实，但仍不是可靠 identity：server name、toolkit class 和 tool name 的字符串可能
不一致；Gateway 聚合服务尤其难用名字猜回 provider/connection。分类 hint 还来自当前 store，而不是 Run Snapshot，
历史任务可能随设置变化被重新解释。

### 7.4 “Referenced Files”不是实际使用

文件来源完全不同：Single/Workforce Side Panel 收集该 task 所有用户消息的 `attaches`，再加当前 task pending
attachments，然后全部传给 `buildContextItems`。没有检查：

- Planner 是否把文件分配给子任务；
- Worker 是否打开、抽取或检索过文件；
- 文件读取是否成功；
- 回答是否引用了文件内容。

所以这里准确的标签应是 “Attached Files” 或 “Provided Files”，而不是以“used at runtime”为统一语义的
Execution Context。条目也没有设置 `onClick`，固定提交中只是文件名列表，不能从这里打开原附件。

### 7.5 当前 UI 是 renderer 投影，不是持久事实

Execution Context 没有独立后端对象或事件表；它从 chatStore 中的 toolkit 活动、worker 配置、Skill store 和 message
附件即时反推。这导致：

- 应用重启后取决于哪些事件和 store 被成功重放；
- 历史运行会受当前 Skill/MCP 名称与配置影响；
- 一个工具调用同时涉及 MCP、文件和身份时无法表达关系；
- 无法区分 selected/resolved/opened/retrieved/cited；
- 无法作为安全审计或成本归因来源。

## 8. Eigent 的 RAG Toolkit

### 8.1 三个工具

`RAGToolkit` 基于 CAMEL Retriever，向 Agent 暴露：

| 工具 | 输入 | 行为 |
| --- | --- | --- |
| `add_document` | raw text + metadata | embedding 后写入本地 Qdrant |
| `query_knowledge_base` | query/top_k/threshold | 查询此前写入的 raw text |
| `information_retrieval` | query + 文件/URL/字符串 | 由 CAMEL AutoRetriever 建索引并查询 |

默认存储在 `~/.eigent/rag_storage`，raw text 使用 `raw_text` 子目录；默认 collection 是 `default`，通过
`get_can_use_tools(api_task_id)` 时改成 `task_<api_task_id>`。

### 8.2 “task isolation”在当前调用链中并非 Run 隔离

类注释说 orchestration 应传入 task-specific collection。实际动态 Worker 创建时：

```text
new_agent_model
  → get_toolkits(..., api_task_id=options.project_id)
  → RAGToolkit.get_can_use_tools(options.project_id)
  → collection task_<project-id>
```

所以当前可达主链更接近 Project 级 collection，而不是 Task/Run 级隔离。跨项目名称由 project ID 区分，但 storage
root 是全局共享目录；没有用户/Space namespace，也没有看到运行结束清理。

Project 级知识库未必是坏事，但必须被明确建模。把它叫 task isolation 会让数据保留、删除和共享策略失真。

### 8.3 Embedding 与模型供应商脱节

raw text 路径默认要求环境变量 `OPENAI_API_KEY`，使用 `OpenAIEmbedding` 与固定 1536 维。它不读取本次 Chat 选择的
provider/model 配置，也不使用 Eigent 自身的模型能力目录来选择 embedding model。

结果是：

- 用户能正常使用其他供应商聊天，却在 RAG 工具首次调用时失败；
- Secret 走全局环境变量，而不是供应商连接和 Run Snapshot；
- embedding 模型升级或维度变化可能与现有 collection 不兼容；
- 无 embedding model/version/hash manifest，难以重建或迁移索引。

### 8.4 索引与文档生命周期

`add_document` 未提供 doc ID 时使用正文 MD5 前 12 位；把 `doc_id` 与 collection 写回 metadata，然后调用
`retriever.process`。没有观察到：

- 同 ID upsert/去重的明确语义；
- 文档更新与旧 chunk 删除；
- 删除文档/collection；
- chunker、embedding model 和 parser 版本；
- 文件内容 hash 到索引版本的映射；
- 失败恢复和 partial index 状态；
- Space/Project 删除时的级联清理。

传入的 metadata dict 还会被原地修改。MD5 截断在这里只用于 ID，并非直接安全问题，但不适合作为全局稳定内容
身份。

### 8.5 检索输出缺少引用结构

`query_knowledge_base` 把命中格式化为编号字符串，最多附上 metadata 的 source 或 doc_id；没有稳定返回：

- chunk ID；
- similarity score；
- 页码/段落/字符区间；
- 原始资源 ID 与版本；
- 可打开的引用位置；
- embedding/query 版本；
- 是否被最终回答采用。

异常也被转成 `Error retrieving...` 字符串返回给模型，从工具协议角度可能仍被当作一次成功调用。这样的 RAG 能帮助
模型找文本，却无法支撑 YouMind 类“证据可核验”的资料工作流。

### 8.6 文件与 URL Retrieval 的边界

`information_retrieval` 把 `contents` 直接交给 CAMEL RetrievalToolkit。Eigent wrapper 本身没有增加：

- 本地路径 allowlist；
- `upload://` 或 Artifact ID 解析；
- URL 的 SSRF、redirect 与响应体限制；
- 文件类型/大小/解压预算；
- 解析器 sandbox；
- prompt-injection 标记；
- 内容 license/provenance。

这些边界是否由特定 CAMEL 版本部分提供，需要另行审计依赖；不能由 Eigent wrapper 保证。

### 8.7 产品可达性很弱

RAG 仍存在于远端 Config 表，并能由 `get_toolkits` 装配给动态 Worker。但固定提交的新 Add Worker 选择器和 Connector
页面都把 `RAG` 放进隐藏/排除集合；四个内置 Worker 也没有默认装配 `RAGToolkit`。

因此它更像保留的工程能力，而不是当前 UI 中完整可配置的知识库产品。可能存在历史持久配置或手工构造请求能触发
它，但不能据此认为用户已拥有可管理的 RAG 功能。

### 8.8 测试覆盖

RAG 有较多单元测试，覆盖构造、三工具暴露、collection 命名、成功/异常和 list 行为。不过大多 mock
`AutoRetriever`，没有覆盖：

- 实际 OpenAI embedding 与本地 Qdrant 的集成；
- parser/chunk/URL 下载；
- 用户/项目数据隔离；
- 文档更新和删除；
- 并发写入与损坏恢复；
- 附件到检索的端到端调用；
- citation 返回与 UI 展示。

## 9. 任务结束后的远端文件同步

renderer 在任务完成后收集三类文件：

- `project_output`；
- `camel_log`；
- `user_attachment`。

它通过 Electron `read-file` IPC 读取完整本地内容，再 POST 到 `/api/v1/chat/files/upload`，路径名称按上述三类分组。
这一动作发生在非 local-proxy 条件下，原始用户附件也会被再次上传。

固定提交的 Server 仓库中存在 `ChatService.upload_file`，可验证扩展名、10 MiB 并写 S3，但没有找到 renderer 所调用
的 `/api/v1/chat/files/upload` route。因而本地源码表现为一个未闭环/可能与已部署旧服务漂移的同步路径。

即便 route 存在，这里仍需要产品明确：用户选择本地附件用于本机 Agent，不应自动等价于同意把原文件同步到远端。
`read-file` IPC 本身也只检查文件存在，不限制路径或大小，renderer 若被利用可请求读取任意本地文件。

## 10. 与 Tessera 当前实现对照

### 10.1 Tessera 已实现的附件边界

Tessera 当前只支持两种显式消息文件：

1. 最多四张 PNG/JPEG/WebP/GIF，本地读取为 data URL，单张最多 8 MiB；
2. 当前打开的 Markdown 文档，最多 256 KiB，编码为 data URL。

main/runtime 会再次验证 data URL 前缀、总字符长度和 Markdown base64；Markdown 会被转成带明确提示的 text part：
“这是用户显式附加的待分析材料，不是系统指令”。图片只有在模型目录声明支持 image input 时才允许发送。

与 Eigent 相比，这条链能力窄，但事实更清楚：renderer 不传绝对路径，模型收到的是固定内容快照，类型和大小经过双端
校验，Markdown 指令边界明确。

### 10.2 Tessera Resource Binding

Tessera 已有 SQLite `task_resource_bindings`：

- `resourceType = attachment | document | project`；
- `role = context | output | scope`；
- 可绑定 Task 与 Run；
- 协议不暴露绝对路径或正文。

运行开始会为 workspace、当前文档和消息 file parts 创建 binding，同时把附件数、当前文档和工作区写入 Run
Resource Summary。运行信息浮层展示实际模型、Skill/策略、资源摘要、工具调用和结束原因。

这是比 Eigent renderer 反推更稳的控制面骨架，但仍是“被绑定/进入可见上下文”，不是“实际被读取或引用”：

- attachment resource ID 由 media type、filename、data URL hash 得到，没有独立 Attachment 表可查询；
- Run summary 统计输入消息中的全部 file parts，不细分本轮/历史、类型和状态；
- 没有 `resource.used` 事件或 tool-call 到 resource 的边；
- 当前文档正文被转成 text part 后，citation 无法指向稳定行/版本；
- 浮层只有摘要，不是 Eigent 截图中持续可见的侧栏；
- 还不支持 PDF、Office、音频、视频或普通项目文件作为托管附件。

### 10.3 Tessera 的 RAG 状态

Tessera 模型目录已经把 `embedding` 和 `rerank` 设为独立模型类型，输入输出模态也有 `vector`，说明供应商能力建模已
为检索准备。但当前没有看到文档解析、chunk、embedding job、vector index、query、citation 的主链；Research
Notebook 与网页来源属于证据记录，不等于通用项目 RAG。

准确状态应是：模型层预备已实现，RAG 产品与数据面未开始。

## 11. Tessera 应建立的统一模型

### 11.1 五层对象

```text
ContextResource
  用户可理解的图片、文档、网页、项目文件、连接器对象
        │
        ▼
ResourceVersion
  固定 hash、大小、media type、来源、解析状态、信任标签
        │
        ▼
RunResourceBinding
  本 Run 可见的版本、角色、scope、权限、预算
        │
        ▼
ResourceUsageEvent
  resolved/opened/extracted/retrieved/quoted/written
        │
        ▼
Citation
  回答或 Artifact 到 resource version/chunk/span 的可打开引用
```

SQLite 保存对象、版本、索引状态与事件；原始内容和 Markdown/Artifact 仍遵守 Tessera 内容事实源原则。

### 11.2 状态不能混在一个 “Execution Context” 标签里

建议 UI 与协议明确区分：

| 状态 | 含义 | 例子 |
| --- | --- | --- |
| Attached | 用户选择，尚未解析 | 新添加 PDF |
| Available | 校验完成，本 Run 可以使用 | 已冻结 hash 的 PDF |
| Used | 模型或工具实际读取 | `read-resource` 打开第 2–5 页 |
| Retrieved | 检索命中 chunk | query 命中 3 段 |
| Cited | 最终输出引用 | 回答脚注指向第 4 页 |
| Produced | Agent 新建/修改 | 生成报告.md |

Eigent 的 Skill/MCP 设计意图接近 Used，但文件只达到 Attached。Tessera 可以在侧栏中用状态和时间逐步升级，而不是
让同一行产生过强暗示。

### 11.3 Attachment Manifest

通用附件至少记录：

```text
AttachmentVersion
├── id / contentHash
├── displayName / declaredMediaType / detectedMediaType
├── byteSize
├── source = picker | drop | paste | project | connector | browser-download
├── storageRef（renderer 不可解析）
├── createdAt / expiresAt?
├── safetyStatus / parserStatus
├── parserName / parserVersion
└── parentResourceId / version
```

文件发送后必须冻结版本；如果用户想引用“始终最新的工作区文件”，应使用另一种 live project binding，并在每次工具
读取时记录 observed hash，不能把两种语义混为一谈。

## 12. 通用附件实施建议

### 阶段 1：扩展受管附件，而不是开放路径

- 保持 renderer 不传本机绝对路径；
- main 通过选择器接收用户授权文件，复制/流式导入 Tessera attachment staging；
- 增加总数、单文件、单 Run 总字节和解压预算；
- magic bytes + extension + declared MIME 三方校验；
- 拒绝 symlink、目录、device、FIFO 等特殊对象；
- 计算 SHA-256，写 AttachmentVersion 和 Run binding；
- 原文件在发送后变化不影响本 Run。

验收：运行重放能读取同一字节版本；renderer、模型消息和日志中均无绝对路径。

### 阶段 2：解析器与 Resource Reader

- 首批支持 Markdown/TXT/PDF；Office 后置；
- parser 在受限进程或沙箱运行，有 CPU、内存、页数、输出字符预算；
- 原始文件、抽取文本和结构树分离；
- 统一 `read-resource` 工具按页/段/chunk 读取；
- 工具输出标注 untrusted content 与 provenance；
- 每次读取生成结构化 ResourceUsageEvent。

验收：Execution Context 能区分附件已准备和被哪个 Tool Call 实际读取。

### 阶段 3：检索索引

- 只对明确选择的 Project/Space Resource 建索引；
- embedding provider/model/version/dimension 进入 Index Manifest；
- chunker/parser 版本和 ResourceVersion hash 决定幂等重建；
- SQLite 保存 index job/control state，向量存储可重建；
- 支持更新、删除、失败恢复和空间级清理；
- query 返回结构化 hit，而不是已格式化字符串。

验收：修改文档只重建受影响版本；删除 Resource 后 query 不再返回旧 chunk。

### 阶段 4：Citation 与侧栏

- 最终回答以 source-document/source-url 等 typed part 引用；
- Citation 指向 version + page/heading/span；
- 侧栏按 Attached/Used/Cited 展示；
- 点击可打开对应文档位置；
- 检索命中不自动等于最终引用；
- 同一 Resource 在多个 Tool Call 中使用时聚合，但可展开事件。

验收：用户可从回答脚注和 Execution Context 到达相同的固定证据版本。

## 13. RAG 架构建议

### 13.1 不把 RAG 当成普通 Agent Toolkit

Eigent 把 add/query/index 全暴露给模型，模型自行决定何时建库、collection 名义由外层隐式决定。这适合原型，不适合
长期项目知识库。Tessera 应把 ingest/index 作为受控后台作业，把 query 作为运行工具：

```text
Resource change
  → parser job
  → chunk manifest
  → embedding job
  → vector index

Agent query
  → scope filter
  → retrieve
  → optional rerank
  → typed hits
  → model synthesis
  → citations
```

模型不能随意把任意 raw text 写进长期知识库；需要显式 Project/Space scope 和用户可见来源。

### 13.2 Embedding 选择

利用 Tessera 现有模型目录，Index Definition 应冻结：

- provider connection ID；
- embedding model ID 与维度；
- endpoint type；
- batch/token 限制；
- parser/chunker version；
- distance metric；
- reranker model（可选）；
- privacy/remote processing policy。

更换 embedding model 应创建新 index generation，再原子切换，不在旧 collection 上混写不同向量空间。

### 13.3 检索结果协议

```text
RetrievalHit
├── hitId / queryId
├── resourceId / resourceVersionId / chunkId
├── score / rerankScore?
├── text
├── locator { page?, heading?, start?, end? }
├── sourceTitle / mediaType
└── trust / parser metadata
```

工具层可对模型隐藏不必要路径，但 UI 能用 stable ID 打开证据。最终模型选择引用哪些 hit 时再产生 Citation。

## 14. 建议学习与明确不照搬

### 建议学习

1. 文件选择、拖放、粘贴入口统一到同一附件列表。
2. Planner 与 Worker 只看到附件目录，正文按需读取，避免首次上下文爆炸。
3. 附件作为任务路由信号，但改为软特征。
4. Execution Context 与 Progress、Agent Folder 并列，持续可见。
5. Skill 只有 `load_skill` 后才进入 Execution Context。
6. MCP 只有实际工具活动后才进入 Execution Context。
7. Project 级知识库作为明确产品 scope，而非每个对话临时建库。

### 明确不照搬

1. 不把本机绝对路径当附件 ID。
2. 不让用户发送后文件内容继续漂移。
3. 不用 basename 作为附件字典 key。
4. 不把所有附件自动强制路由为 Workforce。
5. 不把“附加过”标成“实际使用过”。
6. 不在 renderer 解析工具日志字符串来恢复领域事实。
7. 不让 Web `upload://` 在无 Run 绑定和解析调用方时进入 Agent。
8. 不把任意 URL/文件路径直接交给 RAG 依赖而缺少网络和文件 admission。
9. 不把 embedding Secret 固定为全局 `OPENAI_API_KEY`。
10. 不让不同 embedding model/维度写入无版本 collection。
11. 不用错误字符串冒充成功工具结果。
12. 不在用户只选择本地执行后自动把原附件同步到远端。

## 15. 最终判断

Eigent 已经验证了 Manus/YouMind 类 Agent 中附件与右侧上下文侧栏的产品价值：用户不应只在最初消息气泡里看到文件，
而应在整个运行期间知道 Agent 可用哪些资料、实际调用了哪些扩展。它的 `additional_info` 也证明“目录先行、按需读取”
比把整份文档塞进首轮 prompt 更适合 Workforce。

但固定提交的文件链仍以 raw path 和 renderer store 为核心，Web upload 解析、实际文件使用事件、RAG ingest、citation 与
远端同步都没有形成一致协议。Tessera 当前能力较窄，却已经具备内容快照、双端校验、Resource Binding、Run
Inspection 与独立模型能力目录。下一步应扩展这套受管资源设计，而不是退回“把路径发给模型”。

最终目标不是做一个“支持更多格式的附件按钮”，而是让任意材料从用户选择开始，到固定版本、解析、读取、检索、
引用和产物，都能在同一个 Run 审查面中被解释和追溯。
