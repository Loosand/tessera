/**
 * [INPUT]: 当前 Space 标识、分页尺寸、任务列表修订号与预加载层分页读取函数
 * [OUTPUT]: 拒绝过期响应、自动回退空页并支持重试的任务分页状态
 * [POS]: 侧栏最近任务与全部任务页共享的服务端分页 Hook
 * [DOC]: docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSessionPage, TaskSessionPageRequest } from "@tessera/contracts"
import { useCallback, useEffect, useRef, useState } from "react"

export type TaskPageLoader = (request: TaskSessionPageRequest) => Promise<TaskSessionPage>

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "读取任务列表失败，请稍后重试。"
}

export function useTaskPage({
  loadPage,
  pageSize,
  refreshKey,
  scopeKey,
}: Readonly<{
  loadPage: TaskPageLoader
  pageSize: number
  refreshKey: number
  scopeKey: string
}>) {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<TaskSessionPage>({
    items: [],
    page: 1,
    pageSize,
    total: 0,
    totalPages: 1,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const requestIdRef = useRef(0)

  useEffect(() => {
    void scopeKey
    setPage(1)
  }, [scopeKey])

  useEffect(() => {
    void refreshKey
    void reloadKey
    void scopeKey
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    void loadPage({ page, pageSize })
      .then((nextResult) => {
        if (requestId !== requestIdRef.current) return
        if (page > nextResult.totalPages) {
          setPage(nextResult.totalPages)
          return
        }
        setResult(nextResult)
      })
      .catch((cause) => {
        if (requestId === requestIdRef.current) setError(errorMessage(cause))
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [loadPage, page, pageSize, refreshKey, reloadKey, scopeKey])

  const goToPage = useCallback(
    (nextPage: number) => {
      setPage(Math.min(Math.max(1, nextPage), result.totalPages))
    },
    [result.totalPages],
  )

  const reload = useCallback(() => setReloadKey((current) => current + 1), [])

  return { error, goToPage, loading, page, reload, result }
}
