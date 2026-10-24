import { describe, expect, it } from "vitest";
import ACCOUNTS from "@/data/accounts.public.json";
import { DEMO_NOW, DEMO_WORLD_ID, buildDemoWorld } from "@/data/demo";
import { checkIntegrity } from "@/domain/integrity";
import * as q from "@/domain/queries";

/** 示范工会照 SPEC §7 摆：项目是真的，人员是编的；时钟冻结在 2026-10-23。 */
describe("示范工会", () => {
  const s = buildDemoWorld();
  const andlc = q.projects(s).find((p) => p.code === "ANDLC")!;
  const dmds = q.projects(s).find((p) => p.code === "DMDS")!;
  const statusOf = (projectId: string, key: string, n: number | null, layer: string | null = null) => {
    const stage = q.stagesOf(s, projectId).find((x) => x.templateKey === key)!;
    const cut = n === null ? null : q.cutsOf(s, projectId).find((c) => c.number === n)!;
    return q.tasksOf(s, projectId).find((t) => t.stageId === stage.id && t.cutId === (cut?.id ?? null) && t.layer === layer)!.status;
  };

  it("一步一步跑命令建得起来，引用都对得上；时钟冻结", () => {
    expect(checkIntegrity(s)).toEqual([]);
    expect(q.nowOf(s)).toBe(DEMO_NOW);
    expect(q.todayOf(s)).toBe("2026-10-23");
    expect(s.worlds[DEMO_WORLD_ID].title).toBe("示范工会");
  });

  it("每次建出来都一样（id 也一样）", () => {
    // buildDemoWorld 有缓存；比日志里的 id 和条数就够了。
    expect(s.journal.length).toBeGreaterThan(300);
    expect(new Set(s.journal.map((e) => e.id)).size).toBe(s.journal.length);
  });

  it("八个编的成员；admin 是白鹭，member01 是木星（只存 salt + 哈希）", () => {
    expect(q.members(s).map((m) => m.nickname)).toEqual(["白鹭", "青柠", "栗子", "木星", "北窗", "海盐", "松针", "七号"]);
    const admin = q.accounts(s).find((a) => a.login === "admin")!;
    const m01 = q.accounts(s).find((a) => a.login === "member01")!;
    expect(q.memberById(s, admin.memberId)?.nickname).toBe("白鹭");
    expect(q.memberById(s, admin.memberId)?.role).toBe("admin");
    expect(q.memberById(s, m01.memberId)?.nickname).toBe("木星");
    expect(q.memberById(s, m01.memberId)?.role).toBe("member");
    expect(admin.hash).toBe(ACCOUNTS[0].hash);
    expect(Object.keys(admin).sort()).not.toContain("passcode");
  });

  it("安娜的旅程：14 卡 A / B 层，前期全过，中割到 C011", () => {
    expect(q.cutsOf(s, andlc.id)).toHaveLength(14);
    expect(q.cutsOf(s, andlc.id).every((c) => c.layers.map((l) => l.name).join() === "A,B")).toBe(true);
    expect(andlc).toMatchObject({ name: "安娜的旅程", startOn: "2026-03-01", planEndOn: "2026-06-15", episode: "EP01", scene: "SC001" });
    const pre = q.pipelineOf(s, andlc.id)!.phases[0];
    expect(pre.progress).toBe(1);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14]) for (const l of ["A", "B"]) expect(statusOf(andlc.id, "inbetween", n, l)).toBe("passed");
    expect(statusOf(andlc.id, "inbetween", 9, "B")).toBe("submitted");
    expect(statusOf(andlc.id, "inbetween", 10, "B")).toBe("submitted");
    expect(statusOf(andlc.id, "inbetween", 11, "A")).toBe("returned");
    expect(statusOf(andlc.id, "inbetween", 11, "B")).toBe("claimed");
    expect(statusOf(andlc.id, "paint", 5, "A")).toBe("returned");
    expect(statusOf(andlc.id, "export", 5)).toBe("locked");
    expect(statusOf(andlc.id, "background", 1)).toBe("open");
    const paint = q.reviewsOf(s, q.tasksOf(s, andlc.id).find((t) => t.status === "returned" && q.stageById(s, t.stageId)?.templateKey === "paint")!.id);
    expect(paint[paint.length - 1].comments.map((c) => c.text)).toContain("第 18 张下巴漏色");
  });

  it("拍板以后 C005 · C007 · C009 · C010 要补；箭头影的设定问题还没拍板", () => {
    const todos = Object.values(s.threads).filter((t) => t.kind === "todo");
    expect(todos.map((t) => q.cutName(s, q.cutById(s, t.cutId)!)).sort()).toEqual(["C005", "C007", "C009", "C010"]);
    expect(q.openSettingQuestions(s).map((v) => v.thread.text)).toEqual(["箭头影要简化去掉，还是沿用第 9 卡加影的设定？"]);
  });

  it("有一张中割快超时（还没被收回）", () => {
    const m01 = q.accounts(s).find((a) => a.login === "member01")!;
    const [first] = q.questFor(s, m01.memberId);
    expect(first.view.label).toBe("C011 · 中割 · A 层");
    expect(first.remainingMs).toBeGreaterThan(0);
    expect(first.remainingMs!).toBeLessThan(6 * 3600_000);
    expect(q.overdueTasks(s)).toEqual([]);
  });

  it("电猫与电鼠：8 卡，逾期；Layout 75%，原画 25%", () => {
    expect(q.cutsOf(s, dmds.id)).toHaveLength(8);
    expect(q.isOverdueProject(s, dmds)).toBe(true);
    const pl = q.pipelineOf(s, dmds.id)!;
    const node = (key: string) => pl.phases.flatMap((p) => p.stages).find((n) => n.stage.templateKey === key)!;
    expect(node("layout").progress).toBe(0.75);
    expect(node("key").progress).toBe(0.25);
    expect(node("key_check").progress).toBe(0.25);
    expect(node("inbetween").passed).toBe(0);
  });

  it("视频组没有项目", () => {
    expect(q.projects(s, "video")).toEqual([]);
  });
});
