/**
 * [INPUT]: 从稳定文件成功关系恢复的当前任务 Artifact 摘要、紧凑布局与打开项目文档回调
 * [OUTPUT]: 区分新建/更新/导入并可从对话进入文档预览加同一会话协作视图的轻量产物卡片
 * [POS]: TaskPage 消息区与输入框之间的 Eigent 式产物导航层
 * [DOC]: design.md、docs/architecture/agent-product-feedback-layer.md、docs/architecture/agent-simplification-roadmap.md、docs/architecture/unified-creation-agent.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskArtifact } from "@tessera/contracts"
import { File02Icon, FolderOpenIcon } from "@tessera/design-system/components/icons"
import { Icon } from "@tessera/design-system/components/ui/icon"
import React from "react"

type TaskArtifactTrayProps = Readonly<{
  artifacts: readonly TaskArtifact[]
  compact?: boolean
  onOpen: (artifact: TaskArtifact) => void
}>

export function taskArtifactRelationLabel(relation: TaskArtifact["relation"]) {
  if (relation === "created") return "新建"
  if (relation === "updated") return "更新"
  return "导入"
}

export function TaskArtifactTray({ artifacts, compact = false, onOpen }: TaskArtifactTrayProps) {
  if (artifacts.length === 0) return null
  return (
    <div className="overflow-x-auto py-1" aria-label="当前任务产物">
      <div className="flex min-w-max gap-2">
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            type="button"
            className={`group flex items-center gap-2.5 rounded-xl bg-muted/70 text-left transition-colors hover:bg-muted ${compact ? "max-w-56 px-3 py-2" : "max-w-64 px-3.5 py-2.5"}`}
            aria-label={`${taskArtifactRelationLabel(artifact.relation)}并预览产物：${artifact.document.title}`}
            title={artifact.relativePath}
            onClick={() => onOpen(artifact)}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon icon={File02Icon} size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                {artifact.document.title}
              </span>
              <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                <Icon icon={FolderOpenIcon} size={11} />
                {artifact.project.name}
              </span>
              <span className="mt-1 block text-[9px] text-muted-foreground/80">
                {taskArtifactRelationLabel(artifact.relation)} · Markdown
              </span>
            </span>
            <span className="text-[10px] text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100">
              预览
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
