/**
 * [INPUT]: AI 供应商目录、内置/动态配置映射与可编辑草稿字段
 * [OUTPUT]: 供应商字面量、必选内置连接、可选动态连接和不可变身份字段的编译期契约
 * [POS]: AI 供应商公开类型退化的静态回归测试
 * [DOC]: docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  AI_PROVIDER_DEFINITIONS,
  AiProviderDraft,
  AiProviderDraftUpdate,
  AiProviderDrafts,
  AiProviderId,
} from "./provider-catalog"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right
  ? 1
  : 2
  ? true
  : false
type Expect<Value extends true> = Value

type ProviderDefinitionId = (typeof AI_PROVIDER_DEFINITIONS)[number]["id"]
type DynamicConfigId = `openai-compatible:${string}`

const editableFields = {
  baseUrl: "https://api.example.com/v1",
  enabled: true,
  models: [],
} satisfies AiProviderDraftUpdate

const immutableIdentityUpdate: AiProviderDraftUpdate = {
  // @ts-expect-error 连接身份不属于界面可编辑字段。
  providerId: "deepseek",
}

export type AiProviderTypeContract = [
  Expect<Equal<ProviderDefinitionId, AiProviderId>>,
  Expect<Equal<AiProviderDrafts["deepseek"], AiProviderDraft>>,
  Expect<Equal<AiProviderDrafts[DynamicConfigId], AiProviderDraft | undefined>>,
  Expect<Equal<typeof editableFields.enabled, true>>,
  Expect<Equal<keyof typeof immutableIdentityUpdate, keyof AiProviderDraftUpdate>>,
]
