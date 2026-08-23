# 浏览器、CDP 与 Cookie 管理

> 研究对象：Eigent `d3089558c6e0021eed58270b49893835b02ec4e9`
>
> 结论类型：源码事实、研究推断与 Tessera 建议分开标记
>
> Tessera 状态：受限网页读取已实现；交互式 Agent Browser、CDP 会话、Cookie 授权与实时预览未开始

## 1. 结论先行

Eigent 已经形成一条能工作的浏览器 Agent 主链：renderer 在发送任务前准备 CDP 浏览器，Local Brain 把 CDP
端点冻结进本次运行，Browser Agent 通过 CAMEL 的 Hybrid Browser Toolkit 操作页面，UI 再把页面或截图投影到
Browser 面板。这条链路覆盖导航、点击、输入、Tab、上传下载、控制台与表格操作，产品完整度明显高于“打开一个
网页工具”。

但是，Eigent 当前并不存在一个统一的 `BrowserSession`。至少有七类浏览器或页面容器并存：应用自身的
Electron 调试端点、桌面托管 Chromium、Web Brain 托管 Chrome、外部 CDP 浏览器、远程 Hands 浏览器、独立登录
浏览器、内嵌预览 WebView。它们使用不同 profile、partition、端口、生命周期和状态源。最需要警惕的结果是：

- Cookie 管理界面维护的登录 profile，并不等于 Browser Agent 实际操作的 CDP profile；
- 用户看到的内嵌 Browser 预览，也不一定就是 Agent 当前控制的那个 target；
- “外部浏览器”只是一个展示属性，不构成所有权和关闭权限边界；
- 同一 CDP 端点上的 Tab 通过进程内注册表做软隔离，Cookie、localStorage 和 profile 仍然共享；
- 浏览器池耗尽时会回退复用第一台浏览器，实际突破了会话独占假设。

所以 Tessera 应学习 Eigent 的产品闭环和工具覆盖面，但不应复制其 profile 复制、端口数组与多套会话事实源。
Tessera 的起点应是一个跨 main/runtime/renderer 都使用稳定 ID 的 `BrowserSession` 领域对象，并把连接、身份、
可见预览、授权和审计明确拆开。

## 2. 研究范围与关键证据

本专题覆盖以下代码：

- Electron CDP 池与 IPC：`Eigent: electron/main/index.ts`
- preload 暴露：`Eigent: electron/preload/index.ts`
- 旧版 WebContentsView 池：`Eigent: electron/main/webview.ts`
- 登录 profile 复制：`Eigent: electron/main/copy.ts`
- Brain 浏览器启动与验证：`Eigent: backend/app/utils/browser_launcher.py`
- Web 模式 CDP 状态：`Eigent: backend/app/utils/cdp_browser_state.py`
- Cookie SQLite 管理：`Eigent: backend/app/utils/cookie_manager.py`
- Browser API：`Eigent: backend/app/controller/tool_controller.py`
- 独立登录浏览器：`Eigent: backend/app/controller/electron_browser.cjs`
- 请求到 RunContext：`Eigent: backend/app/model/chat.py`、`backend/app/run_context/context.py`
- Browser Agent 装配：`Eigent: backend/app/agent/factory/browser.py`
- 单 Agent 浏览器装配：`Eigent: backend/app/agent/factory/single_agent.py`
- Hybrid Browser：`Eigent: backend/app/agent/toolkit/hybrid_browser_toolkit.py`
- renderer CDP/Cookie 设置：`Eigent: src/pages/Browser/CDP.tsx`、`src/pages/Browser/Cookies.tsx`
- 新版预览层：`Eigent: src/components/Session/PreviewPanel/tabs/browser/BrowserTab.tsx`
  与 `PreviewBrowserLayer.tsx`
- 旧版任务浏览器投影：`Eigent: src/components/WorkforceMenu/index.tsx`

## 3. 先拆清楚：Eigent 中不是一个“浏览器”

### 3.1 七类浏览器表面

