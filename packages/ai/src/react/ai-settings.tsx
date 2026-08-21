/**
 * [INPUT]: 用户对 Tessera AI 能力与工具建议权限的会话内偏好
 * [OUTPUT]: 与供应商连接解耦的 AI 可用性设置界面
 * [POS]: @tessera/ai/react 的全局 AI 能力控制视图
 * [DOC]: design.md、docs/architecture/ai-providers.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { SettingRow } from "@tessera/design-system/components/setting-row"
import { SettingSection } from "@tessera/design-system/components/setting-section"
import { Switch } from "@tessera/design-system/components/ui/switch"
import { useState } from "react"

export function AiSettings() {
  const [aiEnabled, setAiEnabled] = useState(true)
  const [toolAccessEnabled, setToolAccessEnabled] = useState(false)

  return (
    <div className="space-y-8">
      <SettingSection title="可用性" description="控制 Tessera 中的 AI 入口与后续工具能力。">
        <SettingRow
          title="AI 功能"
          description="关闭后隐藏 AI 面板和相关入口，不影响阅读、编辑和保存。"
          control={<Switch checked={aiEnabled} onCheckedChange={setAiEnabled} aria-label="AI 功能" />}
        />
        <SettingRow
          title="允许 AI 提出工具操作"
          description="工具只能提出带明确范围的操作；文件修改仍需经过权限与 Diff。"
          control={
            <Switch
              checked={toolAccessEnabled}
              disabled={!aiEnabled}
              onCheckedChange={setToolAccessEnabled}
              aria-label="允许 AI 提出工具操作"
            />
          }
        />
      </SettingSection>
    </div>
  )
}
