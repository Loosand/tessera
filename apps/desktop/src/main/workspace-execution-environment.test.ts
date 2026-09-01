/**
 * [INPUT]: 合成前台子进程、超时/Abort、大输出与可选 macOS sandbox-exec 真实工作区
 * [OUTPUT]: 进程组收口、stdio 完成、输出上限、Secret 清空、读写隔离和变更事件回归
 * [POS]: macOS ExecutionEnvironment 与通用前台进程 runner 的主进程稳定性测试
 * [DOC]: docs/architecture/bash-execution-environment.md、docs/architecture/agent-run-reliability.md、docs/architecture/agent-simplification-roadmap.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  createWorkspaceExecutionEnvironment,
  MacOsSandboxExecutionEnvironment,
  runForegroundProcess,
} from "./workspace-execution-environment"

const EMPTY_ENVIRONMENT = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }

describe("foreground process runner", () => {
  it("等待进程与 stdio 关闭，并对输出做字节级上限", async () => {
    const result = await runForegroundProcess({
      abortSignal: new AbortController().signal,
      args: ["-c", "/usr/bin/yes x | /usr/bin/head -c 70000; printf error >&2"],
      cwd: tmpdir(),
      environment: EMPTY_ENVIRONMENT,
      executable: "/bin/sh",
      timeoutMs: 5_000,
    })

    expect(result).toMatchObject({ exitCode: 0, stderr: "error", termination: "exit" })
    expect(Buffer.byteLength(result.stdout, "utf8")).toBe(65_536)
    expect(result.stdoutTruncated).toBe(true)
  })

  it("超时时终止包含后台子进程的整个进程组", async () => {
    const result = await runForegroundProcess({
      abortSignal: new AbortController().signal,
      args: ["-c", "/bin/sleep 10 & wait"],
      cwd: tmpdir(),
      environment: EMPTY_ENVIRONMENT,
      executable: "/bin/sh",
      timeoutMs: 100,
    })

    expect(result.termination).toBe("timeout")
    expect(result.durationMs).toBeLessThan(3_000)
  })

  it("Abort 后等待进程组与输出收口", async () => {
    const controller = new AbortController()
    const resultPromise = runForegroundProcess({
      abortSignal: controller.signal,
      args: ["-c", "/bin/sleep 10 & wait"],
      cwd: tmpdir(),
      environment: EMPTY_ENVIRONMENT,
      executable: "/bin/sh",
      timeoutMs: 5_000,
    })
    setTimeout(() => controller.abort("test"), 50)

    await expect(resultPromise).resolves.toMatchObject({ termination: "abort" })
  })

  it("shell 正常退出时也清理不受支持的后台进程", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "tessera-bash-process-group-"))
    const markerPath = join(rootPath, "background-survived")
    try {
      const result = await runForegroundProcess({
        abortSignal: new AbortController().signal,
        args: ["-c", `(/bin/sleep 0.3; /usr/bin/touch '${markerPath}') >/dev/null 2>&1 &`],
        cwd: rootPath,
        environment: EMPTY_ENVIRONMENT,
        executable: "/bin/sh",
        timeoutMs: 5_000,
      })

      expect(result).toMatchObject({ exitCode: 0, termination: "exit" })
      await new Promise((resolve) => setTimeout(resolve, 500))
      await expect(access(markerPath)).rejects.toThrow()
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })
})

const macOsSandboxTest = process.env.TESSERA_TEST_MACOS_SANDBOX === "1" ? it : it.skip

describe("macOS workspace sandbox", () => {
  macOsSandboxTest("清空 Secret，拒绝越界读写，并只在读写级别记录工作区变更", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "tessera-bash-workspace-"))
    const outsideRoot = await mkdtemp(join(tmpdir(), "tessera-bash-outside-"))
    const outsideSecret = join(outsideRoot, "secret.txt")
    const outsideEscape = join(outsideRoot, "escape.txt")
    const previousSecret = process.env.TESSERA_AGENT_SECRET_TEST
    await writeFile(outsideSecret, "secret", "utf8")
    process.env.TESSERA_AGENT_SECRET_TEST = "host-secret"
    const environment = new MacOsSandboxExecutionEnvironment(workspaceRoot)

    try {
      const readOnly = await environment.execute(
        {
          command: [
            `test ! -r '${outsideSecret}' && printf read-blocked`,
            `test -z "\${TESSERA_AGENT_SECRET_TEST-}" && printf secret-cleared`,
            "if printf denied > blocked.md; then exit 9; fi",
            `if printf denied > '${outsideEscape}'; then exit 10; fi`,
          ].join("; "),
        },
        "read-only",
        new AbortController().signal,
      )
      expect(readOnly.exitCode).toBe(0)
      expect(readOnly.stdout).toContain("read-blocked")
      expect(readOnly.stdout).toContain("secret-cleared")
      expect(readOnly.changedFiles).toEqual([])

      const readWrite = await environment.execute(
        { command: "printf '# artifact\\n' > artifact.md; /bin/ls; /usr/bin/find . -name '*.md'" },
        "read-write",
        new AbortController().signal,
      )
      expect(readWrite, JSON.stringify(readWrite)).toMatchObject({ exitCode: 0, termination: "exit" })
      expect(readWrite.stdout).toContain("artifact.md")
      expect(readWrite.changedFiles).toContain("artifact.md")
      await expect(readFile(join(workspaceRoot, "artifact.md"), "utf8")).resolves.toBe("# artifact\n")

      const detectedEnvironment = await createWorkspaceExecutionEnvironment(workspaceRoot)
      if (!detectedEnvironment) throw new Error("预期当前 macOS 主机支持 Seatbelt ExecutionEnvironment。")
      const ripgrep = await detectedEnvironment.execute(
        { command: "rg artifact artifact.md" },
        "read-only",
        new AbortController().signal,
      )
      expect(ripgrep).toMatchObject({ exitCode: 0, termination: "exit" })
      expect(ripgrep.stdout).toContain("# artifact")

      let networkAccepted = false
      const server = createServer((socket) => {
        networkAccepted = true
        socket.destroy()
      })
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", resolve)
      })
      try {
        const address = server.address()
        if (!address || typeof address === "string") throw new Error("无法取得本地测试端口。")
        const network = await environment.execute(
          { command: `printf probe | /usr/bin/nc -w 1 127.0.0.1 ${address.port}` },
          "read-only",
          new AbortController().signal,
        )
        expect(network.exitCode).not.toBe(0)
        expect(networkAccepted).toBe(false)
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
      }
    } finally {
      if (previousSecret === undefined) process.env.TESSERA_AGENT_SECRET_TEST = undefined
      else process.env.TESSERA_AGENT_SECRET_TEST = previousSecret
      await Promise.all([
        rm(workspaceRoot, { recursive: true, force: true }),
        rm(outsideRoot, { recursive: true, force: true }),
      ])
    }
  })
})