| 表面 | 启动/持有者 | profile 或 partition | 主要用途 | 是否直接给 Agent |
| --- | --- | --- | --- | --- |
| Eigent 应用 Electron | Electron main | `cdp_profile_<port>` | 应用自身远程调试 | 否，Brain 会拒绝 Electron CDP |
| 桌面托管 Chromium | Electron main/Playwright | `cdp_browser_profile_<port>` | 桌面任务 CDP 池 | 是 |
| Web Brain 托管 Chrome | Python Brain | `cdp_brain_<port>` | Web/无 Electron 模式 | 是 |
| 外部 CDP 浏览器 | 用户启动，Eigent 只登记 | 用户原 profile | 接入已有登录会话 | 是 |
| Remote Hands 浏览器 | 远端资源服务 | 远端决定 | Web 云端浏览器 | 是 |
| 独立登录浏览器 | Brain 拉起嵌套 Electron | `profile_user_login` | 让用户手工登录并管理 Cookie | 未发现可靠直连 |
| 内嵌预览 WebView | Electron renderer/main | `persist:user_login` 或 `persist:session-preview` | 用户预览页面 | 不一定 |

这张表是理解后续问题的前提。代码中“browser”“CDP browser”“cookie browser”“preview browser”常以相似名称
出现，但它们不是同一资源。

### 3.2 应用自身 CDP 端点为什么不能直接复用

Electron main 会为 Eigent 应用本身配置 remote debugging port，并使用
`~/.eigent/browser_profiles/cdp_profile_<port>`。但 Brain 的浏览器探测不仅检查 `/json/version`，还会通过 browser
WebSocket 调用 `Browser.setDownloadBehavior`，并拒绝 UA 或版本标识为 Electron 的端点。

源码意图是合理的：Agent 工具需要浏览器级 context、下载和 target 管理能力，不能把“能连上 CDP”误判成“适合
自动化”。这比 Electron main 中只看 `/json/version` 返回 200 的健康检查严格得多。

**Tessera 可借鉴：** 浏览器连接检测应是带能力探针的握手，而不只是端口探活。握手结果至少包含：

- 实现类型与版本；
- browser/context/target 操作能力；
- 下载、上传、截图、console 等所需命令是否可用；
- 是否支持创建隔离 context；
- 是否允许 Tessera 接管关闭；
- 端点来源和信任级别。

## 4. 桌面端托管 CDP 浏览器池

### 4.1 端口、profile 与持久目录

Electron main 在 `9224–9299` 中寻找空闲端口，通过 Playwright 自带 Chromium 启动浏览器，并为每个端口使用
独立的 `cdp_browser_profile_<port>`。浏览器登记项近似包含：

```text
CdpBrowser
├── id
├── port
├── isExternal
├── name?
└── addedAt
```

列表写入 `~/.eigent/cdp-browsers.json`。Electron 重启后进程句柄丢失，恢复出来的记录会被当成外部浏览器；后台
每三秒请求一次 `/json/version`，死亡端点从列表删除。

优点是实现简单、每个托管端口天然对应一个持久 profile，重启浏览器后登录状态仍可能保留。问题是端口、浏览器
身份、profile 和所有权被隐式绑在一起：

- 端口复用后，旧记录的身份语义会漂移；
- JSON 没有观察到 schema 迁移、文件锁或原子替换；
- 重启后统一改成 external，丢失了“由谁创建、是否可以关闭”的事实；
- profile 生命周期没有成为一等对象，无法表达临时、项目专属、用户身份专属等策略。

### 4.2 外部浏览器接入

桌面 CDP 页面允许用户输入本地端口。renderer 自己请求
`http://localhost:<port>/json/version`，成功后通过 IPC 把端口加入池。这里的验证比 Brain 的连接验证弱：没有执行
context/download 能力探针，也没有排除不兼容的 Electron 端点。

更严重的是，`isExternal` 主要用于显示，并未成为资源所有权策略。删除浏览器时，主进程默认会通过 CDP 发出
`Browser.close`；除了保护 Eigent 自身的调试端口，没有看到“外部端点只解除绑定，不关闭用户进程”的强制
边界。一个叫“移除”的 UI 行为可能终止用户自己启动的浏览器。

**Tessera 建议：** 把以下状态分离：

```text
connection.origin = managed | attached | remote
connection.ownership = tessera | user | provider
connection.closePolicy = terminate | detach-only | provider-release
profile.ownership = ephemeral | tessera-managed | user-owned
```

