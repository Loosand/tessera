# Skill 系统

> 代码源头：`packages/contracts/src/index.ts`、`packages/skills/src/index.ts`、
> `packages/skills/builtins/`、`packages/ai/src/server/skill-instructions.ts`、
> `packages/ai/src/server/task-interaction-tools.ts`、
> `packages/database/schema.ts`、`apps/desktop/src/main/task-service.ts`、
> `apps/desktop/src/main/user-skill-service.ts`、
> `apps/desktop/src/renderer/src/components/tasks/conversation/task-composer.tsx`、
> `apps/desktop/src/renderer/src/components/skills/skill-management-page.tsx`
>
> 状态：部分实现。标准 `SKILL.md` 校验、内置注册表、用户单目录导入/递归扫描预览/批量托管/启停/删除、渐进式加载、逐轮显式选择与完整 RunPolicy 快照、统一 AI SDK `ToolLoopAgent` call options 注入、基础自动意图路由、轻量 Research/Tessera Writing 工作流和 Skill 管理页已实现；工作区级自动发现、更新/版本、附属资源按需加载、行为评测与社区目录尚未实现。

## 地位

Skill 是可阅读的模型工作流，不是新的模型、Agent 运行时或权限容器。目标形态中，Skill 属于一次 `task_run` 的实际执行策略，而不是整个任务创建后不可改变的身份：

- 用户显式选择研究或写作时，下一轮直接加载对应 Skill。
- 用户安装并启用自己的 Skill 后，选择器使用稳定的 `user:<name>` 标识加载托管副本。
- 用户选择问答时不加载 Skill，并关闭联网和主动项目操作。
- 用户未选择时，运行策略根据当前 turn 的意图、资源和能力选择零个或一个主 Skill。
- 每个 run 固化实际 `skill_id` 和工具策略，后续 run 可以改变，历史 run 不被回写。
- Skill 声明只参与能力需求解释，实际权限仍来自显式资源、主进程边界和审批策略。

界面把未选择呈现为“自动”，并在同一创作方式面板中提供“研究”“写作”“问答”快捷项，但它们不是同一类对象：`research` / `writing` 对应随应用发布的内置 Skill，`question-answering` 只是关闭联网、不加载 Skill 的回答预设。图片、视频等未来入口属于工具、输出能力或专用模型路由，不应伪装成 Skill；它们可以在同一快捷面板分组呈现，也不与 Skill 互斥。Chat/Agent 不进入这个 UI。

当前实现仍把内部 mode 和之后运行使用的创作方式默认值保存到 `task_sessions`，但不再在首次发送或运行期间锁定；每次运行同时把实际 Skill 保存到 `task_runs`。会话字段只服务兼容读取和 UI 默认值，不是权限事实；进一步迁移见[统一创作 Agent 与内容存储探索](unified-creation-agent.md)。

## 用户安装

用户级 Skill 采用“导入到应用托管目录”，不长期引用任意外部绝对路径：

1. 渲染层只能请求打开系统目录选择器，不能向主进程提交路径。
2. 所选目录根部必须包含合法 `SKILL.md`；名称不能与内置研究、写作或问答标记冲突。
3. 主进程拒绝符号链接和特殊文件，忽略 `.git`、`node_modules` 与 `.DS_Store`，并限制最多 256 个文件、单文件 4 MiB、总计 16 MiB。
4. 文件先复制到同一托管根下的随机暂存目录，复核 `SKILL.md` 后原子改名发布；SQLite 只记录 `user:<name>`、描述、启用状态和安装统计，不保存外部路径或正文。
5. 删除先把托管目录交给系统废纸篓，成功后再删除目录记录。旧任务仍保留 Skill ID，但在重新安装前不能运行。

批量扫描沿用同一安全边界：用户先通过系统选择器指定一个上级目录，主进程最多递归 8 层、检查 4,096 个目录并返回最多 256 个候选；`.git`、`node_modules` 不进入扫描，符号链接不跟随。结果只向渲染层暴露相对路径，并保存在最长 15 分钟、一次性消费的主进程扫描会话中，绝对源路径不会进入页面状态。有效候选、已安装项、内置/同名冲突和无效 `SKILL.md` 在安装前分别呈现；用户勾选后，每个目录仍重新走完整的原子导入与文件限制，扫描本身不复制文件，也不执行任何脚本。

