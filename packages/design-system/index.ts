/**
 * [INPUT]: UI 包内经过评审的公共组件
 * [OUTPUT]: @tessera/design-system 的稳定根级公开 API
 * [POS]: 设计系统包的便捷导出入口；应用也可使用明确的组件子路径
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export * from "./components/icons"
export { SettingRow, type SettingRowProps } from "./components/setting-row"
export { SettingSection, type SettingSectionProps } from "./components/setting-section"
export { Button, buttonVariants } from "./components/ui/button"
export { Icon, type IconProps } from "./components/ui/icon"
export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "./components/ui/message-scroller"
export { NativeSelect, type NativeSelectProps } from "./components/ui/native-select"
export { Separator } from "./components/ui/separator"
export { Switch } from "./components/ui/switch"
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip"
