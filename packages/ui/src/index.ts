/**
 * [INPUT]: UI 包内经过评审的公共组件
 * [OUTPUT]: @tessera/ui 的稳定公开 API
 * [POS]: 共享 UI 包的唯一公共导出入口
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export { CapabilityCard } from "./capability-card"
