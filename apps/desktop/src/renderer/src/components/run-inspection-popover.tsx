/**
 * [INPUT]: assistant message 的 requestId 与只读 TaskRunInspection 加载器
 * [OUTPUT]: 消息操作栏中的用量与运行信息图标，以及按需加载的 Token、ContextManifest 预算、执行、耗时、模型、Skill、资源、工具和结束/失败审计浮层
 * [POS]: ChatMessage 与 task-run:read IPC 之间的轻量可观测性入口
 * [DOC]: design.md、docs/architecture/ai-observability.md、docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskContextManifest, TaskRunInspection, TaskSkillId } from "@tessera/contracts"
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

export function taskRunMetricLabel(value: number | null, unit: "milliseconds" | "tokens" | "value") {
  if (value === null) return "未返回"
  if (unit === "milliseconds") {
    if (value < 1_000) return `${value.toLocaleString("zh-CN")} 毫秒`
    return `${(value / 1_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 秒`
  }
  const formatted = value.toLocaleString("zh-CN")
  return unit === "tokens" ? `${formatted} Token` : formatted
}

export function taskRunContextStatusLabel(status: TaskContextManifest["status"]) {
  if (status === "within-budget") return "预算内"
  if (status === "over-budget") return "已超预算"
  return "模型未声明上限"
}

function AuditMetric({
  label,
  value,
}: Readonly<{
  label: string
  value: string
}>) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/45 px-2.5 py-2">
      <dt className="text-[10px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-xs font-medium tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  )
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
  const contextManifest = inspection.resources?.contextManifest
  return (
    <div className="grid gap-4 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">用量与运行审计</p>
          <p className="mt-0.5 text-muted-foreground">
            {new Date(inspection.startedAt).toLocaleString("zh-CN", { hour12: false })}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {taskRunStatusLabel(inspection.status)}
        </span>
      </div>

      <section className="grid gap-2">
        <p className="text-[10px] font-medium text-muted-foreground">Token 用量</p>
        <dl className="grid grid-cols-2 gap-1.5">
          <AuditMetric label="总用量" value={taskRunMetricLabel(inspection.usage.totalTokens, "tokens")} />
          <AuditMetric label="输入" value={taskRunMetricLabel(inspection.usage.inputTokens, "tokens")} />
          <AuditMetric label="输出" value={taskRunMetricLabel(inspection.usage.outputTokens, "tokens")} />
          <AuditMetric label="推理" value={taskRunMetricLabel(inspection.usage.reasoningTokens, "tokens")} />
          <AuditMetric
            label="缓存读取"
            value={taskRunMetricLabel(inspection.usage.cacheReadTokens, "tokens")}
          />
          <AuditMetric
            label="缓存写入"
            value={taskRunMetricLabel(inspection.usage.cacheWriteTokens, "tokens")}
          />
        </dl>
        <p className="text-[10px] leading-4 text-muted-foreground">
          数值来自供应商与 AI SDK；未返回时不按 0 估算，缓存与推理分项可能已包含在其他口径中。
        </p>
      </section>

      {contextManifest ? (
        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-medium text-muted-foreground">上下文预算</p>
            <span
              className={
                contextManifest.status === "over-budget"
                  ? "text-[10px] text-destructive"
                  : "text-[10px] text-muted-foreground"
              }
            >
              {taskRunContextStatusLabel(contextManifest.status)}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-1.5">
            <AuditMetric
              label="预计输入"
              value={taskRunMetricLabel(contextManifest.estimatedInputTokens, "tokens")}
            />
            <AuditMetric
              label="安全预算"
              value={taskRunMetricLabel(contextManifest.availableInputTokens, "tokens")}
            />
            <AuditMetric
              label="预留输出"
              value={taskRunMetricLabel(contextManifest.reservedOutputTokens, "tokens")}
            />
            <AuditMetric label="观测步骤" value={`${contextManifest.observedStep + 1}`} />
          </dl>
          <p className="text-[10px] leading-4 text-muted-foreground">
            这是每次模型调用前的本地保守估算，不等同于供应商最终计费；工具结果会单独计入。
          </p>
        </section>
      ) : null}

      <section className="grid gap-2">
        <p className="text-[10px] font-medium text-muted-foreground">执行与耗时</p>
        <dl className="grid grid-cols-2 gap-1.5">
          <AuditMetric
            label="Agent 步骤"
            value={taskRunMetricLabel(inspection.execution.stepCount, "value")}
          />
          <AuditMetric
            label="工具调用"
            value={taskRunMetricLabel(inspection.execution.toolCallCount, "value")}
          />
          <AuditMetric
            label="总耗时"
            value={taskRunMetricLabel(inspection.timing.durationMs, "milliseconds")}
          />
          <AuditMetric
            label="首次输出"
            value={taskRunMetricLabel(inspection.timing.timeToFirstOutputMs, "milliseconds")}
          />
          <AuditMetric
            label="模型耗时"
            value={taskRunMetricLabel(inspection.timing.modelDurationMs, "milliseconds")}
          />
          <AuditMetric
            label="工具耗时"
            value={taskRunMetricLabel(inspection.timing.toolDurationMs, "milliseconds")}
          />
        </dl>
      </section>

      <dl className="grid gap-2.5 border-t border-border/60 pt-3">
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
        <div>
          <dt className="text-[10px] font-medium text-muted-foreground">请求 ID</dt>
          <dd className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
            {inspection.requestId}
          </dd>
        </div>
      </dl>
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
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="查看本次用量与运行审计"
            title="用量与运行信息"
          >
            <Icon icon={InformationCircleIcon} size={13} />
          </Button>
        }
      />
      <PopoverContent
        side="top"
        align="start"
        className="max-h-[min(38rem,calc(100vh-2rem))] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border/70 ring-0"
      >
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
