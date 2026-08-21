/**
 * [INPUT]: 设计系统公开状态、复合组件 Props 与原生控件 Props
 * [OUTPUT]: 状态字面量、必填语义字段与控件尺寸不会被宽化的编译期契约
 * [POS]: design-system 公共类型退化的静态回归测试
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type {
  ActivityTraceProps,
  ActivityTraceStatus,
  LoadingStateProps,
  LoadingStateVariant,
  NativeSelectProps,
  SettingRowProps,
  SettingSectionProps,
  ToolChipStatus,
  ToolChipsProps,
} from "./index"

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right
  ? 1
  : 2
  ? true
  : false
type Expect<Value extends true> = Value

export type DesignSystemTypeContract = [
  Expect<Equal<ActivityTraceStatus, "active" | "complete" | "error">>,
  Expect<Equal<LoadingStateVariant, "drive" | "dots" | "orbit" | "surfer">>,
  Expect<Equal<NonNullable<LoadingStateProps["variant"]>, LoadingStateVariant>>,
  Expect<Equal<NonNullable<NativeSelectProps["size"]>, "default" | "sm">>,
  Expect<Equal<SettingRowProps["title"], string>>,
  Expect<Equal<SettingSectionProps["title"], string>>,
  Expect<Equal<ActivityTraceProps["status"], ActivityTraceStatus>>,
  Expect<
    Equal<
      ToolChipStatus,
      | "input-streaming"
      | "input-available"
      | "approval-requested"
      | "approval-responded"
      | "output-available"
      | "output-error"
      | "output-denied"
    >
  >,
  Expect<Equal<ToolChipsProps["items"][number]["status"], ToolChipStatus>>,
]
