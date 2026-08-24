# Tauri 兼容实验与 A/B 基线

> 代码源头：`apps/desktop-tauri/`、`packages/desktop-bridge/`、
> `apps/desktop/src/renderer/src/`、`packages/contracts/src/index.ts`、
> `apps/desktop/benchmarks/editor-budget.json`
>
> 状态：部分实现。当前首版只覆盖 Tauri 壳层、共享 renderer、完整桌面 bridge 形状、首屏空态与编辑器基准；
> 工作区、任务、AI、MCP、Skill、研究、数据迁移，以及签名、公证与自动更新仍是规划能力。

## 实验目的

本实验在不分叉产品 UI 的前提下比较 Electron 与 Tauri 的安装体积、启动、资源占用、编辑器性能和原生窗口体验。
它不是第二套产品实现，也不以“窗口能打开”代表兼容完成。两个宿主必须加载同一份 React renderer，并以
`DesktopApiContract` 作为前后端协议的唯一类型事实源；宿主差异留在 bridge 和后端运行时边界内。

这里的“兼容”分为三个层次：

1. **形状兼容**：`window.tessera` 暴露相同的方法名、参数、返回类型和取消订阅形式；
2. **行为兼容**：成功值、错误、取消、事件顺序、文件冲突和持久化语义一致；
3. **数据兼容**：Markdown、SQLite 状态、配置和凭据可以安全迁移或由同一事实源重建。

首版只承诺第一层及支撑首屏空态的最小行为。未实现的读取接口返回明确的类型安全空态，未实现的变更接口必须稳定失败，
不得伪造成功。空数组、`null` 或 no-op 订阅只用于契约本身允许“当前没有数据”的读取路径，不可掩盖后端缺失。

## 共享 renderer 与 67 方法 bridge

`DesktopApiContract` 当前共有 67 个方法：58 个 `invoke`、3 个 `send`、6 个 `subscribe`。Electron preload 与
Tauri bridge 都从该契约导出 `DesktopApi`，renderer 继续只依赖 `window.tessera`，不得直接导入 Electron、Tauri、
Node.js、Rust 命令名或任一宿主的事件 API。

```text
                         packages/contracts
                     DesktopApiContract（67）
                                  |
        +-------------------------+-------------------------+
        |                                                   |
Electron preload / IPC                            Tauri bridge / command-event
        |                                                   |
Electron main                                      Rust 或受控 sidecar
        +-------------------------+-------------------------+
                                  |
                   同一份 React renderer / design system
```

“完整 bridge 形状”不等于 67 项后端能力已经实现。测试和报告必须分别给出“方法存在”“首屏可调用”“行为通过”三列覆盖率，
不得只用 TypeScript 编译通过宣称互相兼容。`subscribe` 仍须同步返回幂等清理函数；Tauri 异步注册监听时，bridge 要处理
“注册完成前已经清理”的竞态，避免残留监听。未来 AI 流式事件接入时还要单独验证背压、取消和事件顺序，不能用普通事件
吞吐量推断流式体验已经等价。

当前 Tauri transport 会把 Rust 字符串或结构化 rejection 统一转换为标准 `Error`，避免共享 renderer 丢失“尚未实现”等真实
原因；共享 bridge 也不会为省略的可选参数发送 `undefined` 占位，防止 Electron structured clone 与 Tauri JSON 产生差异。
Rust 的两个泛型命令除内部频道 allowlist 外，还由 `AppManifest` 生成独立权限，并且只授予 `main` capability。窗口关闭使用
`idle / pending / approved` 三态原子握手：无待处理请求不能确认，重复关闭不重复发事件，事件或原生关闭失败后可重新请求。

## 首版功能矩阵

