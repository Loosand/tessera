/**
 * [INPUT]: 当前 Space 标识、每批数量、任务列表修订号与预加载层分页读取函数
 * [OUTPUT]: 拒绝过期响应、按页去重追加并支持加载更多/重试的最近任务状态
 * [POS]: 一级侧栏最近任务的渐进加载 Hook
 * [DOC]: docs/architecture/task-navigation.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import type { TaskSessionPage } from "@tessera/contracts"
import { useCallback, useEffect, useRef, useState } from "react"
import type { TaskPageLoader } from "./use-task-page"

function emptyTaskPage(pageSize: number): TaskSessionPage {
  return { items: [], page: 1, pageSize, total: 0, totalPages: 1 }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "读取任务列表失败，请稍后重试。"
}

export function mergeTaskFeedPage(current: TaskSessionPage, next: TaskSessionPage): TaskSessionPage {
  if (next.page === 1) return next
  const existingIds = new Set(current.items.map((task) => task.id))
  return {
    ...next,
    items: [...current.items, ...next.items.filter((task) => !existingIds.has(task.id))],
  }
}

export function useTaskFeed({
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
  const [result, setResult] = useState<TaskSessionPage>(() => emptyTaskPage(pageSize))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const requestIdRef = useRef(0)

  useEffect(() => {
    void refreshKey
    void scopeKey
    requestIdRef.current += 1
    setPage(1)
    setResult(emptyTaskPage(pageSize))
    setLoading(true)
    setError(null)
  }, [pageSize, refreshKey, scopeKey])

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
        setResult((current) => mergeTaskFeedPage(current, nextResult))
      })
      .catch((cause) => {
        if (requestId === requestIdRef.current) setError(errorMessage(cause))
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [loadPage, page, pageSize, refreshKey, reloadKey, scopeKey])

  const loadMore = useCallback(() => {
    if (loading || page >= result.totalPages) return
    setPage((current) => current + 1)
  }, [loading, page, result.totalPages])
  const reload = useCallback(() => setReloadKey((current) => current + 1), [])

  return {
    error,
    hasMore: page < result.totalPages,
    loadMore,
    loading,
    reload,
    result,
  }
}
