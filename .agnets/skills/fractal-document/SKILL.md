---
name: fractal-document
description: Keep this repository's code and documentation synchronized through its fractal documentation protocol. Use for any task that creates, edits, moves, or deletes source files, changes a directory's responsibility or membership, modifies package boundaries, data models, workflows, deployment profiles, or architecture documents, or audits documentation drift in the Chat project.
---

# Fractal Document

Maintain a navigable map from repository root to directory to source file. Treat documentation updates as part of the same change, not follow-up work.

## Workflow

1. Read `AGENTS.md`, the root `README.md`, and `docs/architecture/fractal-documentation-guide.md` completely.
2. Locate and read the nearest `.folder.md` for every file that may change. Read any deeper document named by a source file's `[DOC]` field.
3. Classify the change before editing:
   - Local logic only: update the source Header.
   - File membership or directory responsibility: also update the nearest `.folder.md`.
   - Package boundary, workflow, schema, deployment, or global constraint: also update the relevant architecture document and root map.
4. Implement the requested change without expanding scope.
5. Reconcile documentation immediately after code edits.
6. Verify headers, folder membership, links, status labels, formatting, type checks, tests, and build according to the affected scope.
7. Report which documentation layers changed and any planned capability that remains unimplemented.

## Source Header Contract

Add or maintain a leading comment in hand-written source files:

```ts
/**
 * [INPUT]: External values, imported contracts, or runtime dependencies
 * [OUTPUT]: Public functions, components, types, or side effects
 * [POS]: The file's role inside its nearest directory and package
 * [DOC]: docs/architecture/example.md
 *
 * [PROTOCOL]:
 * 1. Update this Header when the file's contract changes.
 * 2. Reconcile the nearest .folder.md after changing membership or responsibility.
 * 3. Update each [DOC] target when referenced behavior changes.
 */
```

Omit `[DOC]` when no deep document treats the file as a source of truth. Do not add headers to generated files, lockfiles, JSON, migrations, vendored assets, or framework-generated declarations such as `next-env.d.ts`.

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
- Record intentional differences from the DEEIX research baseline instead of silently rewriting that baseline.

## Completion Check

- Confirm every changed hand-written source file has an accurate Header.
- Confirm every add/move/delete is reflected in the nearest `.folder.md`.
- Confirm affected links and reciprocal `[DOC]` anchors resolve.
- Confirm root maps still match the package graph and deployment reality.
- Run `bun run format`, `bun run typecheck`, `bun run test`, and `bun run build` when their affected scope requires them.
