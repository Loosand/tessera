/**
 * [INPUT]: 用户显式创作方式与当前轮最近一条用户文本
 * [OUTPUT]: 自动研究/写作 Skill 收窄
 * [POS]: UI 模式选择与受信任 RunPolicy 之间的无副作用自动意图路由层
 * [DOC]: docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSkillId } from "@tessera/contracts"

const WRITING_INTENT =
  /(?:写(?:一|个|篇|成|作|出|下|好|完)|撰写|成稿|文章|文案|口播|脚本|改写|润色|扩写|续写|整理成|保存成|创建.{0,6}文档)/u
const RESEARCH_INTENT =
  /(?:深入了解|深入研究|研究一下|系统研究|调研|查证|核验|资料综述|背景调查|全面了解|搜集资料)/u
const PROJECT_OPERATION_INTENT =
  /(?:(?:新建|创建|建立|建|搞|做).{0,8}(?:项目|工作区|board)|(?:移动|挪|归档|整理).{0,12}(?:文档|稿子|文章|项目|工作区|board)|(?:项目|工作区|board).{0,8}(?:移动|挪|归档|整理))/iu
export function inferAutomaticTaskSkill(selectedSkillId: TaskSkillId, latestUserText: string): TaskSkillId {
  if (selectedSkillId !== null) return selectedSkillId
  const text = latestUserText.trim()
  if (!text) return null
  if (PROJECT_OPERATION_INTENT.test(text)) return null
  if (WRITING_INTENT.test(text)) return "writing"
  if (RESEARCH_INTENT.test(text)) return "research"
  return null
}