关闭策略由创建事实决定，不能由当前 UI 标签推断。

### 4.3 健康检查不是可用性检查

三秒一次 `/json/version` 只能说明调试 HTTP 服务还在。它不能证明：

- browser WebSocket 仍可建立；
- 当前 target 没被用户关闭；
- context 仍归本 Run 所有；
- profile 没被另一进程锁定；
- Agent 所需命令仍有权限；
- 预览层仍指向相同 target。

建议 Tessera 将状态拆成 `reachable / compatible / leased / degraded / closed`，并把重连、重新租约和重新授权分开。

## 5. Web 模式与远程浏览器资源

### 5.1 Brain 内存状态

Web 模式没有 Electron 池。`cdp_browser_state.py` 使用进程内 map，按认证用户或 `X-User-ID` 等 fallback 形成 owner
key，每个 owner 保存当前浏览器元数据。没有持久恢复时会回退读取 `EIGENT_CDP_URL`。

启动请求的优先级大致是：

1. 复用 owner 已登记且仍可用的浏览器；
2. 如果配置 Remote Hands，向资源服务 acquire；
3. 否则由 Brain 在 `9222–9299` 启动本机 Chrome。

远程浏览器断开会调用资源释放；本机浏览器的 disconnect 主要清除状态，没有看到对托管 Chrome 的可靠终止，可能
留下孤儿进程。Brain 重启也会失去内存租约。

### 5.2 远程 CDP 的信任边界

启动器能标准化裸端口、`host:port`、HTTP URL，并从 `/json/version` 取 browser WebSocket。该能力也允许连接远程
端点，但通用路径没有体现认证 header、证书 pinning 或 host allowlist。Remote Hands 是受控服务时风险较小，环境
变量或未来自定义连接则可能把完整页面内容、Cookie、输入与下载暴露给未知端点。

Tessera 的 Remote Browser 连接应拥有显式提供方适配层：

- Secret 不进入 renderer 和普通日志；
- endpoint 只从已批准连接产生，而非任务文本任意指定；
- TLS、host、租约 ID 与到期时间进入 Run Snapshot；
- release 是幂等、可补偿的后台动作；
- 断线恢复不能悄悄换成另一份身份或 profile。

## 6. 从用户请求到 Browser Agent

### 6.1 renderer 预启动判断

发送任务前，renderer 会根据两类信号决定是否确保浏览器可用：

- Workforce 配置中存在 Browser Agent；
- 单 Agent 请求文本含 URL 或浏览器意图。

随后 renderer 获取 `browser_port` 与 `cdp_browsers`，把浏览器列表随 Chat 请求发给 Brain。`Chat` 模型中的
`cdp_browsers` 是宽松的 `list[dict]`，没有稳定协议 schema。这个实现减少了一次 Brain 到 Electron 的反向通信，
代价是 renderer 参与了运行资源编排，也允许展示态对象直接变成执行输入。

### 6.2 RunContext 冻结

Brain 选择具体端点后，把 `browser_port` 和 `cdp_url` 放进不可变 RunContext。这个点值得保留：运行开始后，即使设置
页新增/删除浏览器，本次 Agent 仍应围绕已批准端点执行。

但当前冻结的是地址，不是完整资源快照。缺失的信息包括：

- 浏览器稳定 ID、来源、所有者和 profile；
- 租约、并发上限和关闭策略；
- 身份/Cookie 授权；
- 允许的站点、下载目录与高风险动作策略；
- 预览 target 与 Agent target 的关联。

### 6.3 Python 运行池与独占失效

Browser Agent 和具备浏览器工具的 Single Agent 会从 Python 进程内 `CdpBrowserPoolManager` 获取端点。池维护
port 到 session、session 到 port/task 的映射，并通过锁控制分配和释放。

正常路径有“一个 session 租一台浏览器”的意图；但当所有候选都被占用时，代码会回退选第一台浏览器。这意味着
并发压力下，两次运行可能共享同一个 profile、Cookie 和 targets，独占语义被静默突破。

静默共享比明确排队更危险：

