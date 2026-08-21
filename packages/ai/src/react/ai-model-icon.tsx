/**
 * [INPUT]: 完整模型 ID、目标尺寸与可选容器样式
 * [OUTPUT]: 按需加载、未知模型可回退的统一模型头像
 * [POS]: @tessera/ai/react 在设置与对话界面复用的模型品牌边界
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { Suspense, lazy } from "react"

const ModelIcon = lazy(async () => {
  const icons = await import("@lobehub/icons")
  return { default: icons.ModelIcon }
})

export type AiModelIconProps = {
  className?: string
  modelId: string
  size?: number
}

export function AiModelIcon({ className = "", modelId, size = 18 }: AiModelIconProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ height: size, width: size }}
      aria-hidden="true"
    >
      <Suspense fallback={<span className="size-full animate-pulse rounded-full bg-muted" />}>
        <ModelIcon model={modelId} shape="circle" size={size} type="avatar" />
      </Suspense>
    </span>
  )
}
