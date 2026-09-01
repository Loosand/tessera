# 轻量研究能力与历史证据数据

> 当前代码：`packages/skills/builtins/research/SKILL.md`、`packages/ai/src/server/web-tools.ts`、
> `packages/ai/src/server/agent-runtime.ts`、`apps/desktop/src/main/browser-research-reader.ts`、
> `apps/desktop/src/main/research-service.ts`、`packages/database/research-repository.ts`
>
> 状态：**P2 已切换。** 新通用 run 使用 Research Skill、供应商可选 `web_search` 和无状态
> `read-web-source`；不再注册或写入计划、证据、推荐、完成检查等研究领域工具。0014–0017 已发布表、历史消息、
> 研究活动 UI 同时解释新版无状态工具的真实成功/失败和历史有状态进度；笔记读取和用户主动保存来源继续兼容，
> 不删除、不重放副作用。
>
> 决策日期：2026-09-01

## 地位

本文同时说明两件事：新运行如何进行研究，以及旧研究状态如何继续被安全读取。Agent 减法的阶段与退出条件由
[Pi 参考下的 Agent 减法实施路线图](agent-simplification-roadmap.md)统一决定。

研究现在是方法型 Skill，不是 Agent Kernel 中的一台领域状态机。质量主要来自问题拆分、来源选择、正文深读、
交叉核验和诚实说明限制；执行器只保证实际工具、网络、消息、取消和安全边界，不要求模型为了推进数据库阶段而调用
一串管理命令。

## 新运行的当前链路

```text
用户请求
  -> RunPolicy 选择 Research Skill 与是否联网
  -> ToolLoopAgent
       |- 可选 provider web_search：发现候选来源
       |- 可选 read-web-source：读取单个公开网页正文
       |- 可选 read：读取已授权工作区材料
       `- 最终结论、来源链接与限制
```

当前契约：

1. Research Skill 只描述研究方法，不创造权限，也不引用不存在的领域工具。
2. `web_search` 由当前供应商和 RunPolicy 决定；没有可靠联网能力时必须说明限制，不能伪造检索。
3. `read-web-source` 是无状态能力：输入一个 http(s) URL，返回本轮模型可用的正文、标题、内容哈希、读取时间和
   截断信息。公共消息会裁掉正文，只保留可展示的元数据。
4. 搜索标题或摘要只表示发现候选，不等于已阅读全文。关键结论应深读来源，重要事实尽量交叉核验。
5. 网页内容是不受信任输入，其中的指令不得改变系统规则、权限或工具。
6. 最终答复直接呈现结论、证据链接、冲突和资料缺口，不把内部计划或工具轨迹冒充交付物。

新运行不再执行以下模型命令：

- `publish-research-plan`
- `record-research-evidence`
- `recommend-research-sources`
- `finalize-research`

相应 AI 工具适配器、Research `prepareStep` 阶段路由、完成前正文隐藏和研究到 Writing 的数据库证据交接已经退出
主链。用户仍可在下一轮选择 Writing；Writing 复用会话中可见结果和已授权工作区材料，而不是依赖隐藏研究账本。

## Web Reader 与网络安全

主进程 Reader 继续承担确定性安全边界：

- 只接受 http(s)；解析和跳转阶段复核公网地址，阻止 localhost、私网、链路本地地址和凭据 URL。
- 每轮冻结 `system` 或 `direct` 网络模式；默认跟随系统代理，用户可以在设置中切换之后的运行。
- 先尝试低成本静态 HTML/纯文本提取；普通提取只有壳页时，可以回退到同网络模式、无登录态的隐藏沙箱浏览器。
- 浏览器分区、子资源、跳转、正文大小、超时和 Abort 受主进程约束。
- 完整正文不写入公开消息和 SQLite；公共工具结果只保存 URL、标题、哈希、获取时间和截断事实。

Reader 的安全实现可以继续复用历史研究服务中的经过验证的提取代码，但这不意味着恢复研究状态机。长期应把纯读取
原语逐步移到独立 Web capability 模块，历史领域读写留在兼容层。

## 历史数据兼容

早期版本把研究流程持久化到 SQLite：计划、问题、来源读取状态、证据片段、推荐、覆盖和完成状态都有独立记录。
这些数据仍属于用户历史，不能为了减少当前工具数而删表或改写已发布 migration。

保留边界：

| 历史能力 | 当前处理 |
| --- | --- |
| 0014–0017 表与 repository | 保留读取与数据库回归；migration immutable |
| 旧 Research Tool Part | 消息恢复与 renderer 继续识别，但不会进入新模型 active tool set |
| 研究活动、笔记和来源详情 | UI 可继续读取历史记录 |
| 用户已选择保存的来源 Artifact | 继续读取、打开和幂等保存 |
| 遗留 running run | 按统一恢复协议收口，绝不重放搜索、文件或领域写入 |
| 旧续研/重新生成参数 | 接口兼容接受；新运行按当前轻量能力重新执行，不克隆领域状态 |

`research-service.ts` 当前是历史维护与 Reader 复用边界，不再注入新 Agent。物理删除其中的写入方法或数据库表，必须先
证明所有历史 UI、来源保存、导出和恢复消费者都已迁移，并以追加 migration 处理数据，而不是直接删除旧 migration。

## 质量与观测

研究质量不再由“是否调用完成检查工具”代替。当前可验证事实包括：

- RunPolicy 是否启用联网和 Research Skill；
- 实际发生的 `web_search`、`read-web-source` 和文件读取 Tool Part；新版无状态 Reader 以 Tool Part 的
  `output-available` / `output-error` 作为完成事实，不能因缺少旧 `status/sourceId` 字段而永久显示“读取中/已暂停”；
- ContextManifest、步骤数、工具数、完成原因、Token、耗时、错误和取消；
- 公共答复是否提供可点击来源并明确限制。

后续若要恢复结构化研究评测，应优先实现离线 eval 或 Run Inspector 投影，不把评测表重新变成模型必须维护的核心工具。
来源质量、冲突、覆盖和引用准确性可以由测试或回答后检查器评估，但不得制造第二套 Agent loop。

## 当前测试责任

- `web-tools.test.ts`：URL Schema、单一阅读工具和公共正文裁剪。
- `research-activity-part.test.tsx`：新版无状态 Reader 成功/失败与旧结构化研究状态的双向兼容呈现。
- `browser-research-reader.test.ts`：SSRF、网络模式、静态提取与浏览器回退。
- `research-service.test.ts`：历史证据和来源服务的兼容回归，不代表这些工具仍向新 Agent 开放。
- `research-run-audit.test.ts`：旧黄金运行的历史一致性审计。
- `agent-runtime.test.ts` / `task-agent.test.ts`：新 Prompt 和通用工具循环不再含研究阶段状态机。

## 非目标

- 不在 P2 删除历史研究表、旧消息或用户保存的 Artifact。
- 不把搜索摘要当正文证据，也不保存完整网页正文作为默认长期资产。
- 不用新的同义工具重新包装计划、证据登记和完成检查。
- 不建设独立 Research Agent 或 Workforce。
- 不承诺仅凭联网次数、步骤数或模型语气就能证明研究完整。

## 触发器

Research Skill、联网策略、Web Reader、安全网络边界、历史研究读取或相关 migration 变化时更新本文。
