/**
 * [INPUT]: Agent 权限效果、任务 Skill ID、标准 SKILL.md 文件约定与内置 Skill 源
 * [OUTPUT]: Skill 描述/权限契约、严格 SKILL.md 解析器，以及元数据常驻、正文按需加载的内置注册表
 * [POS]: Skill 发现、校验、选择和渐进式加载的领域入口
 * [DOC]: docs/architecture.md、docs/architecture/plugin-system.md、docs/architecture/skill-system.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

/// <reference path="./raw.d.ts" />

import type { PermissionEffect } from "@tessera/agent-runtime"
import type { BuiltInTaskSkillId, TaskSkillId } from "@tessera/contracts"

export const SKILL_FILENAME = "SKILL.md"
export const SKILL_SCOPES = ["built-in", "user", "workspace"] as const
const MAX_SKILL_SOURCE_CHARACTERS = 128_000

export type SkillScope = (typeof SKILL_SCOPES)[number]

export type SkillPermission<Action extends string = string, Resource extends string = string> = {
  readonly action: Action
  readonly resource: Resource
  readonly effect: PermissionEffect
}

export type SkillDescriptor<Permission extends SkillPermission = SkillPermission> = {
  readonly defaultPrompt: string
  readonly name: string
  readonly description: string
  readonly displayName: string
  readonly root: string
  readonly scope: SkillScope
  readonly shortDescription: string
  readonly permissions: readonly Permission[]
}

export type LoadedSkill<Permission extends SkillPermission = SkillPermission> =
  SkillDescriptor<Permission> & {
    readonly instructions: string
  }

export type BuiltInSkillDescriptor = SkillDescriptor & {
  readonly name: BuiltInTaskSkillId
  readonly scope: "built-in"
}

type SkillDocument = Readonly<{
  description: string
  instructions: string
  name: string
}>

type BuiltInSkillRegistration = Readonly<{
  descriptor: SkillDescriptor
  loadSource: () => Promise<string>
}>

export function defineSkill<const Descriptor extends SkillDescriptor>(descriptor: Descriptor): Descriptor {
  return descriptor
}

function parseScalar(value: string, field: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`Skill ${field} 不能为空。`)
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (typeof parsed !== "string") throw new Error()
      return parsed
    } catch {
      throw new Error(`Skill ${field} 的双引号格式无效。`)
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }
  if (/^[>|]/u.test(trimmed)) throw new Error(`Skill ${field} 暂不支持多行 YAML。`)
  return trimmed
}

export function parseSkillDocument(source: string, expectedName?: string): SkillDocument {
  if (!source || source.length > MAX_SKILL_SOURCE_CHARACTERS) throw new Error("SKILL.md 大小无效。")
  const normalized = source.replaceAll("\r\n", "\n")
  if (!normalized.startsWith("---\n")) throw new Error("SKILL.md 缺少 YAML frontmatter。")
  const boundary = normalized.indexOf("\n---\n", 4)
  if (boundary < 0) throw new Error("SKILL.md frontmatter 没有结束标记。")

  const metadata = new Map<string, string>()
  for (const line of normalized.slice(4, boundary).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    const separator = line.indexOf(":")
    if (separator <= 0) throw new Error("SKILL.md frontmatter 字段格式无效。")
    const key = line.slice(0, separator).trim()
    if (key !== "name" && key !== "description") throw new Error(`SKILL.md 包含未知字段：${key}。`)
    if (metadata.has(key)) throw new Error(`SKILL.md 字段重复：${key}。`)
    metadata.set(key, parseScalar(line.slice(separator + 1), key))
  }

  const name = metadata.get("name")
  const description = metadata.get("description")
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name.length > 64) {
    throw new Error("Skill name 必须是最长 64 字符的小写 kebab-case。")
  }
  if (expectedName && name !== expectedName) throw new Error(`Skill name 与目录不一致：${expectedName}。`)
  if (!description || description.length > 1_024) throw new Error("Skill description 大小无效。")
  const instructions = normalized.slice(boundary + 5).trim()
  if (!instructions) throw new Error("SKILL.md 缺少指令正文。")
  return { description, instructions, name }
}

const BUILT_IN_SKILLS = {
  research: {
    descriptor: defineSkill({
      defaultPrompt: "使用 $research 调查这个主题，并给出带来源的核验结论。",
      name: "research",
      description:
        "搜索、核验、比较并综合与问题相关的信息、证据和来源。用于需要调查、事实核查、比较来源或形成研究摘要的任务。",
      displayName: "研究",
      root: "builtin://research",
      scope: "built-in",
      shortDescription: "搜索、核验、比较并综合信息、证据和来源",
      permissions: [
        { action: "workspace.read", effect: "ask", resource: "workspace:**/*.md" },
        { action: "network.search", effect: "ask", resource: "internet" },
      ],
    }),
    loadSource: async () => (await import("../builtins/research/SKILL.md?raw")).default,
  },
  writing: {
    descriptor: defineSkill({
      defaultPrompt: "使用 $writing 面向目标读者规划、起草或修订这篇文档。",
      name: "writing",
      description:
        "根据目标、读者和已有材料规划、起草或修订结构清晰的 Markdown 内容。用于写作、改写、编辑和组织文档的任务。",
      displayName: "写作",
      root: "builtin://writing",
      scope: "built-in",
      shortDescription: "面向目标和读者规划、起草与修订 Markdown 内容",
      permissions: [
        { action: "workspace.read", effect: "ask", resource: "workspace:**/*.md" },
        { action: "workspace.write", effect: "ask", resource: "workspace:**/*.md" },
      ],
    }),
    loadSource: async () => (await import("../builtins/writing/SKILL.md?raw")).default,
  },
} as const satisfies Record<BuiltInTaskSkillId, BuiltInSkillRegistration>

export function listBuiltInSkills(): readonly BuiltInSkillDescriptor[] {
  return Object.values(BUILT_IN_SKILLS).map(({ descriptor }) => descriptor)
}

export async function loadBuiltInSkill(skillId: TaskSkillId): Promise<LoadedSkill | null> {
  if (skillId === null) return null
  const registration = BUILT_IN_SKILLS[skillId]
  const document = parseSkillDocument(await registration.loadSource(), registration.descriptor.name)
  if (document.description !== registration.descriptor.description) {
    throw new Error(`内置 Skill 描述与注册表不一致：${skillId}。`)
  }
  return { ...registration.descriptor, instructions: document.instructions }
}
