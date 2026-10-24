/**
 * 盘点的命令（SPEC §18.7 · §18.8 · §18.9）：开始 · 放进来 · 复查 · 写回 · 撤销 · 再盘点一次对比上一次。
 * 命令 → 变更 → 日志，每一步都查引用完整性；最后从日志重放一遍得到同一个世界。
 */
import { describe, expect, it } from "vitest";
import { buildDemoWorld } from "@/data/demo";
import { auditInputs, checkAudit, type AuditCheck } from "@/domain/audit/check";
import { compareAudits } from "@/domain/audit/compare";
import { deliveriesOf } from "@/domain/audit/deliveries";
import { writePlan } from "@/domain/audit/plan";
import { undoPreviewOf } from "@/domain/commands/audit";
import { replay } from "@/domain/dispatch";
import type { Id } from "@/domain/model";
import { DemoRunner, fixtureItems } from "./auditHelpers";

async function opened() {
  const d = new DemoRunner();
  const p = d.project("ANDLC");
  const a = d.run(d.admin, "audit.start", { projectId: p }).auditId;
  d.run(d.admin, "audit.add", { auditId: a, source: { kind: "folder", label: "EP01" }, items: await fixtureItems() });
  return { d, p, a };
}

const check = (d: DemoRunner, a: Id) => checkAudit(auditInputs(d.rm, a)!);
const byBase = (c: AuditCheck, base: string) => c.entries.find((e) => e.parsed.base === base)!;
const ids = (c: AuditCheck, base: string) => byBase(c, base).items.map((i) => i.id);

function taskOf(d: DemoRunner, p: Id, key: string, cut: number, layer: string | null = null) {
  const s = Object.values(d.state.stages).find((x) => x.projectId === p && x.templateKey === key)!;
  const c = Object.values(d.state.cuts).find((x) => x.projectId === p && x.number === cut && !x.archivedAt)!;
  return Object.values(d.state.tasks).find((t) => t.stageId === s.id && t.cutId === c.id && t.layer === layer && !t.extra)!;
}

/** 照 §18.10 复查：确认 3 条 · 不对 1 条 · 改归属 1 条 · 「对上了」一次全确认 · 「系统说交了没找到」标「确实没交」1 条 · 加一卡。 */
function reviewAll(d: DemoRunner, p: Id, a: Id) {
  let c = check(d, a);
  for (const base of ["ANDLC_EP01_SC001_CUT011_B_ANI_v01", "ANDLC_EP01_SC001_CUT001_BG_v01", "ANDLC_EP01_SC001_CUT009_B_ANI_v04"]) d.run(d.admin, "audit.review", { auditId: a, itemIds: ids(c, base), verdict: "ok" });
  d.run(d.admin, "audit.review", { auditId: a, itemIds: ids(c, "ANDLC_EP01_SC001_CUT010_A_ANM_v01"), verdict: "wrong", reason: "not_stage" });
  d.run(d.admin, "audit.review", { auditId: a, itemIds: ids(c, "ANDLC_EP01_SC001_CUT004_B_ANI"), verdict: "ok", place: { stageKey: "inbetween", layer: "B", version: 2 } });
  c = check(d, a);
  const matched = c.queue.filter((q) => q.bucket === "matched").flatMap((q) => q.entry!.items.map((i) => i.id));
  expect(matched.length).toBeGreaterThanOrEqual(7);
  d.run(d.admin, "audit.review", { auditId: a, itemIds: matched, verdict: "ok" });
  d.run(d.admin, "audit.decide", { auditId: a, taskId: taskOf(d, p, "layout", 4).id, verdict: "missing", text: "盘点：确实没交" });
  d.run(d.admin, "audit.review", { auditId: a, itemIds: ids(c, "ANDLC_EP01_SC001_CUT021_A_ANI_v01"), verdict: "add_cut" });
}

