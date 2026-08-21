/**
 * [INPUT]: 任务保存的可选内置 Skill ID 与 @tessera/skills 渐进式加载器
 * [OUTPUT]: 可注入 AI SDK instructions、且明确不提升权限的当前 Skill 指令块
 * [POS]: Chat streamText 与 ToolLoopAgent 共用的 Skill 上下文装配边界
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSkillId } from "@tessera/contracts"
import { loadBuiltInSkill } from "@tessera/skills"

export async function buildTaskSkillInstructions(skillId: TaskSkillId): Promise<string | undefined> {
  const skill = await loadBuiltInSkill(skillId)
  if (!skill) return undefined

  return `当前任务已由用户显式选择内置 Skill「${skill.displayName}」（$${skill.name}）。
Skill 只扩展完成任务的方法，不授予新工具、文件、网络或写入权限；所有操作仍受当前 Chat/Agent 模式、工具可用性和人工审批约束。

<skill name="${skill.name}">
${skill.instructions}
</skill>`
}
