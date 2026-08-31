/**
 * [INPUT]: 当前页、总页数、任务总数与翻页回调
 * [OUTPUT]: 全部任务页固定底栏中的可访问上一页/下一页导航
 * [POS]: 全部任务列表分页的无状态产品模式组件
 * [DOC]: design.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { ArrowLeft01Icon, ArrowRight01Icon } from "@tessera/design-system/components/icons"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React from "react"

export function TaskPaginationControls({
  page,
  total,
  totalPages,
  onPageChange,
}: Readonly<{
  page: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
}>) {
  return (
    <nav className="flex h-8 items-center justify-between gap-2" aria-label="任务分页">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={page <= 1}
        aria-label="上一页任务"
        onClick={() => onPageChange(page - 1)}
      >
        <Icon icon={ArrowLeft01Icon} size={14} />
        上一页
      </Button>
      <span className="text-[10px] text-muted-foreground tabular-nums">
        第 {page} / {totalPages} 页 · 共 {total} 个任务
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={page >= totalPages}
        aria-label="下一页任务"
        onClick={() => onPageChange(page + 1)}
      >
        下一页
        <Icon icon={ArrowRight01Icon} size={14} />
      </Button>
    </nav>
  )
}
