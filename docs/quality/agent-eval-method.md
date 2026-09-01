# Tessera Agent Eval：代码化黄金任务与质量优先评分

> 状态：**基础评估包与 `tessera-core` v1 已实现；真实模型批量 runner 尚未实现。**
>
> 代码事实源：`packages/agent-evals/`。本文解释评估方法，不复制维护每个 Case 的完整 fixture。

## 目标

Tessera 不能只用单元测试证明 Agent 变得更好，也不能只看某一次演示是否顺利。Agent Eval 用同一组固定任务比较
模型、供应商、Prompt、Skill 和 Runtime 版本，回答三个彼此独立的问题：

1. **有没有安全、真实地完成任务；**
2. **结果本身好不好；**
3. **达到相同质量用了多少 Turn、工具、Token、时间和人工纠正。**

评估顺序固定为：

```text
硬门槛
  -> 人工质量达到 Case 最低分
  -> 客观效率和预算
```

效率不能抵消错误结果。例如，一个运行只用 1 Turn 但改错文件，仍然失败；两个运行都获人工 5 分时，10 Turn 的运行
明确优于 50 Turn 的运行。

## 代码资产边界

`@tessera/agent-evals` 保存并测试以下资产：

- Suite / Case Schema 与稳定版本号；
- 用户请求和完整初始工作区内存快照；
- 可选的脚本化外部事件，例如第一次读取后发生外部文件修改；
- 精确文件结果、禁止变化、工具要求和关键事实锚点；
- 每个任务的人工评审关注点和最低质量分；
- Turn、工具、失败、重复、Token、耗时和用户纠正预算；
- Run Inspector 指标适配、JSON 校验、评分和 Markdown 报告。

真实供应商输出、API Key、用户数据和临时工作区不属于评估集。日常运行结果默认放在 `.local/`，派生报告放在被 Git
忽略的 `artifacts/agent-evals/`。只有经过脱敏并需要长期对照的发布基线，才另行进入 `docs/quality/`。

## `tessera-core` v1

首批六个 Case 都使用固定本地材料，不依赖实时网页或当前日期：

| Case | 能力 | 核心判定 |
| --- | --- | --- |
| `direct-answer-side-effects-v1` | 简单问答 | 不调用工具；解释副作用与重试 |
| `workspace-fact-summary-v1` | 工作区理解 | 读取两份材料、引用路径、不写文件 |
| `markdown-precise-edit-v1` | 精确编辑 | 只改变两处指定内容，其余字节保持 |
| `test-fix-minimal-v1` | Bash / 测试修复 | 先复现、最小修复、复测，不改测试 |
| `research-evidence-synthesis-v1` | 固定来源研究 | 解释数字冲突、限制和引用路径 |
| `file-conflict-recovery-v1` | 稳定性 | 外部修改造成冲突后重读，保留新版本 |

Case ID 带 `-vN` 后缀。已发布 ID 不原地改义；材料或成功条件发生不兼容变化时新增版本，Suite 同步升版。

## 硬门槛

机器检查使用最终快照和事件事实，不从模型语气猜成功：

- run 必须进入 `finish`；
- 没有安全违规；
- 脚本事件按约定发生；
- 精确文件与不变文件符合预期；
- 没有白名单外文件变化；
- 必要工具、禁止工具和最低调用次数符合 Case；
- 工具调用/失败计数与观察到的 Tool Part 一致；
- 少量答案关键词只作为事实锚点，不代表完整质量。

任一硬检查失败，等级都是 `failed`，人工高分不能覆盖。

## 人工质量

每项按 0–5 分、0.5 分步进评分：

| 维度 | 权重 | 判断问题 |
| --- | ---: | --- |
| 正确性 | 35% | 事实、代码、引用和文件结果是否正确 |
| 完整性 | 20% | 是否覆盖要求、约束和必要限制 |
| 可用性 | 20% | 是否能直接采用、运行、编辑或决策 |
| 可信度 | 15% | 是否诚实表达来源、权限、不确定性和执行事实 |
| 清晰度 | 10% | 是否简洁清楚并与任务复杂度相称 |

每个 Case 另有 `humanGuidance`，用于提醒该任务最容易被统一量表漏掉的判断。评分人应先看最终结果和必要运行事实，
再给分；模型版本对比时尽量隐藏候选身份，减少品牌偏差。

## 客观效率

每项指标同时有 `target` 和 `maximum`：

- 小于等于 target：100 分；
- target 到 maximum：线性下降；
- 达到或超过 maximum：0 分；
- 超过任一 maximum：该运行标为 `over-budget`；
- Token 或耗时缺失：标为测量不完整，不能获得 `excellent`。

综合效率权重为：Turn 30%、工具调用 20%、工具失败 10%、重复工具 10%、Token 15%、耗时 10%、用户纠正 5%。
因此在其他条件相同、Turn 目标为 10、上限为 50 时，10 Turn 得到 100 的效率分；50 Turn 的综合效率最多为 70，
即使两次人工质量都是 5 分也不会被视为等价。

等级含义：

- `failed`：硬门槛失败；
- `unscored`：缺人工分或关键客观指标；
- `below-quality`：人工质量低于 Case 门槛；
- `over-budget`：质量通过，但至少一项客观预算超限；
- `qualified`：质量与预算通过；
- `excellent`：人工分至少 4.5、效率至少 85，且全部测量完整。

## 运行与报告

列出当前代码评估集：

```bash
bun run eval:agent -- --list
```

评估记录使用 `AgentEvalRunRecord` JSON。Runner 需要记录完整最终工作区快照、工具名称/终态、脚本事件、Run Inspector
指标、代码 revision、模型身份和可选人工评分。可复制的完整格式见
`packages/agent-evals/examples/direct-answer-run.example.json`。生成报告：

```bash
bun run eval:agent -- \
  --input .local/agent-evals/runs.json \
  --output artifacts/agent-evals/report.md
```

报告按 Case 输出硬门槛通过率、人工均分、Turn/工具/Token/耗时中位数、效率均分和 Excellent 数，并列出单次失败原因。

## 比较协议

正式比较至少遵守：

1. 固定 Suite 版本、代码 revision、模型 ID、供应商配置和运行权限；
2. 每个 Case / 候选至少运行 3 次，重要发布建议 5 次；
3. 同时报通过率和中位效率，不只挑最好一次；
4. 人工评分使用同一量表，尽量盲评并保存简短 notes；
5. 供应商不返回 Token 等指标时明确缺失，不填零；
6. 失败运行保留在统计中，不用补跑成功样本替换；
7. 调整预算或 Case 必须升版，不能为了当前候选变绿而修改基线。

## 下一步

下一批实现顺序：

1. 建立临时工作区 materializer 和真实 Tessera Run 驱动，自动收集 Tool Part 与最终快照；
2. 将 Run Inspector 导出连接到 `AgentEvalRunRecord`，减少手工转录；
3. 为长文写作增加事实保持、结构、语气和修改幅度 Case；
4. 为 Web 研究建立可固定正文版本的来源包，不用漂移的实时网页作为唯一基准；
5. 基线稳定后再考虑应用内人工打分入口。

评估 runner 仍必须复用产品 Agent Runtime；不得为了跑 Eval 实现第二套 Agent loop。
