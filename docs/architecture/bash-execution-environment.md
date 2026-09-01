# Bash ExecutionEnvironment：macOS 前台工作区执行边界

> 代码源头：`packages/agent-runtime/src/execution-environment.ts`、
> `packages/agent-runtime/src/workspace-file-capabilities.ts`、
> `packages/ai/src/server/workspace-tools.ts`、
> `apps/desktop/src/main/workspace-execution-environment.ts`、
> `apps/desktop/src/main/workspace-agent-tools.ts`、
> `apps/desktop/src/main/index.ts`
>
> 状态：**macOS 已实现，其他平台未启用。** P4 为当前授权工作区提供无网络、无宿主 Secret、前台限定的
> `bash`。能力探针失败时不注册工具，不退回到未隔离 Shell。

## 1. 结论

Tessera 已把工作区核心收敛为 Pi 风格的 `read/edit/write/bash`，但没有把进程 cwd 当作安全边界。
`bash` 通过可替换 `ExecutionEnvironment` 端口进入 Electron 主进程；当前本地实现只在 macOS 上使用
`/usr/bin/sandbox-exec` 和 Seatbelt profile。其他平台、Seatbelt 不可用或探针失败时，模型只获得
`read/edit/write`。

```text
AI SDK ToolLoopAgent
  -> bash Tool Schema
  -> WorkspaceAgentTools.bash
  -> ExecutionEnvironment
  -> macOS Seatbelt + 独立进程组
  -> 当前授权工作区
  -> 有界结果 + 真实文件事件
```

这一能力服务于工作区探索、构建、测试和短脚本，不是交互终端、后台服务管理器、远程执行器，也不是运行
不受信任第三方代码的通用容器。

## 2. 稳定端口

`@tessera/agent-runtime` 只暴露与 AI SDK、Electron 和 `node:child_process` 无关的契约：

- `ExecutionEnvironment.descriptor` 公开隔离类型、网络和 Secret 策略；
- `execute(input, access, signal)` 接收命令、可选超时、工作区读写级别和 `AbortSignal`；
- 结果固定包含退出码、signal、终止原因、耗时、stdout/stderr 截断事实和实际变化文件；
- `WorkspaceAgentTools` 组合必需的 `read/edit/write` 与可选 `bash`，不预设平台一定支持执行环境。

当前 descriptor 是：

| 字段 | macOS 当前事实 |
| --- | --- |
| `id` | `macos-seatbelt-v1` |
| `isolation` | `macos-seatbelt` |
| `network` | `denied` |
| `secrets` | `cleared` |

未来远端或其他本地实现必须满足同一终态结果，但不能谎报与 macOS 相同的隔离能力。

## 3. 注册与授权

每次带工作区的模型 run 在工具装配前执行能力探针：

1. 平台必须是 macOS，且 `/usr/bin/sandbox-exec` 可执行；
2. 工作区根先经过 `realpath`；
3. 用只读 profile 执行 `/usr/bin/true`；
4. 只有探针正常退出时，`WorkspaceAgentTools` 才包含 `bash`；
5. 任一步失败都返回 `null`，ToolSet 中不会出现一个执行时才降级到宿主 Shell 的假工具。

工作区是用户通过系统目录选择器打开并由主进程登记的资源。`RunPolicy.toolScope` 决定本轮 Bash 级别：

| Tool scope | Bash 工作区权限 |
| --- | --- |
| `workspace-write` | `read-write` |
| `workspace-read` | `read-only` |
| `conversation` | `read-only`；且只有当前请求确实相关时才装配工作区工具 |

当前前台工作区 Bash 不逐次审批。这是工作区授权的延伸，不会同时授权网络、宿主 Secret、工作区外路径、
后台任务或 MCP。MCP 仍是独立信任域并逐工具审批。

## 4. macOS Seatbelt 策略

每次调用创建独立临时目录和 profile，命令以以下结构启动：

```text
sandbox-exec -p <profile> /bin/sh -c <command>
```

### 4.1 文件系统

- cwd 固定为已规范化的当前工作区根；模型不能传入 cwd。
- `read-only` 允许读取工作区，但拒绝在其中创建或改写文件。
- `read-write` 允许读写工作区。
- 两种级别都拒绝读取和写入工作区外的普通用户文件。
- profile 只为 cwd 路径祖先开放精确的目录元数据，不开放祖先目录内容。
- 隔离 HOME、TMPDIR 和可选命令软链接位于每次调用的独立临时目录；完成后删除。
- 标准系统命令目录可读、可执行；`rg` 若存在，只把解析后的单一可执行文件映射进隔离 PATH。

直接 `read/edit/write` 仍只接受可见 Markdown。`bash` 是更通用的工作区能力，可以读取或生成工作区内的
其他文件；Artifact 登记仍只接受符合 Tessera 内容边界的可见 Markdown。

### 4.2 环境与 Secret

子进程不继承 `process.env`。主进程构造一份新的最小环境，只包含隔离 HOME/TMPDIR、固定 PATH、locale、
shell 和无权限身份标签。API Key、MCP 环境变量、代理变量和其他宿主 Secret 都不会进入命令环境。

