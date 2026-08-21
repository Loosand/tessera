/**
 * [INPUT]: 完整模型 ID、目标尺寸与可选容器样式
 * [OUTPUT]: 从精选品牌映射按需加载、未知模型可回退的统一模型头像
 * [POS]: @tessera/ai/react 在设置与对话界面复用的模型品牌边界
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type ComponentType, type LazyExoticComponent, Suspense, lazy } from "react"

type ModelIconBrand =
  | "claude"
  | "cohere"
  | "deepseek"
  | "gemini"
  | "grok"
  | "meta"
  | "minimax"
  | "mistral"
  | "moonshot"
  | "openai"
  | "openrouter"
  | "perplexity"
  | "qwen"
  | "zai"

type ModelAvatarProps = {
  shape?: "circle" | "square"
  size: number
}

type LazyModelAvatar = LazyExoticComponent<ComponentType<ModelAvatarProps>>

const MODEL_ICONS = {
  claude: lazy(() => import("@lobehub/icons/es/Claude/components/Avatar")),
  cohere: lazy(() => import("@lobehub/icons/es/Cohere/components/Avatar")),
  deepseek: lazy(() => import("@lobehub/icons/es/DeepSeek/components/Avatar")),
  gemini: lazy(() => import("@lobehub/icons/es/Gemini/components/Avatar")),
  grok: lazy(() => import("@lobehub/icons/es/Grok/components/Avatar")),
  meta: lazy(() => import("@lobehub/icons/es/Meta/components/Avatar")),
  minimax: lazy(() => import("@lobehub/icons/es/Minimax/components/Avatar")),
  mistral: lazy(() => import("@lobehub/icons/es/Mistral/components/Avatar")),
  moonshot: lazy(() => import("@lobehub/icons/es/Moonshot/components/Avatar")),
  openai: lazy(() => import("@lobehub/icons/es/OpenAI/components/Avatar")),
  openrouter: lazy(() => import("@lobehub/icons/es/OpenRouter/components/Avatar")),
  perplexity: lazy(() => import("@lobehub/icons/es/Perplexity/components/Avatar")),
  qwen: lazy(() => import("@lobehub/icons/es/Qwen/components/Avatar")),
  zai: lazy(() => import("@lobehub/icons/es/ZAI/components/Avatar")),
} satisfies Record<ModelIconBrand, LazyModelAvatar>

const MODEL_ICON_RULES: ReadonlyArray<{ brand: ModelIconBrand; pattern: RegExp }> = [
  {
    brand: "openai",
    pattern: /(?:^|[\/_-])(?:chatgpt|codex|dall-e|gpt|o1|o3|o4|whisper)(?:[\/_-]|$)|openai/iu,
  },
  { brand: "claude", pattern: /anthropic|claude/iu },
  { brand: "deepseek", pattern: /deepseek/iu },
  { brand: "grok", pattern: /(?:^|[\/_-])grok(?:[\/_-]|$)|xai/iu },
  { brand: "gemini", pattern: /gemini|gemma/iu },
  { brand: "qwen", pattern: /qwen|qvq|qwq|tongyi/iu },
  { brand: "meta", pattern: /(?:^|[\/_-])(?:llama|meta)(?:[\/_-]|$)/iu },
  { brand: "mistral", pattern: /codestral|mistral|mixtral|pixtral/iu },
  { brand: "moonshot", pattern: /kimi|moonshot/iu },
  { brand: "zai", pattern: /(?:^|[\/_-])glm(?:[\/_-]|$)|zai/iu },
  { brand: "minimax", pattern: /abab|minimax/iu },
  { brand: "perplexity", pattern: /perplexity|sonar/iu },
  { brand: "cohere", pattern: /cohere|command-r/iu },
  { brand: "openrouter", pattern: /openrouter/iu },
]

export function resolveAiModelIconBrand(modelId: string): ModelIconBrand | undefined {
  return MODEL_ICON_RULES.find(({ pattern }) => pattern.test(modelId))?.brand
}

export type AiModelIconProps = {
  className?: string
  modelId: string
  size?: number
}

export function AiModelIcon({ className = "", modelId, size = 18 }: AiModelIconProps) {
  const brand = resolveAiModelIconBrand(modelId)
  const ModelIcon = brand ? MODEL_ICONS[brand] : undefined

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ height: size, width: size }}
      aria-hidden="true"
    >
      {ModelIcon ? (
        <Suspense fallback={<span className="size-full animate-pulse rounded-full bg-muted" />}>
          <ModelIcon shape="circle" size={size} />
        </Suspense>
      ) : (
        <span className="flex size-full items-center justify-center rounded-full bg-muted text-[8px] font-semibold text-muted-foreground">
          AI
        </span>
      )}
    </span>
  )
}
