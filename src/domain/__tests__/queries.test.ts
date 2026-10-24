import { describe, expect, it } from "vitest";
import * as q from "@/domain/queries";
import { TestGuild } from "./helpers";

function flowing() {
  const g = new TestGuild();
  const p = g.project(2, 4);
  const reviewer = g.member("审审", "reviewer");
  const worker = g.member("小甲");
  const helper = g.member("小乙");
  g.run(g.admin, "hub.dispatch", {
    hubStageId: g.stage(p, "key_check").id,
    rows: Object.values(g.state.tasks).filter((t) => t.stageId === g.stage(p, "inbetween").id).map((t) => ({ taskId: t.id, workload: t.workload })),
    release: "all",
  });
  return { g, p, reviewer, worker, helper };
}

describe("pipelineOf", () => {
  it("三段进度 + 每个环节的计数", () => {
    const { g, p, worker } = flowing();
    g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    const pl = q.pipelineOf(g.state, p)!;
    expect(pl.phases.map((x) => x.phase)).toEqual(["pre", "mid", "post"]);
    const mid = pl.phases[1];
    const node = mid.stages.find((s) => s.stage.templateKey === "inbetween")!;
    expect(node.counts).toMatchObject({ open: 3, claimed: 1, locked: 0 });
    expect(node.state).toBe("active");
    expect(node.enrolled).toBe(1);
    expect(pl.phases[0].stages[0].state).toBe("open");
    expect(pl.phases[2].state).toBe("locked");
    expect(pl.cuts).toBe(2);
    expect(q.pipelineOf(g.state, "prj_nope")).toBeNull();
  });
});

describe("gridOf", () => {
  it("卡 × 环节；每层一个小格；筛选只看我 / 待审 / 卡住的", () => {
    const { g, p, worker, reviewer } = flowing();
    const { taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    const grid = q.gridOf(g.state, p, "all", worker)!;
    expect(grid.rows.map((r) => r.code)).toEqual(["C001", "C002"]);
    expect(grid.projectCells.map((c) => c.stage.templateKey)).toEqual(["plan", "script", "storyboard", "art", "color_design", "sound", "final"]);
    const cell = grid.rows[0].cells.find((c) => c.stage.templateKey === "inbetween")!;
    expect(cell.tasks.map((t) => t.task.layer)).toEqual(["A", "B"]);
    expect(cell.status).toBe("claimed");
    expect(q.gridOf(g.state, p, "mine", worker)!.rows.map((r) => r.code)).toEqual(["C001"]);
    expect(q.gridOf(g.state, p, "review", worker)!.rows).toHaveLength(0);
    g.run(worker, "task.submit", { taskId, note: "v1" });
    expect(q.gridOf(g.state, p, "review", worker)!.rows.map((r) => r.code)).toEqual(["C001"]);
    g.run(reviewer, "task.review", { taskId, verdict: "return", comments: [{ text: "改一下" }] });
    const stuck = q.gridOf(g.state, p, "stuck", worker)!;
    expect(stuck.rows.map((r) => r.code)).toEqual(["C001"]);
    expect(stuck.hidden).toBe(1);
    expect(q.cellStatus([])).toBeNull();
  });
});

describe("questFor · indicatorOf", () => {
  it("任务单：收什么、交到哪个文件夹、规范文件名、奖励、倒计时", () => {
    const { g, worker } = flowing();
    g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0.2 });
    const [quest] = q.questFor(g.state, worker);
    expect(quest.view.label).toBe("C001 · 中割 · A 层");
    expect(quest.indicator.deliver).toMatchObject({ folder: "/EP01/ANI/SC001/CUT001/", fileName: "TEST_EP01_SC001_CUT001_A_ANI_v01", version: 1 });
    expect(quest.indicator.receive.from.map((f) => f.stage.templateKey)).toEqual(["clean"]);
    expect(quest.indicator.receive.from[0].tasks.map((t) => t.task.layer)).toEqual(["A"]);
    expect(quest.indicator.handTo.stages.map((s) => s.stage.templateKey)).toEqual(["inbetween_check"]);
    // 1.5 × 4 ×（1 + 0.2）= 7.2
    expect(quest.reward).toBe(7.2);
    expect(quest.countdown?.text).toBe("还剩 9 小时 0 分");
    expect(q.indicatorOf(g.state, "tsk_nope")).toBeNull();
  });

  it("退回的排在前面，带上意见；待审的不算倒计时", () => {
    const { g, worker, reviewer } = flowing();
    const first = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 }).taskId;
    const second = g.run(worker, "task.claim", {}).taskId;
    g.run(worker, "task.submit", { taskId: second, note: "x" });
    g.run(reviewer, "task.review", { taskId: second, verdict: "return", comments: [{ text: "第 3 张" }] });
    g.run(worker, "task.submit", { taskId: first, note: "y" });
    const quests = q.questFor(g.state, worker);
    expect(quests.map((x) => x.view.task.id)).toEqual([second, first]);
    expect(quests[0].lastReturn?.comments[0].text).toBe("第 3 张");
    expect(quests[1].countdown).toBeNull();
  });

  it("拍板以后要补的显示在任务单上", () => {
    const { g, p, worker } = flowing();
    g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    const cut1 = Object.values(g.state.cuts).find((c) => c.projectId === p && c.number === 1)!;
    g.run(g.admin, "ruling.make", { projectId: p, question: "耳饰？", decision: "补耳饰", cutIds: [cut1.id], stageKey: "inbetween" });
    expect(q.questFor(g.state, worker)[0].indicator.todos.map((t) => t.text)).toEqual(["要补：补耳饰"]);
  });
});

