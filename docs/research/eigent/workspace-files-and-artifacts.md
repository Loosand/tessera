# Eigent 工作区、文件与 Artifact

> Eigent 证据：`server/app/model/space/space.py`、`server/app/model/space/apply.py`、
> `server/app/model/space/file_index.py`、`server/app/domains/space/service/space_service.py`、
> `server/app/domains/space/service/folder_binding.py`、`server/app/domains/space/service/overlay_service.py`、
> `server/app/domains/space/service/apply_service.py`、`server/app/domains/space/service/file_ops_guard.py`、
> `backend/app/utils/workspace_paths.py`、`backend/app/utils/workspace_resolver.py`、
> `backend/app/utils/space_overlay_client.py`、`backend/app/utils/file_utils.py`、
> `backend/app/controller/workspace_controller.py`、`backend/app/controller/chat_controller.py`、
> `backend/app/run_context/context.py`、`src/store/spaceStore.ts`、`src/service/spaceApi.ts`、
> `src/components/Workspace/index.tsx`、`src/components/Workspace/WorkspaceProjectPicker.tsx`、
> `src/components/Session/SidePanelSections/AgentFolderSection.tsx`、
> `backend/tests/app/utils/test_workspace_resolver_direct_write.py`、
> `server/tests/test_space_default_workdir_mode.py`、`server/tests/test_space_write_lock.py`
>
> Tessera 对照：`apps/desktop/src/main/read-only-agent-tools.ts`、
> `apps/desktop/src/main/agent-change-service.ts`、`apps/desktop/src/main/content-library-service.ts`、
> `apps/desktop/src/main/index.ts`、`packages/ai/src/server/agent-runtime.ts`、
> `packages/database/workspace-repository.ts`、`packages/database/agent-change-repository.ts`、
> `packages/database/content-domain-repository.ts`、`packages/database/schema.ts`、
> `docs/architecture/database.md`、`docs/architecture/unified-creation-agent.md`、
> `docs/architecture/local-version-history-and-git-workspaces.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Eigent 的工作区体系不是“给 Agent 一个文件夹”这么简单。它试图同时解决四件事：

1. 用 Space 表达长期文件容器，用 Project 表达持续任务，用 Run 表达一次执行；
2. 在 Electron、远端 Server 和本地 Brain 之间同步逻辑 Space 与真实本地目录的绑定；
3. 为不同风险提供 `artifact-only`、`direct-write`、`copy`、`worktree` 四种工作目录模式；
4. 在隔离副本模式中，将 Agent 写入记录为 run-scoped overlay，再由用户 Apply 回源目录。

最值得 Tessera 学习的是**冻结工作目录快照**和**基于 base hash 的 Apply 协议**：每次 Run 固定
`working_directory`、`task_output_root`、`workdir_mode`、`base_snapshot_id`，Apply 时重新读取真实磁盘，发现基线变化就
返回结构化 conflict；真正写入通过同目录临时文件、`fsync`、hash 复核和原子替换完成。这个机制比“执行结束后扫目录
猜哪些文件改了”可靠，也天然适合做审查 UI。

但 Eigent 当前默认产品路径与这套设计存在冲突：folder-backed Space 新建 Project 默认 `direct-write`，Agent 直接把用户
目录作为 working directory；overlay 记录明确跳过 `direct-write`，因此 Apply、base hash、冲突处理和 pending-changes UI
都不会介入默认本地任务。源码测试甚至说明这是为修复 copy 模式下“输出没有出现在用户文件夹”而做的默认切换。
换句话说，它用降低隔离性换取了“文件马上可见”，而不是把 copy→review→apply 的体验闭环做好。

Tessera 目前在 Markdown 写入安全上更扎实：模型只有受限的列表/读取工具和 `write-workspace-document` 领域工具；修改必须
携带读取时的 mtime 与 SHA-256，候选内容冻结到 SQLite，AI SDK 标准审批完成后再次复核，最后才原子写入并记录 applied /
conflict / failed。Tessera 也已经有 Workspace、Document、Artifact、Resource Binding 和 Operation 控制对象。当前缺口不在
“再造一套 Space 表”，而是：一次 Run 的文件作用域快照、非 Markdown Artifact、统一产物托盘、批量变更审查、外部目录
变更的版本历史，以及让 Agent 在不直写源目录的前提下仍能即时预览结果。

## 1. Eigent 的对象层级

| 对象 | 生命周期 | 文件意义 | 控制事实位置 |
| --- | --- | --- | --- |
| Space | 长期 | folder Space 对应一个本地根目录；blank Space 可由 Brain 创建 scratch root | Server `Space` + Brain binding mirror |
| Project | 多个 Run | 在 Space 中承载 mode、workdir mode、base snapshot 和 UI 会话 | Server `Project` + renderer stores |
| Run / Task | 一次执行 | 冻结工作目录、输出目录、基线和本次 overlay | Brain `TaskSnapshot` / `RunContext` + Server overlays |
| Working directory | Project/Run 使用 | Agent 工具实际读取和修改的根 | Brain 解析并冻结 |
| Task output root | Run 独立 | 日志、导出物或 artifact-only 输出 | `~/.eigent/.../runs/{run_id}` |
| Overlay | Run + relative path | 隔离 workdir 相对基线的待应用变更 | Server `SpaceFileIndexOverlay` |
| File index | Space + path | 源目录文件 hash/size/mode 的惰性缓存 | Server `SpaceFileIndex` |
| Agent Folder item | UI 投影 | 运行中发现的创建/修改文件 | renderer `FileInfo[]`，不是独立 Artifact 领域对象 |

这里最重要的边界是：Space 是用户长期拥有的容器，Project 是协作上下文，Run 才是一次写入事务。一个文件属于 Space，
但“这个 Run 创建或修改了它”应当是独立关系。Eigent 的 overlay 接近这个关系，Agent Folder 却仍是 `FileInfo[]` 的运行时
投影，没有稳定 Artifact ID、来源工具、审批状态、版本或跨移动身份。

## 2. 逻辑 Space 与本地目录绑定

### 2.1 Server 只保存引用

远端 Server 的 folder binding 刻意分成两层：

- `normalize_folder_root_reference()` 只规范字符串，不对远端路径执行 `stat` 或 `resolve`；
- `resolve_folder_root()` 只有在 `SPACE_LOCAL_FILE_OPERATIONS_ENABLED` 开启时才访问文件系统；
- feature flag 默认关闭，防止云端 Server 假设 Brain 所在机器的路径命名空间与自己相同；
- folder fingerprint 包含 path、device、inode、mtime_ns、ctime_ns，用于识别移动、重建或错误重绑。

这是合理的分布式边界：Server 可以拥有 Space 的逻辑身份和项目关系，却不能因为数据库里有 `/Users/...` 就获得文件访问
能力。当前 Apply 仍要求 Server 与 Brain 位于同一文件系统，这是后述 overlay source reference 的限制，而不是这层建模的
目标状态。

### 2.2 Brain 保存绑定镜像

Brain 在 `~/.eigent/workspaces/{owner}/` 保存 Space binding 和 Task snapshot JSON。owner 优先使用稳定 user ID，没有时退回
清理后的 email local-part，并带旧 email 路径迁移兼容。写入使用同目录临时文件后 replace。

`WorkspaceBinding` 主要字段是：

```text
space_id
workspace_root
root_fingerprint
source = space_local_brain
created_at / updated_at
version = 2
```

绑定只在 capability manifest 声明 local deployment 时启用。实际路径由 Brain 校验存在且为目录；同一个 Space 不能静默
重绑到另一个目录，同一个目录也不能同时绑定给另一个 Space。blank Space 则由 Brain 在自己的 scratch 根创建目录，再形成
同样的 binding。

这一镜像解决了“远端逻辑对象如何落到当前桌面机器”，但当前接口仍有明确 TODO：workspace bind/reconcile/refresh 会信任请求
payload 中的 email/user ID，本地 Brain 的真实认证尚未完成。绑定是文件权限事实，不能长期依赖 renderer 提供身份。

### 2.3 Tessera 对照

Tessera 当前 Workspace 根由 Electron 主进程通过系统目录选择器授权，renderer 只经窄 IPC 获得 `WorkspaceInfo`；根目录记录
在 SQLite，真实文件操作继续留在主进程。这个单机桌面边界比 Eigent 的 Server+Brain 双绑定简单，也不需要复制其镜像协议。

如果未来支持远程执行节点，才需要引入：

- `WorkspaceRef`：逻辑 ID，不带模型可见绝对路径；
- `WorkspaceMount`：某个 execution node 对该 Workspace 的本地挂载；
- `mountFingerprint`：设备/inode 或远端卷版本；
- `capabilityLease`：一次 Run 可使用的 mount、操作范围和有效期。

不要提前把本地绝对路径同步到云端控制面。

## 3. 一次 Run 如何冻结目录

聊天开始时，`chat_controller.start_chat_stream()` 在装配 Agent、启动浏览器和进入 SSE 循环之前执行：

```text
Chat request
  -> WorkspaceResolver.freeze_task_directories()
  -> TaskSnapshot 落盘（best effort）
  -> RunContext(working_directory, task_output_root, mode, baseSnapshotId)
  -> TaskLock.run_context
  -> Agent / Toolkit factories 调用 get_working_directory()
