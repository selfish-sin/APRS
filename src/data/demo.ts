/**
 * 示范工会（SPEC §7）：项目信息是真的（安娜的旅程 ANDLC 14 卡 · 电猫与电鼠 DMDS），
 * 人员信息是编的（白鹭 · 青柠 · 栗子 · 木星 · 北窗 · 海盐 · 七号 · 松针）。
 *
 * 不是直接写表，而是从一个空世界开始一步一步跑真的命令（和页面用的是同一套），
 * 所以示范数据也有完整的日志：动态、时间线、活力点流水都是从这里来的。
 * id 用确定的生成器，同样的代码永远建出同样的世界；时钟最后冻结在 2026-10-23 10:00（北京时间）。
 *
 * 页面不要引用这里的 id 和文字；它们只在这个文件里。
 */
import { atWorldClock } from "@/domain/clock";
import type { CommandInput, CommandName } from "@/domain/commands";
import { dispatch, type Actor } from "@/domain/dispatch";
import { seededIds } from "@/domain/ids";
import { emptyWorldState, type Id, type IsoDateTime, type Quality, type ReviewComment, type WorldState } from "@/domain/model";
import ACCOUNTS from "./accounts.public.json";

export const DEMO_WORLD_ID = "wld_demo-guild";
export const DEMO_TITLE = "示范工会";
/** 2026-10-23 10:00（北京时间）。 */
export const DEMO_NOW = atWorldClock("2026-10-23", "10:00");

/** 「2026-03-01 10:00」→ ISO（北京时间）。 */
function at(when: string): IsoDateTime {
  const [d, hm = "10:00"] = when.split(" ");
  return atWorldClock(d, hm);
}

function plusHours(iso: IsoDateTime, h: number): IsoDateTime {
  return new Date(Date.parse(iso) + h * 3600_000).toISOString();
}

const LINK_ROOT = "https://feishu.example.com/drive";

class SeedBuilder {
  state: WorldState = emptyWorldState();
  private ids = seededIds(20261023);
  /** 成员 → 账号（seed 里跑命令不需要登录，用 null）。 */
  run<N extends CommandName>(member: Id | null, name: N, input: CommandInput<N>, when: IsoDateTime): Record<string, Id> {
    const actor: Actor = { worldId: DEMO_WORLD_ID, accountId: null, actorMemberId: member };
    const r = dispatch(this.state, actor, name, input, {
      now: when,
      worldNow: when,
      newId: (t) => this.ids(t, Date.parse(when)),
      source: "seed",
    });
    if (!r.ok) throw new Error(`示范数据：${name} 没跑通（${r.error.message}）`);
    this.state = r.state;
    return r.created;
  }

  task(projectId: Id, key: string, cut: number | null, layer: string | null = null): Id {
    const stage = Object.values(this.state.stages).find((s) => s.projectId === projectId && s.templateKey === key);
    if (!stage) throw new Error(`示范数据：没有环节 ${key}`);
    const cutRow = cut === null ? null : Object.values(this.state.cuts).find((c) => c.projectId === projectId && c.number === cut);
    const t = Object.values(this.state.tasks).find((x) => x.stageId === stage.id && x.cutId === (cutRow?.id ?? null) && x.layer === layer);
    if (!t) throw new Error(`示范数据：没有任务 ${key} ${cut ?? ""} ${layer ?? ""}`);
    return t.id;
  }

  stageId(projectId: Id, key: string): Id {
    const stage = Object.values(this.state.stages).find((s) => s.projectId === projectId && s.templateKey === key);
    if (!stage) throw new Error(`示范数据：没有环节 ${key}`);
    return stage.id;
  }

  cutId(projectId: Id, n: number): Id {
    const c = Object.values(this.state.cuts).find((x) => x.projectId === projectId && x.number === n);
    if (!c) throw new Error(`示范数据：没有卡 ${n}`);
    return c.id;
  }
}

interface Round {
  /** 退回的意见（没有 = 这一版通过）。 */
  comments?: ReviewComment[];
  /** 交和审之间隔几小时。 */
  reviewAfter?: number;
  /** 交的说明。 */
  note?: string;
}

