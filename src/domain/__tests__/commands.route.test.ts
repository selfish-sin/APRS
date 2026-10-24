import { describe, expect, it } from "vitest";
import { buildDemoWorld } from "@/data/demo";
import * as q from "@/domain/queries";
import { TestGuild } from "./helpers";

/** 开局好的项目（零日 → 开工）：3 卡，A 层 4 张。 */
function started() {
  const g = new TestGuild();
  const a = g.member("小甲");
  const b = g.member("小乙");
  const r = g.member("审审", "reviewer");
  const p = g.run(g.admin, "project.draft", { template: "anim_standard", name: "路线测试片", code: "ROUT" }).projectId;
  g.run(g.admin, "project.set_structure", { projectId: p, structure: { episodes: 1, scenesPerEpisode: 1, cutsPerScene: 3, layers: ["A"], sheetsPerLayer: 4, secondsPerCut: 4 } });
  g.run(g.admin, "project.start", { projectId: p });
  return { g, a, b, r, p };
}

const statusOf = (route: q.StageRoute, key: string) => route.rows.find((x) => x.stage.templateKey === key)!.status;

describe("环节路线（SPEC §17.1）", () => {
  it("开工以后按顺序编号 1…N；只有第一批「可以开始」，其余「还没到」；现在在第 1 个", () => {
    const { g, p } = started();
    const route = q.stageRouteOf(g.state, p)!;
    expect(route.rows.map((x) => x.no)).toEqual(route.rows.map((_, i) => i + 1));
    expect(route.rows[0].stage.templateKey).toBe("plan");
    expect(route.rows.filter((x) => x.status === "ready").map((x) => x.stage.templateKey)).toEqual(["plan"]);
    expect(route.rows.slice(1).every((x) => x.status === "locked")).toBe(true);
    expect(route.current?.no).toBe(1);
    expect(route.phases.map((ph) => ph.phase)).toEqual(["pre", "mid", "post"]);
    expect(route.phases[0].started).toBe(false);
    // 没人管的环节写「缺人」
    expect(route.rows[0].alerts.noPeople).toBe(true);
  });

  it("走一步亮一步：进行中 → 待验收 → 验收 = 已结束 ✓，下游亮起来", () => {
    const { g, a, r, p } = started();
    // 报到完马上配一张（策划只有一张）
    g.run(a, "enroll.add", { group: "animation", stageKey: "plan", skill: 0 });
    expect(g.task(p, "plan").assigneeId).toBe(a);
    expect(statusOf(q.stageRouteOf(g.state, p)!, "plan")).toBe("active");
    g.run(a, "task.submit", { taskId: g.task(p, "plan").id, note: "策划" });
    let route = q.stageRouteOf(g.state, p)!;
    expect(route.rows[0].counts).toMatchObject({ total: 1, submitted: 1 });
    expect(route.rows[0].alerts.pending).toBe(1);
    g.run(r, "task.review", { taskId: g.task(p, "plan").id, verdict: "pass", quality: 1 });
    route = q.stageRouteOf(g.state, p)!;
    expect(statusOf(route, "plan")).toBe("review");
    expect(statusOf(route, "script")).toBe("ready");
    expect(statusOf(route, "art")).toBe("ready");
    expect(route.rows[0].people.map((x) => x.name)).toEqual(["小甲"]);
    g.run(g.admin, "stage.accept", { stageId: g.stage(p, "plan").id });
    route = q.stageRouteOf(g.state, p)!;
    expect(statusOf(route, "plan")).toBe("done");
    expect(route.phases[0].done).toBe(1);
  });

  it("示范工会：五种状态都有；「星期三的猫」前 2 个已结束、第 3 个进行中、其余还没到（美术设计接在策划后面，可以开始）", () => {
    const s = buildDemoWorld();
    const cat = q.projects(s).find((x) => x.code === "XQSM")!;
    const route = q.stageRouteOf(s, cat.id)!;
    expect(route.rows.slice(0, 3).map((x) => [x.no, x.stage.templateKey, x.status])).toEqual([
      [1, "plan", "done"],
      [2, "script", "done"],
      [3, "storyboard", "active"],
    ]);
    expect(statusOf(route, "art")).toBe("ready");
    expect(route.rows.filter((x) => !["plan", "script", "storyboard", "art"].includes(x.stage.templateKey)).every((x) => x.status === "locked")).toBe(true);
    expect(route.current?.stage.templateKey).toBe("storyboard");
    const all = new Set(q.projects(s).flatMap((p) => q.stageRouteOf(s, p.id)?.rows.map((x) => x.status) ?? []));
    expect(Array.from(all).sort()).toEqual([...q.ROUTE_STATUS].sort());
  });
});