- Agent A 可能看到 Agent B 新开的 Tab；
- 登录态和站点 localStorage 相互影响；
- 下载和上传路径难以归属；
- 一个 Run 的 cleanup 可能干扰另一个 Run；
- 用户侧栏无法解释页面为什么突然变化。

Tessera 应在池耗尽时选择明确策略：排队、扩容、降级为只读网页工具或请求用户决定，不能无提示复用。

## 7. Hybrid Browser Toolkit 与会话隔离

### 7.1 工具覆盖

Eigent 的 Browser Agent 不是单一 `browse(url)`。Hybrid Toolkit 经由 Python 与 TypeScript WebSocket bridge 提供
一组交互工具，覆盖：

- 页面导航、后退、刷新；
- 快照与页面读取；
- 点击、输入、下拉选择；
- Tab 创建、查询和切换；
- console 执行；
- 文件上传与下载；
- 页面截图；
- 表格相关操作。

Browser Agent 还会组合搜索、截图、Skills 和 safe-mode terminal。这个组合说明浏览器 Agent 的能力边界远大于
“联网搜索”，安全等级也更高：它能操作登录账户、执行页面脚本、上传本地文件并把下载落盘。

### 7.2 WebSocket 连接池

`hybrid_browser_toolkit.py` 维护按 session ID 的 WebSocket 连接，带健康检查、重建和关闭清理。相较于每次工具调用
重新建立 bridge，这能减少开销并保留浏览器侧状态。

同一 CDP 端点上还有全局导航锁，用于规避多个任务同时导航造成的 `ERR_ABORTED`。这个锁本身也侧面证明共享端点
真实存在；它缓解命令竞争，却不能建立数据隔离。

### 7.3 Tab 注册表只是软隔离

实现通过进程内全局注册表记录 `tab_id -> session_id`，只向当前 session 暴露被认领的 Tab。首次接入共享端点时，
还会创建带 Eigent session 标记的 `about:blank` sentinel。

源码把这一方案标记为上游能力修复前的临时方案。它的边界很明确：

- Brain 重启后注册关系丢失；
- 多 Brain 进程之间不共享注册表；
- 已存在 Tab 需要机会式认领；
- CDP 事件仍来自同一 browser；
- Cookie、localStorage、cache、service worker 和权限是 profile/context 级共享；
- Tab ID 过滤不能阻止页面间接访问共享身份数据。

真正的隔离单位应优先是 BrowserContext；如果外部浏览器不允许创建 context，则必须明确标成“共享身份会话”，提高
审批等级并禁止并发 Run。

### 7.4 clone 与登录态复用

Agent clone 过程中会在类级锁内临时替换父 toolkit 的 `cdp_url` 以克隆工具，并保留相同 user data directory 来共享
登录态。它让 Worker 迅速具备可用身份，但同时把身份共享做成隐式副作用。Workforce 中每个 Worker 的 Browser
工具看似独立，底层可能仍在同一浏览器身份域。

Tessera 需要把“共享登录身份”写进 Worker/Run 的 Resource Binding，而不是从 clone 行为推断。

## 8. Cookie 管理链路

### 8.1 独立登录浏览器

Cookie 页面启动的不是池中的 Chromium，而是通过 `npx electron` 拉起的嵌套 Electron，固定使用 `9323` 端口和
`~/.eigent/browser_profiles/profile_user_login`。用户在这个窗口中手工访问站点并登录。

该子进程配置包含：

- `password-store=basic`；
- `use-mock-keychain`；
- `nodeIntegration: true`；
- `contextIsolation: false`；
- `webviewTag: true`。

这套配置降低了系统 Keychain 的保护，并扩大了登录浏览器 renderer 的 Node 权限。即使登录页面本身来自受信 UI，
承载任意互联网内容时也不应使用这种边界。

### 8.2 登录 profile 到 WebView 的单向复制

Eigent 启动时会把登录 profile 中的 `Partitions/user_login` 复制到应用 userData 下同名 partition。旧版
WebViewManager 使用 `persist:user_login`，因此用户登录后需要重启 Eigent，才能让内嵌页面读到复制后的状态。

Cookie 页面通过比较操作前后 Cookie 总量提示用户重启。这是文件级同步，不是会话级同步：

