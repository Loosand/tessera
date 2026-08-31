# Pi 扩展、Skills 与能力装配

> Pi 证据：`packages/coding-agent/src/core/resource-loader.ts::DefaultResourceLoader`、
> `packages/coding-agent/src/core/resource-loader.ts::loadProjectContextFiles`、
> `packages/coding-agent/src/core/extensions/loader.ts::loadExtensions`、
> `packages/coding-agent/src/core/extensions/loader.ts::createExtensionRuntime`、
> `packages/coding-agent/src/core/extensions/runner.ts::ExtensionRunner`、
> `packages/coding-agent/src/core/extensions/types.ts::ExtensionAPI`、
> `packages/coding-agent/src/core/skills.ts::loadSkills`、
> `packages/coding-agent/src/core/skills.ts::formatSkillsForPrompt`、
> `packages/coding-agent/src/core/agent-session.ts::AgentSession`
>
> Tessera 对照：`packages/skills`、`packages/ai/src/server/skill-instructions.ts`、
> `packages/ai/src/server/task-agent.ts`、`apps/desktop/src/main/mcp-service.ts`、
> `docs/architecture/skill-system.md`、
> `docs/architecture/agent-kernel-and-capability-runtime.md`
>
> 状态：固定提交源码分析已完成

## 结论先行

Pi 用两套互补机制保持核心小：

- Skills 是渐进加载的 instruction/resource package；
- Extensions 是同进程任意代码，可以改工具、Provider、消息、上下文、UI 和 Session 生命周期。

Skills 的元数据目录 + 按需全文加载非常值得 Tessera 学习。ExtensionRunner 的 transactional registration、冲突诊断、context
失效也很成熟；但它的权限和 ABI 过宽，不适合 Tessera 直接复制。Tessera 更适合统一 Capability Registry，并把代码执行、
MCP、Skills 和领域命令分别放在明确权限边界内。

## 1. ResourceLoader 的统一资源视图

`DefaultResourceLoader` 聚合：

- extensions；
- Skills；
- prompt templates；
- themes；
- project context files；
- SYSTEM/APPEND_SYSTEM；
- package manager 提供的路径与 source metadata；
- extension `resources_discover` 追加的临时资源。

每项附带 source/scope/origin 信息，用于冲突诊断和 UI。资源加载不是简单扫描当前目录，还要合并 global/user、project、CLI、
package 和 extension-discovered 多种来源。

### context files

Pi 从 agentDir 和 root-to-cwd 的祖先目录加载 `AGENTS.override.md`、`AGENTS.md`、`CLAUDE.md`。同目录 override 优先，
不同目录仍可累积；worktree 场景有去重处理。

这为 monorepo 提供局部规则，但 context files 不受 Project Trust 保护。它们是模型输入，不是代码执行，却仍可能 prompt-inject
拥有 Bash/写入工具的 Agent。

## 2. 扩展加载是同进程代码执行

Loader 使用 jiti 导入 TS/JS，并调用 extension factory。factory 拥有完整 Node 进程权限。Pi 文档明确提醒：扩展可以执行任意
代码，只安装可信来源。

Project Trust 只决定项目扩展是否自动加载；用户/global/CLI 扩展在信任前就能运行，以便参与 `project_trust`。

### 2.1 加载事务

Pi 没有让半失败 factory 留下半套注册：

1. factory 执行期间，Provider、flags、event handlers 等先写临时 registration；
2. runtime action 使用尚未 bind 的 stub；
3. factory 成功才 commit；
4. 失败则丢弃这次 registration 并记录 diagnostic。

这是“扩展注册事务”，不是代码执行沙箱。factory 已发生的外部副作用、全局变量、子进程或 timer 仍无法自动回滚。

## 3. Extension API 的实际宽度

扩展可以注册：

- tools；
- slash commands；
- shortcuts 与 flags；
- message/entry renderer；
- markdown transformer；
- Provider；
- UI status/widget/header/footer/title/dialog；
- project/resource/session/model/turn/message/tool/input/bash 等事件。

可影响模型和执行的关键事件包括：

```text
resources_discover
context
before_provider_request / before_provider_headers / after_provider_response
before_agent_start
tool_call / tool_result
input
session_before_compact / session_before_tree / session_before_switch
```

这几乎是一个“应用内部插件 API”，而不只是工具注册。优点是 Pi 可以不内置 permission UI、subagent、plan mode、MCP 等产品
选择；用户通过扩展实现。代价是任何内部改动都可能成为扩展兼容问题，最终 Provider payload 和工具策略可能经过多次变换。

## 4. ExtensionRunner 的顺序与失效

Runner 做三类重要工作：

### 4.1 顺序执行与链式变换

- 普通事件按扩展加载顺序执行；
- context handler 拿到消息副本，并把前一个结果传给下一个；
- before provider request 链式改 payload；
- headers 在链中变换；
- before_agent_start 链式改 system prompt，并收集 custom messages；
- tool_call 可以阻止/改参数，tool_result 可以改结果。

### 4.2 冲突规则

- 同名工具通常先注册者获胜并产生 diagnostic；
- command 冲突会生成可区分 invocation；
- Provider registration 由 ModelRuntime 组合或替换；
- resource collision 保留来源信息。

