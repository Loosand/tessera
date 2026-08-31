# Pi 上下文、系统提示词与压缩

> Pi 证据：`packages/coding-agent/src/core/system-prompt.ts::buildSystemPrompt`、
> `packages/coding-agent/src/core/messages.ts::convertToLlm`、
> `packages/coding-agent/src/core/compaction/compaction.ts::estimateContextTokens`、
> `packages/coding-agent/src/core/compaction/compaction.ts::prepareCompaction`、
> `packages/coding-agent/src/core/compaction/compaction.ts::compact`、
> `packages/coding-agent/src/core/compaction/branch-summarization.ts::generateBranchSummary`、
> `packages/coding-agent/src/core/compaction/utils.ts::extractFileOpsFromMessage`、
> `packages/coding-agent/src/core/agent-session.ts::AgentSession`
>
> Tessera 对照：`packages/ai/src/server/context-budget.ts`、
> `packages/ai/src/server/task-agent.ts::createTaskAgent`、
> `packages/ai/src/server/skill-instructions.ts`、
> `docs/architecture/agent-kernel-and-capability-runtime.md`、
> `docs/architecture/ai-observability.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Pi 的上下文策略由四层组成：动态 system prompt、产品消息到 LLM 消息的转换、Session tree 投影、超限前后的摘要压缩。
它没有一个叫 `ContextCompiler` 的单一对象，但已经实践了“完整事实不等于当前模型输入”。

最值得学习的是：

- system prompt 只描述当前 active tools，不描述已安装但不可用工具；
- custom/session message 在 Provider 边界统一转换；
- compaction 不删除历史，只插入 summary marker 并保留最近尾部；
- overflow 与普通 retry 分开，最多 compact-and-retry 一次。

最需要修正的是：Token 估算粗糙、摘要 provenance 不够强、工具结果只按文本截断、文件操作追踪只是从 tool call 名称推断，不能
当成真实审计。

## 1. 动态 system prompt

`buildSystemPrompt()` 根据当前输入拼装：

```text
基础 coding assistant 身份
  + 当前 active tool 的 snippet
  + 当前 active tool 的 guideline
  + Pi docs/examples 路径
  + 项目 context files
  + Skills catalog
  + 当前 cwd
