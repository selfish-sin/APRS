import { describe, expect, it } from "vitest";
import * as q from "@/domain/queries";
import { TestGuild } from "./helpers";

function zero() {
  const g = new TestGuild();
  const a = g.member("小甲");
  const b = g.member("小乙");
  const r = g.member("审审", "reviewer");
  const p = g.run(g.admin, "project.draft", { template: "anim_standard", name: "零日测试片", code: "ZERO" }).projectId;
  return { g, a, b, r, p };
}

/** 开工好的项目：3 卡，A 层 4 张。 */
function started() {
  const z = zero();
  z.g.run(z.g.admin, "project.set_structure", { projectId: z.p, structure: { episodes: 1, scenesPerEpisode: 1, cutsPerScene: 3, layers: ["A"], sheetsPerLayer: 4, secondsPerCut: 4 } });
  z.g.run(z.g.admin, "project.start", { projectId: z.p });
  return z;
}

describe("project.draft · project.update（零日页）· project.set_structure", () => {
  it("用模板建项目先进零日，不生成任务；人员表照模板列出职位；封面、日期、关键日能改", () => {
    const { g, p } = zero();
    const proj = g.state.projects[p];
    expect(proj).toMatchObject({ status: "zero", template: "anim_standard", cycleDays: 7 });
    expect(q.tasksOf(g.state, p)).toEqual([]);
    expect(q.stagesOf(g.state, p)).toEqual([]);
    expect(proj.staff!.map((s) => s.key)).toContain("animation_director");
    expect(proj.staff!.find((s) => s.key === "key")!.stageKeys).toEqual(["key"]);
    expect(proj.cutsPlan).toHaveLength(3);
    g.run(g.admin, "project.update", { projectId: p, intro: "一个小女孩去找她的猫，3 分钟，给工会的新人练手。", keyDates: [{ name: "分镜定稿", date: "2026-11-01" }, { name: "交片", date: "2026-12-20" }], planEndOn: "2026-12-31", cycleDays: 7 });
    expect(g.state.projects[p].keyDates!.map((k) => k.name)).toEqual(["分镜定稿", "交片"]);
    expect(g.reject(g.admin, "project.update", { projectId: p, keyDates: [{ name: "", date: "2026-11-01" }] })).toBe("关键日要有名字和日期");
    expect(g.reject(g.admin, "project.draft", { template: "anim_standard", name: "x", code: "ZERO" })).toMatch(/已经有项目在用了/);
  });

  it("结构批量填，再逐卡改；开工以后不能改结构", () => {
    const { g, p } = zero();
    g.run(g.admin, "project.set_structure", { projectId: p, structure: { episodes: 1, scenesPerEpisode: 2, cutsPerScene: 2, layers: ["A", "B"], sheetsPerLayer: 10, secondsPerCut: 3 }, cuts: [{ number: 2, layers: [{ name: "A", sheets: 20 }], seconds: 6 }] });
    const plan = g.state.projects[p].cutsPlan!;
    expect(plan.map((c) => `${c.scene}:${c.number}`)).toEqual(["SC001:1", "SC001:2", "SC002:3", "SC002:4"]);
    expect(plan[1]).toMatchObject({ layers: [{ name: "A", sheets: 20 }], seconds: 6 });
    expect(g.reject(g.admin, "project.set_structure", { projectId: p, structure: { cutsPerScene: 0 } })).toBe("每场几卡要填 1–200 之间的整数");
    expect(g.reject(g.admin, "project.set_structure", { projectId: p, structure: { layers: ["a1"] } })).toBe("层名写一个大写字母（A、B …），最多 6 层");
    g.run(g.admin, "project.start", { projectId: p });
    expect(g.reject(g.admin, "project.set_structure", { projectId: p, structure: {} })).toBe("项目开工以后就不能改结构了，用「加卡」「改卡」");
  });
});