| 能力 | Electron | Tauri 首版 | 当前判定 |
| --- | --- | --- | --- |
| macOS 应用壳层、窗口创建与 renderer 加载 | 已实现 | 已实现 | 可做窗口观感、启动和资源 A/B |
| React renderer、设计系统、TipTap / CodeMirror 编辑表面 | 已实现 | 原样复用 | 两端禁止维护 UI 分叉 |
| `DesktopApi` 67 方法接口形状 | 已实现 | 已实现 | 仅代表类型与调用表面完整 |
| 无工作区、无任务、未配置服务时的首屏空态 | 已实现 | 已实现 | 首版产品路径 |
| 固定语料的 editor benchmark | 已实现自动化 runner | 同一 route 已打包，自动化采集待实现 | 暂不能发布跨宿主性能结论 |
| 工作区选择、Markdown 读写、目录操作、文件监听与冲突处理 | 已实现 | 规划 | 不纳入首版兼容结论 |
| SQLite 生命周期、任务、Artifact、历史与恢复 | 已实现 | 规划 | 不得让两个宿主同时打开同一 DB |
| AI 供应商配置、普通对话、Agent、流式恢复与审批 | 已实现 | 规划 | 需要后端及安全存储方案后再比较 |
| MCP 连接池与用户 Skill 管理 | 已实现 | 规划 | sidecar 复用仍需进程和权限边界 |
| 主动研究与 Electron `BrowserWindow` 阅读回退 | 已实现 | 规划 | 不能由无界面 sidecar 直接复用 |
| 本地 Release `.app` / DMG | 已实现 | 已实现 | 未签名，仅用于本地 `shell-only` 实验 |
| 凭据迁移、签名、公证、ZIP 和自动化发行 | Electron Alpha 部分实现 | 规划 | 不纳入首版兼容结论 |

首版可回答“共享 UI 的本地包体下限和人工窗口观感”，并为后续启动、资源与编辑器 A/B 提供相同 renderer route；在 Tauri
自动化 runner 和完整进程树采集器落地前，不发布这些指标的跨宿主快慢结论。它也不能回答完整工作流是否等价。任何体验报告
都应在标题中标注 `shell-only` 或 `parity-stack`；在后端尚未接入时，只能发布 `shell-only` 结果。

## Electron 体积基线

以下基线于 2026-08-25 在当前 Apple Silicon macOS 本地产物上记录。目录值来自 `du -sh`，压缩包同时记录
`stat` 的逻辑字节数；两类口径不能混用。

| 产物 | 基线 | 补充口径 |
| --- | ---: | ---: |
| `Tessera.app` | 239M | 245,116 KiB 已分配空间 |
| `Electron Framework.framework` | 225M | 229,908 KiB 已分配空间 |
| `Tessera-0.1.0-alpha.1-arm64.dmg` | 99M | 103,481,819 bytes |
| `Tessera-0.1.0-alpha.1-arm64.zip` | 106M | 111,102,894 bytes |

后续 Tauri 结果必须分别比较 `.app` 已分配空间、主 framework/runtime 占用、DMG 逻辑字节和 ZIP 逻辑字节。压缩级别、
签名、公证状态、调试符号和 sidecar 是否包含在产物中必须随结果记录。未携带后端的 Tauri 壳层不能直接对标完整 Electron
应用；正式结论以包含实现相同能力的 `parity-stack` 总体积为准。

## Tauri `shell-only` 体积实测

以下结果于同日、同一台 Apple Silicon Mac 上通过 `bun run dist:tauri:mac` 生成；该命令内置 `CI=true`，只跳过 DMG 的
Finder 图标排版脚本，不改变 Release 应用内容。产物未签名、未公证、不含 Node/Bun sidecar，也没有 Electron 已有的工作区、
SQLite、AI、MCP、Skill 与研究后端，因此只能用来观察壳层下限，不能当作完整产品体积结论。

| 产物 | Tauri `shell-only` | 对应 Electron | 本次差值 |
| --- | ---: | ---: | ---: |
| `.app` 已分配空间 | 10M（10,728 KiB） | 239M（245,116 KiB） | 减少 95.62% |
| DMG 逻辑大小 | 7.9M（8,329,012 bytes） | 99M（103,481,819 bytes） | 减少 91.95% |

Tauri 主可执行文件为 9,012,080 bytes，WebKit 由 macOS 提供，因此 `.app` 内没有可与 225M Electron Framework 一一对应的
私有 runtime 目录。当前没有生成 Tauri ZIP；压缩格式之间不做交叉比较。等 sidecar 或 Rust-native 后端达到行为兼容后，必须
重新记录完整进程树与 `parity-stack` 包体，届时上述百分比大概率会收窄。

## A/B 场景与指标

### 首版必测