```

工具摘要来自 ToolDefinition 自己的 `promptSnippet/promptGuidelines`。`read` 不 active 时，Skill catalog 也不会加入，因为模型
无法读取 Skill 正文。这防止 prompt 宣称不存在的能力。

自定义 `SYSTEM.md` 会替换默认基础 prompt，但仍附加 APPEND_SYSTEM、项目 context、Skills 和 cwd。这个语义让用户可以完全
定制角色，但保留运行环境事实。

### 优点

- 能力说明与实际工具同源；
- tool allow/deny 后 prompt 自动同步；
- 默认 prompt 克制，不把每个工作流全文常驻；
- 项目 context 按 root-to-cwd 顺序组合，近目录可以 override 同目录标准文件。

### 风险

- system prompt 重建不等于 run policy 冻结，扩展可在下一个 turn 改 active tools；
- context files 无论 Project Trust 都可加载，仓库文本可 prompt-inject；
- 完全替换 base prompt 可能移除重要操作约束；
- prompt 中包含本机绝对 docs/cwd 路径，不适合作为远端或脱敏运行事实。

## 2. 产品消息与 LLM 消息分离

coding-agent 扩充了四种消息：

- `bashExecution`；
- `custom`；
- `branchSummary`；
- `compactionSummary`。

`convertToLlm()` 在模型边界把它们转换为标准 user message，或在 `bashExecution.excludeFromContext` 时跳过。标准
user/assistant/toolResult 保持原样。

因此 UI/Session 可以保存比 Provider 协议更丰富的对象。这个分层适合 Tessera：approval、artifact、plan、resource usage
应先是领域事件/消息，只有 Context Compiler 判断必要时才变成 model message。

不过 Pi 的 summary/custom 最终通常伪装成 user message。若 Provider 或模型对 role 很敏感，系统生成摘要与真实用户意图可能被
混淆。Tessera 应在内部保留 `source=system-summary|tool|user|domain`，即使外部协议只能降级成 user role。

## 3. 上下文 Token 估算

默认压缩设置：

```text
enabled = true
reserveTokens = 16384
keepRecentTokens = 20000
```

触发条件：

```text
contextTokens > model.contextWindow - reserveTokens
```

估算优先使用最后一条有效 assistant usage，再对其后的消息按字符估算；无 usage 时全量估算。文本大致按 `chars / 4`，图片按
固定字符成本处理。

这个方法比只数当前字符串好，因为 Provider usage 能覆盖工具 schema、framing 和模型实际 tokenizer 的差异；但最后 usage
属于当时 context，后续消息仍只能粗估。模型切换、Provider usage 口径和未返回 usage 都会影响准确性。

Tessera 当前 `ContextManifest` 已按 instructions、会话、工具结果、工具定义和 framing 分项估算，并在出站前拒绝明显超限，
可解释性比 Pi 更强；缺口是还不会按优先级摘要和裁剪。

## 4. cut point 保护消息语法

Pi 不是在任意 Token 位置切断。合法 cut point 只落在 turn 边界型消息：

- user；
- assistant；
- bashExecution/custom；
- branch/compaction summary。

不会从 ToolResult 开始，避免保留没有对应 assistant tool call 的结果。算法从尾部向前累计，尽量保留
`keepRecentTokens`。若切点进入一个 turn，还会单独生成 turn prefix summary，再与历史 summary 合并。

这个“语法完整优先于精确 Token 命中”是可直接采纳的原则。Context 裁剪不能破坏 tool call/result、citation/evidence、
approval request/response 或领域 transaction 的配对。

## 5. 摘要生成

标准 summary 结构要求覆盖：

- Goal；
- Constraints；
- Progress；
- Key Decisions；
- Next Steps；
- Critical Context。

流程大致是：

1. 选出要摘要的 Session entries；
2. custom AgentMessage 先 `convertToLlm`；
3. 把 conversation 序列化成文本；
4. 每个 tool result 最多保留约 2000 字符进入摘要输入；
5. 用同一模型做无工具 summary call；
6. summary 输出上限取 `reserveTokens` 的一部分；
7. error、length stop 或生成 tool call 都视为摘要失败；
8. transient failure 使用统一 retry policy。

compaction 结果包含 summary、firstKeptEntryId、tokensBefore、usage 和 details，追加到 Session tree。旧消息没有删除。

### 局限

- summary 是有损模型输出，没有逐条来源引用；
- tool result 统一字符截断，不按工具语义保留关键字段；
- summary 使用当前 model，模型切换会改变历史投影质量；
- 没有独立事实校验，摘要可能错误声称文件已修改或任务已完成；
- compact 后直到下一次 Provider usage，当前窗口大小只能估算。

## 6. 文件操作摘要不是审计

Pi 会从 assistant tool call 中识别 `read`、`write`、`edit` 的 path，生成 read/modified file 列表并写进摘要。它不检查：

- 对应 ToolResult 是否成功；
- Bash 是否修改了文件；
- extension tool 是否有文件副作用；
- 路径是否最终解析到同一文件；
- 写入后是否又被回滚或外部修改。

所以这只是帮助模型续轮的近似线索，不能作为 Artifact manifest 或审计。Tessera 已有写入提案、approval、base hash、commit
状态和主进程文件结果，摘要必须引用这些领域事实，而不是从模型调用意图猜结果。

## 7. 分支摘要

`generateBranchSummary()` 摘要从 common ancestor 到 abandoned leaf 的路径，并把结果挂到目标分支。它按 newest-first
预算收集 entry，可包含旧的 Pi summary，但会丢弃 ToolResult message，只保留相关对话和 assistant tool call 表达。

收益是回到旧节点时仍能告诉模型“刚才探索了什么”。风险是 tool call 被保留、结果被丢弃后，摘要模型可能误判调用成功。

Tessera 若支持 branch，应从结构化 Run/Tool/Artifact facts 生成 branch handoff：调用、结果、审批、产物和失败状态必须成对。

## 8. overflow、threshold 与 manual

| 原因 | 是否重试当前 turn | 处理 |
| --- | --- | --- |
| manual | 否 | abort 当前活动运行，生成摘要，重建 context |
| threshold | 否 | 已完成 response 后压缩，为下一 turn 腾空间 |
| overflow + 失败/截断 | 最多一次 | 移除失败 response 的 active projection，压缩后 continue |
| overflow + 成功 | 否 | 保留成功 response，只为后续压缩 |

自动压缩可以被 extension 的 `session_before_compact` 取消或替换结果。运行中会发 compaction start/update/end/failure 事件，UI
能显示正在摘要，而不是卡住。

## 9. Tessera 目标形态

```text
SQLite / Markdown / Run Event 完整事实
  -> Context Compiler
       1. 固定安全与当前请求
       2. 未完成审批/领域状态
       3. 最近消息与当前文档
       4. 当前 Skill 与 active tool schemas
       5. 检索片段、历史 summary、bounded tool results
       6. 低优先级背景
  -> ContextProjectionV1 + ContextManifest
  -> ToolLoopAgent
```

压缩记录应包含：

- source entry/event ranges；
- retained tail；
- summary model/usage；
- 结构化 unresolved items；
- Artifact/approval/tool result 引用；
- 被裁剪类别与原因；
- 可重新生成的 projection version。

## 10. 建议

1. 先把现有 ContextManifest 扩为 Context Compiler 的输出，不把预算逻辑散回各领域工具。
2. active tools、tool guideline 和 system prompt 继续同源；本 run capability 上限不可扩大。
3. compaction 只改变投影，不删除 task message/run event/Markdown 事实。
4. 对 tool result 建按工具类型的 reducer；不要只截断前 2000 字符。
5. summary 中的“已完成/已写入”必须来自结构化成功事件。
6. branch summary 保持 tool call/result 和 approval request/response 配对。
7. 把 Provider 实际 usage、当前窗口估算、累计 run usage、摘要 usage 分栏显示。
