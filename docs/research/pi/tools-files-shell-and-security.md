# Pi 工具、文件、Shell 与安全边界

> Pi 证据：`packages/coding-agent/src/core/tools/index.ts`、
> `packages/coding-agent/src/core/tools/read.ts::createReadToolDefinition`、
> `packages/coding-agent/src/core/tools/write.ts::createWriteToolDefinition`、
> `packages/coding-agent/src/core/tools/edit.ts::createEditToolDefinition`、
> `packages/coding-agent/src/core/tools/bash.ts::createBashToolDefinition`、
> `packages/coding-agent/src/core/tools/file-mutation-queue.ts::withFileMutationQueue`、
> `packages/coding-agent/src/utils/shell.ts`、
> `packages/coding-agent/docs/security.md`、
> `packages/agent/src/harness/types.ts::ExecutionEnv`
>
> Tessera 对照：`packages/agent-runtime/src/workspace-file-capabilities.ts`、
> `packages/ai/src/server/agent-runtime.ts`、
> `apps/desktop/src/main/read-only-agent-tools.ts`、
> `apps/desktop/src/main/agent-change-service.ts`、
> `apps/desktop/src/main/workspace-file-mutation-queue.ts`、
> `docs/architecture/agent-file-capabilities.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Pi 默认工具是 `read`、`bash`、`edit`、`write`。它们的实现质量并不粗糙：有分页/截断、图片读取、精确编辑、同文件队列、
进程树终止、流式输出和可替换 operations。但安全模型非常明确：以启动 Pi 的用户权限在本机工作，不内置 sandbox，也不默认
逐调用审批。

因此 Pi 的工具代码可以作为 capability adapter 参考，不能把其信任模型带入 Tessera。Pi 自己也要求不受信任或无人看管任务
使用容器、VM、micro-VM 或外部 policy sandbox。

## 1. 默认与可选工具

| 集合 | 工具 |
| --- | --- |
| 默认 coding tools | `read`、`bash`、`edit`、`write` |
| 全部内置 | 上述加 `grep`、`find`、`ls`，Windows 另有 PowerShell 适配 |
| read-only set | `read`、`grep`、`find`、`ls` |

SDK 可传显式 tools、allowlist、denylist 或 `noTools`。工具定义和 AgentTool wrapper 分开，方便 TUI renderer、扩展 hook 与新
Harness 复用同一 schema/operations。

## 2. 路径边界

旧 built-in tools 接受相对路径、绝对路径和 `~`。相对路径按 Session cwd 解析，但没有“必须位于 cwd 内”的校验。符号链接、
父目录和绝对路径遵循本机文件系统权限。

这与 Pi 的安全声明一致：cwd 是工作便利和 prompt 上下文，不是 capability root。Project Trust 也不会改变工具路径范围。

Tessera 的 workspace tools 只接受授权工作区内可见相对 Markdown 路径，主进程规范化、realpath 后再次校验符号链接。这一
差异必须保留。

## 3. `read`

`read` 支持文本与图片：

- 默认最多约 2000 行或 50 KiB；
- 支持 offset/limit；
- 截断时返回继续读取提示；
- 单行超过预算时明确提示，并建议用 Bash 等手段读取；
- macOS 上处理 Unicode 文件名规范差异；
- 图片按模型可接受的 image content 返回。

优点是 tool result 有硬预算，长文件不会直接塞满上下文。风险是建议使用 Bash 作为 escape hatch 会绕开 read 的截断协议和
任何未来只加在 read 上的审计。

Tessera 当前分页读取默认 400 行、50 KiB，返回 `nextOffset`、完整文件 hash 和结构化 truncation；其协议更适合产品 UI 和
更新版本复核，应保持结构化结果。

## 4. `write`

`write` 会创建父目录并直接 `writeFile`，存在目标时覆盖。它通过同文件 mutation queue 串行本进程写入，并在关键阶段检查
AbortSignal。

缺口：

- 不要求 base version；
- 不先生成 Diff；
- 无默认审批；
- 没有统一 temp + fsync + atomic rename；
- 外部进程并发修改无法检测；
- abort 发生在底层 write 已提交后不能撤销。

这对用户监控下的 coding CLI 是一致取舍，不满足 Tessera 的知识库文档和桌面产品写入要求。

## 5. `edit`

`edit` 接受一组 oldText/newText edits：

1. 校验 edits 非空且目标唯一；
2. 读取原文件；
3. 计算所有非重叠替换；
4. 保留 BOM 与行尾风格；
5. 在同文件 queue 内再次读取并应用；
6. 写回完整文件；
7. 返回 diff/details。

它比模糊 search/replace 更可预测，多 edit 以同一原始版本定位，避免前一个替换改变后一个 offset。

但队列只防同一 Pi 进程竞争，不用 content hash 检测外部编辑；直接写回也没有批准后的二次版本复核。Tessera 规划中的
`propose-workspace-edits` 可以吸收“确定性、不重叠 edits -> 完整候选 -> Diff”，最终 commit 仍复用现有审批、hash 与原子写。

## 6. 同文件 mutation queue

queue key 优先使用 existing file 的 realpath，缺失目标使用 resolved path。相同 key 串行，不同文件并行；失败在 finally 后
释放后继。

这是正确的进程内临界区抽象，但不是锁、版本控制或事务。Tessera 已把 queue 覆盖“批准后重新读取 -> 版本比较 -> 原子写入”
整个临界区，且用 `modifiedAt + SHA-256` 发现外部修改，边界更完整。

## 7. `bash`

Bash tool 的能力包括：

- 任意 shell command；
- 可选 timeout，默认无 timeout；
- Abort/timeout 时终止进程树；
- stdout/stderr 合并并以约 100ms 节流更新；
- 最终结果保留尾部约 2000 行/50 KiB；
- 截断时将完整输出保存到临时文件并返回路径；
- 支持 command prefix、spawn hook 和替换 operations；
- 注入 `PI_SESSION_ID`、`PI_SESSION_FILE`、`PI_PROVIDER`、`PI_MODEL`、`PI_REASONING_LEVEL` 等 session 元数据。

工程上它解决了本地 coding agent 的核心问题：长输出不淹没模型、子进程可终止、SSH/container adapter 可以替换底层操作。

安全和产品风险：

- 任意代码执行并继承进程环境与凭据；
- 默认无 timeout；
- 输出临时文件路径再次成为模型可访问资源，生命周期不明显；
- command string 难做参数级权限和幂等；
- session/provider 元数据进入任意子进程；
- Shell 可读写任何用户可访问路径，绕开文件工具限制；
- cancel 不保证已经完成的外部副作用回滚。

Tessera 不应把 Bash 放进基础 workspace capability。脚本应由固定 Skill/script identity、参数 schema、解释器、cwd、环境白名单、
timeout、网络/写入权限、输出预算和独立审批共同定义。

## 8. Project Trust 到底保护什么

Pi 官方 Security 文档明确：

- 信任控制项目 settings/resources/packages/extensions 是否加载；
- `AGENTS.override.md`、`AGENTS.md`、`CLAUDE.md` 等 context files 即使未信任也可加载；
- 信任不是 sandbox；
- 信任不限制模型之后要求工具做什么；
- prompt injection 是本地 Agent 预期风险；
- extensions 与 built-in tools 都使用 Pi 进程权限。

所以需要分清：

```text
Project Trust      是否让项目代码/配置进入 Pi 运行时
Active Tools       模型本轮看得到哪些工具
Approval           某个具体参数是否获准执行
Sandbox/OS policy  执行即使被诱导时实际能碰到什么
```

Pi 默认只完整提供前两项，后两项由 extension 或外部隔离环境补充。

## 9. 新 `ExecutionEnv` 的意义

下一代 Harness 把 FileSystem 与 Shell 合成 `ExecutionEnv`，文件、目录、canonical path、temp、rename、exec 都返回 typed
Result。NodeExecutionEnv 只是一个实现；Gondolin/container/remote 后端可以替换。

这是健康方向，因为工具不再硬依赖 `node:fs`。但 `ExecutionEnv` 是 I/O 抽象，不自动提供授权：若实现仍直接暴露宿主用户文件和
环境，它与旧工具的权限相同。

Tessera 的 `WorkspaceAgentTools` 已经是更窄的领域端口，不应降级成通用 FileSystem。未来脚本执行可以单独引入受控
ExecutionEnv，但 workspace 文档工具继续使用领域语义。

## 10. Tessera 对照与结论

| 维度 | Pi | Tessera |
| --- | --- | --- |
| 路径 | cwd 便利，绝对/父路径可用 | 授权根内相对 Markdown 路径 |
| 写入 | 直接 edit/write | proposal -> approval -> version recheck -> atomic apply |
| Shell | 默认 active | 默认不存在，规划为独立 capability pack |
| 并发 | 同进程同文件串行 | 规范路径串行 + 外部版本冲突 |
| 输出 | 通用文本截断 | 结构化、领域级预算 |
| 沙箱 | 外部提供 | 主进程能力上限 + 未来隔离执行器 |
| UI 审查 | 终端用户自行看 diff/git | 标准审批与 Diff preview |

## 11. 建议

1. 采纳 Pi 的 ToolDefinition/operations 分离和流式有界输出，不采纳默认权限。
2. 实现 `propose-workspace-edits` 时复用 Pi 的确定性多 edit 思路，但 commit 始终走 Tessera 现有提案服务。
3. 为每个 ToolResult 定义模型摘要、UI 展示、审计记录三种不同投影。
4. 通用 Shell 继续保持规划状态，先完成 Skill script runner 的固定入口和隔离威胁模型。
5. 在 capability 文档中持续明确 Trust、Visibility、Approval、Sandbox 四个维度。
6. Abort 后执行器重新检查 run lease；已完成的副作用进入 effects-draining 和审计，不伪装成已撤销。
