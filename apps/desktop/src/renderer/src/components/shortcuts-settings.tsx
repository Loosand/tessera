/**
 * [INPUT]: 用户输入的快捷键筛选词与当前应用命令清单
 * [OUTPUT]: 可搜索、按类别组织的中文快捷键设置界面
 * [POS]: 设置页的快捷键分区内容组件
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { Delete02Icon, Refresh01Icon, Search01Icon } from "@tessera/design-system/components/icons"
import { SettingRow } from "@tessera/design-system/components/setting-row"
import { SettingSection } from "@tessera/design-system/components/setting-section"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Input } from "@tessera/design-system/components/ui/input"
import { useDeferredValue, useState } from "react"

type ShortcutCategoryId = "workspace" | "navigation" | "editor" | "settings"

interface ShortcutDefinition {
  available: boolean
  binding: string | null
  category: ShortcutCategoryId
  description: string
  id: string
  label: string
}

const SHORTCUT_CATEGORIES: readonly { id: ShortcutCategoryId; label: string }[] = [
  { id: "workspace", label: "工作区" },
  { id: "navigation", label: "导航" },
  { id: "editor", label: "编辑器" },
  { id: "settings", label: "设置" },
]

const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: "open-workspace",
    category: "workspace",
    label: "打开工作区",
    description: "选择一个已有的本地 Markdown 文件夹。",
    binding: "Mod+O",
    available: false,
  },
  {
    id: "new-document",
    category: "workspace",
    label: "新建文档",
    description: "在当前工作区创建新的 Markdown 文档。",
    binding: "Mod+N",
    available: false,
  },
  {
    id: "refresh-workspace",
    category: "workspace",
    label: "刷新工作区",
    description: "重新扫描当前工作区的文档列表。",
    binding: "Mod+Shift+R",
    available: false,
  },
  {
    id: "go-back",
    category: "navigation",
    label: "后退",
    description: "返回当前文档历史中的上一项。",
    binding: "Mod+[",
    available: false,
  },
  {
    id: "go-forward",
    category: "navigation",
    label: "前进",
    description: "前往当前文档历史中的下一项。",
    binding: "Mod+]",
    available: false,
  },
  {
    id: "toggle-sidebar",
    category: "navigation",
    label: "显示或隐藏侧边栏",
    description: "切换工作区文件树和文档列表。",
    binding: "Mod+Shift+B",
    available: false,
  },
  {
    id: "save-document",
    category: "editor",
    label: "保存文档",
    description: "立即将当前 Markdown 草稿写入磁盘。",
    binding: "Mod+S",
    available: true,
  },
  {
    id: "toggle-editor-mode",
    category: "editor",
    label: "切换编辑模式",
    description: "在即时预览编辑与 Markdown 源码之间切换。",
    binding: "Mod+/",
    available: true,
  },
  {
    id: "undo",
    category: "editor",
    label: "撤销",
    description: "撤销编辑器中的上一步内容变更。",
    binding: "Mod+Z",
    available: true,
  },
  {
    id: "redo",
    category: "editor",
    label: "重做",
    description: "恢复刚刚撤销的内容变更。",
    binding: "Mod+Shift+Z",
    available: true,
  },
  {
    id: "bold",
    category: "editor",
    label: "加粗",
    description: "切换当前选区的粗体格式。",
    binding: "Mod+B",
    available: true,
  },
  {
    id: "italic",
    category: "editor",
    label: "斜体",
    description: "切换当前选区的斜体格式。",
    binding: "Mod+I",
    available: true,
  },
  {
    id: "open-settings",
    category: "settings",
    label: "打开设置",
    description: "从工作区进入应用设置。",
    binding: null,
    available: false,
  },
]

function formatShortcut(binding: string | null) {
  if (!binding) return "未设置"
  const isMac = navigator.platform.toLowerCase().includes("mac")
  if (!isMac) return binding.replace("Mod+", "Ctrl+")
  return binding.replaceAll("Mod+", "⌘").replaceAll("Shift+", "⇧")
}

function ShortcutControl({ shortcut }: { shortcut: ShortcutDefinition }) {
  return (
    <div className="flex items-center gap-2">
      <kbd className="flex h-8 min-w-32 items-center justify-center rounded-lg border border-input bg-background px-3 font-sans text-[13px] font-medium tabular-nums shadow-xs">
        {formatShortcut(shortcut.binding)}
      </kbd>
      <Button
        variant="outline"
        size="icon"
        disabled
        aria-label={`停用“${shortcut.label}”快捷键，即将支持`}
        title="快捷键自定义即将支持"
      >
        <Icon icon={Delete02Icon} size={15} />
      </Button>
      <Button
        variant="outline"
        size="icon"
        disabled
        aria-label={`重置“${shortcut.label}”快捷键，即将支持`}
        title="快捷键自定义即将支持"
      >
        <Icon icon={Refresh01Icon} size={15} />
      </Button>
    </div>
  )
}

export function ShortcutsSettings() {
  const [filter, setFilter] = useState("")
  const deferredFilter = useDeferredValue(filter.trim().toLocaleLowerCase("zh-CN"))
  const filteredShortcuts = SHORTCUTS.filter((shortcut) => {
    if (!deferredFilter) return true
    const category = SHORTCUT_CATEGORIES.find((item) => item.id === shortcut.category)?.label ?? ""
    return [shortcut.label, shortcut.description, category, formatShortcut(shortcut.binding)]
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(deferredFilter)
  })

  return (
    <div className="space-y-9">
      <div>
        <div className="relative">
          <Icon
            icon={Search01Icon}
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            className="h-10 pl-9"
            placeholder="搜索操作、分类或快捷键"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            aria-label="搜索快捷键"
          />
        </div>
        <p className="mt-2 px-1 text-xs leading-5 text-muted-foreground">
          当前展示默认绑定；停用、录制和冲突检测将在命令注册表接入后开放。
        </p>
      </div>

      {SHORTCUT_CATEGORIES.map((category) => {
        const categoryShortcuts = filteredShortcuts.filter((shortcut) => shortcut.category === category.id)
        if (categoryShortcuts.length === 0) return null
        return (
          <SettingSection key={category.id} title={category.label}>
            {categoryShortcuts.map((shortcut) => (
              <SettingRow
                key={shortcut.id}
                title={shortcut.label}
                description={shortcut.description}
                className="grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                control={<ShortcutControl shortcut={shortcut} />}
              >
                <p className="mt-2 text-xs text-muted-foreground">
                  {shortcut.available ? "当前版本可用" : "规划中，尚未接入命令"}
                </p>
              </SettingRow>
            ))}
          </SettingSection>
        )
      })}

      {filteredShortcuts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-[13px] font-medium">没有匹配的快捷键</p>
          <p className="mt-1 text-[13px] text-muted-foreground">可以尝试搜索“编辑器”“保存”或具体按键。</p>
        </div>
      ) : null}
    </div>
  )
}
