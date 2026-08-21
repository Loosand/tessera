/**
 * [INPUT]: Hugeicons 图标数据、尺寸与可选无障碍标签
 * [OUTPUT]: 统一描边、尺寸语义和无障碍行为的 Icon 组件
 * [POS]: 隔离业务组件与具体图标渲染库的基础包装层
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react"

export type IconProps = Omit<HugeiconsIconProps, "strokeWidth"> &
  Readonly<{
    label?: string
    strokeWidth?: number
  }>

export function Icon({ label, size = 18, strokeWidth = 1.7, ...props }: IconProps) {
  return (
    <HugeiconsIcon
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      size={size}
      strokeWidth={strokeWidth}
      {...props}
    />
  )
}
