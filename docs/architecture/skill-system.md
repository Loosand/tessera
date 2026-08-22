# Skill 系统

> 代码源头：`packages/contracts/src/index.ts`、`packages/skills/src/index.ts`、
> `packages/skills/builtins/`、`packages/ai/src/server/skill-instructions.ts`、
> `packages/ai/src/server/task-interaction-tools.ts`、
> `packages/database/schema.ts`、`apps/desktop/src/main/task-service.ts`、
> `apps/desktop/src/renderer/src/components/task-composer.tsx`、
> `apps/desktop/src/renderer/src/components/skill-management-page.tsx`
>
> 状态：部分实现。标准 `SKILL.md` 校验、内置注册表、渐进式加载、逐轮显式选择与运行快照、统一 AI SDK `ToolLoopAgent` 注入、研究提问/计划工具和内置 Skill 管理页已实现；自动意图路由、单一动态 Agent 定义、用户级/工作区级发现、安装、启停、版本、资源按需加载与第三方 Skill 管理尚未实现。

## 地位

Skill 是可阅读的模型工作流，不是新的模型、Agent 运行时或权限容器。目标形态中，Skill 属于一次 `task_run` 的实际执行策略，而不是整个任务创建后不可改变的身份：

- 用户显式选择研究或写作时，下一轮直接加载对应 Skill。
- 用户选择问答时不加载 Skill，并关闭联网和主动项目操作。
- 用户未选择时，运行策略根据当前 turn 的意图、资源和能力选择零个或一个主 Skill。
- 每个 run 固化实际 `skill_id` 和工具策略，后续 run 可以改变，历史 run 不被回写。
- Skill 声明只参与能力需求解释，实际权限仍来自显式资源、主进程边界和审批策略。

界面把未选择呈现为“自动”，并与“研究”“写作”“问答”组成四种创作模式。`question-answering` 只是本轮关闭联网、不加载 Skill 的行为提示，不对应伪造的 `SKILL.md`；研究和写作是随应用发布的两份内置 Skill。Chat/Agent 不进入创作模式 UI。

当前实现仍把内部 mode 和下一轮创作模式默认值保存到 `task_sessions`，但不再在首次发送后锁定；每次运行同时把实际 Skill 保存到 `task_runs`。会话字段只服务兼容读取和下一轮 UI 默认值，不是权限事实；进一步迁移见[统一创作 Agent 与内容存储探索](unified-creation-agent.md)。

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

1. 应用启动和选择器渲染时，注册表只常驻研究与写作的名称、展示描述、默认提示和声明权限；自动与问答由产品层提供，不进入 Skill 注册表。
2. 用户选择研究或写作并开始一轮任务时，运行时动态读取对应 `SKILL.md`，核对目录名、frontmatter 描述和正文；自动与问答返回空 Skill 指令。
3. 当前 Skill 正文被包在明确边界中，通过 AI SDK 的 `instructions` 传给 `ToolLoopAgent`；未选中的 Skill 正文不进入模型上下文。

内置 Skill 暂无额外 `scripts/`、`references/` 或 `assets/`。将来增加这些资源后，也只能在当前 Skill 明确引用并需要时加载，不能把整个目录预先塞进上下文。

目标流程把选择与实际策略固化到每个 run：

```text
本轮创作模式提示 + 用户 turn + 可见资源 + 模型能力
  -> resolveRunPolicy()
  -> SQLite task_runs.skill_id / policy snapshot
  -> loadBuiltInSkill(actualSkillId)
  -> AI SDK ToolLoopAgent instructions + bounded tools
```

自动路由第一版只需要在每个用户 turn 开始时选择主 Skill，不要求在同一个 run 中反复改写系统指令。若一个复杂任务需要独立专业上下文，可以通过有边界的专用工具或子 Agent 执行，并只把结果返回主 Agent。

## 结构化交互

Skill 负责告诉模型何时需要澄清、何时应先计划；共享运行时工具负责把这个意图变成稳定协议和专用界面，两者职责分离：