托管完整目录是为后续 `references/`、`assets/` 和受控 `scripts/` 预留；当前运行时只读取 `SKILL.md`，不会自动执行脚本或把附属文件塞进模型上下文。源目录后续移动或修改不会影响已安装副本。

## 标准目录

```text
research/
  SKILL.md
  agents/
    openai.yaml
```

`SKILL.md` 的 YAML frontmatter 只接受 `name` 和 `description`；正文保存实际工作流指令。`agents/openai.yaml` 保存 `display_name`、`short_description` 和包含 `$skill-name` 的默认提示，只服务产品展示，不进入模型上下文。

当前解析器限制文件最多 128,000 字符，名称必须是最长 64 字符的小写 kebab-case，描述最多 1,024 字符，并拒绝未知或重复 frontmatter 字段。多行 YAML 值暂不支持；需要兼容更多标准写法时再引入完整 YAML 解析器，并保持同一校验结果。

## 渐进式加载

模型不会在每次请求中看到所有 Skill。当前加载分为三层：

1. 应用启动和选择器渲染时，注册表只常驻研究与写作的名称、展示描述、默认提示和声明权限；用户目录只从 SQLite 读取元数据并复核托管 `SKILL.md` 的可用性；自动与问答由产品层提供，不进入 Skill 注册表。
2. 用户选择内置或已启用的用户 Skill 并开始一轮任务时，运行时动态读取对应 `SKILL.md`，核对目录名、frontmatter 描述和正文；自动与问答返回空 Skill 指令。
3. 当前 Skill 正文被包在明确边界中，通过 AI SDK 的 `instructions` 传给 `ToolLoopAgent`；未选中的 Skill 正文不进入模型上下文。

内置 Skill 暂无额外 `scripts/`、`references/` 或 `assets/`。将来增加这些资源后，也只能在当前 Skill 明确引用并需要时加载，不能把整个目录预先塞进上下文。

目标流程把选择与实际策略固化到每个 run：

```text
本轮创作方式提示 + 用户 turn + 可见资源 + 模型能力
  -> resolveRunPolicy()
  -> SQLite task_runs.skill_id / policy snapshot
  -> loadBuiltInSkill(actualSkillId) / userSkillService.load(actualSkillId)
  -> AI SDK ToolLoopAgent instructions + bounded tools
```

自动路由第一版只需要在每个用户 turn 开始时选择主 Skill，不要求在同一个 run 中反复改写系统指令。若一个复杂任务需要独立专业上下文，可以通过有边界的专用工具或子 Agent 执行，并只把结果返回主 Agent。

## 结构化交互

Skill 负责告诉模型何时需要澄清以及如何执行方法；共享运行时只为真正需要暂停用户的核心歧义提供稳定协议：

- `request-user-input` 是无服务端 `execute` 的客户端工具，只处理无法从上下文判断的核心语义歧义，例如“奥德赛”具体指荷马史诗、电影、游戏还是其他作品。平台、篇幅、风格、语气、受众、文章角度、输出格式、资料范围和个性化偏好不得触发提问，运行时 Schema 把每次调用限制为一个问题，并在同一用户请求询问过一次后从下一 turn 的工具集中移除。
- Research 的问题拆分、来源选择与核验保留在 Skill instructions 中，不再注册计划或证据状态命令。可选 `web_search` 和 `read-web-source` 来自 RunPolicy 与主进程能力，详见[轻量研究能力与历史证据数据](research-workflow.md)。
- `request-user-input` 的输入和输出由共享 schema 校验并使用固定 React 组件呈现；它不是任意 JSON UI，也不能注册新工具、修改权限或执行模型提供的组件代码。

## 权限边界

Skill 描述符可以声明 `workspace.read`、`workspace.write` 或 `network.search` 等所需能力，但声明始终是需求，不是授权：

