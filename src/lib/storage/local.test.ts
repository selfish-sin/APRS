import { describe, expect, it } from "vitest";
import { DEMO_WORLD_ID, buildDemoWorld } from "@/data/demo";
import { dispatch } from "@/domain/dispatch";
import type { JournalEntry, WorldState } from "@/domain/model";
import * as q from "@/domain/queries";
import { WORLD_FORMAT, WORLD_FORMAT_VERSION } from "@/lib/migrations";
import { ownJournal, rebuildWorld } from "@/lib/worlds";
import { KEY_PREFIX, MemoryStorage, WORLDS_KEY, measureUsage, worldBackupKey, worldKey } from "./keys";
import { backupWorldKey, buildExport, buildWorldFile, daysSince, exportFileName, markBackedUp, parseImport, readIndex, readWorld, saveWorld, setCurrentWorld } from "./local";

const NOW = "2026-10-23T10:00:00.000Z";

function demo() {
  const base = buildDemoWorld();
  const admin = q.accounts(base).find((a) => a.login === "admin")!;
  const m01 = q.accounts(base).find((a) => a.login === "member01")!;
  return { base, admin, m01, session: { worldId: DEMO_WORLD_ID, accountId: m01.id, memberId: m01.memberId } };
}

/** 在示范工会上真的跑几步。 */
function someSteps(): { state: WorldState; journal: JournalEntry[] } {
  const { base, m01 } = demo();
  let state = base;
  const actor = { worldId: DEMO_WORLD_ID, accountId: m01.id, actorMemberId: m01.memberId };
  const quest = q.questFor(state, m01.memberId)[0];
  for (const [name, input] of [
    ["task.submit", { taskId: quest.view.task.id, link: "https://feishu.example.com/drive/x", note: "照轨目重做了" }],
    ["thread.open", { subjectType: "task", subjectId: quest.view.task.id, kind: "comment", text: "交了，麻烦看一下" }],
  ] as const) {
    const r = dispatch(state, actor, name, input as never);
    if (!r.ok) throw new Error(r.error.message);
    state = r.state;
  }
  return { state, journal: ownJournal(state, "demo") };
}

describe("键", () => {
  it("全部以 arps: 开头，每个工会一个键", () => {
    expect(WORLDS_KEY.startsWith(KEY_PREFIX)).toBe(true);
    expect(worldKey("wld_x")).toBe("arps:w:wld_x");
    expect(worldBackupKey("wld_x")).toBe("arps:w:wld_x:bak");
  });

  it("读不到或者是乱码时，目录是空的", () => {
    const s = new MemoryStorage();
    expect(readIndex(s)).toEqual({ schema: 1, currentWorldId: null, worlds: [] });
    s.setItem(WORLDS_KEY, "{not json");
    expect(readIndex(s).worlds).toEqual([]);
  });
});

describe("saveWorld / readWorld", () => {
  it("存下底之后的日志和谁登录着；目录里记一行", () => {
    const s = new MemoryStorage();
    const { session } = demo();
    const { journal } = someSteps();
    const r = saveWorld(s, { worldId: DEMO_WORLD_ID, base: "demo", title: "示范工会", journal, session, skipped: [] }, NOW);
    expect(r.ok).toBe(true);
    const back = readWorld(s, DEMO_WORLD_ID);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.file).toMatchObject({ format: WORLD_FORMAT, formatVersion: WORLD_FORMAT_VERSION, base: "demo", session, savedAt: NOW });
    expect(back.file.journal).toEqual(journal);
    expect(readIndex(s)).toMatchObject({ currentWorldId: DEMO_WORLD_ID, worlds: [{ id: DEMO_WORLD_ID, title: "示范工会", kind: "demo", steps: 2, lastBackupAt: null }] });
    setCurrentWorld(s, null);
    expect(readIndex(s).currentWorldId).toBeNull();
    expect(readWorld(s, "wld_none")).toEqual({ ok: false, reason: "missing" });
  });

  it("存不上时不抛错，返回原因（界面要显示）", () => {
    const s = new MemoryStorage();
    s.setItem = () => {
      const e = new Error("quota");
      e.name = "QuotaExceededError";
      throw e;
    };
    const { session } = demo();
    const r = saveWorld(s, { worldId: DEMO_WORLD_ID, base: "demo", title: "x", journal: [], session, skipped: [] }, NOW);
    expect(r.ok).toBe(false);
  });

  it("重放：刷新以后和刚才一样", () => {
    const { state, journal } = someSteps();
    const back = rebuildWorld("demo", DEMO_WORLD_ID, journal);
    expect(back.skipped).toEqual([]);
    expect(back.state.tasks).toEqual(state.tasks);
    expect(back.state.threads).toEqual(state.threads);
  });

  it("对不上的条目留着，不丢", () => {
    const { journal } = someSteps();
    const broken = { ...journal[0], changes: journal[0].changes.map((c) => (c.op === "update" ? { ...c, expectVersion: 999 } : c)) } as JournalEntry;
    const back = rebuildWorld("demo", DEMO_WORLD_ID, [broken, ...journal.slice(1)]);
    expect(back.skipped.map((x) => x.reason)).toEqual(["conflict"]);
  });
});

describe("导出 / 导入", () => {
  it("导出的文件 = 存的信封 + 时间和版本；导回来一模一样", () => {
    const { session } = demo();
    const { state, journal } = someSteps();
    const file = buildExport(buildWorldFile({ worldId: DEMO_WORLD_ID, base: "demo", title: "示范工会", journal, session, skipped: [] }, NOW), NOW, "abc123");
    expect(file).toMatchObject({ exportedAt: NOW, build: "abc123" });
    const parsed = parseImport(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.journal).toEqual(journal);
    const back = rebuildWorld(parsed.file.base, parsed.file.worldId, parsed.file.journal);
    expect(back.state.submissions).toEqual(state.submissions);
    expect(exportFileName("示范工会", DEMO_WORLD_ID, NOW)).toBe("arps-示范工会-2026-10-23-10-00.json");
  });

  it("不是备份文件就说清楚", () => {
    expect(parseImport("not json")).toEqual({ ok: false, reason: "not_a_world_file" });
    expect(parseImport(JSON.stringify({ format: "some-other-app-world", formatVersion: 1 }))).toEqual({ ok: false, reason: "not_a_world_file" });
  });

  it("替换之前先留一份 :bak；记下备份时间", () => {
    const s = new MemoryStorage();
    const { session } = demo();
    saveWorld(s, { worldId: DEMO_WORLD_ID, base: "demo", title: "示范工会", journal: [], session, skipped: [] }, NOW);
    expect(backupWorldKey(s, DEMO_WORLD_ID)).toBe(true);
    expect(s.getItem(worldBackupKey(DEMO_WORLD_ID))).toBe(s.getItem(worldKey(DEMO_WORLD_ID)));
    markBackedUp(s, DEMO_WORLD_ID, NOW);
    expect(readIndex(s).worlds[0].lastBackupAt).toBe(NOW);
    expect(daysSince(NOW, "2026-10-26T10:00:00.000Z")).toBe(3);
    expect(daysSince(null, NOW)).toBeNull();
    expect(measureUsage(s).usedChars).toBeGreaterThan(0);
  });
});