interface WorkPlan {
  worker: Id;
  reviewer: Id;
  /** 什么时候接。 */
  start: IsoDateTime;
  /** 接了多少小时以后交第一版。 */
  workHours: number;
  /** 前几版的退回；最后一轮是通过。 */
  rounds?: Round[];
  quality?: Quality;
  /** 审核员自修后通过（自修版的说明）。 */
  selfFix?: string;
  /** 只交不审（停在待审）。 */
  stopAt?: "submitted" | "returned" | "claimed";
  link?: string;
  note?: string;
}

function linkFor(code: string, folder: string, cut: number | null, layer: string | null): string {
  const c = cut === null ? "" : `/CUT${String(cut).padStart(3, "0")}`;
  return `${LINK_ROOT}/${code}/EP01/${folder}${c}${layer ? `/${layer}` : ""}`;
}

/** 接 → 交 →（退回 → 再交）… → 审。返回最后一步的时间。 */
function work(b: SeedBuilder, taskId: Id, plan: WorkPlan): IsoDateTime {
  let t = plan.start;
  b.run(plan.worker, "task.claim", { taskId }, t);
  if (plan.stopAt === "claimed") return t;
  t = plusHours(t, plan.workHours);
  const rounds = plan.rounds ?? [];
  for (const r of rounds) {
    b.run(plan.worker, "task.submit", { taskId, link: plan.link, note: r.note ?? plan.note }, t);
    t = plusHours(t, r.reviewAfter ?? 3);
    b.run(plan.reviewer, "task.review", { taskId, verdict: "return", comments: r.comments ?? [] }, t);
    t = plusHours(t, Math.max(2, plan.workHours / 3));
  }
  b.run(plan.worker, "task.submit", { taskId, link: plan.link, note: plan.note }, t);
  // submitted：停在待审；returned：停在待审，由调用的地方接着退回。
  if (plan.stopAt === "submitted" || plan.stopAt === "returned") return t;
  t = plusHours(t, 4);
  if (plan.selfFix) {
    b.run(plan.reviewer, "task.review", { taskId, verdict: "fix_pass", quality: plan.quality ?? 1, fix: { link: plan.link, note: plan.selfFix } }, t);
  } else {
    b.run(plan.reviewer, "task.review", { taskId, verdict: "pass", quality: plan.quality ?? 1 }, t);
  }
  return t;
}

function c(text: string, extra: Partial<ReviewComment> = {}): ReviewComment {
  return { layer: null, sheets: null, tag: null, text, ...extra };
}

let cached: WorldState | null = null;

