/**
 * 盘点第一层（SPEC §18.4 · §18.5）：读名字以后和系统里记的对一遍。一张表一张表地测：
 *   流程代码 → 环节 · 每种问题 · 几种格式合成一版 / 同一版两个文件 · 五种结果 · 只是信息的提示 · 总结行 · 复查队列的顺序 · 粘贴。
 * 用的是示范工会的「安娜的旅程」和 tests/fixtures/audit 的假文件夹。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { auditInputs, checkAudit, guessPlace, nameContext, projectFacts, QUEUE_BUCKETS, type AuditCheck, type AuditEntry } from "@/domain/audit/check";
import { parseName } from "@/domain/audit/names";
import type { Id } from "@/domain/model";
import { DemoRunner, fixtureItems, fixturePaste } from "./auditHelpers";

let d: DemoRunner;
let andlc: Id;
let auditId: Id;
let c: AuditCheck;

const entry = (base: string): AuditEntry => {
  const e = c.entries.find((x) => x.parsed.base === base);
  if (!e) throw new Error(`no entry ${base}`);
  return e;
};
const codes = (base: string) => Array.from(new Set(entry(base).issues.map((i) => i.code))).sort();

beforeAll(async () => {
  d = new DemoRunner();
  andlc = d.project("ANDLC");
  auditId = d.run(d.admin, "audit.start", { projectId: andlc }).auditId;
  d.run(d.admin, "audit.add", { auditId, source: { kind: "folder", label: "EP01" }, items: await fixtureItems() });
  c = checkAudit(auditInputs(d.rm, auditId)!);
});

describe("流程代码 → 环节（SPEC §18.4，两条规则）", () => {
  const guess = (name: string) => {
    const f = projectFacts(d.rm, andlc)!;
    return guessPlace(f, parseName(name, nameContext(f))).stageKey;
  };

  it("一个代码只对应一个环节的直接对上（LO → Layout · CLN → 清线 · BG → 场景绘制）", () => {
    expect(guess("ANDLC_EP01_SC001_CUT004_LO_v01.clip")).toBe("layout");
    expect(guess("ANDLC_EP01_SC001_CUT004_A_CLN_v01.png")).toBe("clean");
    expect(guess("ANDLC_EP01_SC001_CUT004_BG_v01.png")).toBe("background");
  });

  it("① 系统里有一版的规范文件名和它完全一样（同卡 · 同层 · 同代码 · 同版本）→ 就归那一版的环节（几个都一样取最前的）", () => {
    // H = 原画 / 原画监督：两个都有 C005 的 v01，取最前的原画
    expect(guess("ANDLC_EP01_SC001_CUT005_H_v01.psd")).toBe("key");
    // ANI 有层 = 中割 / 上色：中割 C003 A 有 v02
    expect(guess("ANDLC_EP01_SC001_CUT003_A_ANI_v02.clip")).toBe("inbetween");
    // ANI 没层 = 中割检修 / 输出上色文件 / 上色检查：输出上色文件 C005 有 v01，中割检修 C005 也有 v01 → 取最前的中割检修
    expect(guess("ANDLC_EP01_SC001_CUT005_ANI_v01.png")).toBe("inbetween_check");
  });

  it("①' 没有同名的，但这一格已经有更早的版本 → 当那个环节的新一版（文件比系统新）", () => {
    // C012 A 中割通过在 v01，文件是 v03 → 中割（不是还没碰过的上色）
    expect(guess("ANDLC_EP01_SC001_CUT012_A_ANI_v03.png")).toBe("inbetween");
    // C009 B 中割交到 v03（等审），文件 v04
    expect(guess("ANDLC_EP01_SC001_CUT009_B_ANI_v04.png")).toBe("inbetween");
  });

  it("② 找不到同名的：取这一卡还没通过的、最早的那个；都通过了就给最后一个", () => {
    // C011 B 中割在做（没交过）→ 中割
    expect(guess("ANDLC_EP01_SC001_CUT011_B_ANI_v01.clip")).toBe("inbetween");
    // C012 A：系统里一个 ANI 环节都没有这一格的版本时 → 这一卡没通过的最早那个：中割（C012 A 已经通过）→ 上色
    expect(guess("ANDLC_EP01_SC001_CUT012_A_ANI.png")).toBe("paint");
    // H 的 v09：原画 · 原画监督都通过了 → 最后一个
    expect(guess("ANDLC_EP01_SC001_CUT005_H_v09.psd")).toBe("key_check");
  });

  it("不是这个项目的 · 认不出的：不给归属", () => {
    const f = projectFacts(d.rm, andlc)!;
    expect(guessPlace(f, parseName("DMDS_EP01_SC001_CUT002_A_ANI_v01.png", nameContext(f))).stageKey).toBeNull();
    expect(guessPlace(f, parseName(".DS_Store", nameContext(f))).stageKey).toBeNull();
  });
});

describe("每种问题至少一个例子（SPEC §18.5）", () => {
  const table: [string, string[]][] = [
    ["ANLDC_EP01_SC001_CUT002_H_v01", ["project_typo"]],
    ["ANDLC_EP01_SC001_CUT3_LO_v01", ["no_pad"]],
    ["andlc_ep01_sc001_cut005_a_ani_v01", ["case"]],
    ["ANDLC_EP01_SC001_CUT010_A_ANM_v01", ["unknown_code"]],
    ["ANDLC_EP01_SC001_CUT006_AB_ANI_v01", ["no_layer", "unknown_layer"]],
    ["ANDLC_EP01_CUT003_SC001_A_ANI_v02", ["order"]],
    ["ANDLC_EP01_SC001_CUT004_B_ANI", ["missing"]],
    ["ANDLC_EP01_SC001_CUT021_A_ANI_v01", ["no_cut"]],
    ["ANDLC_EP01_SC001_CUT001_C_ANI_v01", ["no_layer"]],
    ["ANDLC_EP01_SC001_CUT005_LO_v01", ["wrong_folder"]],
    ["ANDLC_EP01_SC001_CUT006_H_v01", ["wrong_folder_code"]],
    ["ANDLC_EP01_SC001_CUT014_A_ANI_v01", ["duplicate"]],
    ["ANDLC_EP01_SC001_CUT014_A_ANI_v01第一次修改后", ["duplicate", "version_note"]],
  ];
  for (const [base, want] of table) it(base, () => expect(codes(base)).toEqual(want));

  it("每条问题带「建议改成」的参数（界面拼一句人话）", () => {
    expect(entry("ANLDC_EP01_SC001_CUT002_H_v01").issues[0]).toEqual({ code: "project_typo", params: { got: "ANLDC", want: "ANDLC" } });
    expect(entry("ANDLC_EP01_SC001_CUT3_LO_v01").issues[0]).toEqual({ code: "no_pad", params: { got: "CUT3", want: "CUT003" } });
    expect(entry("ANDLC_EP01_SC001_CUT010_A_ANM_v01").issues[0]).toEqual({ code: "unknown_code", params: { got: "ANM", want: "ANI" } });
    expect(entry("ANDLC_EP01_SC001_CUT021_A_ANI_v01").issues[0]).toEqual({ code: "no_cut", params: { cut: "CUT021", total: 14 } });
    expect(entry("ANDLC_EP01_SC001_CUT005_LO_v01").issues[0]).toEqual({ code: "wrong_folder", params: { got: "CUT005", folder: "EP01/LO/SC001/CUT004/", want: "/EP01/LO/SC001/CUT005/" } });
    expect(entry("ANDLC_EP01_SC001_CUT014_A_ANI_v01第一次修改后").issues).toContainEqual({ code: "version_note", params: { note: "第一次修改后", want: "v02" } });
  });

  it("不是这个项目的单独一组、不参与统计；认不出的归「认不出」", () => {
    expect(c.foreign.map((e) => e.parsed.base)).toEqual(["DMDS_EP01_SC001_CUT002_A_ANI_v01"]);
    expect(c.unknown.map((e) => e.primary.name).sort()).toEqual([".DS_Store", "IMG_0001.png", "readme.txt"]);
  });
});

describe("几种格式合成一版 · 同一版两个文件（SPEC §18.5 补充）", () => {
  it("名字一样只是扩展名不同（.clip + .rar · .zip + 里面的 .png）：合成一版，不算问题", () => {
    expect(entry("ANDLC_EP01_SC001_CUT001_A_ANI_v01").formats.sort()).toEqual(["clip", "rar"]);
    expect(entry("ANDLC_EP01_SC001_CUT001_A_ANI_v01").issues).toEqual([]);
    expect(entry("ANDLC_EP01_SC001_CUT002_A_ANI_v01").formats.sort()).toEqual(["png", "zip"]);
  });

  it("名字不同、读出来是同一版（v01 和 v01第一次修改后）：两个都标「同一版有两个文件」；复查选了一个算数，另一个就不算了", () => {
    const r = new DemoRunner();
    const p = r.project("ANDLC");
    const a = r.run(r.admin, "audit.start", { projectId: p }).auditId;
    r.run(r.admin, "audit.add", {
      auditId: a,
      source: { kind: "paste" },
      items: ["ANDLC_EP01_SC001_CUT014_A_ANI_v01.clip", "ANDLC_EP01_SC001_CUT014_A_ANI_v01第一次修改后.clip"].map((name) => ({ name, origin: "paste" as const })),
    });
    let ch = checkAudit(auditInputs(r.rm, a)!);
    expect(ch.entries.every((e) => e.issues.some((i) => i.code === "duplicate"))).toBe(true);
    const later = ch.entries.find((e) => e.parsed.note)!;
    r.run(r.admin, "audit.review", { auditId: a, itemIds: later.items.map((i) => i.id), verdict: "ok" });
    ch = checkAudit(auditInputs(r.rm, a)!);
    const cell = ch.cellByTask.get(later.task!.id)!;
    expect(cell.top?.parsed.note).toBe("第一次修改后");
    expect(ch.entries.find((e) => !e.parsed.note)!.superseded).toBe(true);
    expect(cell.top!.issues.map((i) => i.code)).toEqual(["version_note"]);
  });
});

describe("和系统里记的对一遍：五种结果（SPEC §18.5 那张表）", () => {
  const outcome = (base: string) => c.cellByTask.get(entry(base).task!.id)!.outcome;
  it("对上了 · 有文件系统没记 · 文件比系统新", () => {
    expect(outcome("ANDLC_EP01_SC001_CUT001_LO_v01")).toBe("matched");
    expect(outcome("ANDLC_EP01_SC001_CUT011_B_ANI_v01")).toBe("unrecorded");
    expect(outcome("ANDLC_EP01_SC001_CUT001_BG_v01")).toBe("unrecorded");
    expect(outcome("ANDLC_EP01_SC001_CUT009_B_ANI_v04")).toBe("newer");
    // 同一格更早的那版是「旧版本」
    expect(entry("ANDLC_EP01_SC001_CUT009_B_ANI_v01").outcome).toBe("older");
  });

  it("系统说交了、没找到文件 · 缺（只看这次盘点里有文件的环节）", () => {
    const f = c.facts;
    const layout = f.stageByKey.get("layout")!;
    const bg = f.stageByKey.get("background")!;
    const cut4 = f.cuts.find((x) => x.number === 4)!;
    const cell = (stageId: Id) => c.cells.find((x) => x.stage.id === stageId && x.cut?.id === cut4.id)!;
    expect(cell(layout.id)).toMatchObject({ outcome: "nofile", inScope: true });
    expect(cell(bg.id)).toMatchObject({ outcome: "missing", inScope: true });
    // 原画监督这次一个文件都没有：不算「没找到」
    const kc = f.stageByKey.get("key_check")!;
    expect(cell(kc.id)).toMatchObject({ outcome: "nofile", inScope: false });
  });
});

describe("文件里读出来的信息（只显示，不算错）", () => {
  const hints = (base: string) => entry(base).hints.map((h) => h.code).sort();
  it("时长和卡表差得多 · 顶层文件夹", () => {
    expect(entry("ANDLC_EP01_SC001_CUT001_LO_v01").hints).toEqual(
      expect.arrayContaining([
        { code: "folders", params: { names: "原画 · 修线 · 动画 · 标注" } },
        { code: "duration", params: { file: "6.0", table: 5 } },
      ])
    );
  });
  it("画布大小和同一批大多数不一样 · 版本跳号 · 压缩包里面看不了 · zip 里几个文件", () => {
    expect(entry("ANDLC_EP01_SC001_CUT011_B_ANI_v01").hints).toContainEqual({ code: "canvas", params: { got: "2560×1440", most: "1920×1080" } });
    expect(entry("ANDLC_EP01_SC001_CUT009_B_ANI_v04").hints).toContainEqual({ code: "version_gap", params: { have: "v01 v04", missing: "v02 v03" } });
    expect(hints("ANDLC_EP01_SC001_CUT001_A_ANI_v01")).toContain("archive_closed");
    expect(entry("ANDLC_EP01_SC001_CUT002_A_ANI_v01").hints).toContainEqual({ code: "zip_inside", params: { n: 2 } });
    expect(entry("ANDLC_EP01_SC001_CUT011_B_ANI_v01").issues).toEqual([]);
  });
});

describe("总结行 · 复查队列", () => {
  it("读了 · 认出 · 对上 · 有文件系统没记 · 系统说交了没找到 · 文件比系统新 · 有问题 · 不是这个项目的 · 认不出", () => {
    expect(c.summary).toEqual({ read: 30, recognized: 26, matched: 15, unrecorded: 3, nofile: 68, newer: 1, missing: 39, issues: 13, foreign: 1, unknown: 3 });
  });

  it("队列顺序：有问题的 → 有文件系统没记的 → 系统说交了没找到的 → 文件比系统新的 → 对上了的", () => {
    const order = c.queue.map((q) => QUEUE_BUCKETS.indexOf(q.bucket));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(c.queue.filter((q) => q.bucket === "issue").length).toBe(13 + 3);
    expect(c.queue.filter((q) => q.bucket === "unrecorded").map((q) => q.entry!.parsed.base)).toEqual(["ANDLC_EP01_SC001_CUT011_B_ANI_v01", "ANDLC_EP01_SC001_CUT001_BG_v01"]);
    expect(c.queue.filter((q) => q.bucket === "nofile").length).toBe(68);
    expect(c.queue.filter((q) => q.bucket === "newer").map((q) => q.entry!.parsed.base)).toEqual(["ANDLC_EP01_SC001_CUT009_B_ANI_v04"]);
    expect(c.queue.filter((q) => q.bucket === "matched").length).toBe(7);
  });

  it("粘贴 10 行的文件名列表（混着大小、日期）：认出 9 条，只有名字", () => {
    const items = fixturePaste();
    expect(items).toHaveLength(9);
    const r = new DemoRunner();
    const a = r.run(r.admin, "audit.start", { projectId: r.project("ANDLC") }).auditId;
    r.run(r.admin, "audit.add", { auditId: a, source: { kind: "paste" }, items });
    const ch = checkAudit(auditInputs(r.rm, a)!);
    expect(ch.summary.read).toBe(9);
    expect(ch.summary.recognized).toBe(9);
    expect(ch.entries.every((e) => !e.primary.thumb && e.primary.origin === "paste")).toBe(true);
  });
});
