/**
 * [INPUT]: 用户选择的本地目录、Tessera 用户数据目录、SQLite 用户 Skill 目录仓储与系统废纸篓能力
 * [OUTPUT]: 受限递归发现/短时扫描会话、单个与批量原子导入、可用性复核、启停、删除及按需加载用户 SKILL.md 的主进程服务
 * [POS]: Electron 平台文件系统与 @tessera/skills 纯领域协议之间的安全安装边界
 * [DOC]: docs/architecture/database.md、docs/architecture/skill-system.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm } from "node:fs/promises"
import { basename, join, relative, sep } from "node:path"
import {
  BUILT_IN_TASK_SKILL_IDS,
  type TaskSkillId,
  type UserSkillBatchInstallFailure,
  type UserSkillConfig,
  type UserSkillScan,
  type UserSkillScanCandidate,
  type UserTaskSkillId,
  isUserTaskSkillId,
} from "@tessera/contracts"
import {
  type DatabaseClient,
  deleteUserSkillConfigRecord,
  findUserSkillConfigRecord,
  listUserSkillConfigRecords,
  setUserSkillConfigEnabled,
  upsertUserSkillConfigRecord,
} from "@tessera/database"
import {
  SKILL_FILENAME,
  type LoadedSkill,
  createUserSkillDescriptor,
  parseSkillDocument,
  userSkillDisplayName,
  userSkillId,
} from "@tessera/skills"

const MAX_FILE_COUNT = 256
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const MAX_SCAN_DEPTH = 8
const MAX_SCAN_DIRECTORIES = 4_096
const MAX_SCAN_SKILLS = 256
const MAX_SCAN_SESSIONS = 8
const SCAN_SESSION_TTL_MS = 15 * 60 * 1_000
const IGNORED_NAMES = new Set([".DS_Store", ".git", "node_modules"])

type SkillCopyStats = {
  fileCount: number
  totalBytes: number
}

type ScannedCandidate = {
  candidate: UserSkillScanCandidate
  sourceDirectory: string
}

type ScanSession = {
  candidates: Map<string, ScannedCandidate>
  createdAt: number
}

export class UserSkillError extends Error {}

export type UserSkillService = {
  readonly delete: (skillId: UserTaskSkillId) => Promise<void>
  readonly install: (sourceDirectory: string) => Promise<UserSkillConfig>
  readonly installScanned: (
    scanId: string,
    candidateIds: string[],
  ) => Promise<{ failures: UserSkillBatchInstallFailure[]; skills: UserSkillConfig[] }>
  readonly list: () => Promise<UserSkillConfig[]>
  readonly load: (skillId: TaskSkillId) => Promise<LoadedSkill | null>
  readonly scan: (sourceDirectory: string) => Promise<UserSkillScan>
  readonly setEnabled: (skillId: UserTaskSkillId, enabled: boolean) => Promise<UserSkillConfig>
}

type UserSkillServiceOptions = Readonly<{
  client: DatabaseClient
  onChanged?: () => void
  rootPath: string
  trashDirectory: (path: string) => Promise<void>
}>

function unavailableMessage(error: unknown) {
  return error instanceof Error ? error.message : "Skill 文件不可用。"
}

async function pathExists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function requireUserSkillId(skillId: unknown): asserts skillId is UserTaskSkillId {
  if (!isUserTaskSkillId(skillId)) throw new UserSkillError("用户 Skill ID 无效。")
}

function toConfig(
  record: NonNullable<ReturnType<typeof findUserSkillConfigRecord>>,
  availability: { available: boolean; error?: string },
): UserSkillConfig {
  const descriptor = createUserSkillDescriptor(record)
  return {
    available: availability.available,
    description: record.description,
    displayName: descriptor.displayName,
    enabled: record.enabled,
    ...(availability.error ? { error: availability.error } : {}),
    fileCount: record.fileCount,
    id: record.id as UserTaskSkillId,
    installedAt: record.installedAt.getTime(),
    name: record.name,
    shortDescription: descriptor.shortDescription,
    totalBytes: record.totalBytes,
    updatedAt: record.updatedAt.getTime(),
  }
}

async function copySkillTree(sourceRoot: string, targetRoot: string): Promise<SkillCopyStats> {
  const stats = { fileCount: 0, totalBytes: 0 }

  const copyDirectory = async (relativeDirectory: string): Promise<void> => {
    const sourceDirectory = relativeDirectory ? join(sourceRoot, relativeDirectory) : sourceRoot
    const targetDirectory = relativeDirectory ? join(targetRoot, relativeDirectory) : targetRoot
    await mkdir(targetDirectory, { recursive: true })
    const entries = await readdir(sourceDirectory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"))

    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue
      const relativePath = relativeDirectory ? join(relativeDirectory, entry.name) : entry.name
      const sourcePath = join(sourceRoot, relativePath)
      const targetPath = join(targetRoot, relativePath)
      const metadata = await lstat(sourcePath)
      if (metadata.isSymbolicLink()) {
        throw new UserSkillError(`Skill 不能包含符号链接：${relativePath}。`)
      }
      if (metadata.isDirectory()) {
        await copyDirectory(relativePath)
        continue
      }
      if (!metadata.isFile()) throw new UserSkillError(`Skill 包含不支持的文件类型：${relativePath}。`)
      if (metadata.size > MAX_FILE_BYTES) {
        throw new UserSkillError(`Skill 单个文件不能超过 4 MiB：${relativePath}。`)
      }
      stats.fileCount += 1
      stats.totalBytes += metadata.size
      if (stats.fileCount > MAX_FILE_COUNT) throw new UserSkillError("Skill 文件数量不能超过 256 个。")
      if (stats.totalBytes > MAX_TOTAL_BYTES) throw new UserSkillError("Skill 总大小不能超过 16 MiB。")
      await copyFile(sourcePath, targetPath)
    }
  }

  await copyDirectory("")
  return stats
}

export function createUserSkillService({
  client,
  onChanged = () => {},
  rootPath,
  trashDirectory,
}: UserSkillServiceOptions): UserSkillService {
  const skillsRoot = join(rootPath, "skills")
  const scanSessions = new Map<string, ScanSession>()

  const expireScanSessions = (makeRoom = false) => {
    const cutoff = Date.now() - SCAN_SESSION_TTL_MS
    for (const [scanId, session] of scanSessions) {
      if (session.createdAt < cutoff) scanSessions.delete(scanId)
    }
    while (makeRoom && scanSessions.size >= MAX_SCAN_SESSIONS) {
      const oldestScanId = scanSessions.keys().next().value
      if (typeof oldestScanId !== "string") break
      scanSessions.delete(oldestScanId)
    }
  }

  const readInstalledDocument = async (name: string) => {
    try {
      const source = await readFile(join(skillsRoot, name, SKILL_FILENAME), "utf8")
      return parseSkillDocument(source, name)
    } catch (error) {
      throw new UserSkillError(
        error instanceof UserSkillError || error instanceof Error
          ? `无法加载 $${name}：${error.message}`
          : `无法加载 $${name}。`,
      )
    }
  }

  const availability = async (
    record: NonNullable<ReturnType<typeof findUserSkillConfigRecord>>,
  ): Promise<{ available: boolean; error?: string }> => {
    try {
      const document = await readInstalledDocument(record.name)
      if (document.description !== record.description) {
        throw new UserSkillError("SKILL.md 元数据已变化，请删除后重新导入。")
      }
      return { available: true }
    } catch (error) {
      return { available: false, error: unavailableMessage(error) }
    }
  }

  const readConfig = async (skillId: UserTaskSkillId) => {
    requireUserSkillId(skillId)
    const record = findUserSkillConfigRecord(client, skillId)
    if (!record) throw new UserSkillError("找不到这个用户 Skill。")
    return toConfig(record, await availability(record))
  }

  const scanDirectory = async (sourceDirectory: string): Promise<UserSkillScan> => {
    const sourceMetadata = await lstat(sourceDirectory).catch(() => null)
    if (!sourceMetadata?.isDirectory()) throw new UserSkillError("请选择一个要扫描的文件夹。")

    let scannedDirectoryCount = 0
    let truncated = false
    const scannedCandidates: ScannedCandidate[] = []

    const inspectSkill = async (directory: string, relativeDirectory: string) => {
      const skillPath = join(directory, SKILL_FILENAME)
      const candidateId = randomUUID()
      const fallbackName = basename(directory) || "未命名 Skill"
      try {
        const metadata = await lstat(skillPath)
        if (metadata.isSymbolicLink() || !metadata.isFile()) {
          throw new UserSkillError("SKILL.md 必须是普通文件，不能是符号链接。")
        }
        const document = parseSkillDocument(await readFile(skillPath, "utf8"))
        let status: UserSkillScanCandidate["status"] = "ready"
        let error: string | undefined
        if (
          BUILT_IN_TASK_SKILL_IDS.some((name) => name === document.name) ||
          document.name === "question-answering"
        ) {
          status = "conflict"
          error = `与内置创作方式 $${document.name} 冲突。`
        } else if (findUserSkillConfigRecord(client, userSkillId(document.name))) {
          status = "installed"
          error = `$${document.name} 已经安装。`
        } else if (await pathExists(join(skillsRoot, document.name))) {
          status = "conflict"
          error = `托管目录中已存在 $${document.name}。`
        }
        scannedCandidates.push({
          candidate: {
            description: document.description,
            displayName: userSkillDisplayName(document.name),
            ...(error ? { error } : {}),
            id: candidateId,
            name: document.name,
            relativePath: relativeDirectory || ".",
            status,
          },
          sourceDirectory: directory,
        })
      } catch (error) {
        scannedCandidates.push({
          candidate: {
            description: "",
            displayName: fallbackName,
            error: error instanceof Error ? error.message : "无法读取 SKILL.md。",
            id: candidateId,
            name: null,
            relativePath: relativeDirectory || ".",
            status: "invalid",
          },
          sourceDirectory: directory,
        })
      }
    }

    const walk = async (directory: string, depth: number): Promise<void> => {
      if (scannedDirectoryCount >= MAX_SCAN_DIRECTORIES || scannedCandidates.length >= MAX_SCAN_SKILLS) {
        truncated = true
        return
      }
      scannedDirectoryCount += 1
      const relativeDirectory = relative(sourceDirectory, directory).split(sep).join("/")
      let entries: Dirent[]
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch (error) {
        if (depth === 0) {
          throw new UserSkillError(error instanceof Error ? error.message : "无法读取所选文件夹。")
        }
        return
      }
      entries.sort((left, right) => left.name.localeCompare(right.name, "en"))
      if (entries.some((entry) => entry.name === SKILL_FILENAME)) {
        await inspectSkill(directory, relativeDirectory)
      }
      const childDirectories = entries.filter(
        (entry) => entry.isDirectory() && !IGNORED_NAMES.has(entry.name),
      )
      if (depth >= MAX_SCAN_DEPTH) {
        if (childDirectories.length > 0) truncated = true
        return
      }
      for (const entry of childDirectories) {
        await walk(join(directory, entry.name), depth + 1)
        if (truncated && scannedCandidates.length >= MAX_SCAN_SKILLS) return
      }
    }

    await walk(sourceDirectory, 0)
    const candidatesByName = new Map<string, ScannedCandidate[]>()
    for (const scannedCandidate of scannedCandidates) {
      const { name, status } = scannedCandidate.candidate
      if (!name || status !== "ready") continue
      const duplicates = candidatesByName.get(name) ?? []
      duplicates.push(scannedCandidate)
      candidatesByName.set(name, duplicates)
    }
    for (const [name, duplicates] of candidatesByName) {
      if (duplicates.length < 2) continue
      for (const duplicate of duplicates) {
        duplicate.candidate.status = "conflict"
        duplicate.candidate.error = `扫描结果中有多个 $${name}，请只保留一个来源后重新扫描。`
      }
    }
    scannedCandidates.sort((left, right) =>
      left.candidate.relativePath.localeCompare(right.candidate.relativePath, "zh-CN"),
    )

    expireScanSessions(true)
    const scanId = randomUUID()
    scanSessions.set(scanId, {
      candidates: new Map(scannedCandidates.map((item) => [item.candidate.id, item])),
      createdAt: Date.now(),
    })
    return {
      candidates: scannedCandidates.map((item) => item.candidate),
      id: scanId,
      rootName: basename(sourceDirectory) || "所选目录",
      scannedDirectoryCount,
      truncated,
    }
  }

  const service: UserSkillService = {
    list: async () =>
      Promise.all(
        listUserSkillConfigRecords(client).map(async (record) =>
          toConfig(record, await availability(record)),
        ),
      ),
    install: async (sourceDirectory) => {
      const sourceMetadata = await lstat(sourceDirectory).catch(() => null)
      if (!sourceMetadata?.isDirectory()) throw new UserSkillError("请选择一个 Skill 文件夹。")

      let document: ReturnType<typeof parseSkillDocument>
      try {
        document = parseSkillDocument(await readFile(join(sourceDirectory, SKILL_FILENAME), "utf8"))
      } catch (error) {
        throw new UserSkillError(
          error instanceof Error
            ? `所选文件夹不是有效 Skill：${error.message}`
            : "所选文件夹不是有效 Skill。",
        )
      }
      if (
        BUILT_IN_TASK_SKILL_IDS.some((name) => name === document.name) ||
        document.name === "question-answering"
      ) {
        throw new UserSkillError(`Skill name 与内置创作方式冲突：${document.name}。`)
      }

      const id = userSkillId(document.name)
      if (findUserSkillConfigRecord(client, id)) throw new UserSkillError(`$${document.name} 已经安装。`)
      await mkdir(skillsRoot, { recursive: true })
      const targetPath = join(skillsRoot, document.name)
      if (await pathExists(targetPath)) {
        throw new UserSkillError(`托管目录中已存在 $${document.name}，请先处理后再导入。`)
      }

      const stagingPath = join(skillsRoot, `.${document.name}.${randomUUID()}.tmp`)
      try {
        const stats = await copySkillTree(sourceDirectory, stagingPath)
        const stagedDocument = parseSkillDocument(
          await readFile(join(stagingPath, SKILL_FILENAME), "utf8"),
          document.name,
        )
        if (stagedDocument.description !== document.description) {
          throw new UserSkillError("导入期间 SKILL.md 发生变化，请重试。")
        }
        await rename(stagingPath, targetPath)
        const now = new Date()
        try {
          upsertUserSkillConfigRecord(client, {
            id,
            name: document.name,
            description: document.description,
            enabled: true,
            fileCount: stats.fileCount,
            totalBytes: stats.totalBytes,
            installedAt: now,
            updatedAt: now,
          })
        } catch (error) {
          await rm(targetPath, { force: true, recursive: true }).catch(() => {})
          throw error
        }
      } catch (error) {
        await rm(stagingPath, { force: true, recursive: true }).catch(() => {})
        if (error instanceof UserSkillError) throw error
        throw new UserSkillError(error instanceof Error ? error.message : "导入 Skill 失败。")
      }
      onChanged()
      return readConfig(id)
    },
    scan: scanDirectory,
    installScanned: async (scanId, candidateIds) => {
      expireScanSessions()
      const session = scanSessions.get(scanId)
      if (!session) throw new UserSkillError("扫描结果已过期，请重新扫描。")
      const uniqueCandidateIds = [...new Set(candidateIds)]
      if (uniqueCandidateIds.length === 0) throw new UserSkillError("请至少选择一个可安装的 Skill。")
      if (uniqueCandidateIds.length > MAX_SCAN_SKILLS) throw new UserSkillError("一次最多安装 256 个 Skill。")
      scanSessions.delete(scanId)

      const skills: UserSkillConfig[] = []
      const failures: UserSkillBatchInstallFailure[] = []
      for (const candidateId of uniqueCandidateIds) {
        const scannedCandidate = session.candidates.get(candidateId)
        if (!scannedCandidate || scannedCandidate.candidate.status !== "ready") {
          failures.push({ candidateId, error: "这个扫描项不可安装或已经失效。" })
          continue
        }
        try {
          skills.push(await service.install(scannedCandidate.sourceDirectory))
        } catch (error) {
          failures.push({
            candidateId,
            error: error instanceof Error ? error.message : "导入 Skill 失败。",
          })
        }
      }
      return { failures, skills }
    },
    setEnabled: async (skillId, enabled) => {
      requireUserSkillId(skillId)
      const record = findUserSkillConfigRecord(client, skillId)
      if (!record) throw new UserSkillError("找不到这个用户 Skill。")
      if (enabled) {
        const state = await availability(record)
        if (!state.available) throw new UserSkillError(state.error ?? "Skill 文件不可用。")
      }
      setUserSkillConfigEnabled(client, skillId, enabled)
      onChanged()
      return readConfig(skillId)
    },
    delete: async (skillId) => {
      requireUserSkillId(skillId)
      const record = findUserSkillConfigRecord(client, skillId)
      if (!record) throw new UserSkillError("找不到这个用户 Skill。")
      const targetPath = join(skillsRoot, record.name)
      if (await pathExists(targetPath)) await trashDirectory(targetPath)
      deleteUserSkillConfigRecord(client, skillId)
      onChanged()
    },
    load: async (skillId) => {
      if (!isUserTaskSkillId(skillId)) return null
      const record = findUserSkillConfigRecord(client, skillId)
      if (!record) throw new UserSkillError("这个用户 Skill 已被移除，请重新选择创作方式。")
      if (!record.enabled) throw new UserSkillError(`$${record.name} 已停用，请先在技能页启用。`)
      const document = await readInstalledDocument(record.name)
      if (document.description !== record.description) {
        throw new UserSkillError(`$${record.name} 元数据已变化，请删除后重新导入。`)
      }
      return { ...createUserSkillDescriptor(document), instructions: document.instructions }
    },
  }
  return service
}