describe("开始 · 放进来", () => {
  it("管理员 · 审核员能盘点，成员不行；零日的项目先开工", async () => {
    const d = new DemoRunner();
    const p = d.project("ANDLC");
    const member = Object.values(d.state.members).find((m) => m.role === "member")!.id;
    const reviewer = Object.values(d.state.members).find((m) => m.role === "reviewer")!.id;
    const r = d.try(member, "audit.start", { projectId: p });
    expect(r.ok || r.error.key).toBe("audit_reviewers_only");
    expect(d.run(reviewer, "audit.start", { projectId: p }).auditId).toMatch(/^aud_/);
    const zero = Object.values(d.state.projects).find((x) => x.status === "zero")!.id;
    const z = d.try(d.admin, "audit.start", { projectId: zero });
    expect(z.ok || z.error.key).toBe("zero_not_started");
  });

  it("放进来时给每条一个「最可能的归属」；同一批再放一次不重复（按指纹）", async () => {
    const { d, a } = await opened();
    const items = Object.values(d.state.auditItems).filter((i) => i.auditId === a);
    expect(items).toHaveLength(30);
    expect(items.find((i) => i.name === "ANDLC_EP01_SC001_CUT001_H_v01.psd")!.guess).toMatchObject({ stageKey: "key", version: 1, layer: null });
    expect(items.find((i) => i.name === ".DS_Store")!.guess).toBeNull();
    d.run(d.admin, "audit.add", { auditId: a, source: { kind: "folder", label: "EP01" }, items: await fixtureItems() });
    expect(Object.values(d.state.auditItems).filter((i) => i.auditId === a)).toHaveLength(30);
    expect(d.state.audits[a].sources.map((s) => s.count)).toEqual([30, 0]);
  });

  it("步骤条：能离开再回来接着做（记下做到第几步）；只有 1–4 步", async () => {
    const { d, a } = await opened();
    d.run(d.admin, "audit.step", { auditId: a, step: 2, link: "https://example.com/drive/folder/EP01", keep: "full" });
    expect(d.state.audits[a]).toMatchObject({ step: 2, link: "https://example.com/drive/folder/EP01", keep: "full" });
    const bad = d.try(d.admin, "audit.step", { auditId: a, step: 5 });
    expect(bad.ok || bad.error.key).toBe("audit_step_bad");
  });

  it("这一批 ANI 都算 中割检修（只改还没复查的建议）", async () => {
    const { d, a } = await opened();
    let c = check(d, a);
    d.run(d.admin, "audit.review", { auditId: a, itemIds: ids(c, "ANDLC_EP01_SC001_CUT011_B_ANI_v01"), verdict: "skip" });
    d.run(d.admin, "audit.regroup", { auditId: a, code: "ANI", stageKey: "inbetween_check" });
    c = check(d, a);
    expect(byBase(c, "ANDLC_EP01_SC001_CUT009_B_ANI_v04").stage?.templateKey).toBe("inbetween_check");
    expect(byBase(c, "ANDLC_EP01_SC001_CUT011_B_ANI_v01").stage?.templateKey).toBe("inbetween");
  });
});

