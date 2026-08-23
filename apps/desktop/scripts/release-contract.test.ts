/**
 * [INPUT]: Alpha 版本、Tag 与签名环境变量组合
 * [OUTPUT]: macOS 发行契约的回归测试
 * [POS]: release-contract 的纯规则测试
 * [DOC]: docs/architecture/release.md
 *
 * [PROTOCOL]:
 * 1. 文件契约变化时更新本 Header。
 * 2. 成员或职责变化时同步最近的 .folder.md。
 * 3. 行为变化时同步 [DOC] 指向的文档。
 */

import { describe, expect, it } from "vitest"
import {
  type ReleaseEnvironment,
  assertAlphaReleaseContract,
  collectAlphaReleaseContractErrors,
} from "./release-contract"

const completeEnvironment = {
  APPLE_API_ISSUER: "issuer",
  APPLE_API_KEY: "/tmp/AuthKey.p8",
  APPLE_API_KEY_ID: "key-id",
  CSC_KEY_PASSWORD: "password",
  CSC_LINK: "certificate",
} satisfies ReleaseEnvironment

describe("Alpha 发行契约", () => {
  it("接受版本、Tag 与签名环境一致的发行输入", () => {
    expect(() =>
      assertAlphaReleaseContract({
        desktopVersion: "0.1.0-alpha.1",
        environment: completeEnvironment,
        rootVersion: "0.1.0-alpha.1",
        tag: "v0.1.0-alpha.1",
      }),
    ).not.toThrow()
  })

  it("拒绝普通版本、错位 Tag 和不完整签名环境", () => {
    expect(
      collectAlphaReleaseContractErrors({
        desktopVersion: "0.1.0",
        environment: { CSC_LINK: "certificate" },
        rootVersion: "0.0.1",
        tag: "v0.1.0-alpha.2",
      }),
    ).toEqual([
      "桌面版本必须使用 x.y.z-alpha.n 格式，当前为 0.1.0。",
      "根包版本 0.0.1 与桌面包版本 0.1.0 不一致。",
      "发行 Tag v0.1.0-alpha.2 与桌面版本不一致；预期 v0.1.0。",
      "缺少正式签名或公证环境变量：CSC_KEY_PASSWORD、APPLE_API_KEY、APPLE_API_KEY_ID、APPLE_API_ISSUER。",
    ])
  })

  it("拒绝没有 Tag 的直接正式打包", () => {
    expect(
      collectAlphaReleaseContractErrors({
        desktopVersion: "0.1.0-alpha.1",
        environment: completeEnvironment,
        rootVersion: "0.1.0-alpha.1",
        tag: undefined,
      }),
    ).toContain("缺少发行 Tag；需要从 v0.1.0-alpha.1 触发。")
  })
})
