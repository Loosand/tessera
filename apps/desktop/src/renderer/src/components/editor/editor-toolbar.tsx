/**
 * [INPUT]: 当前 TipTap Editor 实例和设计系统交互原语
 * [OUTPUT]: 选择态可感知的格式工具栏与链接编辑浮层
 * [POS]: 富文本编辑器的命令呈现层
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import {
  Heading01Icon,
  Heading02Icon,
  Heading03Icon,
  Link01Icon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  SourceCodeIcon,
  Table01Icon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
} from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@tessera/design-system/components/ui/popover"
import type { Editor } from "@tiptap/core"
import { useEditorState } from "@tiptap/react"
import { type FormEvent, useState } from "react"

interface EditorToolbarProps {
  editor: Editor
}

interface ToolbarButtonProps {
  active?: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}

function ToolbarButton({ active, label, onClick, children }: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      title={label}
      data-active={active || undefined}
      className="size-8 rounded-md text-muted-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function ToolbarDivider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />
}

function LinkControl({ editor, active }: EditorToolbarProps & { active: boolean }) {
  const [open, setOpen] = useState(false)
  const [href, setHref] = useState("")

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) setHref((editor.getAttributes("link").href as string | undefined) ?? "")
  }

  const applyLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextHref = href.trim()
    const chain = editor.chain().focus(undefined, { scrollIntoView: false }).extendMarkRange("link")
    if (nextHref) chain.setLink({ href: nextHref }).run()
    else chain.unsetLink().run()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="链接"
            aria-pressed={active}
            title="链接"
            data-active={active || undefined}
            className="size-8 rounded-md text-muted-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
            onMouseDown={(event) => event.preventDefault()}
          />
        }
      >
        <Icon icon={Link01Icon} size={15} />
      </PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-80 p-2.5">
        <form className="flex items-center gap-2" onSubmit={applyLink}>
          <Input
            value={href}
            onChange={(event) => setHref(event.currentTarget.value)}
            placeholder="https:// 或相对路径"
            aria-label="链接地址"
            autoFocus
          />
          <Button type="submit" size="sm">
            应用
          </Button>
        </form>
        <p className="mt-1.5 px-0.5 text-[11px] text-muted-foreground">留空并应用可移除当前链接。</p>
      </PopoverContent>
    </Popover>
  )
}

function TableControl({ editor, active }: EditorToolbarProps & { active: boolean }) {
  const [open, setOpen] = useState(false)
  const run = (command: () => boolean) => {
    command()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={active ? "编辑表格" : "插入表格"}
            aria-pressed={active}
            title={active ? "编辑表格" : "插入表格"}
            data-active={active || undefined}
            className="size-8 rounded-md text-muted-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
            onMouseDown={(event) => event.preventDefault()}
          />
        }
      >
        <Icon icon={Table01Icon} size={15} />
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-52 p-1.5">
        {active ? (
          <div className="grid gap-0.5" aria-label="表格操作">
            <Button
              type="button"
              variant="ghost"
              className="h-8 justify-start px-2 text-xs"
              onClick={() => run(() => editor.chain().focus().addRowAfter().run())}
            >
              在下方添加行
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 justify-start px-2 text-xs"
              onClick={() => run(() => editor.chain().focus().addColumnAfter().run())}
            >
              在右侧添加列
            </Button>
            <div className="my-1 h-px bg-border" />
            <Button
              type="button"
              variant="ghost"
              className="h-8 justify-start px-2 text-xs"
              onClick={() => run(() => editor.chain().focus().deleteRow().run())}
            >
              删除当前行
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 justify-start px-2 text-xs"
              onClick={() => run(() => editor.chain().focus().deleteColumn().run())}
            >
              删除当前列
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 justify-start px-2 text-xs text-destructive hover:text-destructive"
              onClick={() => run(() => editor.chain().focus().deleteTable().run())}
            >
              删除表格
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full justify-start px-2 text-xs"
            onClick={() =>
              run(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())
            }
          >
            插入 3 × 3 表格
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const active = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      blockquote: currentEditor.isActive("blockquote"),
      bold: currentEditor.isActive("bold"),
      bulletList: currentEditor.isActive("bulletList"),
      codeBlock: currentEditor.isActive("codeBlock"),
      heading1: currentEditor.isActive("heading", { level: 1 }),
      heading2: currentEditor.isActive("heading", { level: 2 }),
      heading3: currentEditor.isActive("heading", { level: 3 }),
      italic: currentEditor.isActive("italic"),
      link: currentEditor.isActive("link"),
      orderedList: currentEditor.isActive("orderedList"),
      strike: currentEditor.isActive("strike"),
      taskList: currentEditor.isActive("taskList"),
      table: currentEditor.isActive("table"),
      underline: currentEditor.isActive("underline"),
    }),
  })
  const focus = () => editor.chain().focus(undefined, { scrollIntoView: false })

  return (
    <div className="pointer-events-none sticky bottom-5 z-20 mt-auto flex justify-center px-4 pt-8">
      <div
        className="pointer-events-auto flex max-w-full items-center overflow-x-auto rounded-[11px] bg-background/96 p-1 shadow-[0_10px_35px_rgb(0_0_0/0.12),0_1px_4px_rgb(0_0_0/0.08)] ring-1 ring-foreground/10 backdrop-blur-xl"
        role="toolbar"
        aria-label="文本格式"
      >
        <ToolbarButton active={active.bold} label="粗体" onClick={() => focus().toggleBold().run()}>
          <Icon icon={TextBoldIcon} size={15} />
        </ToolbarButton>
        <ToolbarButton active={active.italic} label="斜体" onClick={() => focus().toggleItalic().run()}>
          <Icon icon={TextItalicIcon} size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={active.underline}
          label="下划线"
          onClick={() => focus().toggleUnderline().run()}
        >
          <Icon icon={TextUnderlineIcon} size={15} />
        </ToolbarButton>
        <ToolbarButton active={active.strike} label="删除线" onClick={() => focus().toggleStrike().run()}>
          <Icon icon={TextStrikethroughIcon} size={15} />
        </ToolbarButton>
        <ToolbarDivider />
        <LinkControl editor={editor} active={active.link} />
        <ToolbarDivider />
        <ToolbarButton
          active={active.heading1}
          label="一级标题"
          onClick={() => focus().toggleHeading({ level: 1 }).run()}
        >
          <Icon icon={Heading01Icon} size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={active.heading2}
          label="二级标题"
          onClick={() => focus().toggleHeading({ level: 2 }).run()}
        >
          <Icon icon={Heading02Icon} size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={active.heading3}
          label="三级标题"
          onClick={() => focus().toggleHeading({ level: 3 }).run()}
        >
          <Icon icon={Heading03Icon} size={15} />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          active={active.bulletList}
          label="无序列表"
          onClick={() => focus().toggleBulletList().run()}
        >
          <Icon icon={ListIcon} size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={active.orderedList}
          label="有序列表"
          onClick={() => focus().toggleOrderedList().run()}
        >
          <Icon icon={ListOrderedIcon} size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={active.taskList}
          label="任务列表"
          onClick={() => focus().toggleTaskList().run()}
        >
          <Icon icon={ListChecksIcon} size={15} />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          active={active.blockquote}
          label="引用"
          onClick={() => focus().toggleBlockquote().run()}
        >
          <Icon icon={QuoteIcon} size={15} />
        </ToolbarButton>
        <ToolbarButton
          active={active.codeBlock}
          label="代码块"
          onClick={() => focus().toggleCodeBlock().run()}
        >
          <Icon icon={SourceCodeIcon} size={15} />
        </ToolbarButton>
        <ToolbarDivider />
        <TableControl editor={editor} active={active.table} />
      </div>
    </div>
  )
}
