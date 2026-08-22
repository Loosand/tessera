/**
 * [INPUT]: 当前文档、共享任务会话子树与关闭操作
 * [OUTPUT]: 承载正常任务对话实现的可访问文档右侧 AI 协作面板
 * [POS]: TaskPage 在文档工作表面中的窄布局容器
 * [DOC]: design.md、docs/architecture.md、docs/architecture/task-navigation.md
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
import type { ReactNode } from "react"
import { motionSprings } from "../motion"

type AgentSidebarProps = Readonly<{
  children: ReactNode
  document: DocumentSnapshot | null
  onClose: () => void
}>

export function AgentSidebar({ children, document, onClose }: AgentSidebarProps) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <m.aside
      className="flex h-full min-h-0 w-[380px] shrink-0 flex-col border-l border-border/65 bg-sidebar/70 max-[900px]:absolute max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-10 max-[900px]:shadow-xl max-[600px]:w-[min(380px,calc(100vw-32px))]"
      initial={shouldReduceMotion ? false : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
      transition={shouldReduceMotion ? { duration: 0 } : motionSprings.gentle}
    >
      <header className="flex h-11 shrink-0 items-center border-b border-border/55 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-medium">
          <Icon icon={AiBrain01Icon} size={15} />
          <span className="shrink-0">AI 助手</span>
          {document ? (
            <span className="truncate text-[10px] font-normal text-muted-foreground">{document.name}</span>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭 AI 助手" onClick={onClose}>
          <Icon icon={ArrowRight01Icon} size={15} />
        </Button>
      </header>

      <div className="min-h-0 flex-1">{children}</div>
    </m.aside>
  )
}
