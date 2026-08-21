/**
 * [INPUT]: Skill 作用域、描述符泛型与类型保真定义器
 * [OUTPUT]: Skill 字面量和权限动作不会被宽化的编译期契约
 * [POS]: Skill 公共类型退化的静态回归测试
 * [DOC]: docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type SkillScope, defineSkill } from "./index"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right
  ? 1
  : 2
  ? true
  : false
type Expect<Value extends true> = Value

const readerSkill = defineSkill({
  defaultPrompt: "使用 $reader 阅读工作区文档。",
  name: "reader",
  description: "阅读工作区文档",
  displayName: "阅读",
  root: "/skills/reader",
  scope: "workspace",
  shortDescription: "阅读工作区文档",
  permissions: [{ action: "document.read", effect: "ask", resource: "workspace:**/*.md" }],
})

export type SkillTypeContract = [
  Expect<Equal<SkillScope, "built-in" | "user" | "workspace">>,
  Expect<Equal<typeof readerSkill.name, "reader">>,
  Expect<Equal<typeof readerSkill.scope, "workspace">>,
  Expect<Equal<(typeof readerSkill.permissions)[number]["action"], "document.read">>,
]
