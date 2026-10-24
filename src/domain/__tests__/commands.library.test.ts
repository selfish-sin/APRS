import { describe, expect, it } from "vitest";
import * as q from "@/domain/queries";
import { TestGuild } from "./helpers";

const SHA = (n: number) => n.toString(16).padStart(64, "a");
const THUMB = "data:image/png;base64,iVBORw0KGgo=";

function setup() {
  const g = new TestGuild();
  const p = g.project(2, 4);
  const reviewer = g.member("审审", "reviewer");
  const worker = g.member("小甲");
  const other = g.member("小乙");
  const cut = (n: number) => Object.values(g.state.cuts).find((c) => c.projectId === p && c.number === n)!;
  const image = (by = worker, subjectType: "project" | "cut" | "task" | "submission" | "page" | "thread" = "project", subjectId = p, n = 1) =>
    g.run(by, "file.add", { sha256: SHA(n), name: `截图-${n}.png`, mime: "image/png", size: 2048, width: 800, height: 600, thumb: THUMB, subjectType, subjectId }).fileId;
  return { g, p, reviewer, worker, other, cut, image };
}

describe("file.add", () => {
  it("记下文件的信息，挂在哪就带出项目、卡、环节", () => {
    const { g, p, worker, cut, image } = setup();
    const id = image(worker, "cut", cut(2).id);
    expect(g.state.files[id]).toMatchObject({ sha256: SHA(1), name: "截图-1.png", width: 800, projectId: p, cutId: cut(2).id, stageKey: null, byMemberId: worker });
    const t = g.task(p, "inbetween", 1, "A");
    const onTask = image(worker, "task", t.id, 2);
    expect(g.state.files[onTask]).toMatchObject({ cutId: cut(1).id, stageKey: "inbetween" });
    const rar = g.run(worker, "file.add", { sha256: SHA(3), name: "C001_A.rar", mime: "", size: 10_000_000, subjectType: "project", subjectId: p, stageKey: "paint", tags: ["胶片", "胶片", "A 层"] }).fileId;
    expect(g.state.files[rar]).toMatchObject({ width: null, thumb: null, stageKey: "paint", tags: ["胶片", "A 层"] });
  });

  it("sha256、文件名、缩略图、挂的地方、标签都要对", () => {
    const { g, p, worker } = setup();
    const base = { sha256: SHA(1), name: "a.png", mime: "image/png", size: 1, subjectType: "project" as const, subjectId: p };
    expect(g.reject(worker, "file.add", { ...base, sha256: "abc" })).toBe("文件没有读好，请重新放一次");
    expect(g.reject(worker, "file.add", { ...base, name: "a/b.png" })).toMatch(/斜杠/);
    expect(g.reject(worker, "file.add", { ...base, thumb: "data:text/html,<b>" })).toBe("缩略图不是图片");
    expect(g.reject(worker, "file.add", { ...base, thumb: `data:image/png;base64,${"A".repeat(30_000)}` })).toBe("缩略图太大了（最多 20KB）");
    expect(g.reject(worker, "file.add", { ...base, subjectId: "prj_nope" })).toBe("找不到项目");
    expect(g.reject(worker, "file.add", { ...base, stageKey: "nope" })).toMatch(/不在这个项目的流程里/);
    expect(g.reject(worker, "file.add", { ...base, tags: Array.from({ length: 9 }, (_, i) => `t${i}`) })).toBe("标签最多 8 个");
    expect(g.reject(null, "file.add", base)).toBe("请先登录");
  });
});

describe("file.rename · file.tag · file.move · file.archive", () => {
  it("传的人能改名、打标签、换挂的地方（钉跟着图走）、拿掉", () => {
    const { g, p, worker, cut, image } = setup();
    const id = image();
    g.run(worker, "file.rename", { fileId: id, name: "C001 下巴.png" });
    g.run(worker, "file.tag", { fileId: id, tags: ["设定"] });
    const pin = g.run(worker, "pin.add", { fileId: id, kind: "point", x: 0.5, y: 0.5, text: "这里" }).pinId;
    g.run(worker, "file.move", { fileId: id, subjectType: "cut", subjectId: cut(1).id });
    expect(g.state.files[id]).toMatchObject({ name: "C001 下巴.png", tags: ["设定"], subjectType: "cut", cutId: cut(1).id });
    expect(g.state.pins[pin].cutId).toBe(cut(1).id);
    g.run(worker, "file.archive", { fileId: id });
    expect(g.state.files[id].archivedAt).not.toBeNull();
    expect(q.libraryOf(g.state, p)).toHaveLength(0);
  });

  it("别人不能改；不能挪到别的项目；资料页里用着的不能拿掉", () => {
    const { g, p, worker, other, reviewer, image } = setup();
    const id = image();
    expect(g.reject(other, "file.rename", { fileId: id, name: "x.png" })).toBe("只有传的人、审核员或管理员可以改这个文件");
    g.run(reviewer, "file.tag", { fileId: id, tags: ["审核看过"] });
    const p2 = g.project(1, 2, "OTHER");
    expect(g.reject(worker, "file.move", { fileId: id, subjectType: "project", subjectId: p2 })).toBe("文件只能在同一个项目里挪");
    const page = g.run(worker, "page.create", { projectId: p, title: "设定集" }).pageId;
    g.run(worker, "block.add", { pageId: page, type: "image", fileIds: [id] });
    expect(g.reject(worker, "file.archive", { fileId: id })).toBe("这个文件还在资料页里用着，先把那个块删掉");
  });
});