这不表示工作区内文件天然不含 Secret。用户把凭据文件放进已授权工作区后，Bash 仍可能按该轮工作区读取权限看到它；
因此“Secret 清空”特指宿主进程环境不继承，不是工作区内容分类系统。

### 4.3 网络

Seatbelt 采用 deny-by-default profile，未授予 network 权限。真实测试在宿主进程建立本机回环监听端口，隔离命令
无法连接且宿主未收到连接，避免把 DNS 或公网不可用误判为网络隔离。

## 5. 命令生命周期

P4 只支持一次性前台命令：

- 默认超时 30 秒，可请求 1–120 秒；
- 子进程以独立进程组启动；
- timeout 或 Abort 先向整个进程组发送 `SIGTERM`，250ms 后仍未退出则发送 `SIGKILL`；
- 即使顶层 shell 正常退出，也会清理同组中不受支持的重定向后台进程；
- Promise 只在 child `close` 后结束，因此主进程已经看到进程退出和 stdio 关闭；
- Abort 在进程和输出收口后抛出稳定取消错误，不把仍在运行的命令伪装为已取消。

后台服务、daemon、交互 TTY 和主动脱离当前进程组的程序不属于支持契约。Seatbelt 仍限制此类进程的文件与网络权限，
但 P4 不把它们宣传为可管理的长期任务；需要该能力时必须另建可追踪 PID/租约/回收的执行项目。

## 6. 输出预算

stdout 和 stderr 始终被持续 drain，避免子进程因 pipe 写满而阻塞；每条流最多保留 65,536 字节。超过上限的内容
继续读取但不再保存，并分别设置 `stdoutTruncated` / `stderrTruncated`。P4 不把命令原始流实时广播到 renderer，
所以不存在另一份无界 UI 输出队列。

命令文本最多 32,768 字符。输入为空、包含 NUL 或 timeout 越界会在启动进程前失败。

## 7. 文件事件与 Artifact

命令执行期间，主进程只监听工作区真实文件事件，不在命令后递归扫描整个目录推断副作用：

1. `fs.watch({ recursive: true })` 收集最多 128 个可见相对路径；
2. 隐藏目录、`.git`、`.tessera` 和 `node_modules` 不进入 Artifact 候选；
3. 命令收口后只复核事件路径是否仍是工作区内真实普通文件；
4. 主进程只读取符合大小/路径边界的 Markdown，并用实际 hash 与 mtime 登记 Document/Artifact；
5. 首次被索引的 Bash 文件关系是 `created`，已有文档后续是 `updated`；
6. 观察或登记失败不会把已经执行的命令改报成可重试失败，避免模型重放副作用。

`changesTruncated` 表示事件过多或 watcher 异常。P4 不以一次全目录扫描补齐遗漏；未登记的非 Markdown 或中间文件
仍留在工作区，由文件系统本身作为事实源。

## 8. 已验证矩阵

普通测试默认覆盖平台无关的前台 runner；真实 Seatbelt 测试必须显式设置
`TESSERA_TEST_MACOS_SANDBOX=1`，避免不支持平台产生伪失败。

| 场景 | 当前验证 |
| --- | --- |
| stdout 超限 | 结果保留 65,536 字节并标记截断，命令仍能退出 |
| timeout | 包含后台子进程的进程组在上限内收口 |
| Abort | 等待进程组和 stdio 收口后结束 |
| 正常 shell + 后台进程 | shell 返回后清理同组后台进程，不产生迟到 marker |
| 工作区只读 | 读取可用，创建 Markdown 被拒绝 |
| 工作区读写 | `ls` / `find` 与文件创建可用，真实文件事件返回 |
| 工作区越界 | 工作区外普通文件不可读写 |
| 宿主 Secret | 测试先注入真实环境变量，子进程仍看不到 |
| 网络 | 无法连接宿主已监听的回环端口 |
| `rg` | 能力探针后的隔离 PATH 可执行 `rg` |
| Artifact | Bash 新建 Markdown 首次登记为 created，后续事件为 updated |

## 9. 已知限制与后续触发器

- `sandbox-exec` / Seatbelt 是 macOS 特定机制；Windows、Linux 和 Tauri 当前不注册 Bash。
- 当前没有远端执行、容器镜像、持久终端、端口转发、GPU、交互输入或带 Secret 的命令。
- 工作区读写授权粒度是整轮 `RunPolicy`，尚未提供路径子集挂载或单命令升级。
- watcher 是产物提示，不是完整审计日志；安全边界来自 Seatbelt，不能反过来依赖 watcher 阻止访问。
- 主动创建新 session/process group 的后台程序超出支持契约；若真实任务需要长期子进程，必须先引入可证明的
  descendant 跟踪、租约和崩溃恢复，再改变工具说明。

任何新增平台、网络、Secret、后台、远端或更宽文件能力，都必须同步端口 descriptor、威胁模型、工具说明和真实隔离测试；
不得只修改 Prompt 或把 cwd 重命名为 sandbox。
