import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import ACCOUNTS from "@/data/accounts.public.json";
import { hashPasscode, makePasscode, newSalt, passcodeProblem, sha256Hex, sha256HexSync, verifyPasscode } from "./passcode";

describe("口令", () => {
  it("纯 JS 的 SHA-256 和 WebCrypto 一样", async () => {
    for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "中文口令：工会", "x".repeat(1000)]) {
      const node = createHash("sha256").update(text).digest("hex");
      expect(sha256HexSync(text)).toBe(node);
      expect(await sha256Hex(text)).toBe(node);
    }
  });

  it("sha256(salt + \":\" + 口令)；对的过、错的不过", async () => {
    const { salt, hash } = await makePasscode("right-one");
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toBe(await hashPasscode(salt, "right-one"));
    expect(await verifyPasscode({ salt, hash }, "right-one")).toBe(true);
    expect(await verifyPasscode({ salt, hash }, "wrong-one")).toBe(false);
    expect(await verifyPasscode({ salt, hash }, "")).toBe(false);
    expect(newSalt()).not.toBe(newSalt());
  });

  it("预建的两个账号只有 salt 和哈希", () => {
    expect(ACCOUNTS.map((a) => a.login)).toEqual(["admin", "member01"]);
    for (const a of ACCOUNTS) {
      expect(Object.keys(a).sort()).toEqual(["displayName", "hash", "login", "role", "salt"]);
      expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  // 口令原文只在环境变量里（不进仓库）；没设时跳过。
  const pass = { admin: process.env.ARPS_PASS_ADMIN, member01: process.env.ARPS_PASS_MEMBER };
  it.skipIf(!pass.admin || !pass.member01)("环境变量里的口令能对上两个账号", async () => {
    for (const a of ACCOUNTS) expect(await verifyPasscode(a, pass[a.login as "admin"]!)).toBe(true);
  });

  it("口令的规矩", () => {
    expect(passcodeProblem("12345")).toBe("口令至少 6 位");
    expect(passcodeProblem("123456", "123457")).toBe("两次输的口令不一样");
    expect(passcodeProblem("123456", "123456")).toBeNull();
  });
});