- 只在特定时机单向复制；
- Cookie 数相同不代表具体身份没变化；
- 源和目标在复制后会继续分叉；
- active profile 的 WAL/锁状态不容易安全复制；
- 删除或登出无法实时传播。

### 8.3 关键错位：登录 Cookie 未明确进入 Agent CDP profile

桌面托管 CDP 浏览器使用 `cdp_browser_profile_<port>`；Web Brain 使用 `cdp_brain_<port>`；Cookie 登录浏览器使用
`profile_user_login`；新版 preview 又使用 `persist:session-preview`。固定提交中没有发现一条可靠的、受审计的数据流
把登录 profile 同步到 Browser Agent 实际租用的 CDP profile。

因此，“Cookie 管理”更像是在管理内嵌 WebView 的登录状态，而不是统一管理 Agent Browser 的身份。这是本专题最
重要的源码结论之一。产品层把它们称为浏览器/Cookie，用户容易认为 Agent 已经获得同一登录态，但运行层并不能
保证。

### 8.4 SQLite 读取与删除

`cookie_manager.py` 直接操作 Chromium Cookies SQLite：

- 读取时复制数据库到固定 `.tmp` 文件再查询；
- 域名列表返回数量和最近访问时间；
- 单域 Cookie 返回 name、value、path、secure、httpOnly，value 截断到 50 字符；
- 删除时直接打开 live DB 执行 `DELETE` 和 `VACUUM`，随后删除 WAL/SHM/journal 文件。

风险包括：

1. 固定 `.tmp` 会让并发读取相互覆盖；
2. 只复制主 DB、不复制 WAL/SHM，活跃浏览器的新数据可能缺失；
3. live DB 上删除和 `VACUUM` 与浏览器写入竞争，可能损坏 profile；
4. 强删 WAL/SHM 可能丢掉浏览器尚未 checkpoint 的事务；
5. 新版 Chromium 常把敏感值放在 `encrypted_value`，直接读 `value` 可能为空；
6. 即使值被截断，API 也不应默认向 renderer 返回 Cookie secret；
7. 接口会返回本机 `user_data_dir` 绝对路径，扩大信息暴露。

renderer 还用域名最后两段归并主域，这对 `co.uk` 等公共后缀不成立。正确实现应使用 Public Suffix List。

### 8.5 Tessera 的 Cookie 原则

Tessera 不应做通用 Cookie 数据库浏览器。更安全的产品对象是 `BrowserIdentity`：

```text
BrowserIdentity
├── id / displayName
├── profileRef（只在 main/runtime 可解析）
├── allowedOrigins[]
├── source = interactive-login | attached-browser | remote-provider
├── persistence = session | persistent
├── lastVerifiedAt
└── secretExposure = never
```

用户通过受控登录窗口建立身份；Agent 只能选择身份引用，永远看不到 Cookie 明文。删除身份应在浏览器退出且 profile
锁释放后进行，优先删除整个 Tessera 托管 profile，而不是手改 Chrome 内部 SQLite。

## 9. Browser 预览与 Agent 实际页面

### 9.1 旧版 WebContentsView 池

Electron main 的旧实现会预创建最多八个 WebContentsView，共享 `persist:user_login`，关闭 Node、启用 sandbox，
注入部分 stealth 脚本。隐藏时把 view 移到屏幕外，还可定时截取 JPEG。旧 Workforce UI 依据 hostname、agent/task
信息尝试把浏览器 URL 与任务关联，并按约两秒节奏抓图。

这种方案能快速做出“Agent 正在浏览”的可视反馈，但 hostname 关联不是 target identity：同域多 Tab、重定向、
iframe、两个并发任务都可能误配。

### 9.2 新版 session preview

新版 `PreviewBrowserLayer` 在 renderer 中为项目 Tab 创建 DOM `<webview>`，统一使用
`persist:session-preview`。WebView 常驻，只在闲置约十分钟后回收；未选中时停放到屏幕外，从而保留页面历史和交互
状态。

这套 UI 体验不错，但固定提交中没有观察到它与 Browser Agent CDP target 共用稳定 `browserSessionId/targetId`。
它可能只是用户侧的页面预览，而不是 Agent 操作面的镜像。

### 9.3 必须建立同一性协议

