/**
 * [INPUT]: 已经主进程路径策略解析过的工作区文件绝对路径与异步变更任务
 * [OUTPUT]: 同一文件串行、不同文件并行且失败后可继续释放的进程内 mutation queue
 * [POS]: Agent 版本复核与原子写入之间的并发一致性边界
 * [DOC]: docs/architecture/agent-file-capabilities.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

const mutationTails = new Map<string, Promise<void>>()

export async function withWorkspaceFileMutation<Result>(
  canonicalTargetPath: string,
  mutate: () => Promise<Result>,
): Promise<Result> {
  const previous = mutationTails.get(canonicalTargetPath) ?? Promise.resolve()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const currentTail = previous.catch(() => {}).then(() => gate)
  mutationTails.set(canonicalTargetPath, currentTail)

  await previous.catch(() => {})
  try {
    return await mutate()
  } finally {
    release()
    if (mutationTails.get(canonicalTargetPath) === currentTail) {
      mutationTails.delete(canonicalTargetPath)
    }
  }
}
