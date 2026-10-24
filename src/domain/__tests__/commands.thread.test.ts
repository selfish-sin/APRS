import { describe, expect, it } from "vitest";
import { TestGuild } from "./helpers";

function setup() {
  const g = new TestGuild();
  const p = g.project(3, 4);
  const a = g.member("小甲");
  const b = g.member("小乙");
  const cut = (n: number) => Object.values(g.state.cuts).find((c) => c.projectId === p && c.number === n)!;
  return { g, p, a, b, cut };
}

describe("thread.open", () => {
  it("在卡、任务、项目上都能留意见；挂在任务上自动带上环节和卡", () => {
    const { g, p, a, cut } = setup();
    const onCut = g.run(a, "thread.open", { subjectType: "cut", subjectId: cut(2).id, kind: "comment", text: "这一卡的动作很好" }).threadId;
    expect(g.state.threads[onCut]).toMatchObject({ cutId: cut(2).id, status: "open", kind: "comment" });
    const t = g.task(p, "inbetween", 1, "A");
    const onTask = g.run(a, "thread.open", { subjectType: "task", subjectId: t.id, kind: "comment", text: "A 层第 3 张" }).threadId;
    expect(g.state.threads[onTask]).toMatchObject({ cutId: cut(1).id, stageKey: "inbetween" });
    const onProject = g.run(a, "thread.open", { subjectType: "project", subjectId: p, kind: "comment", text: "要尽快了" }).threadId;
    expect(g.state.threads[onProject].cutId).toBeNull();
  });

  it("提问上游要选问哪个环节或问谁；不能问自己", () => {
    const { g, a, b, cut } = setup();
    expect(g.reject(a, "thread.open", { subjectType: "cut", subjectId: cut(1).id, kind: "ask", text: "轨目怎么读？" })).toBe("提问上游要选问哪个环节或问谁");
    expect(g.reject(a, "thread.open", { subjectType: "cut", subjectId: cut(1).id, kind: "ask", askMemberId: a, text: "？" })).toBe("不用问自己");
    expect(g.reject(a, "thread.open", { subjectType: "cut", subjectId: cut(1).id, kind: "ask", askStageKey: "nope", text: "？" })).toMatch(/不在这个项目的流程里/);
    const id = g.run(a, "thread.open", { subjectType: "cut", subjectId: cut(1).id, kind: "ask", askStageKey: "key", askMemberId: b, text: "轨目怎么读？" }).threadId;
    expect(g.state.threads[id]).toMatchObject({ askStageKey: "key", askMemberId: b });
    expect(g.reject(a, "thread.open", { subjectType: "cut", subjectId: cut(1).id, kind: "comment", text: "" })).toBe("意见不能为空");
    expect(g.reject(a, "thread.open", { subjectType: "cut", subjectId: "cut_nope", kind: "comment", text: "x" })).toBe("找不到卡");
  });
});

describe("thread.reply", () => {
  it("别人回了提问 → 已答；自己补充不改状态", () => {
    const { g, a, b, cut } = setup();
    const id = g.run(a, "thread.open", { subjectType: "cut", subjectId: cut(1).id, kind: "ask", askMemberId: b, text: "轨目怎么读？" }).threadId;
    g.run(a, "thread.reply", { threadId: id, text: "补一句：第 4、5 张" });
    expect(g.state.threads[id].status).toBe("open");
    g.run(b, "thread.reply", { threadId: id, text: "按 1/3、2/3 分" });
    expect(g.state.threads[id]).toMatchObject({ status: "answered" });
    expect(g.state.threads[id].replies).toHaveLength(2);
    expect(g.reject(b, "thread.reply", { threadId: id, text: " " })).toBe("回复不能为空");
  });
});

describe("thread.resolve", () => {
  it("提的人能关意见；设定问题要拍板；要补谁都能标补好", () => {
    const { g, p, a, b, cut } = setup();
    const c = g.run(a, "thread.open", { subjectType: "cut", subjectId: cut(1).id, kind: "comment", text: "x" }).threadId;
    expect(g.reject(b, "thread.resolve", { threadId: c })).toBe("只有提的人、审核员或管理员可以关这条");
    g.run(a, "thread.resolve", { threadId: c });
    expect(g.state.threads[c].status).toBe("done");
    expect(g.reject(a, "thread.resolve", { threadId: c })).toBe("这条已经关了");
    const s = g.run(a, "thread.open", { subjectType: "project", subjectId: p, kind: "setting", text: "箭头影要不要加？" }).threadId;
    expect(g.reject(g.admin, "thread.resolve", { threadId: s })).toBe("设定问题要管理员拍板");
    g.run(g.admin, "ruling.make", { threadId: s, decision: "沿用第 9 卡的设定", cutIds: [cut(1).id] });
    const todo = Object.values(g.state.threads).find((t) => t.kind === "todo")!;
    g.run(b, "thread.resolve", { threadId: todo.id });
    expect(g.state.threads[todo.id].status).toBe("done");
  });
});

describe("ruling.make", () => {
  it("拍板：记结论，设定问题变已拍板，列出的卡各留一条要补", () => {
    const { g, p, a, cut } = setup();
    const s = g.run(a, "thread.open", { subjectType: "project", subjectId: p, kind: "setting", stageKey: "inbetween", text: "耳饰要补吗？" }).threadId;
    const { rulingId } = g.run(g.admin, "ruling.make", { threadId: s, decision: "照设定补耳饰", cutIds: [cut(3).id, cut(1).id] });
    expect(g.state.rulings[rulingId]).toMatchObject({ question: "耳饰要补吗？", decision: "照设定补耳饰", cutIds: [cut(1).id, cut(3).id], stageKey: "inbetween" });
    expect(g.state.threads[s]).toMatchObject({ status: "ruled", rulingId });
    const todos = Object.values(g.state.threads).filter((t) => t.kind === "todo");
    expect(todos.map((t) => t.cutId).sort()).toEqual([cut(1).id, cut(3).id].sort());
    expect(todos[0].text).toBe("照设定补耳饰");
    expect(g.reject(g.admin, "ruling.make", { threadId: s, decision: "再拍一次" })).toBe("这条设定问题已经拍过板了");
  });

  it("只有管理员；不挂问题时要写问题；卡要在这个项目里", () => {
    const { g, p, a, cut } = setup();
    expect(g.reject(a, "ruling.make", { projectId: p, question: "q", decision: "d" })).toBe("只有管理员可以拍板");
    expect(g.reject(g.admin, "ruling.make", { projectId: p, decision: "d" })).toBe("问题不能为空");
    const other = g.project(1, 2, "OTHER");
    const otherCut = Object.values(g.state.cuts).find((c) => c.projectId === other)!;
    expect(g.reject(g.admin, "ruling.make", { projectId: p, question: "q", decision: "d", cutIds: [otherCut.id] })).toBe("要补的卡不在这个项目里");
    const c = g.run(a, "thread.open", { subjectType: "cut", subjectId: cut(1).id, kind: "comment", text: "x" }).threadId;
    expect(g.reject(g.admin, "ruling.make", { threadId: c, decision: "d" })).toBe("只有设定问题要拍板");
    g.run(g.admin, "ruling.make", { projectId: p, question: "q", decision: "d" });
  });
});