describe("staff.set · staff.add_position · project.start", () => {
  it("一个职位填成员或外部名字；开工时填了人的成员自动报到对应环节（标「指派」），能拿到任务", () => {
    const { g, a, b, p } = zero();
    g.run(g.admin, "project.set_structure", { projectId: p, structure: { cutsPerScene: 3, layers: ["A"], sheetsPerLayer: 4 } });
    g.run(g.admin, "staff.set", { projectId: p, positionKey: "key", people: [{ memberId: a }, { name: "外包老王" }] });
    g.run(g.admin, "staff.set", { projectId: p, positionKey: "inbetween", people: [{ memberId: b }] });
    expect(g.reject(g.admin, "staff.set", { projectId: p, positionKey: "key", people: [{ memberId: a }, { memberId: a }] })).toBe("小甲已经在这个职位上了");
    expect(g.reject(g.admin, "staff.set", { projectId: p, positionKey: "nope", people: [] })).toBe("人员表里没有这个职位");
    g.run(g.admin, "staff.add_position", { projectId: p, name: "道具设计", desc: "画道具", stageKeys: ["art"] });
    expect(g.state.projects[p].staff!.at(-1)).toMatchObject({ key: expect.stringMatching(/^c\d+$/), custom: { name: "道具设计" }, stageKeys: ["art"] });
    g.run(g.admin, "project.start", { projectId: p });
    const proj = g.state.projects[p];
    expect(proj.status).toBe("active");
    expect(q.cutsOf(g.state, p)).toHaveLength(3);
    expect(q.stagesOf(g.state, p)).toHaveLength(20);
    expect(q.tasksOf(g.state, p).length).toBeGreaterThan(20);
    expect(Object.values(g.state.enrollments).find((e) => e.memberId === a && e.stageKey === "key")).toMatchObject({ assigned: true, origin: "assigned" });
    expect(g.reject(g.admin, "project.start", { projectId: p })).toBe("这个项目已经开工了");
    // 开工以后再填进来的成员马上报到
    g.run(g.admin, "staff.set", { projectId: p, positionKey: "layout", people: [{ memberId: b }] });
    expect(Object.values(g.state.enrollments).some((e) => e.memberId === b && e.stageKey === "layout" && e.assigned)).toBe(true);
  });

  it("「从空白开始」：没有职位、没有环节，开工以后自己加", () => {
    const g = new TestGuild();
    const p = g.run(g.admin, "project.draft", { template: "blank", name: "空白", code: "BLANK" }).projectId;
    expect(g.state.projects[p].staff).toEqual([]);
    g.run(g.admin, "project.start", { projectId: p });
    expect(q.stagesOf(g.state, p)).toEqual([]);
    expect(q.cutsOf(g.state, p)).toHaveLength(3);
    g.run(g.admin, "stage.add", { projectId: p, name: "画", phase: "mid", kind: "transit", grain: "cut", unit: "sheet", tn: 1 });
    expect(q.tasksOf(g.state, p).filter((t) => t.status === "open")).toHaveLength(3);
  });
});