describe("stage.assign · stage.unassign（环节页的人员，SPEC §17.2）", () => {
  it("指派一个成员 → 进人员表、马上报到（标「指派」），路线上头像多一个；外部名字也行；撤掉就拿掉", () => {
    const { g, a, b, p } = started();
    const plan = g.stage(p, "plan");
    g.run(g.admin, "stage.assign", { stageId: plan.id, memberId: a });
    expect(q.stageRouteOf(g.state, p)!.rows[0].people.map((x) => x.name)).toEqual(["小甲"]);
    expect(Object.values(g.state.enrollments).find((e) => e.memberId === a && e.stageKey === "plan")).toMatchObject({ assigned: true, origin: "assigned" });
    expect(g.reject(g.admin, "stage.assign", { stageId: plan.id, memberId: a })).toBe("小甲 已经在这个环节上了");
    g.run(g.admin, "stage.assign", { stageId: plan.id, name: "外包老王" });
    expect(q.stageRouteOf(g.state, p)!.rows[0].people).toEqual([
      { memberId: a, name: "小甲", external: false },
      { memberId: null, name: "外包老王", external: true },
    ]);
    expect(g.reject(g.admin, "stage.assign", { stageId: plan.id })).toBe("选一个成员，或者写一个外部名字");
    expect(g.reject(a, "stage.assign", { stageId: plan.id, memberId: b })).toMatch(/管理员/);
    g.run(g.admin, "stage.unassign", { stageId: plan.id, memberId: a });
    expect(Object.values(g.state.enrollments).some((e) => e.memberId === a && e.stageKey === "plan" && !e.archivedAt)).toBe(false);
    expect(q.stageRouteOf(g.state, p)!.rows[0].people.map((x) => x.name)).toEqual(["外包老王"]);
    expect(g.reject(g.admin, "stage.unassign", { stageId: plan.id, memberId: b })).toBe("小乙 不在这个环节的人员里");
    // 后来插进来的环节在人员表里没有职位：按环节名加一个
    const x = g.run(g.admin, "stage.add", { projectId: p, name: "剧本检查", phase: "pre", kind: "review", grain: "project", unit: "item", tn: 1, afterKey: "script" }).stageId;
    g.run(g.admin, "stage.assign", { stageId: x, memberId: b });
    expect(g.state.projects[p].staff!.find((pos) => pos.stageKeys.includes(g.state.stages[x].templateKey))).toMatchObject({ custom: { name: "剧本检查" }, people: [{ memberId: b }] });
  });
});