| 场景 | 指标 | 观测边界 |
| --- | --- | --- |
| 安装与分发 | `.app`、framework/runtime、DMG、ZIP 大小 | Release 构建；记录签名、压缩和 sidecar |
| 冷启动 | 进程创建到首帧、进程创建到首屏可交互 | 同一首屏空态；首次系统冷启动与普通进程冷启动分开报告 |
| 暖启动 | 退出后再次启动到首帧和可交互 | 两端交替执行，保留系统文件缓存 |
| 空闲资源 | 完整进程树 RSS、CPU、进程数、线程数、能耗影响 | 首屏稳定 60 秒后采样；Tauri sidecar 计入总和 |
| 窗口体验 | 显示、拖动、缩放、最小化、全屏、关闭、焦点与快捷键 | 人工检查并记录屏幕刷新率、缩放和外接屏 |
| 编辑器基准 | 解析、建树、打开到帧、transaction、输入到帧、序列化、hover、滚动、慢帧率、堆增量 | 两端使用相同生产 renderer、固定视口和四组版本化语料 |
| 稳定性 | 启动失败、崩溃、无响应、监听泄漏 | 失败样本计入失败率，不从时延样本中静默删除 |

编辑器预算继续来自 `apps/desktop/benchmarks/editor-budget.json`。它用于判断单端是否退化，不等同于两端差异显著；
A/B 报告必须同时保留每端原始 JSON、环境信息和配对差值。

### 后端完成后再测

- 对同一只读工作区快照测 10、1,000、10,000 个 Markdown 文件的枚举、首开、搜索、外部改动和冲突处理；
- 对同一 SQLite 快照测 10,000 个任务的分页、恢复、归档和写入，但每个宿主使用独立副本；
- 用录制的确定性流重放测首 token、稳定吞吐、取消和恢复，在线供应商网络耗时另列，不能归因于宿主；
- 测 MCP / Skill sidecar 的首次启动、常驻开销、崩溃重启、权限提示和升级；
- 测研究阅读的登录态、Cookie 隔离、弹窗、重定向、下载、超时和网页关闭清理。

## 统计口径

每轮实验固定同一 Git commit、Release 优化级别、机器、macOS 版本、电源模式、显示器、分辨率、缩放、刷新率、语言、
主题、窗口尺寸和数据快照。关闭自动更新、索引、备份等已知干扰，实验前记录 CPU、内存和 WebView / runtime 版本。
Electron 与 Tauri 使用不同的应用数据目录，但数据快照内容和配置哈希应相同。

- 启动时间至少做 30 个配对样本；按 `ABBA / BAAB` 次序交替宿主，避免温度、缓存和顺序偏差。
- 空闲资源至少做 10 个配对会话；每次首屏稳定 60 秒，再以 1 Hz 采样 60 秒。RSS 和 CPU 汇总完整进程树，
  sidecar、helper、WebView 内容进程都不能遗漏。
- editor benchmark 至少做 10 个配对的完整 suite。suite 内的 3 次打开、7 次解析和 24 次输入等样本是同一次运行内的
  重复测量，不作为彼此独立的跨宿主样本；先保留每次 suite 汇总，再比较配对差值。
- 时延和资源分别报告每端 median、p95、范围，以及 `Tauri - Electron` 的绝对差和相对差；对配对差值使用 bootstrap
  95% 置信区间。体积同时报告 bytes 与 MiB，并注明逻辑大小或已分配空间。
- 不自动剔除离群值。只排除预先定义的无效样本，例如系统更新、机器休眠或采集器失败，并在报告中列出原因和数量；
  崩溃、超时与无响应属于结果，计入失败率。
- 只有差值方向在至少三轮独立实验中一致，且配对差值的 95% 置信区间不跨过 0，才描述为“可重复差异”；否则只陈述
  本次样本的数值，不下“更快”或“更省”的结论。人工窗口体验单列观察记录，不包装成统计显著性。

“首帧”与“可交互”必须由两端相同的 renderer 标记定义，不使用各自窗口创建回调代替。首次重启后的系统冷启动样本成本高，
单独报告，不与保留文件缓存的普通进程冷启动合并。所有原始报告应保存构建哈希、宿主版本、样本次序和时间戳，保证能够复算。

## 数据与安全边界

### 禁止同时打开同一 DB

