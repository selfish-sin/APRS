import { describe, expect, it } from "vitest";
import * as q from "@/domain/queries";
import { TestGuild } from "./helpers";

function setup() {
  const g = new TestGuild();
  const p = g.project(2, 4);
  g.run(g.admin, "hub.dispatch", { hubStageId: g.stage(p, "key_check").id, rows: Object.values(g.state.tasks).filter((t) => t.stageId === g.stage(p, "inbetween").id).map((t) => ({ taskId: t.id, workload: t.workload })), release: "all" });
  const reviewer = g.member("审审", "reviewer");
  const worker = g.member("小甲");
  const t = g.run(worker, "enroll.add", { group: "animation", stageKey: "inbetween", skill: 0 }).taskId;
  return { g, p, reviewer, worker, t };
}

const FEISHU = "https://abc.feishu.cn/sheets/ShtFake01";
const QQ = "https://qfile.qq.com/q/FakeCode01";
const GSHEET = "https://docs.google.com/spreadsheets/d/1Fake/edit";
const DROPBOX = "https://www.dropbox.com/scl/fo/fakefolder/AAfake?rlkey=k&dl=0";
const DISCORD = "https://cdn.discordapp.com/attachments/1/2/C001.png?ex=6700aaaa&is=1&hm=x";

describe("task.submit 挂几条链接", () => {
  it("每条认平台和类型、默认起名；格式不对 / 同一版重复的拒", () => {
    const { g, worker, t } = setup();
    expect(g.reject(worker, "task.submit", { taskId: t, links: [{ url: FEISHU }, { url: "随便写的" }] })).toBe("第 2 条链接：这不像一个链接");
    expect(g.reject(worker, "task.submit", { taskId: t, links: [{ url: "ftp://x.com/a" }] })).toBe("第 1 条链接：只收 http:// 或 https:// 开头的链接");
    expect(g.reject(worker, "task.submit", { taskId: t, links: [{ url: DROPBOX }, { url: DROPBOX.replace("dl=0", "dl=1") }] })).toBe("第 2 条和第 1 条是同一个链接");
    const sub = g.run(worker, "task.submit", { taskId: t, links: [{ url: `「${FEISHU}」` }, { url: QQ }, { url: GSHEET, name: "进度表" }, { url: DROPBOX, kind: "folder" }, { url: DISCORD }, { url: "  " }] }).submissionId;
    const links = g.state.submissions[sub].links!;
    expect(links.map((l) => [l.id, l.name, l.kind])).toEqual([
      ["l1", "飞书 表格", "sheet"],
      ["l2", "QQ 闪传 文件", "file"],
      ["l3", "进度表", "sheet"],
      ["l4", "Dropbox 文件夹", "folder"],
      ["l5", "Discord 附件", "file"],
    ]);
    expect(g.state.submissions[sub].link).toBe(FEISHU);
  });

  it("旧的写法（只有 link）照样能交，当成一条", () => {
    const { g, worker, t } = setup();
    const sub = g.run(worker, "task.submit", { taskId: t, link: FEISHU });
    expect(q.submissionLinks(g.state.submissions[sub.submissionId])).toMatchObject([{ id: "l1", url: FEISHU, kind: "sheet" }]);
  });
});

describe("link.mark_broken · link.replace", () => {
  it("审核员标「打不开」→ 交的人在等我处理里看到 → 换一条就清掉", () => {
    const { g, reviewer, worker, t } = setup();
    const sub = g.run(worker, "task.submit", { taskId: t, links: [{ url: FEISHU }, { url: QQ }] }).submissionId;
    expect(g.reject(worker, "link.mark_broken", { submissionId: sub, linkId: "l2" })).toBe("只有审核员和管理员能标「打不开」");
    g.run(reviewer, "link.mark_broken", { submissionId: sub, linkId: "l2" });
    expect(g.state.submissions[sub].links![1].broken).toMatchObject({ byMemberId: reviewer });
    expect(g.reject(reviewer, "link.mark_broken", { submissionId: sub, linkId: "l2" })).toBe("这条已经标过「打不开」了");
    expect(q.inboxOf(g.state, worker).links.map((x) => x.link.id)).toEqual(["l2"]);
    expect(g.reject(reviewer, "link.replace", { submissionId: sub, linkId: "l2", url: GSHEET })).toBe("只有交这一版的人能换链接");
    expect(g.reject(worker, "link.replace", { submissionId: sub, linkId: "l2", url: FEISHU })).toBe("和第 1 条是同一个链接");
    expect(g.reject(worker, "link.replace", { submissionId: sub, linkId: "l9", url: GSHEET })).toBe("这一版没有这条链接");
    g.run(worker, "link.replace", { submissionId: sub, linkId: "l2", url: "https://abc.feishu.cn/file/BoxFake" });
    expect(g.state.submissions[sub].links![1]).toMatchObject({ id: "l2", url: "https://abc.feishu.cn/file/BoxFake", name: "飞书 文件", broken: null });
    expect(q.inboxOf(g.state, worker).links).toEqual([]);
  });
});

describe("表格上的意见（pin.add 带 cell）", () => {
  it("钉一格 / 一片；只能钉在表格上；格子位置要对", () => {
    const { g, p, worker } = setup();
    const sheet = g.run(worker, "file.add", { sha256: "b".repeat(64), name: "进度总表.xlsx", mime: "", size: 9000, subjectType: "project", subjectId: p }).fileId;
    const a = g.run(worker, "pin.add", { fileId: sheet, cell: { sheet: "进度", ref: "c5" }, text: "这一格是空的" }).pinId;
    const b = g.run(worker, "pin.add", { fileId: sheet, cell: { sheet: "进度", ref: "B2:D4" }, text: "这一片日期写成了文字" }).pinId;
    expect(g.state.pins[a]).toMatchObject({ number: 1, kind: "point", cell: { sheet: "进度", ref: "C5" } });
    expect(g.state.pins[b]).toMatchObject({ number: 2, kind: "box", cell: { sheet: "进度", ref: "B2:D4" } });
    expect(g.reject(worker, "pin.add", { fileId: sheet, cell: { sheet: "进度", ref: "5C" }, text: "x" })).toBe("格子的位置不对（例如 B3 或 B3:D5）");
    expect(g.reject(worker, "pin.add", { fileId: sheet, kind: "point", x: 0.5, y: 0.5, text: "x" })).toBe("只能在图片上钉");
    const img = g.run(worker, "file.add", { sha256: "c".repeat(64), name: "a.png", mime: "image/png", size: 1, width: 10, height: 10, subjectType: "project", subjectId: p }).fileId;
    expect(g.reject(worker, "pin.add", { fileId: img, cell: { sheet: "x", ref: "A1" }, text: "x" })).toBe("只能在表格上钉格子");
    expect(q.fileKind(g.state.files[sheet])).toBe("sheet");
  });
});
