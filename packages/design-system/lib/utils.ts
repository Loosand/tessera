/**
 * [INPUT]: clsx 接收的条件类名与 Tailwind 类名集合
 * [OUTPUT]: 去重并按 Tailwind 优先级合并后的 className 字符串
 * [POS]: shadcn/ui 组件共享的最小样式工具
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