```

`TaskSnapshot` 固定：

- `task_id` / `project_id` / `space_id` / `user_id`；
- `working_directory`；
- `task_output_root`；
- `task_start_time`；
- binding source；
- `workdir_mode`；
- `base_snapshot_id`。

快照同时放进 `TaskLock` 和本地 JSON。后续 `get_working_directory()` 优先取 follow-up 临时路径，其次 TaskLock，随后当前
`RunContext`，最后才读环境变量/旧 `file_save_path`。这防止运行中 UI 切换 Project 或 Space 时，既有工具突然写向新目录。

这是 Eigent 工作区设计中最应该直接吸收的部分。Tessera 已冻结模型、端点、联网、工具范围和资源摘要到 `task_runs`，但工作区
工具目前由主进程开始运行时闭包捕获当前 `workspace.rootPath`，尚未把规范化 root identity、document baselines、可写路径集合和
mount fingerprint 作为统一 `RunResourceSnapshot` 持久化。闭包能保证当前进程内不漂移，却不足以解释跨重启历史和远程执行。

## 4. 四种 workdir mode

| 模式 | Agent working directory | 输出位置 | Overlay/Apply | 适用意图 |
| --- | --- | --- | --- | --- |
| `artifact-only` | Run task output root | 独立 run 目录 | 不记录 | 空白/远端 Space，只产生新产物 |
| `direct-write` | 用户 Space 根 | 用户目录立即变化 | 明确跳过 | 追求立即可见，风险最高 |
| `copy` | Project workdir 副本 | 副本内修改 + 独立 output root | 记录 | 基于源目录快照隔离运行 |
| `worktree` | 当前实现仍走通用副本分支 | 同上 | 记录 | 名称暗示 Git worktree，实际未见专用 Git 创建链 |

### 4.1 默认值决定真实安全性

Server `SpaceService._default_project_workdir_mode()` 对 folder Space 返回 `direct-write`，非 folder 返回 `artifact-only`；renderer
从 Workspace 直接新建本地 Project 时也显式发送 `direct-write`。Brain 对有 binding 但无 mode 的旧任务同样回落
`direct-write`。两个回归测试锁定了这一行为。

因此不能只看系统“支持 copy/overlay/apply”就判断默认写入安全。能力存在与默认路径采用是两回事。

### 4.2 `copy` 的基线并不等于完整快照

`_copy_space_baseline()` 在 Space 根目录上获取 advisory filesystem lock，然后复制到 Project workdir：

- 忽略 `.git`、其他 VCS、`node_modules`、虚拟环境、`dist`、`build`、`.next`、cache 等目录；
- 不跟随 symlink；
- 跳过大于 25 MiB 的文件；
- 在 workdir 写 `.eigent-workdir.json`，包含 `base_snapshot_id`、source root、ignore 清单和大小上限；
- marker 已存在时复用原 base snapshot，不自动刷新副本。

这是一份“供 Agent 使用的有损工作副本”，不是可重建所有源文件的快照。被忽略或过大的文件在副本里不存在，Agent 可能误判
项目结构；symlink 语义也被删除。Apply 只处理实际记录的 overlay，不会恢复这些缺失内容，所以安全上可接受，语义上却必须在
Execution Context 告诉用户“本轮看到的是过滤副本”。

### 4.3 `worktree` 名称漂移

数据模型和 UI 接受 `worktree`，但 `WorkspaceResolver` 只特判 `artifact-only` 与 `direct-write`，其余值统一执行普通复制；源码中
没有在这条链路调用 `git worktree add`。因此固定提交中的 `worktree` 更像规划中的模式名，不能按 Git 隔离能力对外承诺。

## 5. working directory 与 output root 的分裂

在 copy/worktree 模式中：

- Agent factory 和大部分 toolkits 通过 `get_working_directory()` 得到 Project workdir；
- `RunContext.as_env()` 却把 `file_save_path` 和 `CAMEL_WORKDIR` 设置为 `task_output_root`；
- 部分第三方 CAMEL 工具读取显式 factory 参数，另一些旧工具可能读取环境变量。

这意味着同一 Run 中“写到哪里”取决于工具读取哪条配置路径。代码试图以 RunContext 统一环境，但 `CAMEL_WORKDIR` 指向 output
root 而 `RunContext.working_directory` 指向副本，语义不一致。最终 Agent Folder 需要扫描多个 working directory 和输出目录，
正是这种历史分裂的 UI 补偿。

Tessera 应当为每个工具明确声明资源端口，而不是提供含混的全局 cwd：

```ts
type RunFileScope = {
  readonlyRoots: WorkspaceMount[]
  stagingRoot: OpaqueDirectoryHandle
  artifactRoot: OpaqueDirectoryHandle
  writableDocuments: DocumentBaseline[]
}
```

模型只看稳定资源名和相对路径；工具实现通过受信任 context 获得句柄。Shell、MCP 和内置文档工具不能通过共享环境变量各自解释
根目录。

## 6. Overlay 如何生成

隔离 workdir 中的 writer 在改动前后计算 hash，并调用 Brain 的 `post_overlay_write()`。它只在以下条件全部满足时同步：

- RunContext 有 Server URL 和 auth header；
- mode 不是 `direct-write` / `artifact-only`；
- working directory 与 task output root 不相同；
- 目标在 working directory 内、且不位于 task output root 下。

路径先转为 POSIX relative path，拒绝绝对路径和 `..`。写入 payload 包含：

```text
run_id, path, status
hash, base_hash, base_snapshot_id
size, mode
source_path, source_root
metadata
```

同一 Run/path 使用进程内弱引用 lock 串行写。Server 以 Space/Project/Run/path 唯一键 upsert，并通过状态机折叠连续变更，例如新增后
再修改仍为 added，新增后删除可消除或转换相应状态。

一个重要可用性取舍是：overlay 同步失败只记录诊断计数和日志，不让实际工具写入失败。这样 Agent 不会因控制面短暂故障丢掉工作，
但 UI 可能不知道某些文件已经变化。没有结束时的目录 diff 对账，失败 overlay 也不会自动补传。因此 overlay 不能仅靠 best-effort
旁路事件；Run 结束前至少需要一次 authoritative reconcile。

## 7. Apply 是怎样的文件事务

### 7.1 并发锁

Apply 同时获取三层锁：

1. 当前进程按 `space_id` 的 thread lock；
2. PostgreSQL 环境中的 connection-scoped advisory lock；
3. Space 根目录文件描述符上的 `flock`，与 Brain 复制基线协调。

这比单独依赖数据库 transaction 更准确，因为最终竞争对象是真实文件系统。SQLite/非 Postgres 部署没有跨 Server 进程 advisory
lock；Windows 没有 `fcntl` 时 filesystem lock 也退化为空，因此跨平台保证并不等价。

### 7.2 Apply 前先整体检查 conflict

服务加载指定 Run 的所有 overlay，可选限定 paths。对于每一行：

1. 在 Space root 下安全解析目标；
2. 读取目标当前 SHA-256，文件不存在用 `null`，与空文件区分；
3. 比较 `current_hash` 与 overlay 的 `base_hash`；
4. 若变化且没有明确 resolution，则把整次响应标记 conflict，**尚不写任何路径**。

resolution 支持：

- `apply_mine`：覆盖为本 Run 结果；
- `keep_theirs`：保留当前源目录内容，更新 index 并删除 overlay；
- `write_chosen`：使用用户选择的另一 content ref 与 hash。

这是一套合格的 optimistic concurrency control。`base_snapshot_id` 被记录，却没有参与 conflict 判定；真正可靠的是逐文件 base hash。

### 7.3 单路径原子落盘

非删除变更：

1. 从 overlay metadata 取 source path/source root；
2. 验证 source 位于 source root 下、不是 symlink、且为普通文件；
3. 复制到目标同目录随机临时文件；
4. 恢复 mode，fsync 临时文件；
5. 计算 staged hash，与 overlay/resolution expected hash 比较；
6. `os.replace()` 原子换入；
7. fsync parent directory，失败作为 durability warning 返回；
8. 更新惰性 file index，删除 overlay，逐路径 commit。

删除只允许普通文件，不递归删目录。单个路径失败保留 overlay 供重试，其余路径可以继续，因此执行结果可能是 `partial`。整体 conflict
检查是 all-or-none，真正 Apply 则是 per-path commit，不是全 Run filesystem transaction。UI 必须准确呈现这一差异。

### 7.4 当前同机 bridge 不能用于云 Brain

overlay metadata 保存绝对 `source_path` 和 `source_root`，Server Apply 直接读取这个路径。源码注释明确说这是 same-filesystem bridge，
未来 cloud Brain 需要 opaque handle 或 Server 可读取的 content reference。当前设计一旦 Brain 跑在另一台机器，Apply 就找不到源文件；
更严重的是不应把执行节点绝对路径当成长期 API。

正确的远程模型应当是 content-addressed staged blob：

```text
overlay -> contentRef(blob hash / signed object handle)
apply service -> fetch + hash verify -> local atomic replace
```

contentRef 必须带 owner、Run、过期时间和只读权限，不能退化成任意服务器路径。

## 8. Discard 与 Refresh 的实际语义

`discard_overlays()` 只删除 Server 数据库中的 pending overlay 行，**不会删除或回滚 Brain workdir 中已经修改的文件**。随后如果继续在同一
workdir 运行，文件依然是 Agent 修改后的版本，但 UI 已不再显示 pending changes。只有 refresh 才会删除 Project workdir 并从 Space root
重新复制基线。

refresh 采用两段调用：

1. renderer 先请求 Server，Server 检查 pending overlay；没有或 force 时更新 Project metadata 中的 base snapshot ID；
2. renderer 再请求 Brain 删除并重建 workdir；Brain 只检查 renderer 传来的 `server_refresh_confirmed` boolean。

源码已经留下 TODO：应改成 Server 签名的短期 refresh token。现在 renderer 可以伪造 boolean，Brain 又会执行 `shutil.rmtree(workdir)`，
身份与授权边界不够强。并且若第二段失败，Server metadata 已前进而实际 workdir 没刷新，形成状态漂移。

因此 Tessera 不应照搬两阶段客户端编排。Staging discard 应由主进程/执行节点事务服务一次完成：删除 staged content、撤销 pending proposal、
记录 operation；Refresh 也应由同一可信服务先拿锁、核对无运行/无提案，再重建并提交新的 snapshot。

## 9. UI 如何暴露工作区状态

### 9.1 Workspace Project Picker

Project 菜单在非 direct-write、Server-backed 项目中加载 overlays，并按 Run 分组顺序 Apply。UI 展示：

- pending overlay 数量；
- Apply 当前 Run/总 Run 进度；
- discard confirm；
- refresh；
- conflict/partial 的路径摘要，最多显示八条，其余折叠为数量。

当前 UI 没有逐文件 diff、mine/theirs 对比或 resolution 编辑器；后端已有 `force_resolutions`，renderer 主路径却只用默认 Apply，因此冲突后主要是
消息提示而不是可完成的审查工作流。它具备状态入口，却没有把后端协议全部产品化。

### 9.2 Agent Folder

右侧 `AgentFolderSection`：

- 对文件去重并过滤内部文件；
- 按扩展名选择图片、视频、音频、压缩包、表格、代码、文档图标；
- 文件出现/消失有轻量 Motion 动画；
- 点击跳到 Folder tab 并打开文件；
- 空态直接解释“Agent 在本任务写入或更新的文件会出现在这里”。

这部分信息架构非常好：用户不必从工具日志里寻找交付物。但底层列表只是 `FileInfo`，没有 create/modify/delete 状态、来源 Agent/工具、Run、审批、
hash、是否已 Apply、是否与源目录冲突，也无法跨 rename 保持身份。它是 Artifact tray 的视觉原型，而不是完整 Artifact domain。

Tessera 已有稳定 Artifact、Document 和 Run 关系，应该直接投影这些控制事实，而不是复制 Eigent 的文件扫描列表。

## 10. 文件发现与路径边界

Eigent 的通用 `list_files()` 有一些值得保留的防护：

- 路径以 `realpath` 解析并确认仍在 base 下，避免简单字符串前缀绕过；
- 默认不 follow directory symlink；文件 symlink 若真实目标仍在 base 内才纳入；
- 忽略隐藏项、常见构建目录和二进制扩展；
- 默认最多 10,000 条；
- 收集扫描耗时、realpath 耗时和 symlink 数量用于诊断。

但 Agent Folder 的来源包含“从任务时间之后扫描工作目录”的启发式路径。mtime 不能可靠表示由哪个 Run 创建：复制基线、外部编辑、工具保留时间戳、
时钟差异都会造成误判。overlay 或领域工具事件应是主来源，结束时目录 diff 只做修复性 reconcile。

Tessera 的只读 Agent 工具当前只允许 Markdown，限制 256 KiB，拒绝路径逃逸、绝对路径和扩大作用域的 symlink；这适合写作产品现阶段，不应为了模仿
通用电脑 Agent 立即放开任意文件。图片、PDF、表格等应作为类型化 Resource/Artifact，通过专门 extractor/preview 工具读取，而不是把任意二进制暴露给模型。

## 11. Tessera 当前能力对照

| 能力 | Eigent | Tessera 当前状态 | 判断 |
| --- | --- | --- | --- |
| 长期 Workspace/Project | Space + Project | Workspace + 内容库 Project 已实现 | 不新增同义对象 |
| Run 工作目录冻结 | `TaskSnapshot` + `RunContext` | 闭包捕获 root，run 有资源摘要/绑定 | 部分实现，需统一 snapshot |
| 多 workdir mode | 四种枚举，默认 direct-write | 只读根 + 审批后直接原子写 Markdown | 产品更简单，但无 staging 模式 |
| 路径防逃逸 | realpath/base/symlink 校验 | 主进程严格相对路径与 symlink 校验 | 已实现且边界更窄 |
| 候选冻结 | overlay 指向 workdir 文件 | SQLite 冻结 base+candidate 正文/hash | Tessera 对单 Markdown 更可靠 |
| 人工审批 | pending changes 菜单，默认路径绕过 | AI SDK approval + proposal 对账 | Tessera 已实现主链路 |
| 冲突检测 | Apply 比逐文件 base hash | mtime + base content hash，两次复核 | 都正确；Tessera 多一层候选身份核对 |
| 原子落盘 | tmp+fsync+hash+replace+dir fsync | tmp+rename，候选 hash 已冻结 | Tessera 尚缺显式 fsync/落盘 hash 复核 |
| 批量变更 | Run overlays + partial apply | 当前以单文档 tool call 为单位 | 未形成 ChangeSet |
| Artifact 身份 | UI FileInfo，overlay path | SQLite stable Artifact/Document ID | Tessera 数据模型更成熟 |
| 产物托盘 | 右侧 Agent Folder | task artifact tray 已有内容域入口 | 部分实现，需统一运行投影 |
| 外部修改 | Apply 前 hash | mtime/hash + watcher/index | 已实现单文档冲突，缺批量 reconcile |
| 版本历史 | 无统一历史，overlay 应用后删除 | 架构文档规划本地版本/Git | 规划 |

## 12. Tessera 应吸收的设计

### 12.1 `RunResourceSnapshot`

每次运行在模型调用前持久化不可变快照：

```text
runId
workspaceMounts[{ workspaceId, fingerprint, role, readonly }]
documents[{ documentId, relativePath, contentHash, modifiedAt, role }]
attachments[{ resourceId, contentHash, mediaType, role }]
artifactRootRef
stagingRootRef?
writePolicy
```

现有 `task_resource_bindings` 和 `resource_summary_json` 可以演进承载稳定关系；敏感绝对路径只留在主进程运行对象，不写进模型消息和云端事件。

### 12.2 从 Proposal 演进到 ChangeSet，而不是替换 Proposal

保留当前 `agent_change_proposals` 的严格单工具审批语义，在其上增加 run-scoped ChangeSet 聚合：

- 多个 create/update/move 作为独立 item；
- 每项都有 stable document/artifact ID、base version、candidate hash、状态；
- UI 可逐项批准/拒绝，也可对低风险新建批量批准；
- Apply 前统一预检所有 conflict；
- 写入仍逐项原子并明确 partial；
- 结束后 Operation 和 Artifact 关系不随 staging 清理而消失。

不要让“批准 Run”绕过 AI SDK 每个高风险 tool call 的标准审批。ChangeSet 是产品聚合和审查投影，不是第二套授权状态机。

### 12.3 产物即时预览用 staging，不用默认 direct-write

Agent 新建非覆盖产物时可写入主进程托管 staging/artifact root，renderer 立即预览；用户选择“保存到项目”时再经过领域操作落到 Workspace。对明确要求在项目中新建 Markdown，目的授权可直接 create-new，但必须保证 `O_EXCL`/不覆盖并记录 Artifact。

更新已有正文继续使用当前 frozen candidate + Diff + approval，不能为追求 Agent Folder “即时出现”而开放 direct-write。

### 12.4 右侧 Artifact tray 需要展示的状态

每个条目至少显示：

- 名称、类型、预览；
- `created` / `modified` / `moved` / `deleted`；
- 产生它的 Run 与 Agent/工具；
- `staged` / `approval-required` / `approved` / `applied` / `conflict` / `failed`；
- 当前目标 Workspace/Project；
- 打开、查看 Diff、保存到项目、放弃、重试。

Progress 只说明目标完成度；Artifact tray 说明用户资产变化；工具活动说明过程。三者不要合并成一个难以审计的时间线。

## 13. 不应照搬的部分

1. **不采用 folder Space 默认 direct-write**：它使最有价值的 overlay/review 协议在默认路径失效。
2. **不把 `worktree` 当标签承诺**：只有真正创建、校验和清理 Git worktree 后才对外提供此模式。
3. **不在 renderer 编排破坏性两阶段 refresh**：由主进程领域服务持有授权和事务。
4. **不把绝对 source path 作为跨节点 content ref**：使用受限句柄或 content-addressed blob。
5. **不靠 mtime 扫描建立 Artifact 身份**：工具/Operation 事件为主，扫描只用于修复。
6. **不复制 Space/Project/Workspace 同义层**：复用 Tessera 已有产品对象。
7. **不让第三方工具从全局 env 猜 cwd**：每个工具显式接收受限资源端口。
8. **不把 discard 定义成只删控制记录**：用户心智中的放弃必须清理 staging，或明确说明只是隐藏记录。

## 14. 推荐实施顺序

### P0：把现有安全链变成统一运行事实

- 为 Workspace mount、Document baseline、Attachment 和 Artifact root 建立 run snapshot；
- Artifact tray 使用数据库 Artifact/Operation/Proposal 投影，不扫描猜测；
- 审批卡展示真实 path、operation、base version、候选 hash 和 Diff；
- 补充写入后 hash 校验与必要的 durability 策略。

验收：任务恢复后仍能解释某次 Run 可见哪些文件、哪个候选获得批准、最终写入哪一版本。

### P1：Run-scoped ChangeSet

- 聚合多个 proposal/operation；
- 全量预检冲突、逐项 Apply、清晰 partial 结果；
- 新建 Artifact 支持即时预览与选择目标 Project；
- Run 结束执行 reconcile，发现工具事件与磁盘不一致时标记异常而不是静默补事实。

验收：外部编辑一个待修改文件后，批量 Apply 不覆盖它；其他无冲突项是否继续由产品策略明确决定并可审计。

### P2：隔离执行与版本恢复

- 有真实代码执行需求时再引入 staging tree、Git worktree 或 sandbox mount；
- worktree 生命周期、ignore/submodule/LFS/未提交变更和磁盘配额需单独设计；
- 与本地版本历史文档中的 checkpoint/restore 统一，不能再造 overlay 历史。

验收：Agent 崩溃、应用重启、外部编辑、Apply 中断和数据库更新失败后，用户正文、控制状态和恢复入口都不互相覆盖。

## 15. 最终判断

Eigent 的 Workspace 代码展示了通用 Agent 产品必然遇到的复杂度：逻辑项目不等于本地目录；一次执行需要冻结资源；隔离副本需要基线、overlay、冲突和 Apply；文件产生后还需要可见的审查界面。它的后端 Apply 实现是本专题最成熟、最值得借鉴的部分。

不过产品默认 `direct-write` 说明一条更重要的教训：如果隔离写入让用户看不到成果、Apply UI 又不能完成 Diff/冲突解决，团队最终会为了可用性绕过安全架构。Tessera 应解决的是这组矛盾——让 staging Artifact 立即可见、让审查足够轻、让低风险 create-new 顺畅——而不是降低写入边界。

Tessera 已经拥有更好的单文档审批和 Artifact 控制模型。下一步应把它们提升到 Run-scoped 资源快照与 ChangeSet，并用右侧 Artifact tray 投影真实控制事实。这样既能吸收 Eigent 的 Space/Run/Agent Folder 产品经验，也不会继承其双绑定、默认直写和同机路径 bridge 的债务。
