# Skill 系统

> 代码源头：`packages/contracts/src/index.ts`、`packages/skills/src/index.ts`、
> `packages/skills/builtins/`、`packages/ai/src/server/skill-instructions.ts`、
> `packages/database/schema.ts`、`apps/desktop/src/main/task-service.ts`、
> `apps/desktop/src/renderer/src/components/task-composer.tsx`、
> `apps/desktop/src/renderer/src/components/skill-management-page.tsx`
>
> 状态：部分实现。标准 `SKILL.md` 校验、内置注册表、渐进式加载、任务持久化、AI SDK Chat/Agent 注入和内置 Skill 管理页已实现；用户级/工作区级发现、安装、启停、版本、资源按需加载与第三方 Skill 管理尚未实现。

## 地位

Skill 是可阅读的模型工作流，不是新的模型、Agent 运行时或权限容器。任务配置有两个正交维度：

- `mode = chat | agent` 决定执行边界和可用工具；Agent 还要求绑定工作区。
- `skill_id = null | research | writing` 决定模型处理当前任务的方法。

界面把 `null` 呈现为“问答”，与“研究”“写作”共同组成三种对话方式。问答不对应一份伪造的 Skill；研究和写作是随应用发布的两份内置 Skill。任务首次保存后，执行模式和 Skill 都锁定，避免同一历史在中途改变系统指令或权限语义。

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

模型不会在每次请求中看到所有 Skill。加载分为三层：

1. 应用启动和选择器渲染时，注册表只常驻名称、展示描述、默认提示和声明权限。
2. 用户选择研究或写作并开始一轮任务时，运行时动态读取对应 `SKILL.md`，核对目录名、frontmatter 描述和正文。
3. 当前 Skill 正文被包在明确边界中，通过 AI SDK 的 `instructions` 传给 `streamText` 或 `ToolLoopAgent`；未选中的 Skill 正文不进入模型上下文。

内置 Skill 暂无额外 `scripts/`、`references/` 或 `assets/`。将来增加这些资源后，也只能在当前 Skill 明确引用并需要时加载，不能把整个目录预先塞进上下文。

```text
原生选择器
  -> task.skillId
  -> SQLite task_sessions.skill_id
  -> 类型化 AI Chat IPC
  -> loadBuiltInSkill(skillId)
  -> AI SDK instructions
     -> streamText（Chat）
     -> ToolLoopAgent（Agent）
```

## 权限边界

Skill 描述符可以声明 `workspace.read`、`workspace.write` 或 `network.search` 等所需能力，但声明始终是需求，不是授权：

- 研究 Skill 不会自动开启联网搜索；Chat 仍由用户的联网开关和模型能力决定，Agent 当前仍没有网络工具。
- 写作 Skill 不会自动进入 Agent 或获得文件写入；只有 Agent 的 `write-workspace-document` 可以提出候选 Markdown。
- 所有文件写入继续先冻结候选内容，展示文档渲染和高亮 Diff，并在用户批准后复核磁盘版本再原子写入。
- Skill 指令不能扩大工作区、注册 Shell/MCP、删除或重命名文件，也不能替代工具输入校验和审计。

## 当前内置 Skill

| 选择 | Skill | 当前作用 | 声明能力 |
| --- | --- | --- | --- |
| 问答 | 无 | 使用基础 Chat/Agent 指令 | 无 |
| 研究 | `$research` | 明确问题、核验来源、区分事实/推断/不确定性 | 工作区读取、网络搜索 |
| 写作 | `$writing` | 识别目标/读者、规划结构、起草或修订 Markdown | 工作区读取、工作区写入 |

这两份正文目前只是可验证的最小骨架。后续打磨提示、评测和专用工具时，不改变注册、持久化、权限和注入协议。

## 管理界面

一级导航中的“技能”页面直接读取同一个内置注册表，不维护第二份展示清单。当前可搜索并选择研究/写作，查看来源、权限声明和渐进式加载流程，也可以带着所选 Skill 创建独立 Chat 任务；任务首次发送前仍可在输入框中切换 Chat/Agent。

内置 Skill 随应用发布并始终启用，所以页面只显示真实的“内置 / 已启用”状态，不提供无效开关。用户级与工作区级安装、启停及社区发现仍是规划能力；接入前不显示可点击但无实现的市场或安装动作。

## 后续

- 增加用户级与工作区级目录发现、同名优先级、安装入口、启停和版本/哈希记录。
- 让注册表从 `agents/openai.yaml` 读取展示元数据，消除内置 TypeScript 清单中的重复字段。
- 支持标准 YAML 多行值，以及 `references/`、`scripts/`、`assets/` 的按需资源路由。
- 由权限网关比较 Skill 声明能力与任务实际授权，向用户解释缺失能力，但仍不自动批准。
- 为 Skill 版本建立固定任务、引用正确率、写作质量和回归评测。
