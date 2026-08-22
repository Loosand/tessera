/**
 * [INPUT]: 预加载层用户 Skill 列表、单目录导入、扫描/批量安装、启停、删除与变更订阅 API
 * [OUTPUT]: 渲染层可复用的用户 Skill 目录、扫描预览、忙碌状态和安全操作
 * [POS]: Skill 管理页与任务创作方式选择器共用的状态入口
 * [DOC]: docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { UserSkillConfig, UserSkillScan, UserTaskSkillId } from "@tessera/contracts"
import { useCallback, useEffect, useState } from "react"

export function userSkillErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (message.includes("No handler registered for 'skill:")) {
    return "Tessera 主进程尚未加载最新技能功能，请重启应用后重试。"
  }
  return message || "Skill 操作失败，请稍后重试。"
}

export function useUserSkills() {
  const [skills, setSkills] = useState<UserSkillConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<UserSkillScan | null>(null)

  const refresh = useCallback(async () => {
    const desktopApi = window.tessera
    if (!desktopApi) {
      setLoading(false)
      return []
    }
    try {
      const nextSkills = await desktopApi.listUserSkills()
      setSkills(nextSkills)
      setError(null)
      return nextSkills
    } catch (cause) {
      setError(userSkillErrorMessage(cause))
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return window.tessera?.onUserSkillsChanged(() => void refresh())
  }, [refresh])

  const install = useCallback(async () => {
    const desktopApi = window.tessera
    if (!desktopApi || busy) return null
    setBusy(true)
    setError(null)
    try {
      const result = await desktopApi.installUserSkill()
      if (!result.ok) {
        setError(result.error)
        return null
      }
      const installedSkill = result.skill
      if (installedSkill) {
        setSkills((current) => [installedSkill, ...current.filter((skill) => skill.id !== installedSkill.id)])
      }
      return result.skill
    } catch (cause) {
      setError(userSkillErrorMessage(cause))
      return null
    } finally {
      setBusy(false)
    }
  }, [busy])

  const scanDirectory = useCallback(async () => {
    const desktopApi = window.tessera
    if (!desktopApi || busy) return null
    setBusy(true)
    setError(null)
    try {
      const result = await desktopApi.scanUserSkills()
      if (!result.ok) {
        setError(result.error)
        return null
      }
      setScanResult(result.scan)
      return result.scan
    } catch (cause) {
      setError(userSkillErrorMessage(cause))
      return null
    } finally {
      setBusy(false)
    }
  }, [busy])

  const installScanned = useCallback(
    async (scanId: string, candidateIds: string[]) => {
      const desktopApi = window.tessera
      if (!desktopApi || busy) return null
      setBusy(true)
      setError(null)
      try {
        const result = await desktopApi.installScannedUserSkills(scanId, candidateIds)
        if (!result.ok) {
          setError(result.error)
          return null
        }
        if (result.skills.length > 0) {
          setSkills((current) => [
            ...result.skills,
            ...current.filter((skill) => !result.skills.some((installed) => installed.id === skill.id)),
          ])
        }
        setScanResult(null)
        if (result.failures.length > 0) {
          setError(
            `已安装 ${result.skills.length} 个 Skill，${result.failures.length} 个失败：${result.failures
              .map((failure) => failure.error)
              .join("；")}`,
          )
        }
        return result
      } catch (cause) {
        setError(userSkillErrorMessage(cause))
        return null
      } finally {
        setBusy(false)
      }
    },
    [busy],
  )

  const setEnabled = useCallback(async (skillId: UserTaskSkillId, enabled: boolean) => {
    const desktopApi = window.tessera
    if (!desktopApi) return null
    setError(null)
    try {
      const result = await desktopApi.setUserSkillEnabled(skillId, enabled)
      if (!result.ok) {
        setError(result.error)
        return null
      }
      setSkills((current) => current.map((skill) => (skill.id === skillId ? result.skill : skill)))
      return result.skill
    } catch (cause) {
      setError(userSkillErrorMessage(cause))
      return null
    }
  }, [])

  const remove = useCallback(async (skillId: UserTaskSkillId) => {
    const desktopApi = window.tessera
    if (!desktopApi) return false
    setError(null)
    try {
      const result = await desktopApi.deleteUserSkill(skillId)
      if (!result.ok) {
        setError(result.error)
        return false
      }
      setSkills((current) => current.filter((skill) => skill.id !== skillId))
      return true
    } catch (cause) {
      setError(userSkillErrorMessage(cause))
      return false
    }
  }, [])

  return {
    busy,
    clearScan: () => setScanResult(null),
    error,
    install,
    installScanned,
    loading,
    refresh,
    remove,
    scanDirectory,
    scanResult,
    setEnabled,
    skills,
  }
}
