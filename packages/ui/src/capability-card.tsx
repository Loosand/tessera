/**
 * [INPUT]: 能力名称、说明和状态文本
 * [OUTPUT]: 用语义 HTML 呈现的 CapabilityCard 组件
 * [POS]: UI 包当前脚手架使用的临时能力摘要组件
 * [DOC]: design.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

export interface CapabilityCardProps {
  title: string
  description: string
  status: string
}

export function CapabilityCard({ title, description, status }: CapabilityCardProps) {
  return (
    <article className="capability-card">
      <div className="capability-card__topline">
        <h2>{title}</h2>
        <span className="status-pill">{status}</span>
      </div>
      <p>{description}</p>
    </article>
  )
}
