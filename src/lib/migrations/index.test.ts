import { describe, expect, it } from "vitest";
import { MIGRATIONS, WORLD_FORMAT, WORLD_FORMAT_VERSION, migrateWorldFile, migrationReasonZh } from "./index";

const ENTRY = {
  id: "jnl_1",
  seq: 400,
  worldId: "wld_demo",
  accountId: "acc_admin",
  actorMemberId: "mem_admin",
  command: "thread.open",
  payload: {},
  changes: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  worldAt: "2026-10-01T00:00:00.000Z",
};

describe("信封升级", () => {
  it("每个旧版本都有升级函数", () => {
    for (let v = 1; v < WORLD_FORMAT_VERSION; v += 1) expect(MIGRATIONS[v], `migration ${v} → ${v + 1}`).toBeTypeOf("function");
  });

  it("现在的信封原样通过", () => {
    const file = { format: WORLD_FORMAT, formatVersion: WORLD_FORMAT_VERSION, base: "demo", worldId: "wld_x", journal: [ENTRY], savedAt: "2026-10-01T00:00:00.000Z" };
    const m = migrateWorldFile(file);
    expect(m.ok && m.file).toEqual(file);
    expect(m.ok && m.from).toBe("current");
  });

  it("更新的版本不猜，直接说读不了", () => {
    const m = migrateWorldFile({ format: WORLD_FORMAT, formatVersion: WORLD_FORMAT_VERSION + 1, base: "demo", worldId: "w", journal: [] });
    expect(m).toEqual({ ok: false, reason: `newer_than_app_${WORLD_FORMAT_VERSION + 1}` });
  });

  it("缺东西、记录坏了都拒", () => {
    expect(migrateWorldFile({ format: WORLD_FORMAT, formatVersion: 1, base: "x", worldId: "w", journal: [] })).toEqual({ ok: false, reason: "bad_base" });
    expect(migrateWorldFile({ format: WORLD_FORMAT, formatVersion: 1, base: "empty", worldId: "w", journal: [{ bad: true }] })).toEqual({ ok: false, reason: "bad_journal_entry" });
    expect(migrateWorldFile({ format: WORLD_FORMAT, formatVersion: 1, base: "empty", journal: [] })).toEqual({ ok: false, reason: "no_world_id" });
    expect(migrateWorldFile(null)).toEqual({ ok: false, reason: "not_an_object" });
  });

  it("每个原因都有一句中文", () => {
    for (const r of ["not_an_object", "not_a_world_file", "newer_than_app_3", "bad_journal_entry", "no_journal", "no_world_id", "bad_base", "whatever"]) {
      expect(migrationReasonZh(r)).toMatch(/。$/);
    }
  });
});