### 4.3 stale context guard

reload 或 session replacement 后，旧 ExtensionContext 会失效；其动作函数拒绝继续操作新 Session。Runner 自身捕获大多数 handler
异常并上报。工具调用前 hook 的异常可以阻止执行，这是安全于“出错后照常执行”的选择。

这些 guard 防止逻辑迟到，不隔离扩展进程权限。

## 5. 工具装配

`AgentSession` 将三类工具合并：

- built-in tools；
- extension tools；
- SDK 注入 tools。

然后应用 allowlist/denylist，生成 active tools，再从 active definitions 建 system prompt snippets/guidelines。工具 registry 变化后可
`refreshTools()`，下一模型 turn 读取新集合。

Pi 已经区分“已注册工具”和“当前 active 工具”，但没有统一声明：权限、资源范围、side-effect level、approval、result budget、
版本或审计 policy。Extension tool 的 execute 就是可信代码入口。

Tessera 的 CapabilityDescriptor 应补齐这些元数据，并让所有来源先变成 descriptor，再由本 run policy 选择少量 active tools。

## 6. Skill 扫描与校验

Pi 遵循 Agent Skills 目录形态，递归查找 `SKILL.md`，忽略 hidden、node_modules 和 ignore 规则。frontmatter 主要包含：

- `name`；
- `description`；
- 可选 model invocation 控制等字段。

name/description 有校验和 warning；缺 description 等情况不会必然让整个资源加载失败。资源带 baseDir 和 source info，供后续
相对路径解析。

宽松加载有利于兼容社区 Skills，但生产产品需要区分“可浏览”“可选择”“可自动路由”“可执行脚本”的验证等级，不能只发
warning 后全部进入可运行目录。

## 7. Skill 的两种加载路径

### 7.1 模型自主发现

system prompt 只包含 catalog：name、description、location。模型判断需要时调用 `read` 读取完整 `SKILL.md`。附属资源由 Skill
文字指示模型继续按相对路径读取或运行脚本。

### 7.2 用户显式 `/skill:name`

`AgentSession` 直接读取完整 SKILL.md，去 frontmatter 后嵌入带 baseDir 的 `<skill>` block，并附加用户参数，再作为 prompt
进入 Agent。

这实现真正渐进加载：未选 Skill 不把全文常驻上下文。缺口是资源读取和脚本执行复用通用 read/bash，Skill 没有独立的资源
能力或权限 envelope。

Tessera 当前已实现托管 Skill 导入/启停、按 run 选择、正文 instructions 加载；L2 references/assets/scripts 仍规划。Pi 证明 L0
catalog + L1 body 的方向成立，也说明 L2 不能简单交给通用 Shell。

## 8. `resources_discover` 的动态资源

Session start 后，extension 可以返回额外 skill/prompt/theme 路径，ResourceLoader 再加载并加入当前资源集合。适合远端 package、
动态环境和企业资源。

风险：

- 资源集合可在 session 内变化；
- 动态路径可能越过原 project scope；
- Skill 内容更新后旧运行难以解释；
- 同名资源选择依赖 discovery/load 顺序。

Tessera 应把 discovery 结果变成带 content hash/version/source/trust 的 CapabilityRef。运行开始后只使用冻结版本；新发现只影响
下一 run。

## 9. Tessera 不应复制的 Extension 模型

Tessera 是 Electron 产品，renderer 无 Node、主进程窄 IPC、写入需审批、MCP secrets 不进 renderer。直接提供 Pi 同等扩展 API
会让第三方代码：

- 修改最终模型 payload；
- 获取/修改工具参数与结果；
- 注册任意 Provider 和 header transform；
- 操作 Session、UI 和本机进程；
- 绕过 capability/approval 的集中解释。

这会破坏现有安全边界。更合适的扩展层次是：

| 类型 | 能力 | 隔离/审批 |
| --- | --- | --- |
| Skill | instructions + resources | 托管导入、按需读取 |
| MCP | 远端/本地标准工具 | server trust、逐工具启停、逐次审批 |
| Domain capability | Tessera 内建 typed command | 主进程领域服务与审计 |
| Script | 固定入口与 schema | 独立执行器、权限声明、批准 |
| UI extension | 若未来需要，仅消费公开 projection | 不获得 Node/Secrets/Execution Gateway |

## 10. 建议

1. 建统一 Capability Registry，吸收 Pi 的来源、scope、冲突 diagnostic 和 lazy load。
2. active capability snapshot 在 run 开始时冻结上限；动态阶段只能收窄。
3. L0 catalog 不包含完整 schema/body，L1 只加载选中 Skill，L2 通过受限 resource/script capability。
4. 不开放任意 before-provider/before-tool 同进程插件；策略必须在可信 Gateway 中可解释。
5. 第三方代码 registration 使用事务，但同时需要进程/沙箱隔离，不能把事务误当安全。
6. 所有动态资源持久化 source、hash、version、trust 与实际使用事件。
7. 工具冲突不只给日志；Run Inspector 应展示最终 owner 和被拒绝候选。
