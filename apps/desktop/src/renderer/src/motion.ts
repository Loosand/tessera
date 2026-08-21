/**
 * [INPUT]: Motion 的 spring transition 契约
 * [OUTPUT]: 应用壳层、面板和微交互共享的动效语义
 * [POS]: 桌面渲染层的 Motion 参数事实源
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export const motionSprings = {
  gentle: { type: "spring", stiffness: 300, damping: 28 },
  layout: { type: "spring", stiffness: 380, damping: 32 },
  snappy: { type: "spring", stiffness: 500, damping: 34 },
} as const
