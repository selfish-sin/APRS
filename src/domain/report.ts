/**
 * 反向导出汇报（SPEC §15.3）：照工会已有的表的列，把工会里的数据排成几张表（纯函数，不碰写文件的库）。
 *   1 进度总表 · 2 项目规划表（按周的格子 + 颜色）· 3 卡 × 环节网格 · 4 必要劳动时间统计表 · 5 审核记录
 * 成员页「导出我的记录」：我的任务 · 工时 · 活力点流水。
 * 表头和表名跟着界面的语言（zh / en）。
 */
import { cmp } from "./agenda";
import { addDays, daysBetween, localDate } from "./clock";
import { LEDGER_KIND_LABEL, PHASE_LABEL, TASK_STATUS_LABEL, VERDICT_LABEL } from "./labels";
import type { Id, StageRow, TaskStatus, WorldState } from "./model";
import { cutName, gridOf, indexOf, memberById, projectById, reviewsOf, scheduleOf, submissionsOf, taskView, todayOf } from "./queries";
import { EXTRA_KIND_LABEL } from "./naming";

export type Lang = "zh" | "en";
export type CellStyle = "header" | "plan" | "actual" | "over" | "today" | "phase" | "total";
export type CellValue = string | number | null;

export interface ReportTable {
  key: string;
  /** 工作表的名字（≤ 31 个字）。 */
  name: string;
  header: string[];
  rows: CellValue[][];
  /** 每列大概几个字宽。 */
  widths: number[];
  /** 数据行里要上色的格子（r 从数据第一行算起，0 起）。 */
  styles: { r: number; c: number; s: CellStyle }[];
  /** 表头的格子要另外上色的（例如「这一周」）。 */
  headerStyles?: { c: number; s: CellStyle }[];
  /** 冻结前几列（表头一行总是冻结）。 */
  freezeCols: number;
}

