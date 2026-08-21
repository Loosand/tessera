/**
 * [INPUT]: 当前文档与关闭操作
 * [OUTPUT]: 带可访问进退场的文档详情页右侧 AI 协作面板骨架
 * [POS]: 后续会话、工具调用和上下文管理的动态界面边界
 * [DOC]: design.md、docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { DocumentSnapshot } from "@tessera/contracts"
import { AiBrain01Icon, ArrowRight01Icon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { m, useReducedMotion } from "motion/react"
import { motionSprings } from "../motion"

type AgentSidebarProps = Readonly<{
  document: DocumentSnapshot | null
  onClose: () => void
}>

export function AgentSidebar({ document, onClose }: AgentSidebarProps) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <m.aside
      className="flex h-full min-h-0 w-[320px] shrink-0 flex-col border-l border-border/65 bg-sidebar/70 max-[900px]:absolute max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-10 max-[900px]:shadow-xl max-[600px]:w-[min(320px,calc(100vw-40px))]"
      initial={shouldReduceMotion ? false : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
      transition={shouldReduceMotion ? { duration: 0 } : motionSprings.gentle}
    >
      <header className="flex h-11 shrink-0 items-center border-b border-border/55 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-medium">
          <Icon icon={AiBrain01Icon} size={15} />
          <span>AI 助手</span>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭 AI 助手" onClick={onClose}>
          <Icon icon={ArrowRight01Icon} size={15} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-center">
        <div>
          <div className="mx-auto flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon icon={AiBrain01Icon} size={17} />
          </div>
          <p className="mt-3 text-sm font-medium">针对当前文档协作</p>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            {document ? `当前上下文：${document.name}` : "选择文档后即可建立上下文。"}
          </p>
        </div>
      </div>

      <div className="shrink-0 p-3">
        <div className="rounded-xl border border-border bg-background p-2.5 shadow-xs">
          <textarea
            className="min-h-16 w-full resize-none bg-transparent text-xs leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            placeholder="Agent 会话能力将在下一阶段接入"
            aria-label="AI 助手输入"
            disabled
          />
          <div className="mt-1 flex justify-end">
            <Button type="button" size="icon-sm" disabled aria-label="发送">
              <Icon icon={ArrowRight01Icon} size={14} />
            </Button>
          </div>
        </div>
      </div>
    </m.aside>
  )
}
