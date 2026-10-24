import { describe, expect, it } from "vitest";
import { ANIMATION } from "@/domain/templates";
import { TestGuild, WORLD } from "./helpers";

describe("project.create", () => {
  it("一步生成环节 + 卡 + 任务；没有上游的可接，其余锁住", () => {
    const g = new TestGuild();
    const p = g.project(3, 10);
    const stages = Object.values(g.state.stages).filter((s) => s.projectId === p);
    expect(stages).toHaveLength(ANIMATION.stages.length);
    expect(Object.values(g.state.cuts).filter((c) => c.projectId === p)).toHaveLength(3);
    const tasks = Object.values(g.state.tasks).filter((t) => t.projectId === p);
    // 项目级 7 个 + 每卡 10 个 × 3 + 每层 3 个 × 2 层 × 3
    expect(tasks).toHaveLength(7 + 10 * 3 + 3 * 2 * 3);
    expect(g.task(p, "plan").status).toBe("open");
    expect(g.task(p, "script").status).toBe("locked");
    expect(g.task(p, "inbetween", 2, "B")).toMatchObject({ status: "locked", workload: 10 });
    expect(g.task(p, "key", 1).workload).toBe(2);
    expect(g.task(p, "storyboard").workload).toBe(12);
  });

  it("代号、日期、层都要像样；成员不能开项目", () => {
    const g = new TestGuild();
    const m = g.member("小甲");
    const base = { group: "animation" as const, name: "项目", code: "AB", startOn: "2026-10-01", planEndOn: "2026-12-01", cuts: [{ layers: [{ name: "A", sheets: 3 }] }] };
    expect(g.reject(m, "project.create", base)).toBe("只有管理员可以开项目");
    expect(g.reject(g.admin, "project.create", { ...base, code: "a" })).toMatch(/代号要 2–6 位大写/);
    expect(g.reject(g.admin, "project.create", { ...base, planEndOn: "2026-09-01" })).toBe("计划结束不能早于开始");
    expect(g.reject(g.admin, "project.create", { ...base, cuts: [] })).toMatch(/至少要有 1 卡/);
    expect(g.reject(g.admin, "project.create", { ...base, cuts: [{ layers: [] }] })).toMatch(/至少要有一层/);
    expect(g.reject(g.admin, "project.create", { ...base, cuts: [{ layers: [{ name: "A", sheets: 0 }] }] })).toMatch(/张数/);
    expect(g.reject(g.admin, "project.create", { ...base, feishuRoot: "ftp://x" })).toMatch(/http/);
    g.run(g.admin, "project.create", base);
    expect(g.reject(g.admin, "project.create", base)).toMatch(/已经用过了/);
  });

  it("视频组不分层，一期一行", () => {
    const g = new TestGuild();
    const { projectId } = g.run(g.admin, "project.create", { group: "video", name: "讲座", code: "VID", startOn: "2026-10-01", planEndOn: "2026-12-01", cuts: [{}, {}] });
    const tasks = Object.values(g.state.tasks).filter((t) => t.projectId === projectId);
    expect(tasks.every((t) => t.layer === null)).toBe(true);
    expect(g.reject(g.admin, "project.create", { group: "video", name: "讲座", code: "VID2", startOn: "2026-10-01", planEndOn: "2026-12-01", cuts: [{ layers: [{ name: "A", sheets: 1 }] }] })).toBe("视频组不分层");
  });

  it("用工会里改过的工时", () => {
    const g = new TestGuild();
    g.run(g.admin, "template.set_rate", { group: "animation", stageKey: "inbetween", tn: 2 });
    const p = g.project();
    expect(g.stage(p, "inbetween").tn).toBe(2);
  });
});

describe("project.update", () => {
  it("改名字、代号、计划结束、飞书根文件夹、状态", () => {
    const g = new TestGuild();
    const p = g.project();
    g.run(g.admin, "project.update", { projectId: p, name: "新名字", code: "NEW", planEndOn: "2027-01-31", feishuRoot: "https://feishu.example.com/drive/x", status: "paused" });
    expect(g.state.projects[p]).toMatchObject({ name: "新名字", code: "NEW", planEndOn: "2027-01-31", status: "paused" });
    expect(g.reject(g.admin, "project.update", { projectId: p, planEndOn: "2020-01-01" })).toBe("计划结束不能早于开始");
    const m = g.member("小甲");
    expect(g.reject(m, "project.update", { projectId: p, name: "x" })).toBe("只有管理员可以改项目");
  });
});

describe("stage.set_reviewer", () => {
  it("只能指定审核员；清空 = 谁都能审", () => {
    const g = new TestGuild();
    const p = g.project();
    const r = g.member("审审", "reviewer");
    const m = g.member("小甲");
    const stage = g.stage(p, "inbetween");
    g.run(g.admin, "stage.set_reviewer", { stageId: stage.id, memberId: r });
    expect(g.state.stages[stage.id].reviewerId).toBe(r);
    expect(g.reject(g.admin, "stage.set_reviewer", { stageId: stage.id, memberId: m })).toMatch(/不是审核员/);
    g.run(g.admin, "stage.set_reviewer", { stageId: stage.id, memberId: null });
    expect(g.state.stages[stage.id].reviewerId).toBeNull();
  });
});