export function buildDemoWorld(): WorldState {
  if (cached) return cached;
  const b = new SeedBuilder();
  const admin = ACCOUNTS.find((a) => a.login === "admin")!;
  const member01 = ACCOUNTS.find((a) => a.login === "member01")!;

  // —— 工会和成员（人员是编的）——
  const bailu = b.run(null, "guild.create", { title: DEMO_TITLE, nickname: "白鹭", login: admin.login, displayName: admin.displayName, salt: admin.salt, hash: admin.hash, tone: "sage" }, at("2026-02-20 10:00")).memberId;
  const join = (nickname: string, role: "reviewer" | "member", tone: "peach" | "lilac" | "sand" | "sage" | "slate", when: string) =>
    b.run(bailu, "member.join", { nickname, role, tone }, at(when)).memberId;
  const qingning = join("青柠", "reviewer", "lilac", "2026-02-25 10:00");
  const lizi = join("栗子", "member", "peach", "2026-03-01 09:00");
  const muxing = join("木星", "member", "slate", "2026-03-05 10:00");
  const beichuang = join("北窗", "member", "sand", "2026-03-10 10:00");
  const haiyan = join("海盐", "member", "sage", "2026-03-15 10:00");
  const qihao = join("七号", "member", "peach", "2026-04-15 10:00");
  const songzhen = join("松针", "member", "lilac", "2026-03-20 10:00");
  b.run(bailu, "account.create", { memberId: muxing, login: member01.login, displayName: member01.displayName, salt: member01.salt, hash: member01.hash }, at("2026-03-05 10:05"));

  // —— 报到 ——
  const enroll = (m: Id, key: string, skill: 0.5 | 0.2 | 0 | -0.2, when: string) => b.run(m, "enroll.add", { group: "animation", stageKey: key, skill }, at(when));
  enroll(bailu, "plan", 0.5, "2026-02-20 10:10");
  enroll(bailu, "script", 0.5, "2026-02-20 10:11");
  enroll(bailu, "storyboard", 0.5, "2026-02-20 10:12");
  enroll(qingning, "key_check", 0.5, "2026-02-25 10:10");
  enroll(qingning, "inbetween_check", 0.5, "2026-02-25 10:11");
  enroll(qingning, "paint_check", 0.2, "2026-02-25 10:12");
  enroll(lizi, "art", 0.5, "2026-03-01 09:10");
  enroll(lizi, "layout", 0.5, "2026-03-01 09:11");
  enroll(lizi, "key", 0.5, "2026-03-01 09:12");
  enroll(muxing, "clean", 0.2, "2026-03-05 10:10");
  enroll(muxing, "inbetween", 0.2, "2026-03-05 10:11");
  enroll(beichuang, "clean", 0, "2026-03-10 10:10");
  enroll(beichuang, "inbetween", 0, "2026-03-10 10:11");
  enroll(haiyan, "color_design", 0.2, "2026-03-15 10:10");
  enroll(haiyan, "paint", 0.2, "2026-03-15 10:11");
  enroll(songzhen, "layout", 0, "2026-03-20 10:10");
  enroll(songzhen, "background", 0.2, "2026-03-20 10:11");
  enroll(qihao, "color_out", 0, "2026-04-15 10:10");
  enroll(qihao, "export", 0, "2026-04-15 10:11");

  // —— 项目（真的）——
  const cuts = (n: number) => Array.from({ length: n }, (_, i) => ({ number: i + 1, layers: [{ name: "A", sheets: 20 }, { name: "B", sheets: 20 }], seconds: 5, keySheets: 6 }));
  const andlc = b.run(bailu, "project.create", { group: "animation", name: "安娜的旅程", code: "ANDLC", episode: "EP01", scene: "SC001", startOn: "2026-03-01", planEndOn: "2026-06-15", feishuRoot: null, cuts: cuts(14) }, at("2026-03-01 10:00")).projectId;
  const dmds = b.run(bailu, "project.create", { group: "animation", name: "电猫与电鼠", code: "DMDS", episode: "EP01", scene: "SC001", startOn: "2026-03-01", planEndOn: "2026-04-30", feishuRoot: null, cuts: cuts(8) }, at("2026-03-01 10:30")).projectId;

  // 审核员：原画、清线、中割、上色由青柠审。
  for (const key of ["key", "clean", "inbetween", "paint"]) b.run(bailu, "stage.set_reviewer", { stageId: b.stageId(andlc, key), memberId: qingning }, at("2026-03-01 11:00"));

  // —— 安娜的旅程 · 前期（全部通过）——
  const L = (folder: string, cut: number | null = null, layer: string | null = null) => linkFor("ANDLC", folder, cut, layer);
  work(b, b.task(andlc, "plan", null), { worker: bailu, reviewer: qingning, start: at("2026-03-02 10:00"), workHours: 5, link: L("策划"), note: "策划案：16 周，一周期一周" });
  work(b, b.task(andlc, "script", null), { worker: bailu, reviewer: qingning, start: at("2026-03-04 10:00"), workHours: 8, link: L("剧本") });
  work(b, b.task(andlc, "art", null), { worker: lizi, reviewer: bailu, start: at("2026-03-04 14:00"), workHours: 10, link: L("设定"), quality: 1.2 });
  work(b, b.task(andlc, "color_design", null), { worker: haiyan, reviewer: bailu, start: at("2026-03-16 10:00"), workHours: 5, link: L("色指定") });
  work(b, b.task(andlc, "storyboard", null), { worker: bailu, reviewer: qingning, start: at("2026-03-09 10:00"), workHours: 9, link: L("分镜") });

  // Layout（14 卡）
  for (let n = 1; n <= 14; n++) {
    const worker = n <= 10 ? lizi : songzhen;
    const day = n <= 10 ? 17 + n : 17 + (n - 10) * 2;
    work(b, b.task(andlc, "layout", n), { worker, reviewer: bailu, start: at(`2026-03-${String(Math.min(day, 31)).padStart(2, "0")} 10:00`), workHours: 2, link: L("LO", n) });
  }
  // 原画 · 原画监督（14 卡）
  for (let n = 1; n <= 14; n++) {
    const start = plusHours(at("2026-04-06 10:00"), (n - 1) * 60);
    work(b, b.task(andlc, "key", n), { worker: lizi, reviewer: qingning, start, workHours: 20, link: L("H", n), quality: n % 4 === 0 ? 1.2 : 1 });
  }
  for (let n = 1; n <= 14; n++) {
    const start = plusHours(at("2026-05-14 10:00"), (n - 1) * 30);
    work(b, b.task(andlc, "key_check", n), {
      worker: qingning,
      reviewer: bailu,
      start,
      workHours: 1,
      link: L("H", n),
      ...(n === 9 ? { note: "定中割张数：A / B 各 20 张；轨目照原画" } : {}),
    });
  }
  // 清线（28 层）
  for (let n = 1; n <= 14; n++) {
    for (const layer of ["A", "B"]) {
      const worker = layer === "A" ? muxing : beichuang;
      const start = plusHours(at("2026-06-03 10:00"), (n - 1) * 72 + (layer === "B" ? 6 : 0));
      work(b, b.task(andlc, "clean", n, layer), { worker, reviewer: qingning, start, workHours: 30, link: L("CLN", n, layer) });
    }
  }

  // 中割：C001–C008、C012–C014 通过；C009 / C010 在检修；C011 在做
  const inbetween: { n: number; layer: "A" | "B"; worker: Id; start: string; rounds?: Round[]; quality?: Quality; selfFix?: string; late?: boolean }[] = [];
  const doneCuts = [1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14];
  doneCuts.forEach((n, i) => {
    const base = Date.parse(at("2026-07-20 10:00")) + i * 6 * 24 * 3600_000;
    const day = (offsetH: number) => new Date(base + offsetH * 3600_000).toISOString();
    const aWorker = n === 7 ? beichuang : muxing;
    const bWorker = n === 5 || n === 10 ? muxing : beichuang;
    inbetween.push({ n, layer: "A", worker: aWorker, start: day(0), quality: n % 3 === 0 ? 1.2 : 1, ...(n === 3 ? { rounds: [{ comments: [c("第 5 张漏了轨目，4、5 之间有中割标记", { layer: "A", sheets: "5", tag: "漏轨目" })] }] } : {}) });
    inbetween.push({
      n,
      layer: "B",
      worker: bWorker,
      start: day(52),
      ...(n === 6 ? { selfFix: "下巴的线我顺手补上了，出一版 v02" } : {}),
      ...(n === 4 ? { rounds: [{ comments: [c("小女孩瞳孔这里主线应该透过头发，有两卡没透", { layer: "B", tag: "主线不透" })] }], late: true } : {}),
      ...(n === 13 ? { late: true } : {}),
    });
  });
  for (const x of inbetween) {
    const start = x.start;
    work(b, b.task(andlc, "inbetween", x.n, x.layer), {
      worker: x.worker,
      reviewer: qingning,
      start,
      workHours: x.late ? 50 : 30,
      rounds: x.rounds,
      quality: x.quality,
      selfFix: x.selfFix,
      link: L("ANI", x.n, x.layer),
    });
  }
  // C009 A · C010 A 通过；C009 B v03、C010 B v05 在等检修
  work(b, b.task(andlc, "inbetween", 9, "A"), { worker: muxing, reviewer: qingning, start: at("2026-10-05 10:00"), workHours: 30, link: L("ANI", 9, "A") });
  work(b, b.task(andlc, "inbetween", 10, "A"), { worker: beichuang, reviewer: qingning, start: at("2026-10-06 10:00"), workHours: 30, link: L("ANI", 10, "A") });
  work(b, b.task(andlc, "inbetween", 9, "B"), {
    worker: beichuang,
    reviewer: qingning,
    start: at("2026-10-12 10:00"),
    workHours: 30,
    link: L("ANI", 9, "B"),
    stopAt: "submitted",
    rounds: [
      { comments: [c("第 5 张漏了轨目，4、5 之间有中割标记", { layer: "B", sheets: "5", tag: "漏轨目" })], reviewAfter: 20 },
      { comments: [c("小女孩瞳孔这里主线应该透过头发，第 11、12 张没透", { layer: "B", sheets: "11、12", tag: "主线不透" })], reviewAfter: 30 },
    ],
  });
  work(b, b.task(andlc, "inbetween", 10, "B"), {
    worker: muxing,
    reviewer: qingning,
    start: at("2026-10-09 10:00"),
    workHours: 24,
    link: L("ANI", 10, "B"),
    stopAt: "submitted",
    rounds: [
      { comments: [c("第 2、3 张之间少了一张中割", { layer: "B", sheets: "2、3", tag: "漏轨目" })], reviewAfter: 10 },
      { comments: [c("第 7 张头发分层错了，头发单独一层", { layer: "B", sheets: "7", tag: "分层错误" })], reviewAfter: 10 },
      { comments: [c("第 14 张主线没闭合", { layer: "B", sheets: "14", tag: "色线缺失或不闭合" })], reviewAfter: 10 },
      { comments: [c("第 18 张下巴的线断了，补一下", { layer: "B", sheets: "18", tag: "色线缺失或不闭合" })], reviewAfter: 20 },
    ],
  });

  // 中割检修 C001–C008 通过（C012–C014 中割通过了，检修还没人接）
  for (let n = 1; n <= 8; n++) {
    const start = plusHours(at("2026-09-28 10:00"), (n - 1) * 40);
    work(b, b.task(andlc, "inbetween_check", n), { worker: qingning, reviewer: bailu, start, workHours: 2, link: L("ANI", n) });
  }

  // 设定问题 → 拍板 → C005 · C007 · C009 · C010 要补
  const settingThread = b.run(
    qingning,
    "thread.open",
    { subjectType: "project", subjectId: andlc, kind: "setting", stageKey: "inbetween", text: "C005–C010 这批监修时看到，耳饰、皇冠上的宝石、大人角色和设定对不上，5、7、9、10 卡要不要照设定补？" },
    at("2026-10-16 15:00")
  ).threadId;
  b.run(
    bailu,
    "ruling.make",
    { threadId: settingThread, decision: "照设定补：耳饰、皇冠的宝石、大人角色", cutIds: [5, 7, 9, 10].map((n) => b.cutId(andlc, n)), stageKey: "inbetween" },
    at("2026-10-17 10:00")
  );

  // 输出上色文件 C005 通过 → 上色 C005 A：v04 交了，被退回
  work(b, b.task(andlc, "color_out", 5), { worker: qihao, reviewer: qingning, start: at("2026-10-17 14:00"), workHours: 1, link: L("ANI", 5) });
  work(b, b.task(andlc, "paint", 5, "A"), {
    worker: haiyan,
    reviewer: qingning,
    start: at("2026-10-18 10:00"),
    workHours: 4,
    link: L("ANI", 5, "A"),
    stopAt: "returned",
    rounds: [
      { comments: [c("第 4 张色线不小心删了，背涂有一部分填到了「影」的图层上", { layer: "A", sheets: "4", tag: "背涂填错图层" })], reviewAfter: 20 },
      { comments: [c("第 9 张背涂涂到主线上了，主线要留出来", { layer: "A", sheets: "9", tag: "背涂涂到主线" })], reviewAfter: 20 },
      { comments: [c("第 11、12 张两个颜色涂反了", { layer: "A", sheets: "11、12", tag: "涂反" })], reviewAfter: 20 },
    ],
  });
  // 上面最后一轮之后会再交一版（v04），这里把它退回（真实的四条意见）。
  b.run(
    qingning,
    "task.review",
    {
      taskId: b.task(andlc, "paint", 5, "A"),
      verdict: "return",
      comments: [
        c("上色单独建了动画文件夹，导出时上色和主线分离了——直接在已有的 A / B 层动画文件夹里按张数新建图层上色", { tag: "分层错误" }),
        c("A 层上色到第 14 张就可以，B 层再补 1–4 张口型，保证不漏色", { layer: "A", sheets: "14", tag: "漏色" }),
        c("第 18 张下巴漏色", { layer: "A", sheets: "18", tag: "漏色" }),
        c("上色不用分这么细，整合到一个图层就行，分离的事后期也能做", { tag: "分层错误" }),
      ],
    },
    at("2026-10-23 09:00")
  );

  // C011 中割：木星照原画的动画轨目重做（快到时限）；北窗在做 B 层
  const c011a = b.task(andlc, "inbetween", 11, "A");
  b.run(muxing, "task.claim", { taskId: c011a }, at("2026-10-21 15:00"));
  b.run(muxing, "thread.open", { subjectType: "task", subjectId: c011a, kind: "ask", askStageKey: "key", text: "第 4、5 张之间有中割标记，轨目漏了，这里怎么读？" }, at("2026-10-21 16:00"));
  const askId = Object.values(b.state.threads).find((t) => t.subjectId === c011a && t.kind === "ask")!.id;
  b.run(lizi, "thread.reply", { threadId: askId, text: "4、5 之间按 1/3、2/3 分两张，轨目我补上了，以轨目为准" }, at("2026-10-21 18:00"));
  b.run(muxing, "task.submit", { taskId: c011a, link: L("ANI", 11, "A"), note: "先交一版" }, at("2026-10-22 09:00"));
  b.run(qingning, "task.review", { taskId: c011a, verdict: "return", comments: [c("照原画的动画轨目重做，现在的中割没按轨目分", { layer: "A", tag: "漏轨目" })] }, at("2026-10-22 11:00"));
  b.run(beichuang, "task.claim", { taskId: b.task(andlc, "inbetween", 11, "B") }, at("2026-10-22 14:00"));
  b.run(muxing, "thread.open", { subjectType: "cut", subjectId: b.cutId(andlc, 11), kind: "setting", stageKey: "inbetween", text: "箭头影要简化去掉，还是沿用第 9 卡加影的设定？" }, at("2026-10-22 15:00"));
  b.run(beichuang, "thread.open", { subjectType: "cut", subjectId: b.cutId(andlc, 9), kind: "ask", askStageKey: "key", text: "第 12 张原画和 Layout 的镜头位置对不上，以哪个为准？" }, at("2026-10-22 16:30"));
  b.run(bailu, "thread.open", { subjectType: "project", subjectId: andlc, kind: "comment", text: "1–14 卡有哪些已经交到导出了？要尽快了" }, at("2026-10-22 20:00"));

  // —— 电猫与电鼠：企划与风险评估 · 资金与团队组建 · 剧本 · 分镜 · 美术设计 通过；Layout 75%；一原 25% ——
  const D = (folder: string, cut: number | null = null) => linkFor("DMDS", folder, cut, null);
  work(b, b.task(dmds, "plan", null), { worker: bailu, reviewer: qingning, start: at("2026-03-02 14:00"), workHours: 6, link: D("策划"), note: "企划与风险评估 · 资金与团队组建" });
  work(b, b.task(dmds, "script", null), { worker: bailu, reviewer: qingning, start: at("2026-03-06 10:00"), workHours: 6, link: D("剧本") });
  work(b, b.task(dmds, "art", null), { worker: lizi, reviewer: bailu, start: at("2026-03-10 10:00"), workHours: 10, link: D("设定") });
  work(b, b.task(dmds, "storyboard", null), { worker: bailu, reviewer: qingning, start: at("2026-03-14 10:00"), workHours: 8, link: D("分镜") });
  for (let n = 1; n <= 6; n++) {
    work(b, b.task(dmds, "layout", n), { worker: n % 2 ? songzhen : lizi, reviewer: bailu, start: plusHours(at("2026-04-01 10:00"), (n - 1) * 30), workHours: 2, link: D("LO", n) });
  }
  for (let n = 1; n <= 2; n++) {
    work(b, b.task(dmds, "key", n), { worker: lizi, reviewer: qingning, start: plusHours(at("2026-04-12 10:00"), (n - 1) * 50), workHours: 20, link: D("H", n) });
    work(b, b.task(dmds, "key_check", n), { worker: qingning, reviewer: bailu, start: plusHours(at("2026-04-22 10:00"), (n - 1) * 30), workHours: 1, link: D("H", n) });
  }

  const state = b.state;
  // 示范世界的时钟冻结在 2026-10-23 10:00（底的一部分，不是一步操作）。
  const world = state.worlds[DEMO_WORLD_ID];
  state.worlds[DEMO_WORLD_ID] = { ...world, rules: { ...world.rules, clock: { fixedNow: DEMO_NOW } } };
  cached = state;
  return state;
}
