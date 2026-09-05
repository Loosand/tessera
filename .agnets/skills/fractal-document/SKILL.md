---
name: fractal-document
description: 维护 Tessera 的代码与文档同步。用于源文件增删改移、目录职责或成员变化、包边界与跨目录机制调整，以及文档漂移审阅。
---

# Fractal Document

Maintain a navigable map from repository root to directory to source file. Treat documentation updates as part of the same change, not follow-up work.

## Workflow

1. Read `AGENTS.md` as the source of truth for repository conventions, Header requirements, and completion checks. Read the root `README.md` when repository entry points or scope are relevant.
2. Locate and read the nearest `.folder.md` for every file that may change. Read any deeper document named by a source file's `[DOC]` field.
3. Classify the change before editing:
   - Local logic only: verify the source Header; update it only when the contract changes or the Header is inaccurate.
   - File membership or directory responsibility: also update the nearest `.folder.md`.
   - Package boundary, workflow, schema, deployment, or global constraint: also update the relevant architecture document and root map.
4. Implement the requested change without expanding scope.
5. Reconcile documentation immediately after code edits.
6. Verify headers, folder membership, links, and status labels, and follow the completion checks in `AGENTS.md`.
7. Report which documentation layers changed and any planned capability that remains unimplemented.

## Source Header Contract

Header 字段、豁免和更新触发器以仓库 `AGENTS.md` 为准，本 Skill 不重复定义。手写迁移不因位于 migrations 目录而自动豁免；契约未变化且 Header 准确时无需重写。

读取目标文件最近的 `.folder.md` 和相关 `[DOC]` 文档。引用的辅助指南不存在时，检查是否已有替代文档，记录缺失并依据现存规则继续；只有缺失内容使关键行为无法确定时才澄清，不为满足失效引用创建无关文档。

## Folder Map Contract

Keep `.folder.md` short and operational:

1. `地位`: why the directory exists.
2. `逻辑`: how members collaborate.
3. `约束`: forbidden dependencies or invariants.
4. `成员清单`: every meaningful direct member and its responsibility.
5. `触发器`: exactly which changes require this map to be updated.

Never list generated output, caches, dependencies, or every incidental asset.

## Deep Documentation Contract

- Put cross-package rules and major workflows in `docs/architecture/`.
- Start a deep document that cites code with `> 代码源头：...` and add reciprocal `[DOC]` fields only to the few source-of-truth files.
- Prefer grep-stable names over fragile line numbers.
- Label claims as `已实现`, `部分实现`, or `规划`.
- 引用 `docs/research/` 的外部研究基线时，在当前设计文档中记录有意差异，不静默改写历史研究结论。

## Completion Check

- Confirm every changed hand-written source file has an accurate Header unless `AGENTS.md` exempts it.
- Confirm every add/move/delete is reflected in the nearest `.folder.md`.
- Confirm affected links and reciprocal `[DOC]` anchors resolve.
- Confirm root maps still match the package graph and deployment reality.
- Follow `AGENTS.md` for required commands, failure handling, and read-only review boundaries; do not maintain a separate command list here.
