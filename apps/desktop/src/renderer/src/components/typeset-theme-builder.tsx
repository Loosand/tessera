/**
 * [INPUT]: 已校验的 Typeset 偏好与单字段实时更新操作
 * [OUTPUT]: 字体、阅读节奏、行宽控件和真实 Typeset Markdown 即时预览
 * [POS]: 编辑器设置页中的 Markdown 主题构建器
 * [DOC]: design.md、docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { NativeSelect } from "@tessera/design-system/components/ui/native-select"
import { Slider } from "@tessera/design-system/components/ui/slider"
import type { CSSProperties } from "react"
import {
  TYPESET_LIMITS,
  TYPESET_MONO_FONT_OPTIONS,
  TYPESET_PROPORTIONAL_FONT_OPTIONS,
  type TypesetMonoFontPreference,
  type TypesetProportionalFontPreference,
  createTypesetCssVariables,
  isTypesetMonoFontPreference,
  isTypesetProportionalFontPreference,
} from "../hooks/typeset-preferences"
import type { AppPreferences, UpdateAppPreference } from "../hooks/use-app-preferences"

type TypesetThemeBuilderProps = {
  readonly onUpdatePreference: UpdateAppPreference
  readonly preferences: AppPreferences
}

type TypesetRangeControlProps = {
  readonly label: string
  readonly limits: { readonly max: number; readonly min: number; readonly step: number }
  readonly onChange: (value: number) => void
  readonly unit: string
  readonly value: number
}

type TypesetFontControlProps =
  | {
      readonly id: string
      readonly kind: "proportional"
      readonly label: string
      readonly onChange: (value: TypesetProportionalFontPreference) => void
      readonly value: TypesetProportionalFontPreference
    }
  | {
      readonly id: string
      readonly kind: "mono"
      readonly label: string
      readonly onChange: (value: TypesetMonoFontPreference) => void
      readonly value: TypesetMonoFontPreference
    }

type TypesetPreviewStyle = CSSProperties & Partial<Record<`--${string}`, string | number>>

function formatValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
}

function TypesetRangeControl({ label, limits, onChange, unit, value }: TypesetRangeControlProps) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <output className="text-[11px] tabular-nums text-muted-foreground">
          {formatValue(value)}
          {unit}
        </output>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={limits.min}
        max={limits.max}
        step={limits.step}
        onValueChange={(values) => {
          const nextValue = Array.isArray(values) ? values[0] : values
          if (typeof nextValue === "number") onChange(nextValue)
        }}
      />
      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground/80">
        <span>
          {limits.min}
          {unit}
        </span>
        <span>
          {limits.max}
          {unit}
        </span>
      </div>
    </div>
  )
}

function TypesetFontControl(props: TypesetFontControlProps) {
  const options = props.kind === "mono" ? TYPESET_MONO_FONT_OPTIONS : TYPESET_PROPORTIONAL_FONT_OPTIONS
  return (
    <label className="grid gap-1.5" htmlFor={props.id}>
      <span className="text-xs font-medium text-foreground">{props.label}</span>
      <NativeSelect
        id={props.id}
        className="w-full"
        containerClassName="w-full"
        value={props.value}
        onChange={(event) => {
          const nextValue = event.currentTarget.value
          if (props.kind === "mono") {
            if (isTypesetMonoFontPreference(nextValue)) props.onChange(nextValue)
            return
          }
          if (isTypesetProportionalFontPreference(nextValue)) props.onChange(nextValue)
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
}

export function TypesetThemeBuilder({ preferences, onUpdatePreference }: TypesetThemeBuilderProps) {
  const previewStyle: TypesetPreviewStyle = {
    ...createTypesetCssVariables(preferences),
    maxWidth: `${preferences.typesetMeasure}ch`,
  }

  return (
    <div className="grid min-h-150 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="border-b border-border bg-muted/20 lg:border-r lg:border-b-0">
        <div className="space-y-4 border-b border-border p-4">
          <div>
            <p className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">字体</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">字体文件随应用提供，不会联网加载。</p>
          </div>
          <TypesetFontControl
            id="typeset-heading-font"
            kind="proportional"
            label="标题字体"
            value={preferences.typesetHeadingFont}
            onChange={(value) => onUpdatePreference("typesetHeadingFont", value)}
          />
          <TypesetFontControl
            id="typeset-body-font"
            kind="proportional"
            label="正文字体"
            value={preferences.typesetBodyFont}
            onChange={(value) => onUpdatePreference("typesetBodyFont", value)}
          />
          <TypesetFontControl
            id="typeset-mono-font"
            kind="mono"
            label="等宽字体"
            value={preferences.typesetMonoFont}
            onChange={(value) => onUpdatePreference("typesetMonoFont", value)}
          />
        </div>

        <div className="space-y-5 border-b border-border p-4">
          <div>
            <p className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
              阅读节奏
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">三项参数会共同派生全文层级与留白。</p>
          </div>
          <TypesetRangeControl
            label="基础字号"
            unit="px"
            value={preferences.typesetSize}
            limits={TYPESET_LIMITS.size}
            onChange={(value) => onUpdatePreference("typesetSize", value)}
          />
          <TypesetRangeControl
            label="行高"
            unit=""
            value={preferences.typesetLeading}
            limits={TYPESET_LIMITS.leading}
            onChange={(value) => onUpdatePreference("typesetLeading", value)}
          />
          <TypesetRangeControl
            label="区块间距"
            unit="em"
            value={preferences.typesetFlow}
            limits={TYPESET_LIMITS.flow}
            onChange={(value) => onUpdatePreference("typesetFlow", value)}
          />
        </div>

        <div className="space-y-4 p-4">
          <div>
            <p className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">版心</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              行宽属于编辑器布局，不写入 Markdown。
            </p>
          </div>
          <TypesetRangeControl
            label="正文行宽"
            unit="ch"
            value={preferences.typesetMeasure}
            limits={TYPESET_LIMITS.measure}
            onChange={(value) => onUpdatePreference("typesetMeasure", value)}
          />
        </div>
      </div>

      <section className="min-w-0 bg-background p-[clamp(24px,5vw,52px)]" aria-label="Markdown 主题实时预览">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="font-medium tracking-[0.06em] uppercase">实时预览</span>
          <span className="tabular-nums">
            {preferences.typesetSize}px · {formatValue(preferences.typesetLeading)} ·{" "}
            {formatValue(preferences.typesetFlow)}em · {preferences.typesetMeasure}ch
          </span>
        </div>

        <article className="typeset typeset-editor mx-auto w-full" style={previewStyle}>
          <h1>让 Markdown 保持清晰</h1>
          <p>
            一套好的主题应该让内容自然成为主角。Tessera 使用 <code>Typeset</code>{" "}
            统一标题、正文与代码的阅读节奏。
          </p>
          <h2>真实内容，实时调整</h2>
          <p>拖动左侧参数时，这段预览和已经打开的文档会同步更新，不会改写 Markdown 文件。</p>
          <ul>
            <li>
              <strong>Heading</strong> 建立清楚而克制的层级。
            </li>
            <li>
              <strong>Body</strong> 同时照顾中文和 Latin 字形。
            </li>
            <li>
              <strong>Mono</strong> 用于 <code>inline code</code> 与代码块。
            </li>
          </ul>
          <blockquote>
            <p>排版不是装饰，而是帮助读者理解结构。</p>
          </blockquote>
          <pre>
            <code>{`const theme = {\n  size: ${preferences.typesetSize},\n  leading: ${formatValue(preferences.typesetLeading)},\n  flow: "${formatValue(preferences.typesetFlow)}em"\n}`}</code>
          </pre>
        </article>
      </section>
    </div>
  )
}