describe("reviewQueue", () => {
  it("我能审的，等得最久的在前；自己交的不在里面", () => {
    const { g, worker, helper, reviewer } = flowing();
    const a = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 }).taskId;
    const b = g.run(helper, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 }).taskId;
    g.run(helper, "task.submit", { taskId: b, note: "先交" });
    g.advance(2);
    g.run(worker, "task.submit", { taskId: a, note: "后交" });
    const queue = q.reviewQueue(g.state, reviewer);
    expect(queue.map((x) => x.view.task.id)).toEqual([b, a]);
    expect(queue[0].waitingMs).toBe(2 * 3600_000);
    expect(q.reviewQueue(g.state, worker)).toEqual([]);
    expect(q.canReview(g.state, worker, g.state.tasks[a]).reason).toBe("只有审核员和管理员可以审核");
    expect(q.pendingReviewCount(g.state)).toBe(2);
  });
});

describe("growthOf · collaboratorsOf", () => {
  it("Lv、经验、本周活力点、准时率、主环节、加入天数", () => {
    const { g, worker, reviewer } = flowing();
    const t = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0.5 }).taskId;
    g.run(worker, "task.submit", { taskId: t, note: "x" });
    g.run(reviewer, "task.review", { taskId: t, verdict: "pass", quality: 1.2 });
    const t2 = g.run(worker, "task.claim", {}).taskId;
    g.advance(20);
    g.run(worker, "task.submit", { taskId: t2, note: "晚了" });
    g.run(reviewer, "task.review", { taskId: t2, verdict: "pass", quality: 1 });
    const growth = q.growthOf(g.state, worker)!;
    // 1.5 × 4 × 1.5 × 1.2 = 10.8；1.5 × 4 × 1.5 × 1 = 9
    expect(growth.points).toBe(19.8);
    expect(growth.level).toMatchObject({ level: 2, floor: 10, next: 30 });
    expect(growth.onTime).toMatchObject({ onTime: 1, total: 2, rate: 0.5 });
    expect(growth.mainStage).toMatchObject({ key: "inbetween", count: 2 });
    expect(growth.ledger[0].points).toBe(9);
    expect(growth.joinedDays).toBe(1);
    expect(growth.weekPoints).toBe(19.8);
  });

  it("合作过：在同一卡上做过事的人", () => {
    const { g, worker, helper, reviewer } = flowing();
    g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    g.run(helper, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    // worker 拿 C001 A，helper 拿 C001 B
    expect(q.collaboratorsOf(g.state, worker).map((c) => [c.member.id, c.cuts])).toEqual([[helper, 1]]);
    expect(q.collaboratorsOf(g.state, reviewer)).toEqual([]);
  });
});

describe("timelineOfCut", () => {
  it("接 · 交 · 审（意见逐条）· 提问和回复 · 拍板要补，按时间倒着排", () => {
    const { g, p, worker, reviewer } = flowing();
    const cut1 = Object.values(g.state.cuts).find((c) => c.projectId === p && c.number === 1)!;
    const t = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 }).taskId;
    g.advance(1);
    g.run(worker, "task.submit", { taskId: t, note: "v1" });
    g.advance(1);
    g.run(reviewer, "task.review", { taskId: t, verdict: "return", comments: [{ layer: "A", sheets: "5", tag: "漏轨目", text: "第 5 张漏了轨目" }] });
    g.advance(1);
    g.run(worker, "thread.open", { subjectType: "task", subjectId: t, kind: "ask", askStageKey: "key", text: "轨目怎么读？" });
    g.advance(1);
    g.run(g.admin, "ruling.make", { projectId: p, question: "耳饰？", decision: "补耳饰", cutIds: [cut1.id] });
    const items = q.timelineOfCut(g.state, cut1.id);
    expect(items.map((i) => i.kind)).toEqual(["thread", "thread", "review", "submit", "claim", "dispatch", "dispatch"]);
    expect(items[0].text).toBe("要补：补耳饰");
    expect(items[2].review?.comments[0]).toMatchObject({ sheets: "5", tag: "漏轨目" });
    expect(items[4].text).toBe("小甲 接了 中割 A 层");
    expect(q.timelineOfCut(g.state, "cut_nope")).toEqual([]);
  });
});

