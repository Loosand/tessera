# 统一创作入口与内容存储实验

> 当前代码：`packages/ai/src/server/agent-runtime.ts`、`packages/ai/src/routing/intent-routing.ts`、
> `packages/agent-runtime/src/workspace-file-capabilities.ts`、`apps/desktop/src/main/workspace-agent-tools.ts`、
> `apps/desktop/src/main/content-library-service.ts`、`packages/database/content-domain-repository.ts`、
> `apps/desktop/src/renderer/src/components/tasks/artifacts/task-artifact-tray.tsx`
>
> 状态：统一对话入口、逐轮 RunPolicy、Skill、工作区文件能力、运行恢复、Artifact 和混合内容库原型已实现。
> **P2 起，内容库领域工具退出模型主链；新文件提交由应用层登记 Artifact，项目创建、移动和整理由 UI/应用服务负责。**
> 最终内容存储方案仍处于实验阶段。
>
> 决策日期：2026-09-01

## 地位

本文记录统一创作体验和当前内容存储事实。Agent Kernel 与工具减法由
[Pi 参考下的 Agent 减法实施路线图](agent-simplification-roadmap.md)决定；文件写入契约见
[Agent 本地文件能力](agent-file-capabilities.md)。

用户面对的是一条持续任务，而不是 Chat、Research Agent、Writing Agent 和内容管理 Agent 的切换器。每次提交都进入
同一 `ToolLoopAgent`；是否联网、加载哪个 Skill、读取或修改哪些文件由本轮策略和授权决定。应用中的 Project、
Document、Artifact 仍是长期产品对象，但模型不需要通过一组领域管理工具操纵它们。

## 已确认的交互原则

1. 新任务、工作区任务和文档侧栏共用消息、运行、工具与恢复协议。
2. 简单请求允许零工具直接回答；不能为了显示“Agent 在工作”制造调用。
3. Research、Writing 和 Question Answering 是逐轮快捷选择。前两者是方法型 Skill，选择不会永久改变 Task。
4. 自动模式只对明确的研究或写作意图做保守收窄，不能从自然语言获得额外权限。
5. 当前文档、附件和工作区是可见资源；实际使用的策略、资源和工具固化到 run，历史不被后来选择回写。
6. 工作区写入不逐次审批，但必须经过路径边界、版本复核、同文件队列和原子提交。
7. MCP 等外部能力是独立信任域，继续按自身配置和审批规则工作。
8. 正常正文完成后可以生成 2–4 个引申问题；后处理失败不影响已经完成的主回答。

## 当前 Agent 与内容层边界

```text
用户消息 + 当前资源 + 模型事实
              |
              v
       resolveTaskRunPolicy
              |
              v
        ToolLoopAgent
          |- 可选 Web
          |- 可选 read/edit/write
          |- 可选 MCP
          `- 直接回答
              |
              v
     主进程提交文件 + 登记 Artifact
              |
              v
       内容库/UI 组织与展示