export const REPORT_KEYS = ["progress", "plan", "grid", "hours", "reviews"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

const L = {
  progress: { zh: "进度总表", en: "Progress" },
  plan: { zh: "项目规划表", en: "Schedule" },
  grid: { zh: "卡 × 环节", en: "Cuts x stages" },
  hours: { zh: "必要劳动时间统计表", en: "Labor hours" },
  reviews: { zh: "审核记录", en: "Reviews" },
  myTasks: { zh: "我的任务", en: "My tasks" },
  myHours: { zh: "工时", en: "Hours" },
  myLedger: { zh: "活力点流水", en: "Points ledger" },
} satisfies Record<string, Record<Lang, string>>;

export const REPORT_LABEL: Record<ReportKey, Record<Lang, string>> = { progress: L.progress, plan: L.plan, grid: L.grid, hours: L.hours, reviews: L.reviews };

const H = {
  progress: { zh: ["序号", "项目", "类型", "预计开始", "预计结束", "计划天数", "进度", "剩余天数", "状态", "实际结束"], en: ["No.", "Item", "Phase", "Planned start", "Planned end", "Planned days", "Progress", "Days left", "Status", "Actual end"] },
  plan: { zh: ["环节", "阶段", "负责人", "计划开始", "计划工期（周）", "实际开始", "实际工期（周）", "完成"], en: ["Stage", "Phase", "Owner", "Planned start", "Planned weeks", "Actual start", "Actual weeks", "Done"] },
  hours: { zh: ["人员", "导演 / 监制", "剧本 / 分镜", "LO", "原画", "中割 / 清线", "填色", "后期", "其他", "总计工时", "活力点"], en: ["Member", "Director / producer", "Script / storyboard", "Layout", "Key animation", "In-between / cleanup", "Coloring", "Post", "Other", "Total hours", "Points"] },
  reviews: { zh: ["时间", "卡", "环节", "版本", "交的人", "谁审", "结论", "质量系数", "意见"], en: ["When", "Cut", "Stage", "Version", "Submitted by", "Reviewed by", "Verdict", "Quality", "Comments"] },
  myTasks: { zh: ["项目", "任务", "状态", "最新版本", "交的时间", "通过时间", "活力点"], en: ["Project", "Task", "Status", "Latest version", "Submitted", "Passed", "Points"] },
  myHours: { zh: ["环节", "通过几张", "工时", "活力点"], en: ["Stage", "Tasks passed", "Hours", "Points"] },
  myLedger: { zh: ["时间", "种类", "任务", "工时", "系数", "质量", "活力点", "说明"], en: ["When", "Kind", "Task", "Hours", "Factor", "Quality", "Points", "Note"] },
};

const STATUS_EN: Record<TaskStatus, string> = { locked: "Locked", open: "Open", claimed: "In progress", submitted: "In review", returned: "Returned", passed: "Passed", reclaimed: "Reclaimed" };
const PHASE_EN = { pre: "Pre-production", mid: "Production", post: "Post-production" } as const;
const VERDICT_EN = { pass: "Pass", return: "Return", fix_pass: "Fixed & passed" } as const;
const LEDGER_EN = { task: "Task", self_fix: "Reviewer fix", penalty: "Late penalty" } as const;

const statusText = (s: TaskStatus, lang: Lang) => (lang === "en" ? STATUS_EN[s] : TASK_STATUS_LABEL[s]);
const phaseText = (p: StageRow["phase"], lang: Lang) => (lang === "en" ? PHASE_EN[p] : PHASE_LABEL[p]);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const v2 = (n: number) => `v${String(n).padStart(2, "0")}`;
const stageName = (s: StageRow) => s.name.replace(/（.*?）/, "");

/** 必要劳动时间统计表：环节 → 工会表里的列（1–8，对应 H.hours 的第 2–9 列）。 */
export const HOURS_COLUMN: Record<string, number> = {
  plan: 1,
  script: 2,
  storyboard: 2,
  layout: 3,
  key: 4,
  key_check: 4,
  clean: 5,
  inbetween: 5,
  inbetween_check: 5,
  color_out: 6,
  paint: 6,
  paint_check: 6,
  export: 7,
  composite: 7,
  fx: 7,
  final: 7,
  sound: 7,
};

function sheetName(s: string): string {
  return s.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
}

export function progressTable(state: WorldState, projectId: Id, lang: Lang): ReportTable | null {
  const sched = scheduleOf(state, projectId);
  if (!sched) return null;
  const today = todayOf(state);
  const rows: CellValue[][] = [];
  const styles: ReportTable["styles"] = [];
  let i = 0;
  for (const ph of sched.phases)
    for (const r of ph.rows) {
      const start = sched.weekStarts[r.plan.start - 1] ?? addDays(sched.project.startOn, (r.plan.start - 1) * sched.cycleDays);
      const end = addDays(addDays(sched.project.startOn, r.plan.end * sched.cycleDays), -1);
      const done = r.actual?.done ?? false;
      const left = daysBetween(today, end);
      const status = done ? (lang === "en" ? "Done" : "完成") : !r.actual ? (left < 0 ? (lang === "en" ? "Late" : "超期") : lang === "en" ? "Not started" : "未开始") : left < 0 ? (lang === "en" ? "Late" : "超期") : lang === "en" ? "In progress" : "进行中";
      const tasks = indexOf(state).tasksByStage.get(r.stage.id) ?? [];
      const lastPass = done ? tasks.map((t) => (t.passedAt ? localDate(t.passedAt) : "")).sort(cmp).pop() ?? "" : "";
      rows.push([++i, stageName(r.stage), phaseText(r.stage.phase, lang), start, end, daysBetween(start, end) + 1, pct(r.progress), done ? 0 : left, status, lastPass || null]);
      if (!done && left < 0) styles.push({ r: rows.length - 1, c: 8, s: "over" });
    }
  return { key: "progress", name: sheetName(L.progress[lang]), header: H.progress[lang], rows, widths: [6, 22, 12, 12, 12, 10, 8, 10, 10, 12], styles, freezeCols: 2 };
}

export function planTable(state: WorldState, projectId: Id, lang: Lang): ReportTable | null {
  const sched = scheduleOf(state, projectId);
  if (!sched) return null;
  const idx = indexOf(state);
  const weeks = Array.from({ length: sched.weeks }, (_, i) => i + 1);
  const header = [...H.plan[lang], ...weeks.map((w) => `W${w} ${sched.weekStarts[w - 1].slice(5)}`)];
  const base = H.plan[lang].length;
  const rows: CellValue[][] = [];
  const styles: ReportTable["styles"] = [];
  const mark = { plan: lang === "en" ? "Plan" : "计", actual: lang === "en" ? "Actual" : "实", over: lang === "en" ? "Over" : "超" };
  for (const ph of sched.phases)
    for (const r of ph.rows) {
      // 负责人：这个环节做得最多的一两个人。
      const count = new Map<Id, number>();
      for (const t of idx.tasksByStage.get(r.stage.id) ?? []) if (t.assigneeId) count.set(t.assigneeId, (count.get(t.assigneeId) ?? 0) + 1);
      const owners = Array.from(count.entries())
        .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
        .slice(0, 2)
        .map(([id]) => idx.memberById.get(id)?.nickname ?? "")
        .filter(Boolean)
        .join("、");
      const row: CellValue[] = [
        stageName(r.stage),
        phaseText(r.stage.phase, lang),
        owners || null,
        `W${r.plan.start}`,
        r.plan.end - r.plan.start + 1,
        r.actual ? `W${r.actual.start}` : null,
        r.actual ? r.actual.end - r.actual.start + 1 : null,
        pct(r.progress),
      ];
      const ri = rows.length;
      for (const w of weeks) {
        const inPlan = w >= r.plan.start && w <= r.plan.end;
        const inActual = !!r.actual && w >= r.actual.start && w <= r.actual.end;
        const over = inActual && w > r.plan.end;
        const c = base + w - 1;
        if (over) {
          row.push(mark.over);
          styles.push({ r: ri, c, s: "over" });
        } else if (inActual) {
          row.push(mark.actual);
          styles.push({ r: ri, c, s: "actual" });
        } else if (inPlan) {
          row.push(mark.plan);
          styles.push({ r: ri, c, s: "plan" });
        } else row.push(null);
      }
      rows.push(row);
    }
  return {
    key: "plan",
    name: sheetName(L.plan[lang]),
    header,
    rows,
    widths: [20, 12, 14, 10, 12, 10, 12, 8, ...weeks.map(() => 9)],
    styles,
    headerStyles: [{ c: base + sched.today - 1, s: "today" }],
    freezeCols: 1,
  };
}

export function gridTable(state: WorldState, projectId: Id, lang: Lang): ReportTable | null {
  const grid = gridOf(state, projectId);
  if (!grid) return null;
  const header = [lang === "en" ? "Cut" : "卡", ...grid.columns.map(stageName)];
  const rows: CellValue[][] = grid.rows.map((row) => [
    row.code,
    ...row.cells.map((cell) =>
      cell.tasks.length
        ? cell.tasks
            .map((t) => [t.task.layer ? `${t.task.layer}` : null, statusText(t.task.status, lang), t.task.outsourced ? (lang === "en" ? "outsourced" : "外包") : t.assignee?.nickname ?? null, t.versionTag].filter(Boolean).join(" · "))
            .join(" / ") + (cell.extras.length ? (lang === "en" ? ` (+${cell.extras.length} extra)` : `（另 ${cell.extras.length} 件）`) : "")
        : null
    ),
  ]);
  return { key: "grid", name: sheetName(L.grid[lang]), header, rows, widths: [8, ...grid.columns.map(() => 22)], styles: [], freezeCols: 1 };
}

/** 必要劳动时间统计表：人员 × 岗位工时。month = "2026-10" 只算那个月；不写 = 整个项目。 */
export function hoursTable(state: WorldState, projectId: Id, lang: Lang, month: string | null = null): ReportTable | null {
  const idx = indexOf(state);
  const project = idx.projectById.get(projectId);
  if (!project) return null;
  const byMember = new Map<Id, number[]>();
  for (const m of idx.members) {
    for (const l of idx.ledgerByMember.get(m.id) ?? []) {
      const t = l.taskId ? idx.taskById.get(l.taskId) : undefined;
      if (!t || t.projectId !== projectId) continue;
      if (month && !localDate(l.at).startsWith(month)) continue;
      const s = idx.stageById.get(t.stageId);
      const col = s ? HOURS_COLUMN[s.templateKey] ?? 8 : 8;
      const row = byMember.get(m.id) ?? Array(11).fill(0);
      row[col] += l.hours;
      row[9] += l.hours;
      row[10] += l.points;
      byMember.set(m.id, row);
    }
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  const rows: CellValue[][] = [];
  const total = Array(11).fill(0);
  for (const m of idx.members) {
    const r = byMember.get(m.id);
    if (!r) continue;
    rows.push([m.nickname, ...r.slice(1).map(round)]);
    for (let i = 1; i < 11; i++) total[i] += r[i];
  }
  rows.push([lang === "en" ? "Total" : "合计", ...total.slice(1).map(round)]);
  const styles = H.hours[lang].map((_, c) => ({ r: rows.length - 1, c, s: "total" as CellStyle }));
  const suffix = month ? ` ${month}` : "";
  return { key: "hours", name: sheetName(`${L.hours[lang]}${suffix}`), header: H.hours[lang], rows, widths: [12, 12, 12, 8, 10, 12, 8, 8, 8, 10, 10], styles, freezeCols: 1 };
}

export function reviewsTable(state: WorldState, projectId: Id, lang: Lang): ReportTable | null {
  const idx = indexOf(state);
  if (!idx.projectById.get(projectId)) return null;
  const rows: { at: string; row: CellValue[] }[] = [];
  for (const t of idx.tasks) {
    if (t.projectId !== projectId) continue;
    const v = taskView(state, t);
    if (!v) continue;
    const subs = submissionsOf(state, t.id);
    for (const r of reviewsOf(state, t.id)) {
      const sub = subs.find((s) => s.id === r.submissionId);
      const comments = r.comments.map((c) => [c.layer ? (lang === "en" ? `layer ${c.layer}` : `${c.layer} 层`) : null, c.sheets ? (lang === "en" ? `#${c.sheets}` : `第 ${c.sheets} 张`) : null, c.tag, c.text].filter(Boolean).join(" ")).join("；");
      rows.push({
        at: r.at,
        row: [
          localDate(r.at),
          v.cut ? cutName(state, v.cut) : null,
          t.extra ? `${stageName(v.stage)} ${lang === "en" ? t.extra.kind : EXTRA_KIND_LABEL[t.extra.kind]}：${t.extra.title}` : `${stageName(v.stage)}${t.layer ? ` ${t.layer}` : ""}`,
          sub ? v2(sub.versionNo) : null,
          sub?.byMemberId ? memberById(state, sub.byMemberId)?.nickname ?? null : t.outsourceName,
          memberById(state, r.byMemberId)?.nickname ?? null,
          lang === "en" ? VERDICT_EN[r.verdict] : VERDICT_LABEL[r.verdict],
          r.quality,
          comments || null,
        ],
      });
    }
  }
  rows.sort((a, b) => cmp(a.at, b.at));
  return { key: "reviews", name: sheetName(L.reviews[lang]), header: H.reviews[lang], rows: rows.map((x) => x.row), widths: [12, 8, 22, 8, 10, 10, 12, 8, 50], styles: [], freezeCols: 0 };
}

export function buildReport(state: WorldState, projectId: Id, keys: readonly ReportKey[], opts: { lang?: Lang; month?: string | null } = {}): ReportTable[] {
  const lang = opts.lang ?? "zh";
  const out: ReportTable[] = [];
  for (const k of keys) {
    const t =
      k === "progress"
        ? progressTable(state, projectId, lang)
        : k === "plan"
          ? planTable(state, projectId, lang)
          : k === "grid"
            ? gridTable(state, projectId, lang)
            : k === "hours"
              ? hoursTable(state, projectId, lang, opts.month ?? null)
              : reviewsTable(state, projectId, lang);
    if (t) out.push(t);
  }
  return out;
}

/** 成员页「导出我的记录」：我的任务 · 工时 · 活力点流水。 */
export function memberRecord(state: WorldState, memberId: Id, lang: Lang = "zh"): ReportTable[] {
  const idx = indexOf(state);
  const ledger = idx.ledgerByMember.get(memberId) ?? [];
  const pointsByTask = new Map<Id, number>();
  for (const l of ledger) if (l.taskId) pointsByTask.set(l.taskId, (pointsByTask.get(l.taskId) ?? 0) + l.points);
  const mine = idx.tasks.filter((t) => t.assigneeId === memberId || (idx.subsByTask.get(t.id) ?? []).some((s) => s.byMemberId === memberId));
  const tasks: CellValue[][] = mine.map((t) => {
    const v = taskView(state, t)!;
    const subs = idx.subsByTask.get(t.id) ?? [];
    const last = subs[subs.length - 1];
    return [v.project.name, v.label, statusText(t.status, lang), last ? v2(last.versionNo) : null, last ? localDate(last.at) : null, t.passedAt ? localDate(t.passedAt) : null, pointsByTask.get(t.id) ?? null];
  });
  const byStage = new Map<string, { n: number; hours: number; points: number }>();
  for (const l of ledger) {
    const t = l.taskId ? idx.taskById.get(l.taskId) : undefined;
    const s = t ? idx.stageById.get(t.stageId) : undefined;
    const name = s ? stageName(s) : lang === "en" ? "Other" : "其他";
    const cur = byStage.get(name) ?? { n: 0, hours: 0, points: 0 };
    if (l.kind === "task") cur.n += 1;
    cur.hours += l.hours;
    cur.points += l.points;
    byStage.set(name, cur);
  }
  const hours: CellValue[][] = Array.from(byStage.entries()).map(([name, x]) => [name, x.n, Math.round(x.hours * 10) / 10, Math.round(x.points * 10) / 10]);
  const flow: CellValue[][] = ledger.map((l) => {
    const t = l.taskId ? idx.taskById.get(l.taskId) : undefined;
    return [localDate(l.at), lang === "en" ? LEDGER_EN[l.kind] : LEDGER_KIND_LABEL[l.kind], t ? taskView(state, t)?.title ?? null : null, l.hours, l.factor, l.quality, l.points, l.note];
  });
  return [
    { key: "myTasks", name: sheetName(L.myTasks[lang]), header: H.myTasks[lang], rows: tasks, widths: [14, 30, 10, 10, 12, 12, 8], styles: [], freezeCols: 0 },
    { key: "myHours", name: sheetName(L.myHours[lang]), header: H.myHours[lang], rows: hours, widths: [20, 10, 10, 10], styles: [], freezeCols: 0 },
    { key: "myLedger", name: sheetName(L.myLedger[lang]), header: H.myLedger[lang], rows: flow, widths: [12, 10, 36, 8, 8, 8, 8, 20], styles: [], freezeCols: 0 },
  ];
}

/** 文件名：「安娜的旅程-汇报-2026-10-23.xlsx」。 */
export function reportFileName(state: WorldState, projectId: Id, ext: "xlsx" | "csv", lang: Lang = "zh", table?: string): string {
  const p = projectById(state, projectId);
  const base = `${p?.code ?? "project"}-${lang === "en" ? "report" : "汇报"}${table ? `-${table}` : ""}-${todayOf(state)}`;
  return `${base.replace(/[\\/:*?"<>|\s]+/g, "-")}.${ext}`;
}

export function memberFileName(state: WorldState, memberId: Id, lang: Lang = "zh"): string {
  const m = memberById(state, memberId);
  return `${(m?.nickname ?? "member").replace(/[\\/:*?"<>|\s]+/g, "-")}-${lang === "en" ? "records" : "我的记录"}-${todayOf(state)}.xlsx`;
}