describe("复查（SPEC §18.7）", () => {
  it("被拒的原因走 code + 参数：不对 · 其他 要写一句；文件在别处要链接或一句话；确实没交要写意见", async () => {
    const { d, p, a } = await opened();
    const c = check(d, a);
    const w = d.try(d.admin, "audit.review", { auditId: a, itemIds: ids(c, "ANDLC_EP01_SC001_CUT010_A_ANM_v01"), verdict: "wrong", reason: "other" });
    expect(w.ok || w.error.key).toBe("audit_wrong_text");
    const e = d.try(d.admin, "audit.decide", { auditId: a, taskId: taskOf(d, p, "layout", 4).id, verdict: "elsewhere" });
    expect(e.ok || e.error.key).toBe("audit_elsewhere_need");
    const m = d.try(d.admin, "audit.decide", { auditId: a, taskId: taskOf(d, p, "layout", 4).id, verdict: "missing" });
    expect(m.ok || m.error.key).toBe("reopen_need_comment");
    const bad = d.try(d.admin, "audit.review", { auditId: a, itemIds: ids(c, "ANDLC_EP01_SC001_CUT004_B_ANI"), verdict: "ok", place: { stageKey: "inbetween", layer: "Z" } });
    expect(bad.ok || bad.error.key).toBe("audit_layer_missing");
  });

  it("改归属算确认；两个人分着复查（记下谁）；「文件在别处」算核实", async () => {
    const { d, p, a } = await opened();
    const reviewer = Object.values(d.state.members).find((m) => m.role === "reviewer")!.id;
    let c = check(d, a);
    d.run(d.admin, "audit.review", { auditId: a, itemIds: ids(c, "ANDLC_EP01_SC001_CUT004_B_ANI"), verdict: "ok", place: { stageKey: "inbetween", layer: "B", version: 2 } });
    // 示范里 10-02 那次已经核实过 C001–C010 的 Layout；C011 系统说交了、这次没找到
    d.run(reviewer, "audit.decide", { auditId: a, taskId: taskOf(d, p, "layout", 11).id, verdict: "elsewhere", link: "https://example.com/drive/folder/LO" });
    c = check(d, a);
    const e = byBase(c, "ANDLC_EP01_SC001_CUT004_B_ANI");
    expect(e.place).toMatchObject({ stageKey: "inbetween", layer: "B", version: 2 });
    expect(c.cellByTask.get(e.task!.id)!.outcome).toBe("matched");
    expect(e.review?.byMemberId).toBe(d.admin);
    expect(c.cellByTask.get(taskOf(d, p, "layout", 11).id)!.decision?.review?.byMemberId).toBe(reviewer);
    const plan = writePlan(c);
    expect(plan.verify.map((v) => v.task.id).sort()).toEqual([e.task!.id, taskOf(d, p, "layout", 11).id].sort());
  });
});