describe("stage.add · stage.update · stage.move · stage.remove · stage.disable", () => {
  it("加「分镜检查」接在分镜后面：已有的卡按位置生成任务，原来接在分镜后面的改成接在它后面", () => {
    const { g, p } = started();
    const id = g.run(g.admin, "stage.add", { projectId: p, name: "分镜检查", phase: "pre", kind: "review", grain: "project", unit: "item", tn: 2, afterKey: "storyboard" }).stageId;
    const s = g.state.stages[id];
    expect(s).toMatchObject({ upstream: ["storyboard"], locked: true });
    expect(g.stage(p, "layout").upstream).toContain(s.templateKey);
    expect(q.tasksOf(g.state, p).filter((t) => t.stageId === id)).toHaveLength(1);
    const order = q.stagesOf(g.state, p).map((x) => x.name);
    expect(order.indexOf("分镜检查")).toBe(order.indexOf("分镜") + 1);
    expect(g.reject(g.admin, "stage.add", { projectId: p, name: "分镜检查", phase: "pre", kind: "review", grain: "project", unit: "item", tn: 2 })).toBe("这个项目里已经有「分镜检查」了");
    g.run(g.admin, "stage.update", { stageId: id, name: "分镜检查（导演）", tn: 3 });
    expect(g.state.stages[id]).toMatchObject({ name: "分镜检查（导演）", tn: 3 });
    g.run(g.admin, "stage.move", { stageId: id, direction: "down" });
    expect(g.reject(g.admin, "stage.move", { stageId: q.stagesOf(g.state, p)[0].id, direction: "up" })).toBe("已经在最前面了");
    // 没人交过：能删，下游接回分镜
    g.run(g.admin, "stage.remove", { stageId: id });
    expect(g.stage(p, "layout").upstream).toContain("storyboard");
  });

  it("有人交过的环节不能删，只能停用；停用的环节任务不再派，下游绕过它", () => {
    const { g, a, r, p } = started();
    g.passStage(p, "plan", a, r);
    const scriptStage = g.stage(p, "script");
    const t = q.tasksOf(g.state, p).find((x) => x.stageId === scriptStage.id)!;
    g.run(a, "task.claim", { taskId: t.id });
    g.run(a, "task.submit", { taskId: t.id, note: "v1" });
    expect(g.reject(g.admin, "stage.remove", { stageId: scriptStage.id })).toBe("这个环节已经有人交过，不能删，可以停用");
    // 停用美术设计 → 色指定设计只等策划（已过），直接可接
    const art = g.stage(p, "art");
    const colorTask = q.tasksOf(g.state, p).find((x) => x.stageId === g.stage(p, "color_design").id)!;
    expect(colorTask.status).toBe("locked");
    g.run(g.admin, "stage.disable", { stageId: art.id, disabled: true });
    expect(g.state.tasks[colorTask.id].status).toBe("open");
    const artTask = q.tasksOf(g.state, p).find((x) => x.stageId === art.id)!;
    expect(g.reject(a, "task.claim", { taskId: artTask.id })).toBe("「美术设计（人设 / 美设）」停用了，任务不再派");
  });
});

describe("stage.accept · task.reopen（打回重做）", () => {
  it("验收：没做完的拒；打回 1 卡重做（带意见，活力点不扣），其余验收通过；最后一个环节验收 = 项目完成", () => {
    const { g, a, r, p } = started();
    for (const key of ["plan", "script", "art", "storyboard", "color_design", "layout"]) g.passStage(p, key, a, r);
    const layout = g.stage(p, "layout");
    const pointsBefore = (q.indexOf(g.state).ledgerByMember.get(a) ?? []).reduce((n, l) => n + l.points, 0);
    const c2 = q.tasksOf(g.state, p).filter((t) => t.stageId === layout.id)[1];
    g.run(g.admin, "task.reopen", { taskId: c2.id, comments: [{ text: "构图和分镜对不上，重画" }] });
    expect(g.state.tasks[c2.id]).toMatchObject({ status: "returned", assigneeId: a, passedAt: null });
    expect((q.indexOf(g.state).ledgerByMember.get(a) ?? []).reduce((n, l) => n + l.points, 0)).toBe(pointsBefore);
    expect(g.reject(g.admin, "task.reopen", { taskId: c2.id, comments: [] })).toBe("只有收回的任务能重新放出、通过的任务能打回重做");
    // 打回的那一卡不挡：其余的验收通过
    g.run(g.admin, "stage.accept", { stageId: layout.id });
    expect(g.state.stages[layout.id].acceptedAt).not.toBeNull();
    expect(g.state.tasks[c2.id].redo).toBe(true);
    g.run(a, "task.submit", { taskId: c2.id, note: "重画了" });
    g.run(r, "task.review", { taskId: c2.id, verdict: "pass", quality: 1 });
    expect(g.state.tasks[c2.id].redo).toBe(false);
    expect((q.indexOf(g.state).ledgerByMember.get(a) ?? []).reduce((n, l) => n + l.points, 0)).toBeGreaterThan(pointsBefore);
    // 还有没做完的（不是打回的）就不能验收
    expect(g.reject(g.admin, "stage.accept", { stageId: g.stage(p, "key").id })).toMatch(/张没通过/);
    expect(g.reject(g.admin, "stage.accept", { stageId: layout.id })).toBe("这个环节已经验收过了");
    expect(g.reject(g.admin, "task.reopen", { taskId: c2.id })).toBe("打回重做要写意见");
  });

  it("最后一个环节验收 = 项目完成", () => {
    const g = new TestGuild();
    const a = g.member("小甲");
    const r = g.member("审审", "reviewer");
    const p = g.run(g.admin, "project.draft", { template: "blank", name: "小片", code: "TINY" }).projectId;
    g.run(g.admin, "project.start", { projectId: p });
    g.run(g.admin, "stage.add", { projectId: p, name: "画", phase: "mid", kind: "transit", grain: "project", unit: "item", tn: 1 });
    const s = q.stagesOf(g.state, p)[0];
    g.passStage(p, s.templateKey, a, r);
    g.run(g.admin, "stage.accept", { stageId: s.id });
    expect(g.state.projects[p].status).toBe("done");
  });
});