Tessera 的 Browser 面板不能只接收 URL。运行事件至少应携带：

```text
BrowserTargetRef
├── browserSessionId
├── contextId
├── targetId
├── runId / workerId
├── url / title
├── visibility = live | snapshot | detached
└── observedAt
```

如果安全或技术限制无法嵌入同一 target，UI 必须明确标记“只读快照”，不能让用户误以为能直接接管 Agent 页面。

## 10. 权限、安全与审计边界

### 10.1 CDP 是高权限连接

CDP 可读取页面内容、Cookie 相关状态、执行脚本、发起请求、下载文件并控制 Tab。连接一个用户正在登录的外部浏览器，
权限接近让 Agent 接管该身份。`localhost` 并不自动等于安全：任何能访问调试端口的本机进程都可能控制浏览器。

Eigent 的浏览器 Agent 提示会告诉模型可使用活动登录会话，但没有观察到按浏览器身份、站点或高风险动作设置的统一
人工审批。其 Browser Agent 同时拥有 console、上传、下载和 terminal，风险组合尤其高。

### 10.2 Tessera 动作分级

建议把浏览器工具分成三层：

| 等级 | 示例 | 默认策略 |
| --- | --- | --- |
| 读取 | 导航公开 URL、读取文本、截图、查询 Tab | 按 Run 授权，可配置站点 allowlist |
| 状态改变 | 登录后点击、填写普通表单、上传文件、下载 | 首次动作或每站点确认，记录 target 与参数摘要 |
| 高风险提交 | 发消息、发布、购买、删除、授权 OAuth、提交隐私数据 | 每次明确确认，展示即将产生的外部影响 |

任何 `evaluate/console` 都应按高权限工具处理，不能因为技术上常用而默认放行。

### 10.3 审计内容

浏览器审计事件应记录：

- Run、Worker、Tool Call 和 Browser Session；
- 操作前后的 URL/target；
- 动作类别与经过脱敏的参数；
- 使用了哪个身份引用，不记录 Cookie；
- 审批者、策略命中与结果；
- 下载/上传 Artifact ID 和内容 hash；
- 截图或 DOM 快照的可选证据引用；
- 连接、断开、崩溃和强制回收原因。

## 11. 与 Tessera 当前实现对照

### 11.1 Tessera 已有：受限公开网页读取

Tessera 当前的 `browser-research-reader.ts` 服务于公开资料研究，而不是交互式 Agent Browser。它已经具备一些比
Eigent 更严格的边界：

- system/direct 网络模式使用独立 Electron Session；
- 禁止权限请求与下载；
- 屏蔽图片、媒体、字体、WebSocket 等非必要资源；
- URL 和 redirect 经过公共网络校验，配合 Research Service 阻断 SSRF；
- 优先静态读取，必要时使用隐藏、sandbox、Node disabled 的 BrowserWindow；
- 不读取用户现有 Cookie；
- 有超时、响应体和文本长度上限。

这条能力应继续作为低权限 `PublicWebReader` 保留，不能被未来 Browser Agent 的高权限 profile 替换。

### 11.2 Tessera 当前缺口

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 公开网页受限读取 | 已实现 | 适合 research/search 后的正文提取 |
| BrowserSession 领域对象 | 未开始 | 没有统一生命周期与资源绑定 |
| 托管交互浏览器 | 未开始 | 没有 Playwright/CDP 池 |
| 外部浏览器 attach | 未开始 | 没有能力探测、所有权和授权 |
| 登录身份/profile 管理 | 未开始 | 架构明确不默认读取用户会话 |
| live target 预览 | 未开始 | 没有 Agent target 与 UI 面板同一性 |
| 浏览器工具审批 | 未开始 | 可复用 AI SDK Tool Part 审批基础 |
| 上传/下载 Artifact 闭环 | 部分实现 | 文件治理基础存在，尚未绑定浏览器会话 |
| Browser 审计时间线 | 未开始 | 可接现有 Run/Tool/Artifact 方向 |

### 11.3 Tessera 已有基础可以复用

Tessera 不需要从 Eigent 复制一套 renderer 编排。现有方向已经提供：

