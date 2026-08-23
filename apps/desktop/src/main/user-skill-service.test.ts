/**
 * [INPUT]: 临时目录、内存 SQLite 与用户 Skill 安装服务
 * [OUTPUT]: 递归扫描/批量安装、重复识别、原子导入、托管副本、启停、删除、数据库 ID/文件损坏检测和符号链接拒绝的回归验证
 * [POS]: user-skill-service 的主进程文件安全与生命周期单元测试
 * [DOC]: docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase } from "@tessera/database"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { UserSkillError, createUserSkillService } from "./user-skill-service"

describe("用户 Skill 服务", () => {
  let temporaryPath = ""
  let userDataPath = ""

  beforeEach(async () => {
    temporaryPath = await mkdtemp(join(tmpdir(), "tessera-user-skill-"))
    userDataPath = join(temporaryPath, "user-data")
    await mkdir(userDataPath)
  })

  afterEach(async () => {
    await rm(temporaryPath, { force: true, recursive: true })
  })

  async function writeSkill(sourcePath: string, name: string, description = "整理会议记录并提取行动项") {
    await mkdir(join(sourcePath, "references"), { recursive: true })
    await writeFile(
      join(sourcePath, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n# 工作流\n\n先提取决定，再列出负责人。\n`,
    )
    await writeFile(join(sourcePath, "references", "template.md"), "# 模板\n")
    return sourcePath
  }

  async function createSource(name = "meeting-notes") {
    const sourcePath = join(temporaryPath, `source-${name}`)
    await writeSkill(sourcePath, name)
    return sourcePath
  }

  function setupService() {
    const client = openDatabase({ path: ":memory:" })
    const trashed: string[] = []
    const service = createUserSkillService({
      client,
      rootPath: userDataPath,
      trashDirectory: async (path) => {
        trashed.push(path)
        await rm(path, { force: true, recursive: true })
      },
    })
    return { client, service, trashed }
  }

  it("把完整目录复制到托管位置，并只按需加载 SKILL.md instructions", async () => {
    const sourcePath = await createSource()
    const { client, service } = setupService()

    const installed = await service.install(sourcePath)
    await writeFile(join(sourcePath, "SKILL.md"), "源目录后续变化不应影响托管副本")

    expect(installed).toMatchObject({
      available: true,
      enabled: true,
      fileCount: 2,
      id: "user:meeting-notes",
      name: "meeting-notes",
    })
    await expect(
      readFile(join(userDataPath, "skills", "meeting-notes", "references", "template.md"), "utf8"),
    ).resolves.toBe("# 模板\n")
    await expect(service.load("user:meeting-notes")).resolves.toMatchObject({
      instructions: expect.stringContaining("先提取决定"),
      permissions: [],
      scope: "user",
    })
    client.close()
  })

  it("停用后阻止任务加载，重新启用后恢复", async () => {
    const sourcePath = await createSource("review-notes")
    const { client, service } = setupService()
    const installed = await service.install(sourcePath)

    await expect(service.setEnabled(installed.id, false)).resolves.toMatchObject({ enabled: false })
    await expect(service.load(installed.id)).rejects.toThrow("已停用")
    await expect(service.setEnabled(installed.id, true)).resolves.toMatchObject({ enabled: true })
    await expect(service.load(installed.id)).resolves.toMatchObject({ name: "review-notes" })
    client.close()
  })

  it("递归扫描候选并通过短时会话批量安装", async () => {
    const collectionPath = join(temporaryPath, "skill-collection")
    await writeSkill(join(collectionPath, "planning"), "weekly-planning", "规划每周重点")
    await writeSkill(join(collectionPath, "nested", "review"), "weekly-review", "复盘每周成果")
    const brokenPath = join(collectionPath, "broken")
    await mkdir(brokenPath, { recursive: true })
    await writeFile(join(brokenPath, "SKILL.md"), "不是有效的 Skill")
    const { client, service } = setupService()

    const scan = await service.scan(collectionPath)
    expect(scan).toMatchObject({
      rootName: "skill-collection",
      truncated: false,
    })
    expect(scan.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "weekly-planning", relativePath: "planning", status: "ready" }),
        expect.objectContaining({ name: "weekly-review", relativePath: "nested/review", status: "ready" }),
        expect.objectContaining({ name: null, relativePath: "broken", status: "invalid" }),
      ]),
    )

    const readyIds = scan.candidates
      .filter((candidate) => candidate.status === "ready")
      .map((candidate) => candidate.id)
    await expect(service.installScanned(scan.id, readyIds)).resolves.toMatchObject({
      failures: [],
      skills: [expect.any(Object), expect.any(Object)],
    })
    await expect(service.list()).resolves.toHaveLength(2)
    await expect(service.installScanned(scan.id, readyIds)).rejects.toThrow("扫描结果已过期")
    client.close()
  })

  it("扫描时标记同名来源、内置名称和已安装项", async () => {
    const installedPath = await createSource("already-there")
    const collectionPath = join(temporaryPath, "conflicts")
    await writeSkill(join(collectionPath, "copy-a"), "duplicate-skill")
    await writeSkill(join(collectionPath, "copy-b"), "duplicate-skill")
    await writeSkill(join(collectionPath, "builtin"), "research")
    await writeSkill(join(collectionPath, "installed"), "already-there")
    const { client, service } = setupService()
    await service.install(installedPath)

    const scan = await service.scan(collectionPath)
    expect(scan.candidates.filter((candidate) => candidate.name === "duplicate-skill")).toEqual([
      expect.objectContaining({ status: "conflict", error: expect.stringContaining("多个") }),
      expect.objectContaining({ status: "conflict", error: expect.stringContaining("多个") }),
    ])
    expect(scan.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "research", status: "conflict" }),
        expect.objectContaining({ name: "already-there", status: "installed" }),
      ]),
    )
    client.close()
  })

  it("检测托管 SKILL.md 损坏，并把删除交给系统废纸篓边界", async () => {
    const sourcePath = await createSource("daily-review")
    const { client, service, trashed } = setupService()
    const installed = await service.install(sourcePath)
    await writeFile(join(userDataPath, "skills", "daily-review", "SKILL.md"), "已损坏")

    await expect(service.list()).resolves.toMatchObject([
      { available: false, id: "user:daily-review", error: expect.stringContaining("无法加载") },
    ])
    await expect(service.load(installed.id)).rejects.toThrow("无法加载")
    await service.delete(installed.id)
    expect(trashed).toEqual([join(userDataPath, "skills", "daily-review")])
    await expect(service.list()).resolves.toEqual([])
    client.close()
  })

  it("拒绝重复名称、内置名称和符号链接", async () => {
    const sourcePath = await createSource("safe-skill")
    await symlink(join(sourcePath, "SKILL.md"), join(sourcePath, "linked.md"))
    const { client, service } = setupService()

    await expect(service.install(sourcePath)).rejects.toThrow("符号链接")

    const builtInPath = await createSource("research")
    await expect(service.install(builtInPath)).rejects.toThrow("内置创作方式冲突")

    const cleanPath = await createSource("unique-skill")
    await service.install(cleanPath)
    await expect(service.install(cleanPath)).rejects.toThrow("已经安装")
    client.close()
  })

  it("拒绝无效用户 Skill ID", async () => {
    const { client, service } = setupService()
    await expect(service.setEnabled("user:../escape" as never, true)).rejects.toBeInstanceOf(UserSkillError)
    client.close()
  })

  it("拒绝 SQLite 中损坏的用户 Skill ID", async () => {
    const sourcePath = await createSource("damaged-id")
    const { client, service } = setupService()
    const installed = await service.install(sourcePath)
    client.connection
      .prepare("UPDATE user_skill_configs SET id = ? WHERE id = ?")
      .run("broken-id", installed.id)

    await expect(service.list()).rejects.toThrow("用户 Skill ID 无效")
    client.close()
  })
})
