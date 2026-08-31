/**
 * [INPUT]: renderer 已收到的完整增量文本、流式状态与系统 reduced-motion 偏好
 * [OUTPUT]: 只沿文本尾部单调增长、按屏幕帧平滑追赶源文本的可见字符串
 * [POS]: ChatMarkdown 外层的显示节奏控制器；不参与 Markdown 解析或 Transport 合并
 * [DOC]: design.md、docs/architecture/ai-chat-agent-todo.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import React from "react"

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"
const graphemeSegmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" })

function pendingStepCount(current: string, target: string) {
  const pendingCodeUnits = Math.max(0, target.length - current.length)
  if (pendingCodeUnits > 96) return 4
  if (pendingCodeUnits > 32) return 2
  return 1
}

export function advanceTailStreamText(current: string, target: string, steps = 1) {
  if (current === target) return current
  if (!target.startsWith(current)) return target

  const suffix = target.slice(current.length)
  let revealed = ""
  let count = 0
  for (const segment of graphemeSegmenter.segment(suffix)) {
    revealed += segment.segment
    count += 1
    if (count >= steps) break
  }
  return current + revealed
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches,
  )

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)
    const update = () => setReducedMotion(mediaQuery.matches)
    update()
    mediaQuery.addEventListener("change", update)
    return () => mediaQuery.removeEventListener("change", update)
  }, [])

  return reducedMotion
}

export function useTailStreamText(source: string, streaming: boolean) {
  const [visibleText, setVisibleText] = React.useState(source)
  const visibleTextRef = React.useRef(source)
  const sourceRef = React.useRef(source)
  const reducedMotion = usePrefersReducedMotion()

  const commitVisibleText = React.useCallback((next: string) => {
    visibleTextRef.current = next
    setVisibleText((current) => (current === next ? current : next))
  }, [])

  React.useEffect(() => {
    sourceRef.current = source
    if (!streaming || reducedMotion || !source.startsWith(visibleTextRef.current)) {
      commitVisibleText(source)
    }
  }, [commitVisibleText, reducedMotion, source, streaming])

  React.useEffect(() => {
    if (!streaming || reducedMotion) return

    let frame = 0
    const revealTail = () => {
      const current = visibleTextRef.current
      const target = sourceRef.current
      const next = advanceTailStreamText(current, target, pendingStepCount(current, target))
      if (next !== current) commitVisibleText(next)
      frame = window.requestAnimationFrame(revealTail)
    }
    frame = window.requestAnimationFrame(revealTail)
    return () => window.cancelAnimationFrame(frame)
  }, [commitVisibleText, reducedMotion, streaming])

  if (!streaming || reducedMotion || !source.startsWith(visibleText)) return source
  return visibleText
}
