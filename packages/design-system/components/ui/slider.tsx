/**
 * [INPUT]: Base UI Slider 属性、受控或非受控数值与设计系统样式工具
 * [OUTPUT]: 支持键盘、指针和触控的单值或范围滑块
 * [POS]: 设计系统的连续数值输入原语
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "@tessera/design-system/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props) {
  const values = Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]
  const thumbKeys = Array.from({ length: values.length }, (_, index) => `slider-thumb-${index}`)

  return (
    <SliderPrimitive.Root
      className={cn(
        "relative w-full data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-auto",
        className,
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center py-2 select-none data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col data-[orientation=vertical]:px-2 data-[orientation=vertical]:py-0">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow rounded-full bg-muted select-none data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="rounded-full bg-primary select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          />
          {thumbKeys.map((thumbKey) => (
            <SliderPrimitive.Thumb
              data-slot="slider-thumb"
              key={thumbKey}
              className="block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm ring-ring/40 transition-[color,box-shadow] select-none after:absolute after:-inset-2.5 hover:ring-4 has-[:focus-visible]:ring-4 has-[:focus-visible]:outline-hidden active:ring-4 disabled:pointer-events-none disabled:opacity-50"
            />
          ))}
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
