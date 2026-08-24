/**
 * [INPUT]: 用户显式创作方式、当前轮最近一条用户文本与当前任务是否已有完成研究
 * [OUTPUT]: 自动研究/写作收窄，以及完成研究后从遗留 Research 到 Writing 的 Artifact 交接意图
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
const RESEARCH_ARTIFACT_HANDOFF_INTENT =
  /(?:(?:写|整理|保存|存|落盘|创建|新建).{0,16}(?:文档|文章|报告|稿子|内容库)|(?:文档|文章|报告|稿子).{0,12}(?:保存|存下|落盘|创建|新建))/u

export function inferAutomaticTaskSkill(selectedSkillId: TaskSkillId, latestUserText: string): TaskSkillId {
  if (selectedSkillId !== null) return selectedSkillId
  const text = latestUserText.trim()
  if (!text) return null
  if (PROJECT_OPERATION_INTENT.test(text)) return null
  if (WRITING_INTENT.test(text)) return "writing"
  if (RESEARCH_INTENT.test(text)) return "research"
  return null
}

/** 已完成研究后的明确成稿/保存请求可以越过遗留的 Research 选择，交给 Writing 消费证据账本。 */
export function inferCompletedResearchFollowUpSkill(
  selectedSkillId: TaskSkillId,
  latestUserText: string,
  hasCompletedResearch: boolean,
): TaskSkillId {
  if (
    selectedSkillId === "research" &&
    hasCompletedResearch &&
    RESEARCH_ARTIFACT_HANDOFF_INTENT.test(latestUserText.trim())
  ) {
    return "writing"
  }
  return selectedSkillId
}