describe("task.extend · stage.extend · project.extend", () => {
  it("延期一张 / 一个环节 / 整个项目，都要写原因", () => {
    const { g, a, r, p } = started();
    g.passStage(p, "plan", a, r);
    const t = q.tasksOf(g.state, p).find((x) => x.stageId === g.stage(p, "script").id)!;
    g.run(a, "task.claim", { taskId: t.id });
    const due = g.state.tasks[t.id].dueAt!;
    expect(g.reject(g.admin, "task.extend", { taskId: t.id, hours: 4, reason: "" })).toBe("写一下原因");
    expect(g.reject(g.admin, "task.extend", { taskId: t.id, reason: "x" })).toBe("延期写加几小时、加几天，或者改到哪一天");
    g.run(g.admin, "task.extend", { taskId: t.id, hours: 4, reason: "设定改了" });
    expect(Date.parse(g.state.tasks[t.id].dueAt!) - Date.parse(due)).toBe(4 * 3600_000);
    g.run(g.admin, "stage.extend", { stageId: g.stage(p, "script").id, days: 1, reason: "过节" });
    expect(Date.parse(g.state.tasks[t.id].dueAt!) - Date.parse(due)).toBe(28 * 3600_000);
    expect(g.reject(g.admin, "stage.extend", { stageId: g.stage(p, "key").id, days: 1, reason: "x" })).toBe("这个环节现在没有在做的任务");
    const locked = q.tasksOf(g.state, p).find((x) => x.stageId === g.stage(p, "key").id)!;
    expect(g.reject(g.admin, "task.extend", { taskId: locked.id, days: 1, reason: "x" })).toMatch(/现在没有在做，没有时限可以延/);
    g.run(g.admin, "project.extend", { projectId: p, until: "2027-03-31", reason: "加了两卡" });
    expect(g.state.projects[p].planEndOn).toBe("2027-03-31");
  });
});