describe("写回 · 撤销（SPEC §18.8）", () => {
  it("写回清单的数字 → 写回：核实 · 补录（任务变通过、下游解锁、不记活力点）· 打回 · 加卡；项目动态里一条", async () => {
    const { d, p, a } = await opened();
    reviewAll(d, p, a);
    const plan = writePlan(check(d, a));
    // 核实：一次全确认的 7 条里有 5 条在 10-02 那次已经核实过了（不再记）+ 改归属的 1 条 = 3
    expect({ verify: plan.verify.length, backfill: plan.backfill.length, newer: plan.newer.length, redo: plan.redo.length, addCuts: plan.addCuts.length }).toEqual({ verify: 3, backfill: 3, newer: 1, redo: 1, addCuts: 1 });
    expect(plan.addCuts[0]).toMatchObject({ number: 21, suffix: "" });
    expect(plan.untouched.total).toBe(check(d, a).queue.length + 1 - 8 - 3 - 1 - 1);
    expect(writePlan(check(d, a), { newer: "ignore" }).backfill).toHaveLength(2);

    const ledger = Object.keys(d.state.ledger).length;
    const journal = d.state.journal.length;
    const ib9 = taskOf(d, p, "inbetween_check", 9);
    expect(ib9.status).toBe("locked");
    d.run(d.admin, "audit.write", { auditId: a });
    expect(d.state.journal.length).toBe(journal + 1);
    expect(d.state.journal[d.state.journal.length - 1].command).toBe("audit.write");
    expect(d.state.audits[a]).toMatchObject({ status: "written", step: 4, written: { counts: { verify: 3, backfill: 3, redo: 1, addCut: 1 } } });

    // 补录：一版「补录」的交付，任务通过；文件比系统新的记成新的一版（v04）
    const t11 = taskOf(d, p, "inbetween", 11, "B");
    expect(t11.status).toBe("passed");
    const subs11 = Object.values(d.state.submissions).filter((s) => s.taskId === t11.id && !s.archivedAt);
    expect(subs11.map((s) => [s.versionNo, !!s.backfill, s.fileName])).toEqual([[1, true, "ANDLC_EP01_SC001_CUT011_B_ANI_v01.clip"]]);
    const t9 = taskOf(d, p, "inbetween", 9, "B");
    expect(t9).toMatchObject({ status: "passed", versions: 4 });
    // 下游照常解锁：中割检修 C009（A · B 都通过了）
    expect(taskOf(d, p, "inbetween_check", 9).status).toBe("open");
    // 活力点默认不记
    expect(Object.keys(d.state.ledger).length).toBe(ledger);
    // 核实：那一版记「已核实」，状态不变
    const ib1 = taskOf(d, p, "inbetween", 1, "A");
    const sub = Object.values(d.state.submissions).find((s) => s.taskId === ib1.id)!;
    expect(sub.verified).toMatchObject({ auditId: a, byMemberId: d.admin });
    expect(ib1.status).toBe("passed");
    // 打回：确实没交 → 打回重做
    expect(taskOf(d, p, "layout", 4)).toMatchObject({ status: "returned", redo: true });
    // 加卡：C015
    expect(Object.values(d.state.cuts).filter((x) => x.projectId === p && !x.archivedAt).map((x) => x.number)).toContain(15);
    // 写回以后不能再复查
    const again = d.try(d.admin, "audit.review", { auditId: a, itemIds: ids(check(d, a), "ANDLC_EP01_SC001_CUT010_A_ANM_v01"), verdict: "skip" });
    expect(again.ok || again.error.key).toBe("audit_written");

    // 墙上的状态 · 还差多少
    const dv = deliveriesOf(d.rm, p)!;
    expect(dv.cellByTask.get(t9.id)!.mark).toBe("verified");
    expect(dv.cellByTask.get(t9.id)!.backfilled).toBe(true);
    expect(dv.cellByTask.get(ib1.id)!.mark).toBe("verified");
    expect(dv.cellByTask.get(taskOf(d, p, "layout", 4).id)!.mark).toBe("missing");
    const layout = dv.stages.find((s) => s.stage?.templateKey === "layout")!;
    expect(layout.due).toBe(15);
    expect(layout.verified + layout.pending + layout.nofile + layout.issue + layout.missing).toBe(15);
    expect(dv.total.due).toBe(dv.stages.reduce((n, s) => n + s.due, 0));
  });

  it("撤销：之后没人动过 → 整批退回到写回前；盘点回到第 4 步", async () => {
    const { d, p, a } = await opened();
    reviewAll(d, p, a);
    const before = structuredClone({ tasks: d.state.tasks, cuts: d.state.cuts });
    const verifiedBefore = Object.values(d.state.submissions).filter((s) => s.verified).length;
    d.run(d.admin, "audit.write", { auditId: a });
    expect(undoPreviewOf(d.rm, a)).toMatchObject({ kept: [] });
    d.run(d.admin, "audit.undo", { auditId: a });
    for (const [id, t] of Object.entries(before.tasks)) expect({ id, status: d.state.tasks[id].status, versions: d.state.tasks[id].versions, redo: !!d.state.tasks[id].redo }).toEqual({ id, status: t.status, versions: t.versions, redo: !!t.redo });
    expect(Object.values(d.state.cuts).filter((c) => !c.archivedAt).length).toBe(Object.values(before.cuts).filter((c) => !c.archivedAt).length);
    expect(Object.values(d.state.submissions).filter((s) => s.backfill && !s.archivedAt)).toHaveLength(0);
    expect(Object.values(d.state.submissions).filter((s) => s.verified)).toHaveLength(verifiedBefore);
    expect(d.state.audits[a]).toMatchObject({ status: "open", step: 4, written: null, undone: [{ kept: 0 }] });
    // 撤销以后还能再写回
    d.run(d.admin, "audit.write", { auditId: a });
    expect(d.state.audits[a].status).toBe("written");
  });

  it("撤销：有人动过的那几条列出来、不撤（解锁的下游已经被人接了 → 它上游那一条留着）", async () => {
    const { d, p, a } = await opened();
    reviewAll(d, p, a);
    d.run(d.admin, "audit.write", { auditId: a });
    const ib9 = taskOf(d, p, "inbetween_check", 9);
    const reviewer = Object.values(d.state.members).find((m) => m.role === "reviewer")!.id;
    d.run(d.admin, "task.assign", { taskId: ib9.id, memberId: reviewer });
    const pv = undoPreviewOf(d.rm, a)!;
    expect(pv.kept.map((u) => u.taskId)).toEqual([taskOf(d, p, "inbetween", 9, "B").id]);
    d.run(d.admin, "audit.undo", { auditId: a });
    expect(taskOf(d, p, "inbetween", 9, "B").status).toBe("passed");
    expect(taskOf(d, p, "inbetween_check", 9).status).toBe("claimed");
    expect(taskOf(d, p, "inbetween", 11, "B").status).toBe("claimed");
    expect(d.state.audits[a].undone).toEqual([expect.objectContaining({ kept: 1 })]);
  });

  it("活力点：勾了才按规则给做的人记（选人和质量系数）；外部名字不记", async () => {
    const { d, p, a } = await opened();
    const c = check(d, a);
    d.run(d.admin, "audit.review", { auditId: a, itemIds: ids(c, "ANDLC_EP01_SC001_CUT011_B_ANI_v01"), verdict: "ok" });
    d.run(d.admin, "audit.review", { auditId: a, itemIds: ids(c, "ANDLC_EP01_SC001_CUT001_BG_v01"), verdict: "ok" });
    const worker = Object.values(d.state.members).find((m) => m.role === "member")!.id;
    const ledger = Object.keys(d.state.ledger).length;
    d.run(d.admin, "audit.write", { auditId: a, person: { memberId: worker }, personByStage: { background: { name: "外面的场景老师" } }, points: true, quality: 1.2 });
    const added = Object.values(d.state.ledger).slice(ledger);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ memberId: worker, quality: 1.2, taskId: taskOf(d, p, "inbetween", 11, "B").id });
    expect(taskOf(d, p, "background", 1)).toMatchObject({ status: "passed", outsourced: true, outsourceName: "外面的场景老师" });
  });

  it("只有管理员能写回；没有确认过的写不了", async () => {
    const { d, a } = await opened();
    const reviewer = Object.values(d.state.members).find((m) => m.role === "reviewer")!.id;
    const r = d.try(reviewer, "audit.write", { auditId: a });
    expect(r.ok || r.error.key).toBe("admin_only");
    const e = d.try(d.admin, "audit.write", { auditId: a });
    expect(e.ok || e.error.key).toBe("audit_nothing");
  });
});