```

新 run 不再注册下列内容领域命令：项目/Artifact 查询、`create-document`、`create-project`、`move-documents` 和
结构检查。对应 AI 适配器已经删除。内容库服务、IPC、现有 UI、数据库记录和历史 Tool Part 仍保留，因为它们服务用户
已有数据和直接界面操作。

工作区 `edit` 或 `write` 成功后，主进程通过提交观察器执行最小登记：

1. 使用已提交的相对路径、内容 hash 和修改时间更新文档索引；
2. 在当前 task/run 下创建或复用 Artifact；
3. 保存 output 与 workspace scope 资源关系；
4. 不把登记失败伪装成“文件未写入”，避免模型重试已经提交的副作用。

Artifact 登记是应用层投影，不是文件提交的第二事实源。文件系统仍决定正文是否写入成功；P5 应把登记异常显示为独立
运行诊断，而不是让模型猜测或重复写文件。

## 产品对象

| 对象 | 用户心智 | 当前实现 |
| --- | --- | --- |
| Task | 一条持续协作的对话 | SQLite 会话与版本化消息 |
| Run | 一次用户提交触发的执行 | 策略快照、有序事件、指标与终态 |
| Workspace / Project | 长期材料与产物容器 | 用户授权的本地目录及 SQLite 稳定引用 |
| Document | 可独立拥有和编辑的正文 | Markdown 文件 |
| Artifact | 某次 run 创建或更新的产物关系 | 稳定 Artifact、Document 索引和资源绑定 |
| Operation | UI 发起的创建、移动或整理动作 | 主进程文件操作与 SQLite 审计 |

Task 可以没有工作区，也可以后来关联文档或工作区。移动 Document 不应复制 Task 或改变历史 run 的资源快照；Artifact
身份应尽量稳定，磁盘路径变化由索引和关系层更新。

## 内容存储实验

当前混合基线：Markdown 是正文事实源，SQLite 保存可重建索引、任务、运行、Artifact、资源关系和操作审计。用户在
设置中明确选择内容库根目录；其中维护可见的“未归档”和项目目录，也允许登记内容库外的 Workspace。

仍需比较三个候选：

| 候选 | 正文事实源 | 优势 | 主要代价 |
| --- | --- | --- | --- |
| 数据库正文 | SQLite/其他数据库 | 事务、移动、关联和同步直接 | 外部编辑、Git、备份和用户拥有感变弱 |
| 托管 Markdown（当前） | 内容库目录中的 Markdown | 文件所有权与稳定产品 API 折中 | 路径、外部修改和关系刷新复杂 |
| 开放工作区 | 用户任意授权目录中的 Markdown | 最符合现有文件习惯 | 自动组织、跨目录移动和权限解释最复杂 |

在新 ADR 完成前：

- 不把数据库和 Markdown 同时声明为正文权威副本；
- 不执行不可逆正文迁移；
- SQLite 丢失时 Markdown 仍应能独立打开；
- 数据库索引异常不得覆盖、删除或隐藏磁盘正文；
- 项目创建、移动与整理优先由可见 UI 发起，不为这些动作扩大主 Agent 工具面。

具体实验指标与最终门槛见 [ADR-0001：内容存储实验基线与评审门槛](adr-0001-content-storage-experiment.md)。

## 权限与审计

统一运行时不等于统一放权：

- 工作区授权以当前用户明确打开的目录为边界，模型不接触真实根路径。
- `read/edit/write` 只接受工作区相对路径；创建不覆盖，更新要求已读取 hash，冲突后重新读取。
- 文件修改不逐次审批；旧 `write-workspace-document` 审批只读兼容，批准不会再写盘。
- 项目移动、重命名、废纸篓和跨工作区操作仍由 UI 与主进程服务执行，并保留冲突检查和操作审计。
- MCP 继续逐工具审批，不因工作区文件授权自动获得信任。
- renderer 不直接访问文件系统、数据库、Node 或密钥。

## 历史兼容

- 已发布 `task_sessions.mode`、`skill_id`、`workspace_id` 和数据库 migration 不原地删除或改写。
- 旧内容工具和审批 Tool Part 可恢复、展示和审计，但从当前模型 active tool set 隔离。
- 内容库服务与历史 Operation 数据继续支持现有 UI；“不再是模型工具”不等于删除用户数据。
- 应用重启只恢复消息与运行状态，不重放已经完成的文件、项目或 Artifact 副作用。

## 验收场景

1. 无工作区的普通知识问题直接回答，不创建空目录、空文档或内容记录。
2. 研究请求按需联网、深读并给出来源，不写新的研究领域状态机记录。
3. 写作请求读取明确材料；有工作区时使用 `write` 创建 Markdown，成功后 Artifact 出现在当前 Task。
4. 修改已有文档使用 `read` + `edit/write`，冲突不覆盖外部更改，且无需逐次审批。
5. 用户通过 UI 创建项目或移动 Artifact，文件、索引和资源关系保持一致。
6. 重启后消息、run、Artifact 和 Workspace 可恢复，磁盘 Markdown 可脱离 Tessera 打开。
7. 历史研究/内容工具消息仍可查看，但不会被新模型重放。

## 非目标

- 不在 P2 开放任意 Shell、绝对路径、递归删除或跨工作区写入。
- 不建设内容管理 Agent、固定 Worker 池或第二套 Agent runtime。
- 不因删除模型领域工具而删除内容库 UI、历史数据或用户文件。
- 不在存储评审前承诺最终数据库正文或完全开放工作区方案。

## 触发器

统一任务入口、RunPolicy、文件提交、Artifact 登记、内容库服务、存储实验或相关 migration 变化时更新本文。