describe("插环节 · 改环节 · 一起延期", () => {
  it("在两个环节之间插一个：编号顺延；下游原来「可接」的回到「还没到」；新环节接着上游「可以开始」", () => {
    const { g, a, r, p } = started();
    g.passStage(p, "plan", a, r);
    expect(g.task(p, "script").status).toBe("open");
    const before = q.stageRouteOf(g.state, p)!;
    const scriptNo = before.rows.find((x) => x.stage.templateKey === "script")!.no;
    const id = g.run(g.admin, "stage.add", { projectId: p, name: "策划评审", phase: "pre", kind: "review", grain: "project", unit: "item", tn: 1, afterKey: "plan" }).stageId;
    const route = q.stageRouteOf(g.state, p)!;
    expect(route.total).toBe(before.total + 1);
    const added = route.rows.find((x) => x.stage.id === id)!;
    expect(added.no).toBe(2);
    expect(added.status).toBe("ready");
    expect(route.rows.find((x) => x.stage.templateKey === "script")!.no).toBe(scriptNo + 1);
    expect(g.task(p, "script").status).toBe("locked");
    expect(q.stagePageOf(g.state, p, g.state.stages[id].templateKey)!.upstream.map((s) => s.templateKey)).toEqual(["plan"]);
  });

  it("stage.update 改交到哪（文件夹）；task.extend 一次延几张", () => {
    const { g, a, r, p } = started();
    const plan = g.stage(p, "plan");
    g.run(g.admin, "stage.update", { stageId: plan.id, folder: "策划案" });
    expect(g.state.stages[plan.id].folder).toBe("策划案");
    expect(g.reject(g.admin, "stage.update", { stageId: plan.id, folder: "a/b".repeat(20) })).toMatch(/交到哪/);
    g.passStage(p, "plan", a, r);
    g.passStage(p, "script", a, r);
    g.passStage(p, "art", a, r);
    g.passStage(p, "storyboard", a, r);
    g.run(a, "enroll.add", { group: "animation", stageKey: "layout", skill: 0, maxActive: 9 });
    const ids = [1, 2].map((n) => g.task(p, "layout", n).id);
    // 报到时配了 C001，再接 C002
    expect(g.state.tasks[ids[0]].assigneeId).toBe(a);
    g.run(a, "task.claim", { taskId: ids[1] });
    const due = ids.map((id) => g.state.tasks[id].dueAt!);
    g.run(g.admin, "task.extend", { taskIds: ids, hours: 24, reason: "分镜改了一版" });
    ids.forEach((id, i) => expect(Date.parse(g.state.tasks[id].dueAt!) - Date.parse(due[i])).toBe(24 * 3600_000));
    expect(g.reject(g.admin, "task.extend", { taskIds: [], hours: 1, reason: "x" })).toBe("先选要延期的任务");
    const page = q.stagePageOf(g.state, p, "layout")!;
    expect(page.people.find((x) => x.memberId === a)).toMatchObject({ how: "claimed", inHand: 2, passed: 0 });
    expect(q.stageActivityOf(g.state, g.stage(p, "layout").id).map((x) => x.entry.command)).toContain("task.extend");
  });
});

describe("环节页（SPEC §17.2）", () => {
  it("上一个 / 下一个、上游 / 下游、派发、人员（手上几张、通过几张、准时率）、审核员、动态", () => {
    const { g, a, r, p } = started();
    g.run(g.admin, "stage.set_reviewer", { stageId: g.stage(p, "plan").id, memberId: r });
    g.passStage(p, "plan", a, r);
    const page = q.stagePageOf(g.state, p, "plan")!;
    expect(page.row.no).toBe(1);
    expect(page.prev).toBeNull();
    expect(page.next?.stage.templateKey).toBe("script");
    expect(page.downstream.map((s) => s.templateKey).sort()).toEqual(["art", "script"]);
    expect(page.tasks).toHaveLength(1);
    expect(page.tasks[0].latest?.versionNo).toBe(1);
    expect(page.tasks[0].review?.quality).toBe(1);
    expect(page.reviewer?.id).toBe(r);
    expect(page.people).toEqual([expect.objectContaining({ memberId: a, how: "claimed", inHand: 0, passed: 1, onTime: 1 })]);
    const act = q.stageActivityOf(g.state, g.stage(p, "plan").id).map((x) => x.entry.command);
    expect(act).toEqual(expect.arrayContaining(["enroll.add", "task.submit", "task.review", "stage.set_reviewer"]));
    expect(q.stagePageOf(g.state, p, "nope")).toBeNull();
    // 枢纽环节：派发下游管到哪
    expect(q.stagePageOf(g.state, p, "storyboard")!.hubScope.map((s) => s.templateKey)).toContain("layout");
  });
});

describe("project.set_setup_step（开局向导，SPEC §17.4）", () => {
  it("存做到第几步；只有 1–5；开工以后不能再改", () => {
    const g = new TestGuild();
    const p = g.run(g.admin, "project.draft", { template: "anim_standard", name: "向导测试", code: "WIZ" }).projectId;
    expect(g.state.projects[p].setupStep ?? null).toBeNull();
    g.run(g.admin, "project.set_setup_step", { projectId: p, step: 3 });
    expect(g.state.projects[p].setupStep).toBe(3);
    expect(g.reject(g.admin, "project.set_setup_step", { projectId: p, step: 6 })).toBe("开局向导只有 1–5 步");
    g.run(g.admin, "project.set_structure", { projectId: p, structure: { cutsPerScene: 2 } });
    g.run(g.admin, "project.start", { projectId: p });
    expect(g.reject(g.admin, "project.set_setup_step", { projectId: p, step: 5 })).toBe("项目已经开工了，不用再走开局向导");
  });
});
