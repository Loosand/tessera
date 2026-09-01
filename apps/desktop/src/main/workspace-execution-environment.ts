/**
 * [INPUT]: 已授权工作区根、前台 shell 命令、读写级别、AbortSignal 与 macOS sandbox-exec
 * [OUTPUT]: Secret 清空、断网、工作区边界、超时/进程组终止、输出上限和文件变化事件的 macOS ExecutionEnvironment
 * [POS]: ExecutionEnvironment 契约在 Electron 主进程的前台本地隔离实现
 * [DOC]: docs/architecture/bash-execution-environment.md、docs/architecture/agent-run-reliability.md、docs/architecture/agent-simplification-roadmap.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { constants, watch } from "node:fs"
import { access, lstat, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, dirname, isAbsolute, join, relative, sep } from "node:path"
import { type ChildProcess, spawn } from "node:child_process"
import type {
  ExecutionEnvironment,
  WorkspaceCommandInput,
  WorkspaceCommandResult,
  WorkspaceExecutionAccess,
} from "@tessera/agent-runtime"

const SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec"
const SHELL_EXECUTABLE = "/bin/sh"
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const MAX_COMMAND_CHARACTERS = 32_768
const MAX_OUTPUT_BYTES = 65_536
const MAX_CHANGED_FILES = 128
const PROCESS_TERMINATION_GRACE_MS = 250
const FILE_EVENT_SETTLE_MS = 50
const STANDARD_COMMAND_PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] as const
const IGNORED_PATH_SEGMENTS = new Set([".git", ".tessera", "node_modules"])

type ForegroundProcessResult = Readonly<{
  durationMs: number
  exitCode: number | null
  signal: string | null
  stderr: string
  stderrTruncated: boolean
  stdout: string
  stdoutTruncated: boolean
  termination: "abort" | "exit" | "timeout"
}>

export class WorkspaceExecutionError extends Error {}

function boundedTimeout(value: number | undefined) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_TIMEOUT_MS) {
    throw new WorkspaceExecutionError(`timeoutMs 必须是 1000 到 ${MAX_TIMEOUT_MS} 之间的整数。`)
  }
  return value
}

function assertCommand(command: string) {
  if (!command.trim()) throw new WorkspaceExecutionError("bash command 不能为空。")
  if (command.length > MAX_COMMAND_CHARACTERS) {
    throw new WorkspaceExecutionError(`bash command 不能超过 ${MAX_COMMAND_CHARACTERS} 个字符。`)
  }
  if (command.includes("\0")) throw new WorkspaceExecutionError("bash command 不能包含 NUL。")
}

function appendOutput(chunks: Buffer[], chunk: Buffer, state: { bytes: number; truncated: boolean }) {
  if (state.bytes >= MAX_OUTPUT_BYTES) {
    state.truncated = true
    return
  }
  const remaining = MAX_OUTPUT_BYTES - state.bytes
  const accepted = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining)
  chunks.push(accepted)
  state.bytes += accepted.byteLength
  if (accepted.byteLength < chunk.byteLength) state.truncated = true
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // 进程可能已在竞态中退出。
    }
  }
}

/** 只在 close（进程退出且 stdio 关闭）后返回；测试实现也复用该收口。 */
export function runForegroundProcess({
  abortSignal,
  args,
  cwd,
  environment,
  executable,
  timeoutMs,
}: Readonly<{
  abortSignal: AbortSignal
  args: readonly string[]
  cwd: string
  environment: NodeJS.ProcessEnv
  executable: string
  timeoutMs: number
}>): Promise<ForegroundProcessResult> {
  if (abortSignal.aborted) {
    return Promise.reject(new WorkspaceExecutionError("Agent 运行已停止。"))
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const stdoutState = { bytes: 0, truncated: false }
    const stderrState = { bytes: 0, truncated: false }
    let termination: ForegroundProcessResult["termination"] = "exit"
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null
    let settled = false
    const child = spawn(executable, [...args], {
      cwd,
      detached: true,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    })

    const terminate = (reason: "abort" | "timeout") => {
      if (settled || termination !== "exit") return
      termination = reason
      killProcessGroup(child, "SIGTERM")
      forceKillTimer = setTimeout(() => killProcessGroup(child, "SIGKILL"), PROCESS_TERMINATION_GRACE_MS)
    }
    const abort = () => terminate("abort")
    const timeout = setTimeout(() => terminate("timeout"), timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => appendOutput(stdout, chunk, stdoutState))
    child.stderr.on("data", (chunk: Buffer) => appendOutput(stderr, chunk, stderrState))
    child.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      abortSignal.removeEventListener("abort", abort)
      reject(new WorkspaceExecutionError(`无法启动受控 bash：${error.message}`))
    })
    child.once("close", (exitCode, processSignal) => {
      if (settled) return
      // shell 正常退出不代表它启动的重定向后台进程已退出；四核心只支持前台命令。
      killProcessGroup(child, "SIGKILL")
      settled = true
      clearTimeout(timeout)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      abortSignal.removeEventListener("abort", abort)
      resolve({
        durationMs: Math.max(0, Date.now() - startedAt),
        exitCode,
        signal: processSignal,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stderrTruncated: stderrState.truncated,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stdoutTruncated: stdoutState.truncated,
        termination,
      })
    })

    abortSignal.addEventListener("abort", abort, { once: true })
    if (abortSignal.aborted) abort()
  })
}

