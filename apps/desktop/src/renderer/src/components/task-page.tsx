/**
 * [INPUT]: 侧栏状态、设置入口与本地输入草稿
 * [OUTPUT]: 新任务页、居中任务输入框和未接运行时的交互反馈
 * [POS]: Tessera 主导航中的任务创建表面
 * [DOC]: design.md、docs/architecture.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  AiBrain01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Attachment01Icon,
  Mic01Icon,
  PanelLeftOpenIcon,
  Settings01Icon,
  Shield01Icon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Textarea } from "@tessera/design-system/components/ui/textarea"
import { type FormEvent, type KeyboardEvent, useState } from "react"

interface TaskPageProps {
  hasWorkspace: boolean
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

export function TaskPage({ hasWorkspace, sidebarOpen, onToggleSidebar, onOpenSettings }: TaskPageProps) {
  const [prompt, setPrompt] = useState("")
  const [notice, setNotice] = useState("")
  const canSubmit = prompt.trim().length > 0

  const submitPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    setNotice("任务输入界面已就绪，执行能力接入后会从这里开始处理。")
  }

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <header
        className="app-drag-region window-titlebar-leading relative flex h-12 shrink-0 items-center pr-3"
        data-sidebar-open={sidebarOpen}
      >
        <div className="app-no-drag flex min-w-8 items-center">
          {!sidebarOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="展开侧边栏"
              title="展开侧边栏"
              onClick={onToggleSidebar}
            >
              <Icon icon={PanelLeftOpenIcon} size={15} />
            </Button>
          ) : null}
        </div>
        <span className="pointer-events-none absolute inset-x-0 text-center text-[13px] font-medium">
          新任务
        </span>
        <div className="app-no-drag ml-auto">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="打开设置"
            title="设置"
            onClick={onOpenSettings}
          >
            <Icon icon={Settings01Icon} size={15} />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-6 py-16 pb-24">
          <div className="mb-7 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-muted text-foreground">
              <Icon icon={AiBrain01Icon} size={19} />
            </div>
            <h1 className="mt-4 text-xl font-semibold tracking-tight">开始一个新任务</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">从研究问题、材料整理或一段想法开始。</p>
          </div>

          <form className="w-full" onSubmit={submitPreview}>
            <div className="rounded-2xl border border-input bg-background shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-md">
              <Textarea
                value={prompt}
                autoFocus
                className="min-h-32 resize-none border-0 bg-transparent px-5 py-4 text-[15px] leading-7 shadow-none focus-visible:ring-0 dark:bg-transparent"
                placeholder="描述你想研究、阅读或写作的内容…"
                aria-label="新任务内容"
                aria-describedby="task-composer-notice"
                onChange={(event) => {
                  setPrompt(event.target.value)
                  if (notice) setNotice("")
                }}
                onKeyDown={handlePromptKeyDown}
              />

              <div className="flex min-h-12 items-center gap-2 px-3 pb-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="添加材料，即将支持"
                  title="添加材料（即将支持）"
                  disabled
                >
                  <Icon icon={Attachment01Icon} size={16} />
                </Button>

                <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground max-[520px]:hidden">
                  <Icon icon={Shield01Icon} size={14} className="shrink-0" />
                  <span className="truncate">{hasWorkspace ? "仅当前工作区" : "未选择工作区"}</span>
                </div>

                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs font-normal max-[600px]:hidden"
                    aria-label="模型：自动选择，即将支持切换"
                    title="模型选择（即将支持）"
                    disabled
                  >
                    <span>自动选择</span>
                    <Icon icon={ArrowDown01Icon} size={12} className="text-muted-foreground" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="语音输入，即将支持"
                    title="语音输入（即将支持）"
                    disabled
                  >
                    <Icon icon={Mic01Icon} size={16} />
                  </Button>
                  <Button
                    type="submit"
                    size="icon-lg"
                    className="rounded-full"
                    aria-label="创建任务"
                    title="创建任务"
                    disabled={!canSubmit}
                  >
                    <Icon icon={ArrowUp01Icon} size={17} />
                  </Button>
                </div>
              </div>
            </div>
            <p
              id="task-composer-notice"
              className="mt-3 min-h-5 text-center text-xs text-muted-foreground"
              aria-live="polite"
            >
              {notice || "Enter 创建任务，Shift + Enter 换行"}
            </p>
          </form>
        </div>
      </div>
    </section>
  )
}