describe("inboxOf", () => {
  it("退回的 · 被问到的 · 要补的", () => {
    const { g, p, worker, helper, reviewer } = flowing();
    const t = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 }).taskId;
    g.run(worker, "task.submit", { taskId: t, note: "v1" });
    g.run(reviewer, "task.review", { taskId: t, verdict: "return", comments: [{ text: "改" }] });
    g.run(helper, "thread.open", { subjectType: "task", subjectId: t, kind: "ask", askMemberId: worker, text: "这张你改好了吗？" });
    const cut1 = Object.values(g.state.cuts).find((c) => c.projectId === p && c.number === 1)!;
    g.run(g.admin, "ruling.make", { projectId: p, question: "q", decision: "补", cutIds: [cut1.id], stageKey: "inbetween" });
    const inbox = q.inboxOf(g.state, worker);
    expect(inbox.returned).toHaveLength(1);
    expect(inbox.asked.map((a) => a.thread.text)).toEqual(["这张你改好了吗？"]);
    expect(inbox.todos.map((a) => a.where)).toEqual(["测试项目 · C001"]);
    expect(inbox.total).toBe(3);
    expect(q.inboxOf(g.state, helper).total).toBe(0);
  });

  it("问某个环节：报到了这个环节、在这一卡做过这个环节的人看得到", () => {
    const { g, p, worker, helper } = flowing();
    g.passStage(p, "plan", helper, g.admin);
    g.run(helper, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    g.run(worker, "thread.open", { subjectType: "project", subjectId: p, kind: "ask", askStageKey: "plan", text: "策划案在哪？" });
    expect(q.inboxOf(g.state, helper).asked).toHaveLength(1);
    expect(q.inboxOf(g.state, g.admin).asked).toHaveLength(0);
  });
});

describe("feedOf", () => {
  it("把日志说成人话，最近的在前", () => {
    const { g, worker } = flowing();
    g.advance(1);
    g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    const feed = q.feedOf(g.state, 3);
    expect(feed[0].text).toBe("小甲 报到了「中割」，拿到 TEST C001 · 中割 · A 层");
    expect(feed[1].text).toMatch(/派发了 4 张任务/);
  });
});

describe("enrollOptions · dispatchPlan · estimateOf", () => {
  it("报到页：每个环节几张可接、几个人报到、我报到没有", () => {
    const { g, worker } = flowing();
    g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    const opts = q.enrollOptions(g.state, worker, "animation");
    const ib = opts.find((o) => o.template.key === "inbetween")!;
    expect(ib).toMatchObject({ open: 3, enrolled: 1, active: 1, tn: 1.5, per: 1 });
    expect(ib.mine?.skill).toBe(0);
    expect(opts.find((o) => o.template.key === "plan")!.open).toBe(1);
    expect(q.enrollOptions(g.state, null, "video").every((o) => o.open === 0)).toBe(true);
  });

  it("枢纽派发：管到下一个枢纽为止；估几个人几天", () => {
    const { g, p } = flowing();
    const plan = q.dispatchPlan(g.state, g.stage(p, "key_check").id)!;
    expect(plan.scopes.map((s) => s.stage.templateKey)).toEqual(["clean", "inbetween"]);
    expect(plan.scopes[0].direct).toBe(true);
    expect(plan.scopes[1].direct).toBe(false);
    expect(plan.scopes[1].rows.every((r) => r.editable)).toBe(true);
    const layout = q.dispatchPlan(g.state, g.stage(p, "layout").id)!;
    expect(layout.scopes.map((s) => s.stage.templateKey)).toEqual(["key", "background"]);
    const sb = q.dispatchPlan(g.state, g.stage(p, "storyboard").id)!;
    expect(sb.scopes.map((s) => s.stage.templateKey)).toEqual(["layout", "sound"]);
    expect(q.dispatchPlan(g.state, g.stage(p, "key").id)).toBeNull();
    expect(q.estimateOf(48, 2, 10)).toEqual({ hours: 48, days: 6, peopleByPlan: 2 });
    expect(q.estimateOf(0, 0, 0)).toEqual({ hours: 0, days: 0, peopleByPlan: null });
  });
});

describe("overdueTasks · isStuck", () => {
  it("过了时限还在手上的（打开时要收回的）", () => {
    const { g, worker } = flowing();
    const t = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 }).taskId;
    expect(q.overdueTasks(g.state)).toEqual([]);
    g.advance(8);
    expect(q.isStuck(g.state, g.state.tasks[t])).toBe(true);
    expect(q.overdueTasks(g.state)).toEqual([]);
    g.advance(2);
    expect(q.overdueTasks(g.state).map((x) => x.id)).toEqual([t]);
    g.run(worker, "task.expire", { taskId: t });
    expect(q.overdueTasks(g.state)).toEqual([]);
  });
});