describe("pin.add", () => {
  it("点一下 = 钉，拖一下 = 框；按比例存；编号往上加；退回时钉的进交的人的「等我处理」", () => {
    const { g, p, reviewer, worker, other, image } = setup();
    const { taskId } = g.run(g.admin, "hub.dispatch", { hubStageId: g.stage(p, "key_check").id, rows: [{ taskId: g.task(p, "inbetween", 1, "A").id, workload: 4 }], release: "all" });
    void taskId;
    const t = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 }).taskId;
    const sub = g.run(worker, "task.submit", { taskId: t, note: "v1" }).submissionId;
    const shot = image(worker, "submission", sub, 5);
    const a = g.run(reviewer, "pin.add", { fileId: shot, kind: "point", x: 0.25, y: 0.75, text: "第 18 张下巴漏色", layer: "a", sheets: "18", tag: "漏色", forReview: true }).pinId;
    const b = g.run(reviewer, "pin.add", { fileId: shot, kind: "box", x: 0.1, y: 0.1, w: 0.3, h: 0.2, text: "这一块的色线没闭合", mentions: [other] }).pinId;
    expect(g.state.pins[a]).toMatchObject({ number: 1, kind: "point", x: 0.25, y: 0.75, layer: "A", sheets: "18", tag: "漏色", reviewTaskId: t, taskId: t, status: "open" });
    expect(g.state.pins[b]).toMatchObject({ number: 2, kind: "box", w: 0.3, h: 0.2, mentions: [other], reviewTaskId: null });
    g.run(reviewer, "task.review", { taskId: t, verdict: "return", comments: [{ text: "看图上的钉" }] });
    expect(q.inboxOf(g.state, worker).pins.map((v) => v.pin.number)).toEqual([1, 2]);
    expect(q.inboxOf(g.state, other).pins.map((v) => v.pin.number)).toEqual([2]);
    expect(q.inboxOf(g.state, reviewer).pins).toEqual([]);
  });

  it("要在图里、框不能太小、标签和 @ 要对；不是图片不能钉；成员不能以审核的身份钉", () => {
    const { g, p, worker, image } = setup();
    const id = image();
    expect(g.reject(worker, "pin.add", { fileId: id, kind: "point", x: 1.2, y: 0.5, text: "x" })).toBe("位置要在图里面");
    expect(g.reject(worker, "pin.add", { fileId: id, kind: "box", x: 0.1, y: 0.1, w: 0.001, h: 0.2, text: "x" })).toBe("框太小了，拖大一点");
    expect(g.reject(worker, "pin.add", { fileId: id, kind: "box", x: 0.8, y: 0.1, w: 0.5, h: 0.2, text: "x" })).toBe("框超出图了");
    expect(g.reject(worker, "pin.add", { fileId: id, kind: "point", x: 0.5, y: 0.5, text: "" })).toBe("意见不能为空");
    expect(g.reject(worker, "pin.add", { fileId: id, kind: "point", x: 0.5, y: 0.5, text: "x", tag: "随便" })).toBe("标签不在可选范围内");
    expect(g.reject(worker, "pin.add", { fileId: id, kind: "point", x: 0.5, y: 0.5, text: "x", mentions: ["mem_nope"] })).toBe("找不到要 @ 的人");
    expect(g.reject(worker, "pin.add", { fileId: id, kind: "point", x: 0.5, y: 0.5, text: "x", forReview: true })).toBe("只有审核员和管理员能在审核时钉");
    const pdf = g.run(worker, "file.add", { sha256: SHA(9), name: "说明.pdf", mime: "application/pdf", size: 10, subjectType: "project", subjectId: p }).fileId;
    expect(g.reject(worker, "pin.add", { fileId: pdf, kind: "point", x: 0.5, y: 0.5, text: "x" })).toBe("只能在图片上钉");
  });
});