Electron 和 Tauri 不得同时连接同一个 SQLite 文件，即使 SQLite WAL 理论上允许多个连接。两个实现可能在启动时运行不同迁移、
维护进程内单例、监听 `-wal` / `-shm` 文件或写入运行状态；并发实验会污染正确性与性能结论，也可能造成不可逆的数据变化。

A/B 必须先完全退出两个应用，再从同一个静态基准快照生成 `electron/` 与 `tauri/` 两份 DB，校验初始哈希后分别运行。
不得在数据库仍打开时直接复制 `.db`、`-wal` 和 `-shm`。需要真实用户数据迁移时使用 SQLite backup 或应用内导出协议，
并在副本上演练；同一 Markdown 工作区也应只读共享或复制后写入，不允许两端并发写。

### `safeStorage` 不兼容

Electron `safeStorage` 生成的密文不是 Tauri 可直接消费的跨运行时格式。首版不迁移供应商密钥，也不把密文当普通配置复制。
后续只能选择用户重新输入，或由仍可解密旧数据的 Electron 版本在明确授权后执行一次性迁移；明文只在内存和受控 IPC 中短暂存在，
不得写日志、基准报告或中间文件。Tauri 侧的新凭据存储还要独立完成 Keychain、锁屏、撤销和失败恢复验证。

两个宿主的 WebView origin 和应用标识也不同，因此 `localStorage`、Cookie 和权限记录默认视为不兼容状态；只迁移有版本号、
有 schema 且明确列入迁移协议的数据。

## Electron 专属能力与 sidecar 局限

研究工作流当前包含 Electron `BrowserWindow` 阅读回退。Tauri 主 WebView、额外 WebView 和 Electron session 在 Cookie、弹窗、
权限、下载、进程隔离与关闭语义上并不等价；无界面的 Node/Bun sidecar 也不能承载 `BrowserWindow`。因此研究能力需要新的
WebView 边界或服务端读取路径，并重新通过安全和体验验收，不能简单转发现有实现后标记兼容。

长期驻留的 Node/Bun sidecar 是复用数据库、AI、MCP、Skill 与 Agent Runtime 的最快路径，但它会带来：

- runtime 和原生模块随包分发，`better-sqlite3` 的架构、ABI、签名和公证必须与目标机器一致；
- 独立进程的启动握手、身份校验、消息 framing、背压、取消、崩溃重启、日志脱敏和退出清理；
- helper 的权限、沙盒、自动更新和版本配对，以及 sidecar 失联时 renderer 的确定性降级；
- 额外体积、RSS、CPU 与能耗。所有 A/B 指标必须汇总完整 sidecar 进程树，不能只测较轻的 Tauri 壳。

sidecar 是迁移策略，不是“原生 Tauri”结论。报告必须注明 `shell-only`、`Tauri + sidecar` 或 `Rust-native`，三种结果不可混合。

## 后续阶段

1. **阶段 0，部分实现**：稳定壳层、共享 renderer、67 方法 bridge 形状、空态和 editor benchmark route；补齐 Tauri
   自动化 runner 与进程树采集器后，再产出第一份 `shell-only` A/B 原始报告。
2. **阶段 1，规划**：实现工作区选择、Markdown 读写、监听、冲突和窗口关闭协议；用复制工作区完成端到端验收。
3. **阶段 2，规划**：确定 Node/Bun sidecar 或 Rust-native 数据层，接入 SQLite、任务、Artifact 和历史；建立版本化 DB
   迁移与互斥启动保护。
4. **阶段 3，规划**：接入凭据、AI 流式通道、Agent、MCP 与 Skill；完成取消、背压、审批、崩溃恢复和完整进程树测量。
5. **阶段 4，规划**：替代研究 `BrowserWindow`，验证 Cookie / 权限 / 弹窗边界；完成 Electron 凭据的一次性安全迁移方案。
6. **阶段 5，规划**：补齐签名、公证、DMG / ZIP、升级与回滚；运行完整 `parity-stack` A/B 后，再决定是否替换 Electron
   或长期保留双宿主。

每个阶段完成时同步本矩阵和状态。只有 67 项行为契约、关键数据迁移、发行安全与完整工作流都通过后，才能把本文状态改为
“已实现”并使用“完全互相兼容”的表述。
