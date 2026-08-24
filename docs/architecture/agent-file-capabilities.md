# Agent 本地文件能力评估与收敛设计

> 代码源头：`packages/agent-runtime/src/workspace-file-capabilities.ts`、
> `packages/ai/src/server/agent-runtime.ts`、
> `apps/desktop/src/main/read-only-agent-tools.ts`、
> `apps/desktop/src/main/workspace-file-mutation-queue.ts`、
> `apps/desktop/src/main/agent-change-service.ts`
>
> 状态：部分实现。类型化端口、有界分页读取、工作区路径边界、人工审批、版本复核、同文件变更队列和原子写入已实现；
> Patch 编辑、Skill 脚本执行器、可替换远端后端与通用命令能力仍在规划中。

## 结论

Tessera 不应复制 Pi 默认的“以当前用户权限直接访问本机文件和 Shell”信任模型，但应该学习它把文件能力从 Agent
循环中剥离出来的结构。目标不是让 Agent Kernel 理解文件系统，而是让它只消费一个小而稳定的 capability contract：

```text
Model / ToolLoopAgent
  -> AI SDK Tool Schema Adapter
  -> Workspace File Capability Contract
  -> 主进程授权、路径、预算、审批与审计边界
  -> Local Markdown Backend
```

这一结构同时满足三个目标：模型上下文不包含实现源码；桌面渲染层不能访问 Node.js；未来可以在不修改 Agent Loop 的
前提下替换本地目录、托管内容库、容器或远端工作区适配器。

## Pi 与 Tessera 的取舍

| 维度 | Pi | Tessera 决策 |
| --- | --- | --- |
| Agent 核心 | 统一 Tool 契约，文件行为下沉 | 保留 AI SDK `ToolLoopAgent`，文件能力通过独立端口注入 |
| 常用能力 | `read`、`edit`、`write`、`grep`、`find`、`ls` | Markdown 列表、分页读取、纯文本搜索、受批准文档变更 |
| 逃生能力 | 任意 `bash` | 默认不提供 Shell；脚本和命令必须使用独立 capability pack |
| 路径范围 | 相对路径或绝对路径，默认继承进程权限 | 只接受当前授权工作区的可见相对路径 |
| 符号链接 | 默认本机文件语义 | `realpath` 后再次校验，禁止链接扩大范围 |
| 读取预算 | 默认按行数和字节数截断 | 单次 400 行、最多 1,000 行且独立限制 50 KiB，返回结构化续读位置 |
| 修改方式 | 精确/有限模糊文本替换后直接写入 | 当前提交完整候选 Markdown，先冻结 Diff 和基准版本，再等待批准 |
| 写入并发 | 按真实文件路径串行 | 按主进程解析后的规范目标路径串行“复核 + 原子写入” |
| 冲突检测 | 主要防止同进程并发写 | 同进程队列之外，再比较 `modifiedAt + SHA-256` 防止外部修改 |
| 原子性 | 完整覆盖写，未统一使用原子替换 | 同目录临时文件，创建使用 hard link，更新使用 rename |

Pi 的轻量来自薄协议和可替换 operations，不来自沙箱。Tessera 采用前者，同时保留桌面产品所需的权限、审批和恢复边界。

## 当前分层

### Agent Kernel

`ToolLoopAgent` 负责模型循环、工具选择、参数校验、停止条件和工具结果回送，不导入 `node:fs`，也不持有工作区绝对路径。

### AI SDK 适配层

`packages/ai/src/server/agent-runtime.ts` 把 capability contract 映射为模型可见工具：

- 工具名、描述和 Zod `inputSchema`；
- 本轮工作区相关性与 RunPolicy 工具收窄；
- `needsApproval` 写入暂停；
- `AbortSignal` 和 `toolCallId` 传递。

这一层不再声明主进程文件操作返回 `unknown`，也不决定路径、文件类型或写入策略。

### Capability contract

`@tessera/agent-runtime` 的 `workspace-file-capabilities.ts` 定义：

- 列表、读取和搜索输入输出；
- 读取范围与结构化截断信息；
- 创建/更新候选文档输入；
- 只读与可写工作区 capability 组合；
- 与具体 AI SDK 和桌面实现无关的执行上下文。

端口只表达 Agent 需要的语义，不暴露 `readFile`、`rename`、SQLite 表或绝对路径。

### 主进程后端

Electron 主进程闭包持有真实工作区根目录，并负责：

- 规范化相对路径；
- 拒绝绝对路径、目录穿越、隐藏目录和 NUL；
- 对已存在目标执行 `realpath`，防止符号链接逃逸；
- 只允许 Markdown 和普通文件；
- 限制文件、扫描、搜索和单次读取结果体积；
- 计算完整文件 SHA-256；
- 冻结写入提案、等待审批、复核版本并原子落盘；
- 记录提案、决策、冲突和完成状态。

## 有界读取协议

之前单个合法 Markdown 最多可以把 256 KiB 正文一次性送入模型。文件体积限制保护了主机，却不能防止一次工具结果挤占
大量上下文。现在读取输入增加可选 `offset` 和 `limit`：