function sbplString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function directoryAncestors(...paths: readonly string[]) {
  const ancestors = new Set<string>()
  for (const path of paths) {
    let current = path
    while (true) {
      ancestors.add(current)
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return [...ancestors].map((path) => `(literal ${sbplString(path)})`).join("\n       ")
}

function sandboxProfile(
  workspaceRoot: string,
  temporaryRoot: string,
  accessLevel: WorkspaceExecutionAccess,
  extraExecutables: readonly string[],
) {
  const executableRules = extraExecutables.map((path) => `(literal ${sbplString(path)})`).join("\n       ")
  const ancestorMetadataRules = directoryAncestors(workspaceRoot, temporaryRoot)
  const workspaceWrite =
    accessLevel === "read-write"
      ? `(allow file-write*
       (literal ${sbplString(workspaceRoot)})
       (subpath ${sbplString(workspaceRoot)}))`
      : ""
  return `(version 1)
(deny default)
(import "system.sb")
(allow process*)
(allow file-read-metadata
       ${ancestorMetadataRules})
(allow file-read* file-test-existence
       (subpath "/bin")
       (subpath "/usr/bin")
       (subpath "/usr/sbin")
       (subpath "/sbin")
       (literal "/private/var/select/sh")
       (literal ${sbplString(temporaryRoot)})
       (subpath ${sbplString(temporaryRoot)})
       (literal ${sbplString(workspaceRoot)})
       (subpath ${sbplString(workspaceRoot)})
       ${executableRules})
(allow file-map-executable ${executableRules || '(subpath "/usr/bin")'})
(allow file-write*
       (literal ${sbplString(temporaryRoot)})
       (subpath ${sbplString(temporaryRoot)}))
${workspaceWrite}`
}

function visibleRelativePath(rootPath: string, filename: string) {
  if (!filename || isAbsolute(filename)) return null
  const normalized = filename.replaceAll("\\", "/")
  const segments = normalized.split("/")
  if (
    segments.some(
      (segment) =>
        !segment || segment === ".." || segment.startsWith(".") || IGNORED_PATH_SEGMENTS.has(segment),
    )
  ) {
    return null
  }
  const absolutePath = join(rootPath, ...segments)
  const relativePath = relative(rootPath, absolutePath)
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`)) return null
  return relativePath.replaceAll(sep, "/")
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function observeWorkspaceChanges(rootPath: string) {
  const observed = new Set<string>()
  let truncated = false
  const watcher = watch(rootPath, { recursive: true }, (_eventType, filename) => {
    if (filename === null) {
      truncated = true
      return
    }
    const relativePath = visibleRelativePath(rootPath, filename.toString())
    if (!relativePath) return
    if (observed.size >= MAX_CHANGED_FILES) {
      truncated = true
      return
    }
    observed.add(relativePath)
  })
  watcher.on("error", () => {
    truncated = true
  })

  return {
    async finish() {
      await delay(FILE_EVENT_SETTLE_MS)
      watcher.close()
      const changedFiles: string[] = []
      for (const relativePath of [...observed].sort()) {
        try {
          const absolutePath = join(rootPath, relativePath)
          const [metadata, resolvedPath] = await Promise.all([lstat(absolutePath), realpath(absolutePath)])
          const resolvedRelativePath = relative(rootPath, resolvedPath)
          if (
            metadata.isFile() &&
            !metadata.isSymbolicLink() &&
            resolvedRelativePath !== ".." &&
            !resolvedRelativePath.startsWith(`..${sep}`)
          ) {
            changedFiles.push(relativePath)
          }
        } catch {
          // 已删除、更名或瞬时文件不是可打开 Artifact。
        }
      }
      return { changedFiles, changesTruncated: truncated }
    },
  }
}

async function optionalExecutable(command: string) {
  const searchPath = process.env.PATH
  if (!searchPath) return null
  for (const directory of searchPath.split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue
    const candidate = join(directory, command)
    try {
      await access(candidate, constants.X_OK)
      return await realpath(candidate)
    } catch {
      // 继续检查下一个 PATH 成员。
    }
  }
  return null
}

async function stageOptionalCommands(temporaryRoot: string, commands: ReadonlyMap<string, string>) {
  const binaryRoot = join(temporaryRoot, "bin")
  await mkdir(binaryRoot, { recursive: true })
  for (const [name, target] of commands) await symlink(target, join(binaryRoot, name))
  return binaryRoot
}

export class MacOsSandboxExecutionEnvironment implements ExecutionEnvironment {
  readonly descriptor = {
    id: "macos-seatbelt-v1",
    isolation: "macos-seatbelt",
    network: "denied",
    secrets: "cleared",
  } as const

  constructor(
    private readonly workspaceRoot: string,
    private readonly optionalCommands: ReadonlyMap<string, string> = new Map(),
  ) {}

  async execute(
    input: WorkspaceCommandInput,
    accessLevel: WorkspaceExecutionAccess,
    abortSignal: AbortSignal,
  ): Promise<WorkspaceCommandResult> {
    assertCommand(input.command)
    const timeoutMs = boundedTimeout(input.timeoutMs)
    const workspaceRoot = await realpath(this.workspaceRoot)
    const createdTemporaryRoot = await mkdtemp(join(tmpdir(), "tessera-agent-bash-"))
    const temporaryRoot = await realpath(createdTemporaryRoot)
    const observer = observeWorkspaceChanges(workspaceRoot)
    let observerFinished = false
    try {
      const binaryRoot = await stageOptionalCommands(temporaryRoot, this.optionalCommands)
      const isolatedHome = join(temporaryRoot, "home")
      const isolatedTmp = join(temporaryRoot, "tmp")
      await Promise.all([mkdir(isolatedHome, { recursive: true }), mkdir(isolatedTmp, { recursive: true })])
      const profile = sandboxProfile(workspaceRoot, temporaryRoot, accessLevel, [
        ...this.optionalCommands.values(),
      ])
      const processResult = await runForegroundProcess({
        abortSignal,
        args: ["-p", profile, SHELL_EXECUTABLE, "-c", input.command],
        cwd: workspaceRoot,
        environment: {
          HOME: isolatedHome,
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          LOGNAME: "tessera-agent",
          PATH: [binaryRoot, ...STANDARD_COMMAND_PATH].join(":"),
          SHELL: SHELL_EXECUTABLE,
          TMPDIR: isolatedTmp,
          USER: "tessera-agent",
        },
        executable: SANDBOX_EXECUTABLE,
        timeoutMs,
      })
      const changes = await observer.finish()
      observerFinished = true
      if (processResult.termination === "abort") {
        throw new WorkspaceExecutionError("Agent 运行已停止；bash 进程组与输出已收口。")
      }
      return {
        access: accessLevel,
        ...changes,
        durationMs: processResult.durationMs,
        exitCode: processResult.exitCode,
        signal: processResult.signal,
        stderr: processResult.stderr,
        stderrTruncated: processResult.stderrTruncated,
        stdout: processResult.stdout,
        stdoutTruncated: processResult.stdoutTruncated,
        termination: processResult.termination,
      }
    } finally {
      try {
        if (!observerFinished) await observer.finish()
      } finally {
        await rm(createdTemporaryRoot, { recursive: true, force: true })
      }
    }
  }
}

export async function createWorkspaceExecutionEnvironment(rootPath: string) {
  if (process.platform !== "darwin") return null
  try {
    await access(SANDBOX_EXECUTABLE, constants.X_OK)
    const workspaceRoot = await realpath(rootPath)
    const ripgrep = await optionalExecutable("rg")
    const environment = new MacOsSandboxExecutionEnvironment(
      workspaceRoot,
      ripgrep ? new Map([["rg", ripgrep]]) : new Map(),
    )
    const probe = await environment.execute(
      { command: "/usr/bin/true", timeoutMs: 5_000 },
      "read-only",
      new AbortController().signal,
    )
    return probe.exitCode === 0 && probe.termination === "exit" ? environment : null
  } catch {
    return null
  }
}
