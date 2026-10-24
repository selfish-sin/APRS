import { describe, expect, it } from "vitest";
import { TestGuild, WORLD } from "./helpers";

/** 一个铺到中割可接的项目：原画监督派发了中割。 */
function ready(n = 2, sheets = 4) {
  const g = new TestGuild();
  const p = g.project(n, sheets);
  const hub = g.stage(p, "key_check");
  const rows = Object.values(g.state.tasks)
    .filter((t) => t.stageId === g.stage(p, "inbetween").id)
    .map((t) => ({ taskId: t.id, workload: t.workload }));
  g.run(g.admin, "hub.dispatch", { hubStageId: hub.id, rows, release: "all" });
  const reviewer = g.member("审审", "reviewer");
  const worker = g.member("小甲");
  return { g, p, reviewer, worker };
}

describe("enroll.add", () => {
  it("报到 = 立刻按卡号顺序配一张", () => {
    const { g, p, worker } = ready();
    const r = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0.2 });
    expect(r.taskId).toBe(g.task(p, "inbetween", 1, "A").id);
    expect(g.state.tasks[r.taskId]).toMatchObject({ status: "claimed", assigneeId: worker, claimedAt: g.now });
    // 4 张 × 1.5 小时 × 1.5 = 9 小时
    expect(Date.parse(g.state.tasks[r.taskId].dueAt!) - Date.parse(g.now)).toBe(9 * 3600_000);
  });

  it("再报到一次只改熟练度和上限，还会再配一张（不超过上限）", () => {
    const { g, worker } = ready();
    g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0, maxActive: 1 });
    const again = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0.5, maxActive: 1 });
    expect(again.taskId).toBeUndefined();
    const e = Object.values(g.state.enrollments).filter((x) => x.memberId === worker);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ skill: 0.5, maxActive: 1 });
  });

  it("没有可接的也能报到；熟练度和环节要对", () => {
    const g = new TestGuild();
    const m = g.member("小甲");
    const r = g.run(m, "enroll.add", { group: "animation", stageKey: "paint", skill: 0 });
    expect(r.taskId).toBeUndefined();
    expect(g.reject(m, "enroll.add", { group: "animation", stageKey: "nope", skill: 0 })).toBe("这个组里没有这个环节");
    expect(g.reject(m, "enroll.add", { group: "animation", stageKey: "paint", skill: 0.3 as 0.2 })).toMatch(/熟练度/);
    const other = g.member("小乙");
    expect(g.reject(m, "enroll.add", { group: "animation", stageKey: "paint", skill: 0, memberId: other })).toBe("只有管理员可以替别人报到");
    g.run(g.admin, "enroll.add", { group: "animation", stageKey: "paint", skill: 0, memberId: other });
    expect(Object.values(g.state.enrollments).some((e) => e.memberId === other)).toBe(true);
  });
});

