/**
 * [INPUT]: 当前 TipTap Editor 实例、光标前的斜杠查询与键盘事件
 * [OUTPUT]: 定位在光标附近的块级命令菜单
 * [POS]: 编辑器快捷输入的交互层，不参与 Markdown 持久化
 * [DOC]: docs/architecture/editor.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { Editor } from "@tiptap/core"
import { useEditorState } from "@tiptap/react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

interface SlashCommandMenuProps {
  editor: Editor
}

interface SlashRange {
  from: number
  to: number
}

interface SlashCommand {
  description: string
  id: string
  keywords: string
  label: string
  symbol: string
  run: (editor: Editor, range: SlashRange) => void
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "paragraph",
    label: "正文",
    description: "切换为普通文本段落",
    keywords: "paragraph text p 正文 段落",
    symbol: "T",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    id: "heading-1",
    label: "一级标题",
    description: "页面或章节的主标题",
    keywords: "heading h1 title 一级 标题",
    symbol: "H1",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run(),
  },
  {
    id: "heading-2",
    label: "二级标题",
    description: "章节中的主要层级",
    keywords: "heading h2 二级 标题",
    symbol: "H2",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
  },
  {
    id: "heading-3",
    label: "三级标题",
    description: "章节中的次要层级",
    keywords: "heading h3 三级 标题",
    symbol: "H3",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run(),
  },
  {
    id: "bullet-list",
    label: "无序列表",
    description: "创建项目符号列表",
    keywords: "bullet list ul 无序 列表",
    symbol: "•",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "ordered-list",
    label: "有序列表",
    description: "创建编号列表",
    keywords: "ordered list ol 有序 编号 列表",
    symbol: "1.",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "task-list",
    label: "任务列表",
    description: "创建可勾选的待办事项",
    keywords: "task todo checkbox 任务 待办 列表",
    symbol: "✓",
    run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "blockquote",
    label: "引用",
    description: "突出一段引用内容",
    keywords: "quote blockquote 引用",
    symbol: "“",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    id: "code-block",
    label: "代码块",
    description: "插入多行等宽代码",
    keywords: "code pre 代码 代码块",
    symbol: "</>",
    run: (editor, range) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    id: "table",
    label: "表格",
    description: "插入 3 × 3 数据表格",
    keywords: "table grid 表格",
    symbol: "▦",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
]

export function SlashCommandMenu({ editor }: SlashCommandMenuProps) {
  const context = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const { selection } = currentEditor.state
      if (!selection.empty) return null

      const { $from } = selection
      if ($from.parent.type.name !== "paragraph") return null

      const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc")
      const match = /^\/([^/\s]*)$/.exec(textBeforeCursor)
      if (!match) return null

      return {
        from: $from.start(),
        query: match[1] ?? "",
        to: selection.from,
      }
    },
  })
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const contextKey = context ? `${context.from}:${context.to}:${context.query}` : null
  const commands = useMemo(() => {
    const query = context?.query.toLocaleLowerCase() ?? ""
    if (!query) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter((command) =>
      `${command.label} ${command.keywords}`.toLocaleLowerCase().includes(query),
    )
  }, [context?.query])
  const visible = Boolean(context && contextKey !== dismissedKey && commands.length > 0)
  const selectedIndex = Math.max(
    0,
    commands.findIndex((command) => command.id === selectedCommandId),
  )

  useLayoutEffect(() => {
    if (!visible || !context || editor.isDestroyed) return
    const anchor = editor.view.coordsAtPos(context.to)
    setPosition({
      left: Math.max(12, Math.min(anchor.left, window.innerWidth - 276)),
      top: Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - 332)),
    })
  }, [context, editor, visible])

  const execute = useCallback(
    (command: SlashCommand) => {
      if (!context) return
      command.run(editor, { from: context.from, to: context.to })
    },
    [context, editor],
  )

  useEffect(() => {
    if (!visible) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedCommandId(commands[(selectedIndex + 1) % commands.length]?.id ?? null)
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedCommandId(commands[(selectedIndex - 1 + commands.length) % commands.length]?.id ?? null)
      } else if (event.key === "Enter") {
        event.preventDefault()
        const command = commands[selectedIndex]
        if (command) execute(command)
      } else if (event.key === "Escape") {
        event.preventDefault()
        setDismissedKey(contextKey)
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [commands, contextKey, execute, selectedIndex, visible])

  if (!visible) return null

  return createPortal(
    <section
      className="fixed z-50 w-64 overflow-hidden rounded-xl bg-popover p-1.5 text-popover-foreground shadow-[0_14px_42px_rgb(0_0_0/0.16),0_2px_7px_rgb(0_0_0/0.08)] ring-1 ring-foreground/10"
      style={position}
      aria-label="插入内容"
      aria-live="polite"
    >
      <div className="px-2 pt-1 pb-1.5 text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        插入内容
      </div>
      <div className="max-h-64 overflow-y-auto">
        {commands.map((command, index) => (
          <button
            key={command.id}
            type="button"
            data-selected={index === selectedIndex || undefined}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted data-[selected=true]:bg-muted"
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setSelectedCommandId(command.id)}
            onClick={() => execute(command)}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background font-mono text-[11px] font-medium text-foreground">
              {command.symbol}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">{command.label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{command.description}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-1 flex items-center gap-2 border-t border-border px-2 pt-1.5 pb-0.5 text-[10px] text-muted-foreground">
        <span>↑↓ 选择</span>
        <span>↵ 确认</span>
        <span>Esc 关闭</span>
      </div>
    </section>,
    document.body,
  )
}
