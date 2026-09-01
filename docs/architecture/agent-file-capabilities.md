# Agent 本地文件能力：`read/edit/write` 与 Bash 接口事实

> 当前代码源头：`packages/agent-runtime/src/workspace-file-capabilities.ts`、
> `packages/ai/src/server/workspace-tools.ts`、
> `apps/desktop/src/main/read-only-agent-tools.ts`、
> `apps/desktop/src/main/workspace-agent-tools.ts`、
> `apps/desktop/src/main/workspace-execution-environment.ts`、
> `apps/desktop/src/main/workspace-file-mutation-queue.ts`、
> `apps/desktop/src/main/agent-change-service.ts`
>
> 状态：**P1 文件能力与 P4 工具收敛已实现。** 新运行使用 `read/edit/write`，macOS 隔离探针通过时再增加 `bash`；
> 独立列表/搜索工具已删除。普通工作区修改不逐次审批；旧文件审批只读兼容，不再拥有磁盘写入入口。
>
> 一期阶段和后续删除顺序见 [Pi 参考下的 Agent 减法实施路线图](agent-simplification-roadmap.md)。

## 结论

Tessera 已采用 Pi 的薄文件工具形态，但没有采用其裸宿主权限模型。模型看到三个稳定文件动作与平台允许时的
受控 Bash，安全和一致性由主进程执行器保证：

```text
AI SDK ToolLoopAgent
  -> workspace-tools.ts：Schema / Tool adapter
  -> WorkspaceAgentTools：供应商无关端口
  -> workspace-agent-tools.ts：read/edit/write/bash 语义
  -> 文件路径/版本提交边界 + 可选 ExecutionEnvironment
  -> 当前授权工作区
```

renderer 不访问 Node、绝对工作区根不进入模型、数据库不保存 Markdown 正文。工具变少不意味着数据保护变少。

## Pi 参考与 Tessera 取舍

Pi 研究固定在 0.84.4。P1 直接复核了其 MIT 源码中的 `read.ts`、`edit.ts` 与 `write.ts`，采用的是行为机制：分页读取、
精确替换、基于原文定位多个 edit、BOM/换行保护和单文件写入序列化。Tessera 独立实现端口和执行器，并保留更严格的
工作区约束。

| 维度 | Pi 机制 | Tessera 当前实现 |
| --- | --- | --- |
| 模型工具 | `read/edit/write/bash` | `read/edit/write` 始终可用；macOS 隔离探针通过时增加 `bash` |
| 路径范围 | 继承 coding agent 进程权限 | 文件工具只操作可见 Markdown；Bash 由 Seatbelt 限制在当前工作区 |
| 符号链接 | 宿主文件系统语义 | `realpath` 后再次校验，不允许逃逸工作区 |
| 读取 | offset/limit 与截断 | 行分页 + 超长单行 UTF-8 字节续读 + 50 KiB 预算 + 完整文件 SHA-256 |
| 编辑 | 精确文本替换 | 唯一、互不重叠、同一原文定位的多 edit |
| 写入串行 | 每文件队列 | canonical target queue 覆盖复核和提交 |
| 外部修改 | 工具实现决定 | update/edit 强制绑定最近读取的 SHA-256，临近提交再次复核 |
| 提交 | 直接文件写入 | 同目录临时文件；create 不覆盖，update 复核后原子 rename |
| 授权 | coding agent 会话授权 | 用户打开工作区后普通读写授权，无逐次文件审批 |

## 当前分层

### Capability contract

`@tessera/agent-runtime` 只表达模型需要的文件语义：

- `read(input, signal)`；
- `edit(input, signal)`；
- `write(input, signal)`；
- 可选 `bash(input, access, signal)`，通过独立 `ExecutionEnvironment` 契约执行。

端口不依赖 AI SDK、Electron、SQLite 或 `node:fs`。稳定返回值明确区分 `saved` 与 `conflict`，调用方不需要解析异常文字
判断版本竞争。

### AI SDK adapter

`packages/ai/src/server/workspace-tools.ts` 持有 Zod Schema、工具说明和 `AbortSignal` 适配。新工具名固定为：

- `read`
- `edit`
- `write`
- `bash`（仅当主进程注入通过能力探针的执行环境）

四个核心工具都不设置 `needsApproval`。当前文档路径由 run input 进入 instructions，不再为同一个文件注册
`read-current-document`。旧 `read-workspace-file`、`write-workspace-document` 和 `delegate-workspace-research` 不再出现在
新 ToolSet；`list-workspace-files` 与 `search-workspace-text` 也已由 Bash 的 `ls/rg/find` 取代。

### 主进程执行器

`read-only-agent-tools.ts` 保留共享安全原语：相对路径解析、扩展名/隐藏目录限制、真实路径校验、hash、有界读取和
原子文件提交。`workspace-agent-tools.ts` 在其上实现新语义；`workspace-file-mutation-queue.ts` 对同一个
canonical target 串行执行“复核 + 提交”。

`bash` 不复用 Markdown 文件原语冒充通用执行权限；它通过
[Bash ExecutionEnvironment](bash-execution-environment.md)获得平台声明、只读/读写级别、Secret/网络隔离、进程组收口、
输出预算与真实文件事件。

## 工具契约

### `read`

输入：工作区相对路径，可选从 1 开始的 `offset` 与 `limit`；续读异常长的单行时，同时传入上一段返回的
`nextLineByteOffset` 作为 `lineByteOffset`。

返回：

```ts
{
  path,
  size,
  modifiedAt,
  contentHash,
  content,
  range: {
    startLine,
    endLine,
    totalLines,
    lineByteRange: { startByte, endByte, totalBytes } | null,
  },
  truncation: {
    truncated,
    reason: "lines" | "bytes" | null,
    nextOffset,
    nextLineByteOffset,
    lineTruncated,
    maxBytes,
  },
}
```