- 窄 IPC 与 renderer 无 Node/fs；
- AI SDK Tool Part 及工具确认；
- 供应商/模型能力的三态事实；
- 托管文件、差异与审计边界；
- Run/Workspace/Skill/MCP 正在形成的控制面；
- 公开网页读取的网络安全策略。

浏览器应作为新的受管资源接入这些对象，而不是成为独立的“第二套 Agent runtime”。

## 12. Tessera 目标模型

### 12.1 核心对象

```text
BrowserDefinition                 BrowserIdentity
  连接方式与能力                    登录身份与 origin 授权
          │                                  │
          └──────────────┬───────────────────┘
                         ▼
                   BrowserSession
             运行期租约、profile、策略与状态
                         │
                 ┌───────┴────────┐
                 ▼                ▼
          BrowserContext      BrowserTarget
          隔离存储域             页面/Tab
                 │                │
                 └───────┬────────┘
                         ▼
                 BrowserActionEvent
                 工具、审批、证据、Artifact
```

`BrowserDefinition` 类似 MCP Server Definition，描述 managed Chromium、attached CDP 或 remote provider；
`BrowserIdentity` 独立描述登录态；`BrowserSession` 是 Run 绑定的租约；Target 才是 UI 预览和工具调用的对象。

### 12.2 运行快照

发送前只选择资源意图，开始运行时由 main/runtime 解析并冻结：

```text
BrowserRunBinding
├── sessionId
├── definitionId / connectionOrigin
├── identityId?
├── contextIsolationMode
├── allowedOrigins[]
├── capabilities
├── closePolicy
├── downloadRootArtifactId
├── approvalPolicyVersion
└── leaseExpiresAt?
```

renderer 只获得展示所需的脱敏投影，不获得 CDP URL、Bearer token 或 profile 路径。

### 12.3 状态机

```text
defined → connecting → compatible → leased → ready
                          │          │       │
                          │          │       ├→ degraded → reconnecting
                          │          │       └→ awaiting-approval
                          │          └→ releasing
                          └→ rejected
releasing → closed | orphaned
```

“orphaned”必须是显式可清理状态，尤其适用于远程租约、崩溃后的托管进程和 profile 锁。

## 13. 分阶段实施建议

### 阶段 0：保持低权限网页读取独立

- 把现有能力明确命名为 Public Web Reader；
- 固化 SSRF、重定向、内容体积与资源类型测试；
- 不引入用户 Cookie，不开放 console/upload/download；
- 在模型能力和工具 UI 中避免把它标成完整“浏览器控制”。

验收：公开网页研究仍可用，交互式浏览器未开启时不存在身份数据访问路径。

### 阶段 1：单 Run、单托管浏览器、临时 profile

- 在 Electron main/runtime 创建 BrowserSession manager；
- 只支持 Tessera 托管 Chromium 和 ephemeral context；
- 每 Run 独占，不足时排队；
- 首批工具只开放 navigate、snapshot、click、type、tabs、screenshot；
- 所有事件带 session/context/target ID；
- Browser 面板先做只读实时截图与目标信息；
- download/upload 暂不开启。

验收：两个并发 Run 不能看到彼此 Tab、storage 或下载；main 崩溃后能识别并回收孤儿资源。

### 阶段 2：受控身份与 Artifact

- 增加 BrowserIdentity 和专用登录窗口；
- 每身份使用 Tessera 管理 profile，不复制系统 Chrome 数据库；
- origin allowlist 与持久化策略由用户确认；
- 上传必须从托管 Artifact 选择；
- 下载先进入隔离 staging，再成为扫描、hash 完成的 Artifact；
- 增加状态改变/高风险动作审批。

验收：模型、renderer 和普通日志都无法取得 Cookie 明文；身份删除在浏览器完全退出后安全完成。

### 阶段 3：外部 CDP 与远程浏览器

- 做完整能力握手和显式 ownership/close policy；
- 外部浏览器默认 detach-only、单 Run 独占；
- remote provider 使用连接适配层、短期 token 和幂等 release；
- 不支持 BrowserContext 的连接标成 shared identity，高风险 UI 明示；
- 断线后不得静默切换身份。

验收：移除外部连接不会关闭用户浏览器；远程租约异常能在后台补偿，不遗留持续计费资源。

