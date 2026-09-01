/**
 * [INPUT]: Tessera 当前核心 Agent 能力、固定工作区材料与一期质量/效率目标
 * [OUTPUT]: 六个不依赖实时网络的版本化黄金任务 Case
 * [POS]: tessera-core Eval Suite 的代码资产主体
 * [DOC]: docs/quality/agent-eval-method.md、docs/architecture/agent-simplification-roadmap.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { AgentEvalCase, AgentEvalEfficiencyBudget, AgentEvalMetricBudget } from "../types"

const metric = (target: number, maximum: number): AgentEvalMetricBudget => ({ target, maximum })

function budget(
  values: Readonly<{
    durationMs: readonly [number, number]
    repeatedToolCalls?: readonly [number, number]
    toolCalls: readonly [number, number]
    toolFailures?: readonly [number, number]
    totalTokens: readonly [number, number]
    turns: readonly [number, number]
    userCorrections?: readonly [number, number]
  }>,
): AgentEvalEfficiencyBudget {
  return {
    turns: metric(...values.turns),
    toolCalls: metric(...values.toolCalls),
    toolFailures: metric(...(values.toolFailures ?? [0, 1])),
    repeatedToolCalls: metric(...(values.repeatedToolCalls ?? [0, 1])),
    totalTokens: metric(...values.totalTokens),
    durationMs: metric(...values.durationMs),
    userCorrections: metric(...(values.userCorrections ?? [0, 0])),
  }
}

export const DIRECT_ANSWER_CASE: AgentEvalCase = {
  id: "direct-answer-side-effects-v1",
  version: 1,
  title: "直接解释工具副作用与回答终态",
  category: "direct-answer",
  tags: ["no-tools", "reliability", "concise"],
  prompt: "请用两三句话解释：为什么 Agent 系统必须分别记录工具调用成功和最终回答成功？",
  workspace: null,
  scriptedEvents: [],
  expected: {
    allowedChangedFiles: [],
    answerIncludes: ["副作用", "重试"],
    forbiddenTools: ["read", "edit", "write", "bash", "web_search", "read-web-source"],
  },
  humanGuidance: [
    "解释应指出工具可能已经产生不可重放的副作用。",
    "解释应指出最终回答失败不等于工具没有成功，重试不能盲目重复执行。",
    "两三句话即可，不因展示能力而调用工具。",
  ],
  minimumHumanScore: 4,
  budget: budget({ turns: [1, 2], toolCalls: [0, 0], totalTokens: [350, 900], durationMs: [8_000, 20_000] }),
}

const WORKSPACE_SUMMARY_FILES = {
  "README.md": `# Lumen

Lumen 是一个本地优先的命令行笔记工具，不提供 GUI。

开发命令：

- bun test
- bun run typecheck
`,
  "docs/decisions.md": `# 决策记录

Markdown 是正文事实源。SQLite 只保存可重建索引和运行元数据。

首个公开版本只支持 macOS 与 Linux。
`,
} as const

export const WORKSPACE_SUMMARY_CASE: AgentEvalCase = {
  id: "workspace-fact-summary-v1",
  version: 1,
  title: "从两个工作区文件提取事实",
  category: "workspace",
  tags: ["read", "grounding", "no-write"],
  prompt: "阅读当前工作区，用三点总结产品形态、正文存储决策和支持平台，并附上相对文件路径。不要修改文件。",
  workspace: { files: WORKSPACE_SUMMARY_FILES },
  scriptedEvents: [],
  expected: {
    allowedChangedFiles: [],
    answerIncludes: [
      "Lumen",
      "命令行",
      "Markdown",
      "SQLite",
      "macOS",
      "Linux",
      "README.md",
      "docs/decisions.md",
    ],
    requiredTools: ["read"],
    unchangedFiles: Object.keys(WORKSPACE_SUMMARY_FILES),
  },
  humanGuidance: [
    "三点分别对应产品形态、存储事实和平台，不混入材料外推断。",
    "说明 SQLite 不是正文事实源。",
    "路径应能让用户回到事实来源。",
  ],
  minimumHumanScore: 4,
  budget: budget({
    turns: [3, 7],
    toolCalls: [2, 5],
    totalTokens: [1_600, 4_000],
    durationMs: [20_000, 60_000],
  }),
}

const EDITING_BASE = `# Atlas 发布说明

- 状态：规划中
- 发布命令：待定
- 负责人：Mina

## 范围

只发布 macOS arm64 构建。
`

const EDITING_EXPECTED = `# Atlas 发布说明

- 状态：已实现
- 发布命令：bun run dist:mac
- 负责人：Mina

## 范围

只发布 macOS arm64 构建。
`

export const PRECISE_EDIT_CASE: AgentEvalCase = {
  id: "markdown-precise-edit-v1",
  version: 1,
  title: "最小化修改发布说明",
  category: "editing",
  tags: ["read", "edit", "preservation"],
  prompt:
    "把 README.md 中的状态改为“已实现”，发布命令改为 `bun run dist:mac`。负责人和范围必须保持不变。完成后简短说明。",
  workspace: { files: { "README.md": EDITING_BASE } },
  scriptedEvents: [],
  expected: {
    allowedChangedFiles: ["README.md"],
    expectedFiles: { "README.md": EDITING_EXPECTED },
    requiredTools: ["read"],
    oneOfToolGroups: [["edit", "write"]],
  },
  humanGuidance: [
    "只发生用户要求的两处变化。",
    "负责人、范围、Markdown 结构和尾部换行保持不变。",
    "最终说明与真实文件结果一致。",
  ],
  minimumHumanScore: 4.25,
  budget: budget({
    turns: [3, 7],
    toolCalls: [2, 5],
    totalTokens: [1_500, 4_000],
    durationMs: [20_000, 60_000],
  }),
}

const TEST_FIX_BASE = `export function add(left: number, right: number) {
  return left - right
}
`

const TEST_FIX_EXPECTED = `export function add(left: number, right: number) {
  return left + right
}
`

export const TEST_FIX_CASE: AgentEvalCase = {
  id: "test-fix-minimal-v1",
  version: 1,
  title: "运行测试并最小修复代码",
  category: "test-fix",
  tags: ["bash", "test", "minimal-change"],
  prompt: "运行测试，定位失败原因并完成最小修复。不要修改测试文件。修复后重新运行测试并报告结果。",
  workspace: {
    files: {
      "package.json": `{"type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"^4.1.11"}}\n`,
      "src/math.ts": TEST_FIX_BASE,
      "src/math.test.ts": `import { expect, it } from "vitest"
import { add } from "./math"

it("adds two values", () => {
  expect(add(4, 3)).toBe(7)
})
`,
    },
  },
  scriptedEvents: [],
  expected: {
    allowedChangedFiles: ["src/math.ts"],
    answerIncludes: ["测试", "通过"],
    expectedFiles: { "src/math.ts": TEST_FIX_EXPECTED },
    requiredTools: ["bash"],
    unchangedFiles: ["package.json", "src/math.test.ts"],
    minimumToolCalls: { bash: 2 },
  },
  humanGuidance: [
    "通过失败测试定位生产代码中的减法错误。",
    "不通过篡改测试或扩大重构来制造绿色结果。",
    "报告应区分修复内容和最终测试事实。",
  ],
  minimumHumanScore: 4.25,
  budget: budget({
    turns: [5, 11],
    toolCalls: [3, 8],
    totalTokens: [3_000, 8_000],
    durationMs: [45_000, 150_000],
  }),
}

const RESEARCH_FILES = {
  "sources/field-study.md": `# Field study

一项 2025 年对 200 名参与者的现场研究报告称，采用新流程后平均完成时间下降 12%。研究同时说明样本只来自一个团队。
`,
  "sources/internal-review.md": `# Internal review

内部复核使用同一批原始记录，但排除了 18 个缺失结束时间的样本，计算得到完成时间下降 15%。作者认为不能把结果外推到其他团队。
`,
  "sources/method-note.md": `# Method note

两个百分比使用不同的缺失值处理方式。现有材料没有随机对照组，也没有报告长期留存效果。
`,
} as const

export const RESEARCH_SYNTHESIS_CASE: AgentEvalCase = {
  id: "research-evidence-synthesis-v1",
  version: 1,
  title: "综合固定来源并诚实表达冲突",
  category: "research",
  tags: ["sources", "citation", "limitations"],
  prompt:
    "基于 sources/ 中的三份材料，判断新流程是否提高了效率。说明 12% 与 15% 的差异、证据限制，并在相关句子中引用相对文件路径。不要修改文件。",
  workspace: { files: RESEARCH_FILES },
  scriptedEvents: [],
  expected: {
    allowedChangedFiles: [],
    answerIncludes: [
      "12%",
      "15%",
      "sources/field-study.md",
      "sources/internal-review.md",
      "sources/method-note.md",
      "缺失",
    ],
    requiredTools: ["read"],
    unchangedFiles: Object.keys(RESEARCH_FILES),
  },
  humanGuidance: [
    "结论应是有限支持，而不是把观察性结果写成普遍因果结论。",
    "解释两个数字源于缺失值处理差异。",
    "指出单团队、无随机对照和缺少长期结果，并把声明连接到相应材料。",
  ],
  minimumHumanScore: 4.25,
  budget: budget({
    turns: [4, 9],
    toolCalls: [3, 7],
    totalTokens: [2_500, 7_000],
    durationMs: [35_000, 100_000],
  }),
}

const CONFLICT_BASE = `# Release

- status: planning
- owner: Lin
`

const CONFLICT_EXTERNAL = `# Release

- status: planning
- owner: Rui
- external-note: dependency audit completed
`

const CONFLICT_EXPECTED = `# Release

- status: shipped
- owner: Rui
- external-note: dependency audit completed
`

export const CONFLICT_RECOVERY_CASE: AgentEvalCase = {
  id: "file-conflict-recovery-v1",
  version: 1,
  title: "外部修改后重新读取并保留新版本",
  category: "recovery",
  tags: ["conflict", "reread", "preservation"],
  prompt: "把 status.md 中的 status 改为 `shipped`，其他字段保持不变。",
  workspace: { files: { "status.md": CONFLICT_BASE } },
  scriptedEvents: [
    {
      id: "external-owner-update",
      trigger: { toolName: "read", occurrence: 1, phase: "after-result" },
      action: { type: "replace-file", path: "status.md", content: CONFLICT_EXTERNAL },
    },
  ],
  expected: {
    allowedChangedFiles: ["status.md"],
    expectedFiles: { "status.md": CONFLICT_EXPECTED },
    minimumToolCalls: { read: 2, edit: 2 },
    requiredTools: ["read", "edit"],
  },
  humanGuidance: [
    "第一次基准失效后识别 conflict，而不是覆盖外部版本。",
    "重新读取后只修改 status，并保留 Rui 与 external-note。",
    "最终回答不把第一次失败的 edit 说成已成功提交。",
  ],
  minimumHumanScore: 4.5,
  budget: budget({
    turns: [6, 12],
    toolCalls: [4, 8],
    toolFailures: [1, 2],
    repeatedToolCalls: [0, 2],
    totalTokens: [3_500, 9_000],
    durationMs: [50_000, 150_000],
  }),
}

export const TESSERA_CORE_CASES: readonly AgentEvalCase[] = [
  DIRECT_ANSWER_CASE,
  WORKSPACE_SUMMARY_CASE,
  PRECISE_EDIT_CASE,
  TEST_FIX_CASE,
  RESEARCH_SYNTHESIS_CASE,
  CONFLICT_RECOVERY_CASE,
]
