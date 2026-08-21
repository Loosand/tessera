/**
 * [INPUT]: 加载提示、像素动画变体、可选 Surfer 视频与标准 div 属性
 * [OUTPUT]: 带像素网格、低干扰状态文案和实时耗时的 LoadingState 复合组件
 * [POS]: 设计系统中供长耗时任务复用的状态反馈模式
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { cn } from "@tessera/design-system/lib/utils"
import { type ComponentProps, type CSSProperties, useEffect, useState, useSyncExternalStore } from "react"

const CELL_KEYS = [
  "top-start",
  "top",
  "top-end",
  "start",
  "center",
  "end",
  "bottom-start",
  "bottom",
  "bottom-end",
]

const chevronDelays = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3)
  const column = index % 3
  return (column + Math.abs(row - 1)) * 90
})

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const orbitDelays = Array.from({ length: 9 }, (_, index) => {
  const order = ORBIT_ORDER.indexOf(index)
  return order === -1 ? null : order * 110
})

interface LoaderPattern {
  delays: (number | null)[]
  duration: number
  round: boolean
}

const GRID_PATTERNS = {
  drive: { delays: chevronDelays, duration: 650, round: false },
  dots: { delays: chevronDelays, duration: 650, round: true },
  orbit: { delays: orbitDelays, duration: 950, round: false },
} satisfies Record<Exclude<LoadingStateVariant, "surfer">, LoaderPattern>

export type LoadingStateVariant = "drive" | "dots" | "orbit" | "surfer"

export interface LoadingStateProps extends Omit<ComponentProps<"div">, "children"> {
  label?: string
  variant?: LoadingStateVariant
  videoSrc?: string
}

function LoaderGrid({ delays, duration, round }: LoaderPattern) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]"
      data-slot="loading-state-grid"
    >
      {delays.map((delay, index) => (
        <span
          key={CELL_KEYS[index]}
          className={cn(
            "tessera-loading-pixel size-1 bg-foreground",
            round ? "rounded-full" : "rounded-[1px]",
          )}
          data-inactive={delay === null ? "" : undefined}
          style={
            {
              "--loading-delay": `${delay ?? 0}ms`,
              "--loading-duration": `${duration}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}

function formatElapsed(elapsedMilliseconds: number) {
  const totalSeconds = elapsedMilliseconds / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  return `${Math.floor(totalSeconds / 60)}m ${(totalSeconds % 60).toFixed(1)}s`
}

function useElapsed() {
  const [elapsedMilliseconds, setElapsedMilliseconds] = useState(0)

  useEffect(() => {
    const startedAt = performance.now()
    const timer = window.setInterval(() => {
      setElapsedMilliseconds(performance.now() - startedAt)
    }, 100)

    return () => window.clearInterval(timer)
  }, [])

  return formatElapsed(elapsedMilliseconds)
}

function ElapsedTime() {
  const elapsed = useElapsed()
  return <span className="font-mono text-xs text-muted-foreground tabular-nums">{elapsed}</span>
}

function subscribeToReducedMotion(onChange: () => void) {
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
  mediaQuery.addEventListener("change", onChange)
  return () => mediaQuery.removeEventListener("change", onChange)
}

function getReducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function getServerReducedMotionSnapshot() {
  return false
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getServerReducedMotionSnapshot,
  )
}

export function LoadingState({
  "aria-label": ariaLabel,
  className,
  label,
  variant = "drive",
  videoSrc = "/subway-surfers.mp4",
  ...props
}: LoadingStateProps) {
  const surfer = variant === "surfer"
  const resolvedLabel = label ?? (surfer ? "Subway surfing" : "正在处理")
  const pattern = GRID_PATTERNS[surfer ? "drive" : variant]
  const [failedVideoSrc, setFailedVideoSrc] = useState<string>()
  const reducedMotion = usePrefersReducedMotion()
  const videoAvailable = failedVideoSrc !== videoSrc

  const status = (
    <div aria-hidden="true" className="flex items-center gap-2.5">
      <LoaderGrid {...pattern} />
      <span className="tessera-loading-label bg-clip-text text-[13px] font-medium text-transparent">
        {resolvedLabel}
      </span>
      <ElapsedTime />
    </div>
  )

  if (surfer) {
    return (
      <div
        className={cn("flex w-fit flex-col items-start", className)}
        data-slot="loading-state"
        role="status"
        {...props}
      >
        <span className="sr-only">{ariaLabel ?? resolvedLabel}</span>
        {status}
        <div className="tessera-loading-surface mt-2 w-56 overflow-hidden rounded-lg bg-popover shadow-lg ring-1 ring-foreground/10">
          <div className="relative aspect-video w-full bg-muted">
            {videoAvailable && !reducedMotion ? (
              <video
                aria-hidden="true"
                autoPlay
                className="size-full object-cover"
                key={videoSrc}
                loop
                muted
                onError={() => setFailedVideoSrc(videoSrc)}
                playsInline
                src={videoSrc}
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
                <LoaderGrid {...GRID_PATTERNS.drive} />
                <span className="px-3 text-center font-mono text-[10px]">
                  {reducedMotion ? "已减少动态效果" : "视频不可用"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn("flex w-fit items-center", className)}
      data-slot="loading-state"
      role="status"
      {...props}
    >
      <span className="sr-only">{ariaLabel ?? resolvedLabel}</span>
      {status}
    </div>
  )
}