- `request-user-input` 是无服务端 `execute` 的客户端工具，只处理无法从上下文判断的核心语义歧义，例如“奥德赛”具体指荷马史诗、电影、游戏还是其他作品。平台、篇幅、风格、语气、受众、文章角度、输出格式、资料范围和个性化偏好不得触发提问，运行时 Schema 把每次调用限制为一个问题，并在同一用户请求询问过一次后从下一 turn 的工具集中移除。
- `publish-research-plan` 是无副作用的展示工具，只在研究 Skill 下注册。多步研究先发布目标、范围、交付物与最多八个研究问题，再继续使用当前模式已授权的搜索或工作区工具；简单事实问答不强制制造计划。
- 专用工具输入和输出都由共享 schema 校验，并使用固定 React 组件呈现。它们不是任意 JSON UI，也不能注册新工具、修改权限或执行来自模型的组件代码。

## 权限边界

Skill 描述符可以声明 `workspace.read`、`workspace.write` 或 `network.search` 等所需能力，但声明始终是需求，不是授权：

- 研究模式会请求深度推理和原生联网，并提高有界搜索额度；写作与自动模式也可在当前模型/端点支持时注册原生搜索工具。能力来自本轮策略和已验证模型事实，不来自 Skill 权限声明。
- 写作 Skill 本身不会获得任意内容写入；只有本轮已经关联授权内容目标时，统一 Agent 才能注册 `create-document` / `update-document` 等领域工具。目标可以由当前实验的托管内容库、外部工作区或未来数据库适配器提供。
- 所有文件写入继续先冻结候选内容，展示文档渲染和高亮 Diff，并在用户批准后复核磁盘版本再原子写入。
- Skill 指令不能扩大内容作用域、创建存储授权、注册 Shell/MCP、删除或重命名内容，也不能替代工具输入校验和审计。

## 当前内置 Skill

| 选择 | Skill | 当前作用 | 声明能力 |
| --- | --- | --- | --- |
| 自动 | 按本轮解析 | 根据用户意图、显式资源和模型事实选择安全能力；简单问题可以不加载 Skill | 无 |
| 研究 | `$research` | 必要时结构化澄清，发布多步研究计划，核验来源并区分事实/推断/不确定性 | 工作区读取、网络搜索 |
| 写作 | `$writing` | 识别目标/读者、规划结构、起草或修订 Markdown | 工作区读取、工作区写入 |
| 问答 | 无 | 不联网，使用对话历史与显式附件直接回答 | 无 |

研究正文已接通澄清与计划工具，写作正文仍保持最小可验证工作流。后续打磨提示、评测和更多专用工具时，不改变注册、持久化、权限和注入协议。

## 管理界面

一级导航中的“技能”页面直接读取同一个内置注册表，不维护第二份展示清单。当前可搜索并选择研究/写作，查看来源、权限声明和渐进式加载流程，也可以带着已选 Skill 创建任务。目标界面允许在每次发送前通过创作模式浮层切换自动、研究、写作或问答；选择只影响下一轮，界面始终不要求选择 Chat/Agent、联网或思考强度。

内置 Skill 随应用发布并始终启用，所以页面只显示真实的“内置 / 已启用”状态，不提供无效开关。用户级与工作区级安装、启停及社区发现仍是规划能力；接入前不显示可点击但无实现的市场或安装动作。

## 后续

- 用类型化 `RunPolicy` 和统一 Agent call options 替代当前两条工具装配路径，并继续扩充 `task_run` 的工具/资源策略快照。
- 在自动模式增加可评测的每轮意图解析，使同一会话能够从问答自然进入研究或写作。
- 增加用户级与工作区级目录发现、同名优先级、安装入口、启停和版本/哈希记录。
- 让注册表从 `agents/openai.yaml` 读取展示元数据，消除内置 TypeScript 清单中的重复字段。
- 支持标准 YAML 多行值，以及 `references/`、`scripts/`、`assets/` 的按需资源路由。
- 由权限网关比较 Skill 声明能力与任务实际授权，向用户解释缺失能力，但仍不自动批准。
- 为 Skill 版本建立固定任务、引用正确率、写作质量和回归评测。
