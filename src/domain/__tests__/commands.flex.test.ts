import { describe, expect, it } from "vitest";
import * as q from "@/domain/queries";
import { TestGuild } from "./helpers";

/** 一个项目：原画以前的都过了（原画可接）；中割已经派发、放出来了。 */
function setup() {
  const g = new TestGuild();
  const p = g.project(3, 4);
  const reviewer = g.member("审审", "reviewer");
  const a = g.member("小甲");
  const b = g.member("小乙");
  g.run(g.admin, "hub.dispatch", { hubStageId: g.stage(p, "key_check").id, rows: Object.values(g.state.tasks).filter((t) => t.stageId === g.stage(p, "inbetween").id).map((t) => ({ taskId: t.id, workload: t.workload })), release: "all" });
  g.run(g.admin, "hub.dispatch", { hubStageId: g.stage(p, "layout").id, rows: Object.values(g.state.tasks).filter((t) => t.stageId === g.stage(p, "key").id).map((t) => ({ taskId: t.id, workload: 2 })), release: "all" });
  return { g, p, reviewer, a, b };
}

describe("role.assign · role.unassign", () => {
  it("指派职位 = 自动报到（标「指派」，不自动配任务）；撤掉：因指派才报到的取消，自己报到的只去掉「指派」", () => {
    const { g, a, b } = setup();
    const e = g.run(g.admin, "role.assign", { memberId: a, group: "animation", stageKey: "key", skill: 0.2 }).enrollmentId;
    expect(g.state.enrollments[e]).toMatchObject({ memberId: a, stageKey: "key", skill: 0.2, origin: "assigned", assigned: true });
    expect(Object.values(g.state.tasks).some((t) => t.assigneeId === a)).toBe(false);
    expect(q.memberRoles(g.state, a).assigned.map((r) => r.name)).toEqual(["原画"]);
    expect(g.reject(g.admin, "role.assign", { memberId: a, group: "animation", stageKey: "key" })).toBe("小甲已经是这个职位了");
    g.run(g.admin, "role.unassign", { memberId: a, group: "animation", stageKey: "key" });
    expect(g.state.enrollments[e].archivedAt).not.toBeNull();
    // 自己报到过的：指派只是加个标记，撤掉以后还在
    g.run(b, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    g.run(g.admin, "role.assign", { memberId: b, group: "animation", stageKey: "inbetween" });
    g.run(g.admin, "role.unassign", { memberId: b, group: "animation", stageKey: "inbetween" });
    const own = Object.values(g.state.enrollments).find((x) => x.memberId === b && x.stageKey === "inbetween")!;
    expect(own).toMatchObject({ archivedAt: null, assigned: false, origin: "self" });
    expect(g.reject(g.admin, "role.unassign", { memberId: b, group: "animation", stageKey: "inbetween" })).toBe("小乙没有被指派这个职位");
    expect(g.reject(a, "role.assign", { memberId: a, group: "animation", stageKey: "key" })).toBe("只有管理员可以指派职位");
    expect(g.reject(g.admin, "role.assign", { memberId: a, group: "animation", stageKey: "nope" })).toBe("这个组里没有这个环节");
  });
});

describe("task.assign（一批）· 自己认领别的环节", () => {
  it("管理员把几卡一起派给一个人，任务单上写谁派的；成员认领别的环节自动加一条「自己认领」的报到", () => {
    const { g, p, a, b } = setup();
    const ids = [1, 2, 3].map((n) => g.task(p, "key", n).id);
    g.run(g.admin, "task.assign", { taskIds: ids, memberId: a });
    for (const id of ids) expect(g.state.tasks[id]).toMatchObject({ status: "claimed", assigneeId: a, assignedById: g.admin });
    expect(q.questFor(g.state, a)[0].assignedBy?.id).toBe(g.admin);
    expect(g.reject(g.admin, "task.assign", { taskIds: ids, memberId: b })).toMatch(/已经有人在做/);
    // 小乙没报到中割，直接认领一张
    const r = g.run(b, "task.claim", { stageKey: "inbetween", group: "animation" });
    expect(g.state.tasks[r.taskId].assigneeId).toBe(b);
    expect(g.state.enrollments[r.enrollmentId]).toMatchObject({ origin: "claimed", skill: 0, assigned: false });
    expect(q.memberRoles(g.state, b).own).toMatchObject([{ name: "中割", claimed: true }]);
    // 上限照旧（默认 2 张）
    g.run(b, "task.claim", { stageKey: "inbetween", group: "animation" });
    expect(g.reject(b, "task.claim", { stageKey: "inbetween", group: "animation" })).toBe("你手上的任务已经到上限了，先交掉一张再接");
  });
});

describe("stage.set_lock", () => {
  it("审核类环节默认只给指派的人；没被指派的认领被拒（中文原因），指派了就能接；管理员能放开", () => {
    const { g, p, a, b, reviewer } = setup();
    // 原画全过 → 原画监督可接
    g.passStage(p, "key", a, reviewer);
    const check = g.task(p, "key_check", 1);
    expect(check.status).toBe("open");
    expect(g.reject(b, "task.claim", { taskId: check.id })).toBe("这个环节只给指派的人，找管理员");
    expect(g.reject(b, "enroll.add", { group: "animation", stageKey: "key_check", skill: 0 })).toBe("这个环节只给指派的人，找管理员");
    expect(q.enrollOptions(g.state, b, "animation").find((o) => o.template.key === "key_check")).toMatchObject({ locked: true, lockedForMe: true });
    g.run(g.admin, "role.assign", { memberId: b, group: "animation", stageKey: "key_check" });
    g.run(b, "task.claim", { taskId: check.id });
    expect(g.state.tasks[check.id].assigneeId).toBe(b);
    // 中割默认不锁；锁上以后没指派的接不了
    g.run(g.admin, "stage.set_lock", { stageId: g.stage(p, "inbetween").id, locked: true });
    expect(g.reject(a, "task.claim", { taskId: g.task(p, "inbetween", 1, "A").id })).toBe("这个环节只给指派的人，找管理员");
    g.run(g.admin, "stage.set_lock", { stageId: g.stage(p, "inbetween").id, locked: false });
    g.run(a, "task.claim", { taskId: g.task(p, "inbetween", 1, "A").id });
    expect(g.reject(a, "stage.set_lock", { stageId: g.stage(p, "inbetween").id, locked: true })).toBe("只有管理员可以改环节设置");
  });
});

describe("stage.set_period · stage.set_rate", () => {
  it("改计划周期，排期里计划 / 实际 / 超出都对；下游开始早于上游结束只提醒", () => {
    const { g, p, a } = setup();
    const sched0 = q.scheduleOf(g.state, p)!;
    const ib0 = sched0.phases.flatMap((x) => x.rows).find((r) => r.stage.templateKey === "inbetween")!;
    expect(ib0.plan.custom).toBe(false);
    expect(ib0.warning).toBeNull();
    g.run(g.admin, "stage.set_period", { stageId: g.stage(p, "inbetween").id, startWeek: 2, weeks: 1 });
    g.run(a, "task.claim", { taskId: g.task(p, "inbetween", 1, "A").id });
    g.advance(24 * 14);
    const sched = q.scheduleOf(g.state, p)!;
    const ib = sched.phases.flatMap((x) => x.rows).find((r) => r.stage.templateKey === "inbetween")!;
    expect(ib.plan).toEqual({ start: 2, end: 2, custom: true });
    expect(ib.actual).toMatchObject({ start: 1, end: 3, done: false });
    expect(ib.overrun).toBe(1);
    expect(ib.warning).toMatch(/早于上游「清线」计划结束/);
    expect(sched.today).toBe(3);
    expect(g.reject(g.admin, "stage.set_period", { stageId: g.stage(p, "inbetween").id, startWeek: 0, weeks: 1 })).toMatch(/从第几周开始/);
    g.run(g.admin, "project.update", { projectId: p, cycleDays: 14 });
    expect(q.scheduleOf(g.state, p)!.today).toBe(2);
  });

  it("改 Tn / 时限系数 / 最短时限：只影响之后派出的任务", () => {
    const { g, p, a, b, reviewer } = setup();
    const first = g.task(p, "inbetween", 1, "A").id;
    g.run(a, "task.claim", { taskId: first });
    const due1 = g.state.tasks[first].dueAt!;
    g.run(g.admin, "stage.set_rate", { stageId: g.stage(p, "inbetween").id, tn: 3, deadlineFactor: 2, minDeadlineHours: 6 });
    expect(g.state.tasks[first].dueAt).toBe(due1);
    const second = g.task(p, "inbetween", 1, "B").id;
    g.run(b, "task.claim", { taskId: second });
    // 4 张 × 3 小时 × 2 = 24 小时
    expect(Date.parse(g.state.tasks[second].dueAt!) - Date.parse(g.now)).toBe(24 * 3600_000);
    // 活力点也按接的时候的 Tn：第一张 4 × 1.5 = 6 小时
    g.run(a, "task.submit", { taskId: first, note: "好了" });
    const r = g.run(reviewer, "task.review", { taskId: first, verdict: "pass", quality: 1 });
    expect(g.state.ledger[r.ledgerId]).toMatchObject({ hours: 6, points: 6 });
    expect(g.reject(g.admin, "stage.set_rate", { stageId: g.stage(p, "inbetween").id, tn: 0 })).toBe("Tn 要大于 0");
  });
});

describe("task.publish", () => {
  it("在分镜节点发一张修正挂在 C002、派给小乙、这一卡要等它做完：下游等它，通过以后解锁", () => {
    const { g, p, a, b, reviewer } = setup();
    // 原画 C002 还没人接（可接）
    const key2 = g.task(p, "key", 2);
    expect(key2.status).toBe("open");
    const cut2 = key2.cutId!;
    const sbNode = () => q.pipelineOf(g.state, p)!.phases[0].stages.find((s) => s.stage.templateKey === "storyboard")!;
    const before = { total: sbNode().total, progress: sbNode().progress };
    const fix = g.run(g.admin, "task.publish", { stageId: g.stage(p, "storyboard").id, kind: "fix", title: "C002 分镜加一个镜头", cutIds: [cut2], workload: 2, deadlineHours: 12, assigneeId: b, blocking: true }).taskId;
    expect(g.state.tasks[fix]).toMatchObject({ status: "claimed", assigneeId: b, assignedById: g.admin, cutId: cut2, extra: { kind: "fix", blocking: true, deadlineHours: 12 } });
    expect(Date.parse(g.state.tasks[fix].dueAt!) - Date.parse(g.now)).toBe(12 * 3600_000);
    expect(g.state.tasks[key2.id].status).toBe("locked");
    expect(g.state.tasks[g.task(p, "key", 1).id].status).toBe("open");
    // 网格：分镜那一格（项目级）右上角 1 件；时间线也有
    const grid = q.gridOf(g.state, p)!;
    expect(grid.projectCells.find((c) => c.stage.templateKey === "storyboard")!.extras).toHaveLength(1);
    expect(q.extrasOfStage(g.state, g.stage(p, "storyboard").id).map((t) => t.id)).toEqual([fix]);
    expect(q.taskView(g.state, g.state.tasks[fix])!.label).toBe("C002 · 分镜修正 · C002 分镜加一个镜头");
    // 新任务不算进流程的统计
    expect({ total: sbNode().total, progress: sbNode().progress }).toEqual(before);
    g.run(b, "task.submit", { taskId: fix, note: "加好了" });
    g.run(reviewer, "task.review", { taskId: fix, verdict: "pass", quality: 1 });
    expect(g.state.tasks[key2.id].status).toBe("open");
    void a;
  });

  it("不勾「要等它」就不挡；放出来让人认领；固定活力点；谁审默认环节的审核员", () => {
    const { g, p, a, b, reviewer } = setup();
    g.run(g.admin, "stage.set_reviewer", { stageId: g.stage(p, "art").id, memberId: reviewer });
    const t = g.run(g.admin, "task.publish", { stageId: g.stage(p, "art").id, kind: "extra", title: "补一张道具设定", fixedPoints: 6, deadlineHours: 48 }).taskId;
    expect(g.state.tasks[t]).toMatchObject({ status: "open", assigneeId: null, cutId: null, extra: { reviewerId: reviewer, fixedPoints: 6 } });
    // 自动配不配它，要点名认领
    expect(g.reject(a, "task.claim", { stageKey: "art", group: "animation" })).toBe("这个环节现在没有可接的任务");
    g.run(a, "task.claim", { taskId: t });
    expect(Date.parse(g.state.tasks[t].dueAt!) - Date.parse(g.now)).toBe(48 * 3600_000);
    g.run(a, "task.submit", { taskId: t, note: "画好了" });
    const other = g.member("别的审核", "reviewer");
    expect(g.reject(other, "task.review", { taskId: t, verdict: "pass", quality: 1 })).toBe("「补一张道具设定」由审审审核");
    const r = g.run(reviewer, "task.review", { taskId: t, verdict: "pass", quality: 1.2 });
    expect(g.state.ledger[r.ledgerId]).toMatchObject({ memberId: a, points: 7.2, hours: 0 });
    void b;
  });

  it("被拒时中文原因", () => {
    const { g, p, a, reviewer } = setup();
    const sb = g.stage(p, "storyboard").id;
    expect(g.reject(a, "task.publish", { stageId: sb, kind: "extra", title: "x", workload: 1 })).toBe("只有管理员和这个环节的审核员能发新任务");
    expect(g.reject(g.admin, "task.publish", { stageId: sb, kind: "extra", title: "x", workload: 0 })).toBe("工作量要大于 0");
    expect(g.reject(g.admin, "task.publish", { stageId: sb, kind: "fix", title: "x", workload: 1 })).toBe("修正要挂在一卡上");
    expect(g.reject(g.admin, "task.publish", { stageId: sb, kind: "extra", title: "x", workload: 1, blocking: true })).toBe("勾了「这一卡要等它做完」要选挂哪一卡");
    expect(g.reject(g.admin, "task.publish", { stageId: sb, kind: "extra", title: "", workload: 1 })).toMatch(/标题/);
    // 这个环节的审核员也能发
    g.run(g.admin, "stage.set_reviewer", { stageId: sb, memberId: reviewer });
    g.run(reviewer, "task.publish", { stageId: sb, kind: "setting", title: "照拍板补耳饰", cutIds: [g.task(p, "key", 1).cutId!, g.task(p, "key", 2).cutId!], workload: 1 });
  });
});