```ts
readWorkspaceFile({
  path: "notes/design.md",
  offset: 401,
  limit: 200,
})
```

返回结果同时包含完整文件版本和本次窗口：

```ts
{
  path,
  size,
  modifiedAt,
  contentHash,
  content,
  range: { startLine, endLine, totalLines },
  truncation: {
    truncated,
    reason: "lines" | "bytes" | null,
    nextOffset,
    lineTruncated,
    maxBytes,
  },
}
```

规则如下：

1. 默认最多返回 400 行，调用方最多请求 1,000 行。
2. 无论行数参数如何，单次正文最多返回 50 KiB UTF-8。
3. 完整行被字节预算截断时，`nextOffset` 指向下一行。
4. 单行本身超过预算时返回安全 UTF-8 前缀，设置 `lineTruncated=true`，不伪造可继续的行号。
5. `contentHash` 始终基于完整文件，分页不改变更新时使用的版本身份。
6. Agent instructions 要求只在确有需要时按 `nextOffset` 续读；超长单行改用搜索定位并说明限制。

这不是对长文件做自动摘要。原始 Markdown 仍是事实源，模型只按任务需要拉取窗口。

## 写入一致性

仅有版本校验和原子 `rename` 仍存在进程内竞态：两个已经批准的更新可以同时读取相同基准版本，随后先后替换目标，形成
“最后写入者获胜”。因此同文件队列必须覆盖整个临界区：

```text
解析并规范化目标路径
  -> 进入 canonical target queue
  -> 再次读取磁盘版本
  -> 比较 modifiedAt + contentHash
  -> 原子写入或返回 conflict
  -> 释放队列
```

不同文件使用不同 key，可以并行；同一文件的创建与更新串行。任务失败也必须在 `finally` 中释放队列，不能让后续写入永久
等待。该队列只解决同一 Tessera 主进程内的竞争，外部编辑仍由版本复核解决。

## 安全边界

### 已实现

- 工作区根目录只存在于受信任主进程闭包。
- 模型不能提供绝对根目录或自行选择工作区。
- renderer 不直接访问文件系统。
- 读取、搜索和写入都有资源上限和取消信号。
- 写入必须经过 AI SDK 标准人工审批。
- 批准后再次检查冻结提案和磁盘版本。
- 创建不覆盖现有文件，更新使用同目录原子替换。
- 同一目标的复核与写入被串行化。

### 部分实现

- AI SDK 的工作区 ToolSet 仍在较大的 `agent-runtime.ts` 内组装，后续可抽成单独 adapter，但不应重新实现 Agent Loop。
- 读取后端仍是 Electron 主进程本地文件系统；端口已经允许未来替换，尚未提供 SSH、容器或数据库正文适配器。
- 当前写入提交完整候选 Markdown，适合首版审批预览，但长文的小范围修改仍会消耗较多模型输出。

### 规划

- 增加基于确定性文本定位的 `propose-workspace-edits`，以不重叠编辑列表生成完整候选和 Diff；审批与最终写入仍复用现有服务。
- 为 Skill 资源建立 `run-skill-script` capability：按已导入 Skill ID 和脚本相对路径解析，不把脚本源码注入上下文。
- 脚本执行器使用固定解释器、参数 schema、超时、工作目录、环境变量白名单、输出预算和单独审批；不等价于默认开放 `bash`。
- 若未来开放命令能力，应作为独立 capability pack，可被 RunPolicy 完全移除，不进入基础文件端口。

## Skill 脚本的目标执行链

```text
Skill instructions 只描述脚本用途和输入
  -> 模型调用 run-skill-script(skillId, scriptId, args)
  -> 主进程从已托管 Skill manifest 解析固定脚本
  -> 权限/审批/解释器/参数/环境/超时校验
  -> 隔离执行器运行 Python、Bash 或 TypeScript
  -> 截断并结构化 stdout、stderr、exitCode 和产物引用
  -> 只把结果返回模型
```

脚本文件本身不需要进入上下文。Skill 也不能因为声明了脚本就自动获得文件、网络或进程权限。

## 验证

首轮实现必须维持以下回归：

- 小文件默认读取结果与原内容一致；
- 450 行文件默认返回前 400 行和 `nextOffset=401`；
- 第二页范围和结束状态正确；
- 超长单行结果不超过 50 KiB 且显式标记不可按行续读；
- 路径穿越、绝对路径、工作区外符号链接和非 Markdown 继续被拒绝；
- 两个基于同一版本的并发批准更新恰好一个保存、一个冲突；
- 不同文件不共享全局写锁；
- 原有审批、外部修改冲突和创建竞态测试继续通过。

## 后续顺序

1. 观察分页读取是否降低真实运行的 tool-result token 峰值。
2. 把工作区 ToolSet 组装从统一运行文件抽成 AI SDK adapter。
3. 设计 `propose-workspace-edits`，先覆盖小范围 Markdown 修改，不做模糊大范围替换。
4. 在独立威胁模型和恢复设计完成后实现 Skill 脚本 capability。
5. 通用 Shell 只有在明确的产品场景、权限矩阵和隔离后端存在时再评估。