- 研究方式会请求深度推理和原生联网，并提高有界搜索额度；写作与自动方式也可在当前模型/端点支持时注册原生搜索工具。能力来自本轮策略和已验证模型事实，不来自 Skill 权限声明。
- 写作 Skill 本身不会获得任意内容写入；只有本轮已经关联授权工作区且请求相关时，统一 Agent 才注册 `read/edit/write`。
- 文件工具不逐次审批；主进程仍强制相对路径、版本冲突、同文件串行和原子提交。旧 Diff/批准仅用于历史消息兼容。
- Skill 指令不能扩大内容作用域、创建存储授权、注册 Shell/MCP、删除或重命名内容，也不能替代工具输入校验和审计。
- 用户 Skill 的 frontmatter 不接受权限、工具、入口脚本或 MCP 字段；随目录导入的脚本当前只是不可执行文件。

## 当前内置 Skill

| 选择 | Skill | 当前作用 | 声明能力 |
| --- | --- | --- | --- |
| 自动 | 按本轮解析 | 根据用户意图、显式资源和模型事实选择安全能力；简单问题可以不加载 Skill | 无 |
| 研究 | `$research` | 必要时结构化澄清，使用可选搜索与深读核验来源，并区分事实/推断/不确定性 | 工作区读取、网络搜索 |
| 写作 | `$writing` | 区分起草/续写/改写/审稿，整理事实与判断，在保持作者声音和修改边界的前提下交付并质检 Markdown | 工作区读取、工作区写入 |
| 问答 | 无 | 不联网，使用对话历史与显式附件直接回答 | 无 |

Research 正文只描述候选发现、网页深读、交叉核验和限制说明；搜索/阅读能力按本轮实际授权装配，不再由研究领域状态机推进。Writing 正文已实现写作契约、材料分类、文体选择、受控修订和四层质检。当前两者仍缺少独立行为评测集；后续增加固定样本与人工评分时，不改变注册、持久化、权限和注入协议。

## 管理界面

一级导航中的“技能”页面组合内置注册表和用户安装目录，不维护另一份用户展示清单。当前既可添加单个本地 Skill，也可扫描一个上级目录，在对话框中检查相对位置、描述、有效性、重复/已安装状态，勾选后批量安装；页面继续支持搜索内置/用户 Skill，卡片列表保持完整内容宽度，点击后以右侧 Sheet 按需查看来源、权限边界、安装统计和渐进式加载流程，不再用常驻详情栏压缩目录。用户 Skill 可启停、删除，也可以直接带着已选 Skill 创建任务。任务输入浮层同时列出当前已启用且可用的用户 Skill；选择只影响下一轮，界面始终不要求选择 Chat/Agent、联网或思考强度。

内置 Skill 随应用发布并始终启用，所以页面只显示真实的“内置 / 已启用”状态，不提供无效开关。用户 Skill 的启用状态保存在 SQLite，托管文件缺失、损坏或元数据变化时标记为不可用；重新启用和开始任务都会再次校验。工作区级覆盖、社区发现和更新仍是规划能力。

## 后续

- 已用类型化 `RunPolicy` 和统一 Agent call options 收敛工具装配；后续继续扩充更强语义意图、Skill 版本和 `task_run` 的可解释策略。
- 在自动模式增加可评测的每轮意图解析，使同一会话能够从问答自然进入研究或写作。
- 增加工作区级目录发现、同名优先级，以及用户 Skill 更新、版本/目录哈希和恢复策略。
- 让注册表从 `agents/openai.yaml` 读取展示元数据，消除内置 TypeScript 清单中的重复字段。
- 支持标准 YAML 多行值，以及 `references/`、`scripts/`、`assets/` 的按需资源路由。
- 由权限网关比较 Skill 声明能力与任务实际授权，向用户解释缺失能力，但仍不自动批准。
- 为 Skill 版本建立固定任务、引用正确率、写作质量和回归评测。
- 按[轻量研究能力与历史证据数据](research-workflow.md)维护无状态 Web capability 与历史研究读取边界；研究 Skill 继续只维护方法论和来源判断规则。