describe("template.set_rate", () => {
  it("记在工会规则里，也改到现有项目的环节上", () => {
    const g = new TestGuild();
    const p = g.project();
    g.run(g.admin, "template.set_rate", { group: "animation", stageKey: "paint", tn: 0.3, control: 1.1 });
    expect(g.state.worlds[WORLD].rules.rates?.animation?.paint).toEqual({ tn: 0.3, control: 1.1 });
    expect(g.stage(p, "paint")).toMatchObject({ tn: 0.3, control: 1.1, per: 1 });
    expect(g.reject(g.admin, "template.set_rate", { group: "animation", stageKey: "nope", tn: 1 })).toBe("找不到这个环节");
    expect(g.reject(g.admin, "template.set_rate", { group: "animation", stageKey: "paint", tn: -1 })).toMatch(/工时/);
  });
});

describe("hub.dispatch", () => {
  it("改下游工作量，全部马上放出来（不等上游），一条日志", () => {
    const g = new TestGuild();
    const p = g.project(2, 4);
    const hub = g.stage(p, "key_check");
    const rows = [g.task(p, "inbetween", 1, "A"), g.task(p, "inbetween", 1, "B")].map((t) => ({ taskId: t.id, workload: 12 }));
    const before = g.state.journal.length;
    g.run(g.admin, "hub.dispatch", { hubStageId: hub.id, rows, release: "all" });
    expect(g.state.journal.length).toBe(before + 1);
    expect(g.task(p, "inbetween", 1, "A")).toMatchObject({ status: "open", workload: 12 });
    expect(g.task(p, "inbetween", 1, "A").dispatchedAt).toBe(g.now);
    expect(g.task(p, "inbetween", 2, "A").status).toBe("locked");
  });

  it("ready：上游没完的先不放，派发过的等上游通过自动放", () => {
    const g = new TestGuild();
    const p = g.project(1, 4);
    const hub = g.stage(p, "layout");
    const key = g.task(p, "key", 1);
    g.run(g.admin, "hub.dispatch", { hubStageId: hub.id, rows: [{ taskId: key.id, workload: 7 }], release: "ready" });
    expect(g.task(p, "key", 1)).toMatchObject({ status: "locked", workload: 7 });
  });

  it("可以给某一卡加一层（生成新任务）", () => {
    const g = new TestGuild();
    const p = g.project(1, 4);
    const hub = g.stage(p, "key_check");
    const stage = g.stage(p, "inbetween");
    const cut = Object.values(g.state.cuts).find((c) => c.projectId === p)!;
    g.run(g.admin, "hub.dispatch", { hubStageId: hub.id, rows: [], add: [{ stageId: stage.id, cutId: cut.id, layer: "C", workload: 5 }], release: "all" });
    expect(g.task(p, "inbetween", 1, "C")).toMatchObject({ status: "open", workload: 5 });
    expect(g.state.cuts[cut.id].layers.map((l) => l.name)).toEqual(["A", "B", "C"]);
  });

  it("不在这个枢纽范围里的、有人在做的、不是枢纽的，都拒", () => {
    const g = new TestGuild();
    const p = g.project(1, 4);
    const hub = g.stage(p, "key_check");
    expect(g.reject(g.admin, "hub.dispatch", { hubStageId: hub.id, rows: [{ taskId: g.task(p, "paint", 1, "A").id, workload: 3 }], release: "all" })).toMatch(/不在「原画监督」管的范围里/);
    expect(g.reject(g.admin, "hub.dispatch", { hubStageId: g.stage(p, "key").id, rows: [], release: "all" })).toMatch(/不是枢纽环节/);
    expect(g.reject(g.admin, "hub.dispatch", { hubStageId: hub.id, rows: [], release: "all" })).toBe("没有选要派发的任务");
    expect(g.reject(g.admin, "hub.dispatch", { hubStageId: hub.id, rows: [{ taskId: g.task(p, "inbetween", 1, "A").id, workload: 0 }], release: "all" })).toMatch(/工作量/);
    const m = g.member("小甲");
    expect(g.reject(m, "hub.dispatch", { hubStageId: hub.id, rows: [], release: "all" })).toBe("只有管理员可以枢纽派发");
    // 有人接了以后不能再派
    const t = g.task(p, "inbetween", 1, "A");
    g.run(g.admin, "hub.dispatch", { hubStageId: hub.id, rows: [{ taskId: t.id, workload: 4 }], release: "all" });
    g.run(m, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 });
    expect(g.reject(g.admin, "hub.dispatch", { hubStageId: hub.id, rows: [{ taskId: t.id, workload: 4 }], release: "all" })).toMatch(/已经有人在做/);
  });
});