### 阶段 4：Worker 共享与人工接管

- 默认一个 Run 一个 context；Worker 只共享经过声明的 target 或身份；
- 实际需要并行时创建独立 context，而不是用 Tab 注册表假隔离；
- 支持 Agent 暂停、用户接管、再交还，并生成 ownership transition 事件；
- Execution Context 展示实际身份、站点、工具和 Artifact，但全部脱敏。

验收：多 Worker 的页面归属可解释，用户接管期间 Agent 不继续提交动作。

## 14. 建议直接学习的设计

1. **发送任务前确保资源可用**：避免 Agent 跑到一半才发现没有浏览器。
2. **运行期冻结 CDP 选择**：设置变化不污染在途 Run。
3. **连接需要真实能力探针**：`/json/version` 不够，至少验证 context/download 等关键命令。
4. **浏览器工具是组合能力**：Browser Agent 需要导航、交互、Tab、截图和文件协作，而非只有搜索。
5. **连接池与 cleanup 是 runtime 职责**：Agent 工厂只拿租约，不直接拥有进程生命周期。
6. **右侧 Browser 面板持续保留状态**：用户能看见 Agent 访问到哪里，并能在需要时审查。
7. **浏览器资源进入 Execution Context**：展示实际使用过的会话、身份和站点，不只展示发送前选择。

## 15. 明确不要照搬

1. 不用端口号充当浏览器身份。
2. 不让 renderer 把宽松 `list[dict]` 浏览器状态直接送入 runtime。
3. 不在池耗尽时静默共享第一台浏览器。
4. 不把 Tab 过滤当成 Cookie/profile 隔离。
5. 不使用 `nodeIntegration: true` 的窗口承载任意登录页面。
6. 不通过复制 Chromium profile/partition 实现身份同步。
7. 不直接修改活跃 Chrome Cookies SQLite，更不强删 WAL/SHM。
8. 不向 renderer 返回 Cookie 明文、CDP secret 或本机 profile 路径。
9. 不让“移除外部浏览器”隐式执行 `Browser.close`。
10. 不按 hostname 猜测 Agent target，也不把另一个 WebView 冒充实际页面。
11. 不让 console、上传、下载和外部提交绕开统一工具审批。
12. 不把用户日常 Chrome profile 默认暴露给 Agent。

## 16. 需要进入后续路线图的决策

| 决策 | 建议默认值 | 原因 |
| --- | --- | --- |
| 第一个交互浏览器实现 | 托管 Chromium + ephemeral context | 最容易建立真实隔离和可回收性 |
| 默认并发策略 | 每 Run 独占，资源不足排队 | 不静默泄露身份或 Tab |
| 登录态 | Tessera 专用 BrowserIdentity | 不读取系统日常浏览器 |
| UI 第一版 | target 元数据 + 实时只读截图 | 先保证同一性，再做复杂嵌入接管 |
| 外部 CDP | 后置 | 所有权、身份和兼容性风险更高 |
| Cookie 展示 | 只展示身份和授权 origin | Cookie secret 永不进入 renderer |
| Browser 高风险动作 | AI SDK 工具审批 | 复用统一 Tool Part 和审计链 |
| 多 Worker | 独立 context，显式共享例外 | 不采用进程内 Tab 注册表假隔离 |

## 17. 最终判断

Eigent 证明了 Browser 面板、浏览器专职 Agent、CDP 资源准备和可见执行过程是 Manus/YouMind 类桌面 Agent 的重要
组成部分。它也暴露了一个很典型的演进陷阱：先分别实现“登录窗口”“CDP 池”“预览 WebView”“Cookie 页面”，
最后 UI 看起来完整，但各自对应不同 profile 和不同会话，缺少可证明的同一性。

Tessera 目前没有这笔兼容债务，反而适合先定义 `BrowserSession → BrowserContext → BrowserTarget` 的领域关系。
保持 Public Web Reader 为低权限路径，再逐步增加托管交互浏览器、专用身份、Artifact 上传下载、远程连接与多 Worker，
会比从 Cookie 导入或任意 CDP attach 起步更安全，也更容易在右侧审查面板中给用户一个真实、可解释的执行视图。