describe("enroll.remove", () => {
  it("取消报到，手上的任务不动", () => {
    const { g, worker } = ready();
    const { enrollmentId, taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    g.run(worker, "enroll.remove", { enrollmentId });
    expect(g.state.enrollments[enrollmentId].archivedAt).not.toBeNull();
    expect(g.state.tasks[taskId].status).toBe("claimed");
    const other = g.member("小乙");
    const e2 = g.run(other, "enroll.add", { group: "animation", stageKey: "clean", skill: 0 }).enrollmentId;
    expect(g.reject(worker, "enroll.remove", { enrollmentId: e2 })).toBe("只能取消自己的报到");
  });
});

describe("task.claim", () => {
  it("「接任务」再配一张；到上限就拒", () => {
    const { g, worker } = ready();
    g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    const second = g.run(worker, "task.claim", {});
    expect(g.state.tasks[second.taskId].status).toBe("claimed");
    expect(g.reject(worker, "task.claim", {})).toBe("你手上的任务已经到上限了，先交掉一张再接");
  });

  it("指定一张：没报到也能认领（第一次认领自动报到，标「自己认领」），锁住的不能接", () => {
    const { g, p, worker } = ready();
    const t = g.task(p, "inbetween", 2, "B");
    const r = g.run(worker, "task.claim", { taskId: t.id });
    expect(g.state.tasks[t.id].assigneeId).toBe(worker);
    expect(g.state.enrollments[r.enrollmentId]).toMatchObject({ memberId: worker, stageKey: "inbetween", skill: 0, origin: "claimed", assigned: false });
    const locked = g.task(p, "paint", 1, "A");
    g.run(worker, "enroll.add", { group: "animation", stageKey: "paint", skill: 0 });
    expect(g.reject(worker, "task.claim", { taskId: locked.id })).toMatch(/上游还没完/);
  });

  it("没报到 / 没有可接的，给中文原因", () => {
    const { g, worker } = ready();
    expect(g.reject(worker, "task.claim", {})).toBe("你还没有报到任何环节，先去报到");
    g.run(worker, "enroll.add", { group: "animation", stageKey: "export", skill: 0 });
    expect(g.reject(worker, "task.claim", {})).toBe("你报到的环节现在都没有可接的任务，等上游放出来再来");
  });
});

describe("task.submit", () => {
  it("版本号 +1，文件名按规范，准时记下", () => {
    const { g, worker } = ready();
    const { taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    const { submissionId } = g.run(worker, "task.submit", { taskId, link: "https://feishu.example.com/drive/a" });
    expect(g.state.submissions[submissionId]).toMatchObject({ versionNo: 1, fileName: "TEST_EP01_SC001_CUT001_A_ANI_v01", onTime: true, byMemberId: worker });
    expect(g.state.tasks[taskId]).toMatchObject({ status: "submitted", versions: 1 });
  });

  it("链接和说明至少一个；链接只收 http / https；不在你手上不能交", () => {
    const { g, worker } = ready();
    const { taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    expect(g.reject(worker, "task.submit", { taskId })).toBe("链接和说明至少写一个");
    expect(g.reject(worker, "task.submit", { taskId, link: "javascript:alert(1)" })).toMatch(/http/);
    const other = g.member("小乙");
    expect(g.reject(other, "task.submit", { taskId, note: "x" })).toBe("这张任务不在你手上");
    g.run(worker, "task.submit", { taskId, note: "交了", fileName: "自己起的名字" });
    expect(g.reject(worker, "task.submit", { taskId, note: "再交" })).toMatch(/已经在等审核/);
  });

  it("过了时限交，记成不准时；管理员可以代交", () => {
    const { g, worker } = ready();
    const { taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    g.advance(10);
    const { submissionId } = g.run(g.admin, "task.submit", { taskId, note: "代交" });
    expect(g.state.submissions[submissionId]).toMatchObject({ onTime: false, byMemberId: worker, recordedById: g.admin });
  });
});

describe("task.release", () => {
  it("放弃 = 返还到可接，不扣分", () => {
    const { g, worker } = ready();
    const { taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    g.run(worker, "task.release", { taskId });
    expect(g.state.tasks[taskId]).toMatchObject({ status: "open", assigneeId: null, dueAt: null });
    expect(Object.values(g.state.ledger)).toHaveLength(0);
    expect(g.reject(worker, "task.release", { taskId })).toMatch(/不用放弃/);
  });
});

describe("task.expire", () => {
  it("过了时限才能收回；收回到可接；开关打开时扣分", () => {
    const { g, worker } = ready();
    const { taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    expect(g.reject(worker, "task.expire", { taskId })).toBe("还没到时限");
    g.advance(10);
    g.run(worker, "task.expire", { taskId });
    expect(g.state.tasks[taskId]).toMatchObject({ status: "open", assigneeId: null });
    expect(Object.values(g.state.ledger)).toHaveLength(0);

    g.run(g.admin, "rules.set", { expiryPenalty: true });
    g.run(worker, "task.claim", { taskId });
    g.advance(10);
    const r = g.run(g.admin, "task.expire", { taskId });
    expect(g.state.ledger[r.ledgerId]).toMatchObject({ memberId: worker, kind: "penalty", points: -2 });
    expect(g.state.worlds[WORLD].rules.expiryPenalty).toBe(true);
  });
});

describe("task.reclaim / task.reopen", () => {
  it("管理员收回 → 谁都不能接 → 重新放出", () => {
    const { g, worker } = ready();
    const { taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    expect(g.reject(worker, "task.reclaim", { taskId })).toBe("只有管理员可以收回任务");
    g.run(g.admin, "task.reclaim", { taskId });
    expect(g.state.tasks[taskId]).toMatchObject({ status: "reclaimed", assigneeId: null });
    expect(g.reject(worker, "task.claim", { taskId })).toMatch(/现在不能接/);
    g.run(g.admin, "task.reopen", { taskId });
    expect(g.state.tasks[taskId].status).toBe("open");
    expect(g.reject(g.admin, "task.reopen", { taskId })).toBe("只有收回的任务才能重新放出");
  });

  it("项目级的任务也能收回再放出", () => {
    const g = new TestGuild();
    const p = g.project(1, 2);
    const t = g.task(p, "plan");
    g.run(g.admin, "task.reclaim", { taskId: t.id });
    g.run(g.admin, "task.reopen", { taskId: t.id });
    expect(g.state.tasks[t.id].status).toBe("open");
  });
});

describe("task.assign", () => {
  it("指派给成员，或外包（管理员代交，不记活力点）", () => {
    const { g, p, reviewer, worker } = ready();
    const a = g.task(p, "inbetween", 1, "A");
    g.run(g.admin, "task.assign", { taskId: a.id, memberId: worker });
    expect(g.state.tasks[a.id]).toMatchObject({ status: "claimed", assigneeId: worker });
    const b = g.task(p, "inbetween", 1, "B");
    g.run(g.admin, "task.assign", { taskId: b.id, outsourceName: "外面的老师" });
    expect(g.state.tasks[b.id]).toMatchObject({ status: "claimed", outsourced: true, assigneeId: null, outsourceName: "外面的老师" });
    expect(g.reject(worker, "task.submit", { taskId: b.id, note: "x" })).toBe("这张任务不在你手上");
    g.run(g.admin, "task.submit", { taskId: b.id, note: "外包交来的" });
    g.run(reviewer, "task.review", { taskId: b.id, verdict: "pass", quality: 1 });
    expect(Object.values(g.state.ledger)).toHaveLength(0);
    expect(g.reject(g.admin, "task.assign", { taskId: g.task(p, "inbetween", 2, "A").id })).toBe("选一个成员，或写外包的名字");
    expect(g.reject(g.admin, "task.assign", { taskId: a.id, memberId: worker })).toMatch(/已经有人在做/);
  });
});

describe("task.review", () => {
  it("退回：带意见，回到原来的人手上；改完再交是 v02", () => {
    const { g, reviewer, worker } = ready();
    const { taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    g.run(worker, "task.submit", { taskId, note: "v1" });
    expect(g.reject(reviewer, "task.review", { taskId, verdict: "return", comments: [] })).toBe("退回要写意见（至少一条），或者在图上钉一处");
    g.run(reviewer, "task.review", { taskId, verdict: "return", comments: [{ layer: "A", sheets: "6、7", tag: "漏轨目", text: "第 6、7 张漏了轨目" }] });
    expect(g.state.tasks[taskId]).toMatchObject({ status: "returned", assigneeId: worker });
    const { submissionId } = g.run(worker, "task.submit", { taskId, note: "v2" });
    expect(g.state.submissions[submissionId].versionNo).toBe(2);
  });

  it("通过：按 Tn × 工作量 ×（掌控 + 熟练度）× 质量 记活力点，下游解锁", () => {
    const g = new TestGuild();
    const p = g.project(1, 4);
    const reviewer = g.member("审审", "reviewer");
    const worker = g.member("小甲");
    g.run(g.admin, "hub.dispatch", { hubStageId: g.stage(p, "key_check").id, rows: [g.task(p, "inbetween", 1, "A"), g.task(p, "inbetween", 1, "B")].map((t) => ({ taskId: t.id, workload: 4 })), release: "all" });
    const { taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0.2, maxActive: 2 });
    g.run(worker, "task.submit", { taskId, note: "好了" });
    const r = g.run(reviewer, "task.review", { taskId, verdict: "pass", quality: 1.2 });
    // 1.5 × 4 × (1 + 0.2) × 1.2 = 8.64 → 8.6
    expect(g.state.ledger[r.ledgerId]).toMatchObject({ memberId: worker, points: 8.6, hours: 6, factor: 1.2, quality: 1.2 });
    expect(g.state.tasks[taskId].status).toBe("passed");
    expect(g.task(p, "inbetween_check", 1).status).toBe("locked");
    const b = g.run(worker, "task.claim", {}).taskId;
    g.run(worker, "task.submit", { taskId: b, note: "好了" });
    g.run(reviewer, "task.review", { taskId: b, verdict: "pass", quality: 1 });
    expect(g.task(p, "inbetween_check", 1).status).toBe("open");
  });

  it("自修后通过：审核员出新的一版，另记 0.5 小时给审核员", () => {
    const { g, reviewer, worker } = ready();
    const { taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    g.run(worker, "task.submit", { taskId, note: "v1" });
    expect(g.reject(reviewer, "task.review", { taskId, verdict: "fix_pass", quality: 1 })).toBe("自修要填新版本的链接或说明");
    const r = g.run(reviewer, "task.review", { taskId, verdict: "fix_pass", quality: 1, fix: { note: "下巴补上了" } });
    expect(g.state.submissions[r.submissionId]).toMatchObject({ versionNo: 2, selfFix: true, byMemberId: reviewer });
    expect(g.state.ledger[r.selfFixLedgerId]).toMatchObject({ memberId: reviewer, kind: "self_fix", points: 0.5 });
    expect(g.state.ledger[r.ledgerId]).toMatchObject({ memberId: worker, points: 6 });
    expect(g.state.tasks[taskId]).toMatchObject({ status: "passed", versions: 2 });
  });

  it("成员不能审；不能审自己交的；指定了审核员就只有他和管理员能审", () => {
    const { g, p, reviewer, worker } = ready();
    const { taskId } = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    g.run(worker, "task.submit", { taskId, note: "v1" });
    expect(g.reject(worker, "task.review", { taskId, verdict: "pass", quality: 1 })).toBe("只有审核员和管理员可以审核");
    const other = g.member("别的审", "reviewer");
    g.run(g.admin, "stage.set_reviewer", { stageId: g.stage(p, "inbetween").id, memberId: reviewer });
    expect(g.reject(other, "task.review", { taskId, verdict: "pass", quality: 1 })).toBe("「中割」由审审审核");
    expect(g.reject(reviewer, "task.review", { taskId, verdict: "pass", quality: 0.8 as 1 })).toMatch(/质量系数/);
    g.run(g.admin, "task.review", { taskId, verdict: "pass", quality: 1 });
    // 审核员自己交的
    g.run(reviewer, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    const mine = Object.values(g.state.tasks).find((t) => t.assigneeId === reviewer)!;
    g.run(reviewer, "task.submit", { taskId: mine.id, note: "自己做的" });
    expect(g.reject(reviewer, "task.review", { taskId: mine.id, verdict: "pass", quality: 1 })).toBe("不能审自己交的版本");
    expect(g.reject(reviewer, "task.review", { taskId, verdict: "pass", quality: 1 })).toMatch(/没有等审核的版本/);
  });
});
