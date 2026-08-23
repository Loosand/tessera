/**
 * [INPUT]: assistant message 的 requestId 与只读 TaskRunInspection 加载器
 * [OUTPUT]: 消息操作栏中的运行信息图标及按需加载的模型、Skill、资源、工具、结束/失败解释浮层
 * [POS]: ChatMessage 与 task-run:read IPC 之间的轻量可观测性入口
 * [DOC]: design.md、docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskRunInspection, TaskSkillId } from "@tessera/contracts"
import { InformationCircleIcon } from "@tessera/design-system/components/icons"
import { LoadingState } from "@tessera/design-system/components/loading-state"
import { Button } from "@tessera/design-system/components/ui/button"
import { Icon } from "@tessera/design-system/components/ui/icon"
import { Popover, PopoverContent, PopoverTrigger } from "@tessera/design-system/components/ui/popover"
import React, { useState } from "react"

export function taskRunSkillLabel(skillId: TaskSkillId) {
  if (skillId === "research") return "研究"
  if (skillId === "writing") return "写作"
  if (skillId === "question-answering") return "问答"
  if (skillId?.startsWith("user:")) return `用户 Skill · ${skillId.slice(5)}`
  return "自动编排"
}

export function taskRunStatusLabel(status: TaskRunInspection["status"]) {
  if (status === "running") return "运行中"
  if (status === "completed") return "已完成"
  if (status === "cancelled") return "已停止"
  if (status === "interrupted") return "意外中断"
  return "失败"
}

export function taskRunToolsLabel(tools: TaskRunInspection["tools"]) {
  if (tools.length === 0) return "未调用工具"
  return tools
    .map((tool) => {
      const result = [
        tool.callCount > 1 ? `${tool.callCount} 次` : "",
        tool.failureCount ? `${tool.failureCount} 次失败` : "",
        tool.denialCount ? `${tool.denialCount} 次拒绝` : "",
      ]
        .filter(Boolean)
        .join(" · ")
      return result ? `${tool.name}（${result}）` : tool.name
    })
    .join("、")
}

function PolicyValue({ inspection }: Readonly<{ inspection: TaskRunInspection }>) {
  const policy = inspection.policy
  if (!policy) return <>历史运行未记录完整策略</>
  const reasoning =
    policy.reasoning === "none"
      ? "不启用深度思考"
      : `思考 ${policy.reasoning === "auto" ? "自动" : policy.reasoning}`
  const network = policy.webSearch ? "联网" : "离线"
  const scope =
    policy.toolScope === "workspace-write"
      ? "工作区读写"
      : policy.toolScope === "workspace-read"
        ? "工作区只读"
        : "仅对话"
  return <>{`${network} · ${reasoning} · ${scope}`}</>
}

function ResourceValue({ inspection }: Readonly<{ inspection: TaskRunInspection }>) {
  const resources = inspection.resources
  if (!resources) return <>历史运行未记录资源摘要</>
  const values = [
    resources.workspaceName ? `工作区 ${resources.workspaceName}` : "无工作区",
    resources.currentDocumentPath ? `当前文档 ${resources.currentDocumentPath}` : "",
    resources.attachmentCount ? `${resources.attachmentCount} 个附件` : "",
  ].filter(Boolean)
  return <>{values.join(" · ")}</>
}

function InspectionDetails({ inspection }: Readonly<{ inspection: TaskRunInspection }>) {
  const result =
    inspection.failure?.message ?? inspection.finishReason ?? taskRunStatusLabel(inspection.status)
  return (
    <div className="grid gap-3 text-xs">
      <div>
        <p className="font-medium">本次运行</p>
        <p className="mt-0.5 text-muted-foreground">{taskRunStatusLabel(inspection.status)}</p>
      </div>
      <dl className="grid gap-2.5">
        <div>
          <dt className="text-[10px] font-medium text-muted-foreground">实际模型</dt>
          <dd className="mt-0.5 break-all">{`${inspection.model.providerId} / ${inspection.model.modelId}`}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-medium text-muted-foreground">Skill 与能力</dt>
          <dd className="mt-0.5">{taskRunSkillLabel(inspection.policy?.skillId ?? null)}</dd>
          <dd className="mt-0.5 text-muted-foreground">
            <PolicyValue inspection={inspection} />
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-medium text-muted-foreground">可见资源</dt>
          <dd className="mt-0.5 break-words">
            <ResourceValue inspection={inspection} />
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-medium text-muted-foreground">工具</dt>
          <dd className="mt-0.5 break-words">{taskRunToolsLabel(inspection.tools)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-medium text-muted-foreground">结束原因</dt>
          <dd className={inspection.failure ? "mt-0.5 text-destructive" : "mt-0.5"}>{result}</dd>
        </div>
      </dl>
      {inspection.timing.durationMs !== null || inspection.usage.totalTokens !== null ? (
        <p className="border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
          {[
            inspection.timing.durationMs !== null
              ? `耗时 ${(inspection.timing.durationMs / 1_000).toFixed(1)} 秒`
              : "",
            inspection.usage.totalTokens !== null ? `${inspection.usage.totalTokens} tokens` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  )
}

type RunInspectionPopoverProps = Readonly<{
  onRead: (requestId: string) => Promise<TaskRunInspection | null>
  requestId: string
}>

export function RunInspectionPopover({ onRead, requestId }: RunInspectionPopoverProps) {
  const [open, setOpen] = useState(false)
  const [inspection, setInspection] = useState<TaskRunInspection | null | undefined>(undefined)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const load = () => {
    if (loading || inspection !== undefined) return
    setLoading(true)
    setError("")
    void onRead(requestId)
      .then(setInspection)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取这次运行。"))
      .finally(() => setLoading(false))
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) load()
      }}
    >
      <PopoverTrigger
        render={
          <Button type="button" variant="ghost" size="icon-xs" aria-label="查看本次运行信息" title="运行信息">
            <Icon icon={InformationCircleIcon} size={13} />
          </Button>
        }
      />
      <PopoverContent side="top" align="start" className="w-80 rounded-xl border border-border/70 ring-0">
        {loading ? <LoadingState className="py-4" label="正在读取运行信息" /> : null}
        {!loading && error ? <p className="text-xs text-destructive">{error}</p> : null}
        {!loading && !error && inspection === null ? (
          <p className="text-xs text-muted-foreground">这次运行记录不存在或已经清理。</p>
        ) : null}
        {!loading && !error && inspection ? <InspectionDetails inspection={inspection} /> : null}
      </PopoverContent>
    </Popover>
  )
}