describe("pin.reply · pin.resolve · pin.reopen", () => {
  it("回复；钉的人或被 @ 的人能解决；解决了的能重新打开；别人不能", () => {
    const { g, worker, other, reviewer, image } = setup();
    const id = image();
    const pin = g.run(reviewer, "pin.add", { fileId: id, kind: "point", x: 0.5, y: 0.5, text: "这里", mentions: [worker] }).pinId;
    g.run(worker, "pin.reply", { pinId: pin, text: "改好了" });
    expect(g.state.pins[pin].replies.map((r) => r.text)).toEqual(["改好了"]);
    expect(g.reject(worker, "pin.reply", { pinId: pin, text: " " })).toBe("回复不能为空");
    expect(g.reject(other, "pin.resolve", { pinId: pin })).toMatch(/才能解决|能解决/);
    g.run(worker, "pin.resolve", { pinId: pin });
    expect(g.state.pins[pin].status).toBe("resolved");
    expect(g.reject(worker, "pin.resolve", { pinId: pin })).toBe("这个钉已经解决了");
    g.run(reviewer, "pin.reopen", { pinId: pin });
    expect(g.state.pins[pin].status).toBe("open");
    expect(g.reject(reviewer, "pin.reopen", { pinId: pin })).toBe("这个钉还开着");
  });

  it("钉出现在卡的时间线上", () => {
    const { g, worker, cut, image } = setup();
    const id = image(worker, "cut", cut(1).id);
    g.advance(1);
    g.run(worker, "pin.add", { fileId: id, kind: "box", x: 0.1, y: 0.1, w: 0.2, h: 0.2, text: "背涂涂到主线" });
    const items = q.timelineOfCut(g.state, cut(1).id);
    expect(items.map((i) => i.kind).slice(0, 2)).toEqual(["pin", "file"]);
    expect(items[0].text).toMatch(/框了 #1/);
  });
});

describe("page.create · page.rename · page.archive", () => {
  it("建页、改名、删页（建的人或审核员）", () => {
    const { g, p, worker, other } = setup();
    const page = g.run(worker, "page.create", { projectId: p, title: "设定集" }).pageId;
    g.run(worker, "page.rename", { pageId: page, title: "设定集 v2" });
    expect(q.pagesOf(g.state, p).map((x) => x.title)).toEqual(["设定集 v2"]);
    expect(g.reject(worker, "page.create", { projectId: p, title: "" })).toBe("页面标题不能为空");
    expect(g.reject(other, "page.archive", { pageId: page })).toBe("只有建这页的人、审核员或管理员可以删这页");
    g.run(worker, "page.archive", { pageId: page });
    expect(q.pagesOf(g.state, p)).toEqual([]);
  });
});

describe("block.add · block.update · block.move · block.remove", () => {
  it("加标题、段落、图片、网格、文件、清单、分割线；改字；上下移；删", () => {
    const { g, p, worker, image } = setup();
    const page = g.run(worker, "page.create", { projectId: p, title: "设定集" }).pageId;
    const img1 = image(worker, "page", page, 1);
    const img2 = image(worker, "page", page, 2);
    const pdf = g.run(worker, "file.add", { sha256: SHA(7), name: "色指定.pdf", mime: "application/pdf", size: 10, subjectType: "page", subjectId: page }).fileId;
    const h = g.run(worker, "block.add", { pageId: page, type: "heading", text: "人物" }).blockId;
    const t = g.run(worker, "block.add", { pageId: page, type: "text", text: "小女孩的瞳孔主线要透过头发" }).blockId;
    const im = g.run(worker, "block.add", { pageId: page, type: "image", fileIds: [img1] }).blockId;
    const gal = g.run(worker, "block.add", { pageId: page, type: "gallery", fileIds: [img1, img2] }).blockId;
    const fb = g.run(worker, "block.add", { pageId: page, type: "file", fileIds: [pdf] }).blockId;
    const cl = g.run(worker, "block.add", { pageId: page, type: "checklist", items: [{ text: "补耳饰", done: false }] }).blockId;
    const dv = g.run(worker, "block.add", { pageId: page, type: "divider", afterBlockId: h }).blockId;
    const order = () => q.blocksOf(g.state, page).map((b) => b.id);
    expect(order()).toEqual([h, dv, t, im, gal, fb, cl]);
    g.run(worker, "block.update", { blockId: t, text: "瞳孔主线透过头发" });
    g.run(worker, "block.update", { blockId: cl, items: [{ text: "补耳饰", done: true }, { text: "补皇冠的宝石", done: false }] });
    expect(g.state.blocks[t].text).toBe("瞳孔主线透过头发");
    expect(g.state.blocks[cl].items).toEqual([{ text: "补耳饰", done: true }, { text: "补皇冠的宝石", done: false }]);
    g.run(worker, "block.move", { blockId: t, direction: "up" });
    expect(order()).toEqual([h, t, dv, im, gal, fb, cl]);
    g.run(worker, "block.move", { blockId: h, direction: "down" });
    expect(order()).toEqual([t, h, dv, im, gal, fb, cl]);
    expect(g.reject(worker, "block.move", { blockId: t, direction: "up" })).toBe("已经在最上面了");
    expect(g.reject(worker, "block.move", { blockId: cl, direction: "down" })).toBe("已经在最下面了");
    g.run(worker, "block.remove", { blockId: dv });
    expect(order()).toEqual([t, h, im, gal, fb, cl]);
  });

  it("块的内容要对得上类型", () => {
    const { g, p, worker, image } = setup();
    const page = g.run(worker, "page.create", { projectId: p, title: "页" }).pageId;
    const img = image(worker, "page", page, 1);
    const pdf = g.run(worker, "file.add", { sha256: SHA(8), name: "a.pdf", mime: "application/pdf", size: 1, subjectType: "page", subjectId: page }).fileId;
    expect(g.reject(worker, "block.add", { pageId: page, type: "image", fileIds: [] })).toBe("先选一个文件");
    expect(g.reject(worker, "block.add", { pageId: page, type: "image", fileIds: [pdf] })).toMatch(/不是图片/);
    expect(g.reject(worker, "block.add", { pageId: page, type: "image", fileIds: [img, img].concat([image(worker, "page", page, 2)]) })).toMatch(/单张图片块只放一张/);
    expect(g.reject(worker, "block.add", { pageId: page, type: "nope" as "text" })).toMatch(/块的类型/);
    const t = g.run(worker, "block.add", { pageId: page, type: "text", text: "a" }).blockId;
    expect(g.reject(worker, "block.update", { blockId: t, items: [] })).toBe("只有清单块有清单");
    const other = g.project(1, 2, "OTHER2");
    const foreign = g.run(worker, "file.add", { sha256: SHA(11), name: "b.png", mime: "image/png", size: 1, width: 10, height: 10, subjectType: "project", subjectId: other }).fileId;
    expect(g.reject(worker, "block.add", { pageId: page, type: "gallery", fileIds: [foreign] })).toBe("只能放这个项目资料库里的文件");
  });

  it("每个块也能留评论", () => {
    const { g, p, worker } = setup();
    const page = g.run(worker, "page.create", { projectId: p, title: "页" }).pageId;
    const b = g.run(worker, "block.add", { pageId: page, type: "text", text: "a" }).blockId;
    const th = g.run(worker, "thread.open", { subjectType: "block", subjectId: b, kind: "comment", text: "这段要改" }).threadId;
    expect(g.state.threads[th]).toMatchObject({ projectId: p, subjectType: "block", cutId: null });
  });
});

describe("资料库的查询", () => {
  it("按卡 · 环节 · 类型 · 标签 · 谁传的筛，搜文件名，按时间排；两版对比的候选", () => {
    const { g, p, worker, other, cut, image } = setup();
    const t = g.task(p, "inbetween", 1, "A");
    const a = image(worker, "task", t.id, 1);
    g.advance(1);
    const b = image(other, "task", t.id, 2);
    g.advance(1);
    const c = image(worker, "cut", cut(1).id, 3);
    g.advance(1);
    const d = g.run(worker, "file.add", { sha256: SHA(4), name: "C001.clip", mime: "", size: 5_000_000, subjectType: "project", subjectId: p, tags: ["原文件"] }).fileId;
    expect(q.libraryOf(g.state, p).map((v) => v.file.id)).toEqual([d, c, b, a]);
    expect(q.libraryOf(g.state, p, { order: "old" }).map((v) => v.file.id)).toEqual([a, b, c, d]);
    expect(q.libraryOf(g.state, p, { cutId: cut(1).id }).map((v) => v.file.id)).toEqual([c, b, a]);
    expect(q.libraryOf(g.state, p, { stageKey: "inbetween" }).map((v) => v.file.id)).toEqual([b, a]);
    expect(q.libraryOf(g.state, p, { kind: "clip" }).map((v) => v.kindLabel)).toEqual(["CLIP 文件"]);
    expect(q.libraryOf(g.state, p, { tag: "原文件" })).toHaveLength(1);
    expect(q.libraryOf(g.state, p, { byMemberId: other }).map((v) => v.file.id)).toEqual([b]);
    expect(q.libraryOf(g.state, p, { q: "截图-2" }).map((v) => v.file.id)).toEqual([b]);
    expect(q.compareCandidates(g.state, a).map((f) => f.id)).toEqual([b, c]);
    expect(q.libraryFacets(g.state, p)).toMatchObject({ tags: ["原文件"], stageKeys: ["inbetween"] });
    expect(q.fileView(g.state, g.state.files[a]).where).toBe("C001 · 中割 · A 层");
    expect(q.sizeLabel(5_000_000)).toBe("4.8 MB");
    expect(q.libraryBytes(g.state)).toEqual({ files: 4, bytes: 2048 * 3 + 5_000_000 });
  });
});