describe("再盘点一次 · 重放", () => {
  it("对比上一次：多了几个文件 · 几个不见了 · 几个版本更新了", async () => {
    const { d, p, a } = await opened();
    reviewAll(d, p, a);
    d.run(d.admin, "audit.write", { auditId: a });
    const b = d.run(d.admin, "audit.start", { projectId: p }).auditId;
    const items = (await fixtureItems()).filter((i) => !i.name.includes("CUT021") && !i.name.startsWith("IMG_"));
    items.push({ name: "ANDLC_EP01_SC001_CUT010_B_ANI_v06.clip", path: "EP01/ANI/SC001/CUT010/ANDLC_EP01_SC001_CUT010_B_ANI_v06.clip", origin: "file", size: 10 });
    items.push({ name: "ANDLC_EP01_SC001_CUT001_A_ANI_v02.png", path: "EP01/ANI/SC001/CUT001/ANDLC_EP01_SC001_CUT001_A_ANI_v02.png", origin: "file", size: 10 });
    d.run(d.admin, "audit.add", { auditId: b, source: { kind: "folder", label: "EP01" }, items });
    expect(compareAudits(d.rm, b)).toMatchObject({ prev: { id: a }, added: 2, gone: 2, updated: 1 });
  });

  it("命令 → 变更 → 日志：从示范的底把日志重放一遍，得到同一个世界", async () => {
    const { d, p, a } = await opened();
    reviewAll(d, p, a);
    d.run(d.admin, "audit.write", { auditId: a });
    d.run(d.admin, "audit.undo", { auditId: a });
    const base = buildDemoWorld();
    const entries = d.state.journal.slice(base.journal.length);
    const r = replay(base, entries);
    expect(r.skipped).toEqual([]);
    for (const t of ["audits", "auditItems", "tasks", "submissions", "cuts", "reviews", "ledger"] as const) expect(r.state[t]).toEqual(d.state[t]);
  });
});