describe("cut.add · cut.update · cut.archive", () => {
  it("加 2 卡（接着往后排）、插一卡 C001a；新卡从头走；改张数工作量跟着变；加层生成新任务；停用一卡不再派", () => {
    const { g, a, r, p } = started();
    for (const key of ["plan", "script", "art", "storyboard"]) g.passStage(p, key, a, r);
    g.run(g.admin, "cut.add", { projectId: p, count: 2 });
    const first = q.cutsOf(g.state, p)[0];
    g.run(g.admin, "cut.add", { projectId: p, count: 1, afterCutId: first.id });
    expect(q.cutsOf(g.state, p).map((c) => q.cutName(g.state, c))).toEqual(["C001", "C001a", "C002", "C003", "C004", "C005"]);
    const c4 = q.cutsOf(g.state, p).find((c) => c.number === 4)!;
    const layout4 = q.tasksOf(g.state, p).find((t) => t.cutId === c4.id && t.stageId === g.stage(p, "layout").id)!;
    expect(layout4.status).toBe("open");
    const key4 = q.tasksOf(g.state, p).find((t) => t.cutId === c4.id && t.stageId === g.stage(p, "inbetween").id)!;
    expect(key4).toMatchObject({ status: "locked", workload: 4 });
    g.run(g.admin, "cut.update", { cutId: c4.id, layers: [{ name: "A", sheets: 10 }, { name: "B", sheets: 6 }], seconds: 8 });
    const ib = q.tasksOf(g.state, p).filter((t) => t.cutId === c4.id && t.stageId === g.stage(p, "inbetween").id);
    expect(ib.map((t) => `${t.layer}:${t.workload}`).sort()).toEqual(["A:10", "B:6"]);
    g.run(g.admin, "cut.archive", { cutId: c4.id, reason: "剪掉了" });
    expect(g.state.cuts[c4.id].disabled).toBe(true);
    expect(q.tasksOf(g.state, p).filter((t) => t.cutId === c4.id && t.status === "open")).toEqual([]);
    expect(g.reject(g.admin, "cut.archive", { cutId: c4.id, reason: "x" })).toBe("C004 已经停用了");
    expect(g.reject(g.admin, "cut.add", { projectId: p, count: 0 })).toBe("一次加 1–50 卡");
  });
});

describe("项目时间线", () => {
  it("每次改都留一条（谁、改了什么、为什么）", () => {
    const { g, p } = started();
    g.run(g.admin, "project.extend", { projectId: p, until: "2027-03-31", reason: "加了两卡" });
    g.run(g.admin, "cut.add", { projectId: p, count: 2, reason: "导演要加两个镜头" });
    const items = q.projectTimeline(g.state, p);
    expect(items.map((i) => i.command)).toEqual(expect.arrayContaining(["project.draft", "project.start", "project.extend", "cut.add"]));
    const ext = items.find((i) => i.command === "project.extend")!;
    expect(ext.reason).toBe("加了两卡");
    expect(ext.text).toMatch(/计划结束改到 2027-03-31/);
  });
});

describe("account.set_lang（SPEC §16：语言跟着账号记）", () => {
  it("登录的账号记下界面语言；没登录的不行；只认 zh / en", async () => {
    const { dispatch } = await import("@/domain/dispatch");
    const g = new TestGuild();
    const opts = { now: g.now, worldNow: g.now, newId: () => "x_1" };
    const as = { worldId: "wld_test", accountId: g.adminAccount, actorMemberId: g.admin };
    const r = dispatch(g.state, as, "account.set_lang", { lang: "en" }, opts);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.accounts[g.adminAccount].lang).toBe("en");
    const bad = dispatch(g.state, as, "account.set_lang", { lang: "fr" as "en" }, opts);
    expect(bad.ok).toBe(false);
    const anon = dispatch(g.state, { ...as, accountId: null }, "account.set_lang", { lang: "zh" }, opts);
    expect(anon.ok).toBe(false);
  });

  it("被拒的原因带 code + 参数，界面按语言拼（中文原文不变）", async () => {
    const { errorText } = await import("@/i18n/I18n");
    const { g, p } = started();
    const stage = q.stagesOf(g.state, p).find((s) => s.templateKey === "inbetween")!;
    const r = g.try(g.admin, "stage.accept", { stageId: stage.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.key).toBe("accept_unfinished");
    expect(errorText(r.error, "zh")).toBe(r.error.message);
    expect(errorText(r.error, "zh")).toBe("还有 3 张没通过，先等它们做完或打回");
    expect(errorText(r.error, "en")).toBe("3 tasks haven't passed yet. Wait for them to finish, or send some back.");
  });
});
