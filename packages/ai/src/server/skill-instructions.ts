/**
 * [INPUT]: 本轮选择的可选内置/用户 Skill ID、主进程已复核的用户 Skill 与 @tessera/skills 渐进式加载器
 * [OUTPUT]: 可注入 AI SDK instructions、且明确不提升权限的当前 Skill 指令块
 * [POS]: 所有 ToolLoopAgent 路径共用的 Skill 上下文装配边界
 * [DOC]: docs/architecture/ai-chat-agent-todo.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSkillId } from "@tessera/contracts"
import { isUserTaskSkillId } from "@tessera/contracts"
import { type LoadedSkill, loadBuiltInSkill } from "@tessera/skills"

export async function buildTaskSkillInstructions(
  skillId: TaskSkillId,
  userSkill?: LoadedSkill,
): Promise<string | undefined> {
  const isUserSkill = isUserTaskSkillId(skillId)
  if (isUserSkill && (!userSkill || skillId !== `user:${userSkill.name}`)) {
    throw new Error("用户 Skill 尚未经过主进程校验。")
  }
  const skill = isUserSkill ? userSkill : await loadBuiltInSkill(skillId)
  if (!skill) return undefined

  return `当前任务已由用户显式选择${isUserSkill ? "用户" : "内置"} Skill「${skill.displayName}」（$${skill.name}）。
Skill 只扩展完成任务的方法，不授予新工具、文件、网络或写入权限；所有操作仍受当前工具可用性、工作区授权和执行器边界约束。

<skill name="${skill.name}">
${skill.instructions}
</skill>`
}