约束：

1. 默认最多 400 行，调用方最多请求 1,000 行。
2. 单次正文最多 50 KiB UTF-8。
3. 完整行被字节预算截断时，`nextOffset` 指向下一行。
4. 单行本身超限时返回安全 UTF-8 分片、`lineByteRange`、同一行的 `nextOffset` 与
   `nextLineByteOffset`；调用方可以无损续读，不再只有不可继续的前缀。
5. `contentHash` 始终基于完整磁盘文件，分页不改变版本身份；但 hash 只是版本身份，不代表模型已经看过全部正文。
6. 主进程按当前工具实例和 hash 记录已完整读取的行/单行字节区间；版本变化会清空该版本的读取许可。
7. 只允许普通 Markdown 文件；绝对路径、穿越、隐藏目录和工作区外符号链接会在主进程拒绝。

### `edit`

输入包含 `path`、最近一次 `read` 的 `baseContentHash` 和一组 `{ oldText, newText }`。

执行规则：

1. 一次最多 64 个 edit，空 `oldText` 无效。
2. 每个 `oldText` 必须在原文中恰好出现一次。
3. 所有 edit 都在同一个原始版本上定位，范围不得重叠。
4. 模型传入 LF 文本时可以匹配 CRLF 文件；提交后保持原文件 CRLF 风格。
5. UTF-8 BOM 从匹配正文中剥离，提交时恢复。
6. 进入同文件队列后重新读取磁盘；hash 不一致返回 `conflict`，不会尝试模糊覆盖。
7. 新正文经过文件大小复核，再用同目录临时文件原子替换。

确定性失败包括：未找到、非唯一匹配、重叠 edit、结果超限和版本冲突。工具不做模糊相似匹配，也不让模型通过
Prompt 决定覆盖策略。

### `write`

`operation=create`：

- 不允许携带 `baseContentHash`；
- 目标已存在时返回 `conflict`；
- 同目录临时文件写完后使用不覆盖语义提交。

`operation=update`：

- 必须携带最近一次 `read` 的 `baseContentHash`；
- 必须在当前运行中读完该 hash 对应的所有行与超长单行分片；只拿到部分正文和完整 hash 不能获得整篇覆盖许可；
- 在同文件队列中复核完整磁盘 hash；
- 临近原子替换时重新解析目标并再次读取、复核 hash；版本一致后才替换，否则返回 `conflict`。

完整写入适合创建或确实需要整体重写的文件；已有文件的小范围变更应优先使用 `edit`。

## 取消与提交点

文件副作用采用明确提交点：

```text
检查 Abort
  -> 写入同目录临时文件
  -> 再次检查 Abort
  -> 重新解析目标并复核预期 hash
  -> 原子 link / rename（提交点）
  -> 返回 committed result
```

提交点前取消会清理临时文件且不改变目标。提交点后才到达的 Abort 不能把已提交写入伪装成失败，否则上层重试可能重复
副作用。更完整的 run terminal 与工具结果唯一性由 P3 继续补齐。

## 旧审批兼容边界

旧 `agent_change_proposals` 和 `tool-write-workspace-document` 仍可能存在于用户历史，因此不能直接删表或让 renderer 失去
Diff：

- renderer 继续显示旧 Tool Part 和历史 Diff；
- `agent-change-service.ts` 只允许预览、决定对账和失效终态；
- 新运行不注册旧写工具，也不创建新 proposal；
- 用户批准旧 pending proposal 时，记录收口为 `failed`，错误明确说明“未执行磁盘写入”；
- 主进程拒绝用旧批准继续运行，并引导用户发送新消息；
- 模型历史投影按当前 active tool names 过滤，旧审批不会进入新 ToolSet 的续轮上下文；
- 已发布迁移 `0004-agent-runs-and-changes` 保持不变。

兼容代码只读历史，不构成双运行时。

## 已验证不变量

- read 分页、字节截断和完整 hash；
- 超长 UTF-8 单行可按字节边界无损续读；
- 未读完同版本所有分页/单行分片时，`write update` 拒绝整篇覆盖；
- 绝对路径、目录穿越、工作区外符号链接、非 Markdown 和超大文件拒绝；
- 多 edit 的唯一性、无重叠、同一原文定位；
- UTF-8 BOM 与 CRLF 保留；
- create 不覆盖、update/edit 外部版本冲突，底层写原语在临近提交时再次复核预期 hash；
- 同一基准的并发 edit 恰好一次保存、一次冲突；
- Abort 在提交点前不产生副作用；
- 新工具不要求 AI SDK approval；
- `ls/rg/find` 已在真实 macOS Seatbelt 测试中通过，旧列表/搜索模型工具已删除；
- Bash 越界、网络、宿主 Secret、输出、timeout、Abort 与后台进程组边界可验证；
- 旧 approval 可审计但永不写盘；
- 旧 Tool Part 保持可见，同时从新模型上下文隔离。

P1 的文件能力和 P4 的执行边界分别保留阶段验证记录；当前完整 P4 事实与 opt-in 真实隔离命令见
[Bash ExecutionEnvironment](bash-execution-environment.md)。

## 后续顺序

1. P1–P4 已完成文件核心、Runtime/Prompt 减法、运行可靠性和受控 Bash。
2. P5 已从 Run/Event 与文件成功事实投影 Progress、Execution Context 和 Artifact，没有重新让模型理解项目管理状态机。
3. Windows/Linux/远端执行只有在提供同等级真实隔离测试后才能注册 Bash，不使用未隔离 fallback。
