/**
 * [INPUT]: 用户对 Tessera AI 能力/工具建议的会话内偏好，以及主进程注入的研究网络模式读写函数
 * [OUTPUT]: 与供应商连接解耦的 AI 可用性和研究网页系统代理/直连设置界面
 * [POS]: @tessera/ai/react 的全局 AI 能力控制视图
 * [DOC]: design.md、docs/architecture/ai-providers.md、docs/architecture/research-workflow.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { type ResearchNetworkMode, isResearchNetworkMode } from "@tessera/contracts"
import { SettingRow } from "@tessera/design-system/components/setting-row"
import { SettingSection } from "@tessera/design-system/components/setting-section"
import { NativeSelect } from "@tessera/design-system/components/ui/native-select"
import { Switch } from "@tessera/design-system/components/ui/switch"
import { useEffect, useState } from "react"

export type AiSettingsProps = Readonly<{
  getResearchNetworkMode: () => Promise<ResearchNetworkMode>
  setResearchNetworkMode: (mode: ResearchNetworkMode) => Promise<ResearchNetworkMode>
}>

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function AiSettings({ getResearchNetworkMode, setResearchNetworkMode }: AiSettingsProps) {
  const [aiEnabled, setAiEnabled] = useState(true)
  const [toolAccessEnabled, setToolAccessEnabled] = useState(false)
  const [networkMode, setNetworkMode] = useState<ResearchNetworkMode | "">("")
  const [networkBusy, setNetworkBusy] = useState(true)
  const [networkStatus, setNetworkStatus] = useState("")

  useEffect(() => {
    let cancelled = false
    void getResearchNetworkMode()
      .then((mode) => {
        if (!cancelled) setNetworkMode(mode)
      })
      .catch((error) => {
        if (!cancelled) setNetworkStatus(errorMessage(error, "读取研究网络设置失败。"))
      })
      .finally(() => {
        if (!cancelled) setNetworkBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [getResearchNetworkMode])

  const updateNetworkMode = async (value: string) => {
    if (!isResearchNetworkMode(value)) return
    const previousMode = networkMode
    setNetworkMode(value)
    setNetworkBusy(true)
    setNetworkStatus("")
    try {
      setNetworkMode(await setResearchNetworkMode(value))
      setNetworkStatus("已保存；从下一次研究任务开始生效。")
    } catch (error) {
      setNetworkMode(previousMode)
      setNetworkStatus(errorMessage(error, "保存研究网络设置失败。"))
    } finally {
      setNetworkBusy(false)
    }
  }

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

      <SettingSection
        title="研究网络"
        description="只控制研究 Skill 读取网页正文时采用的网络路径，不改变模型供应商请求或浏览器登录态。"
      >
        <SettingRow
          title="网页连接方式"
          description="默认跟随 macOS 系统代理；网络无需代理时可改为直连。每次任务启动后会冻结本次选择。"
          control={
            <NativeSelect
              aria-label="研究网页连接方式"
              value={networkMode}
              disabled={networkBusy}
              onChange={(event) => void updateNetworkMode(event.currentTarget.value)}
            >
              <option value="" disabled>
                读取中…
              </option>
              <option value="system">跟随系统代理</option>
              <option value="direct">直接连接</option>
            </NativeSelect>
          }
        />
        {networkStatus ? (
          <p className="px-4 py-2.5 text-xs leading-5 text-muted-foreground" aria-live="polite">
            {networkStatus}
          </p>
        ) : null}
      </SettingSection>
    </div>
  )
}
