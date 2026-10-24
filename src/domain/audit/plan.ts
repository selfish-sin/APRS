/**
 * 盘点第 ④ 步：写回以前列的清单（SPEC §18.8）。纯函数——命令照它改，页面照它显示数字，两边一样。
 *   核实：确认过、和系统里那一版对上的 → 那一版记「已核实」，状态不变；「文件在别处」的也算核实。
 *   补录：确认过、系统里没记的 → 记一版「补录」的交付，任务变「通过」；文件比系统新的照写回时的选择。
 *   打回：「确实没交」的，「不对 · 没做完」并勾了打回的 → 照 §12.2 打回重做。
 *   加卡：卡不在卡表里、复查点了「加这一卡」的。
 *   不动：其余的（不是这个项目的 · 不要 · 跳过 · 还没复查 · 不对）。
 */
import type { AuditItemRow, CutRow, StageRow, SubmissionRow, TaskRow } from "../model";
import type { AuditCheck, AuditEntry } from "./check";

export interface PlanVerify {
  task: TaskRow;
  stage: StageRow;
  cut: CutRow | null;
  sub: SubmissionRow;
  entry: AuditEntry | null;
  /** 「文件在别处」的那一条。 */
  decision: AuditItemRow | null;
}

export interface PlanBackfill {
  task: TaskRow;
  stage: StageRow;
  cut: CutRow | null;
  entry: AuditEntry;
  /** 记成第几版（文件上的版本号；系统里已经有更高的就接着往后）。 */
  version: number;
  /** 文件比系统新的。 */
  newer: boolean;
}

export interface PlanRedo {
  task: TaskRow;
  stage: StageRow;
  cut: CutRow | null;
  why: "missing" | "unfinished";
  item: AuditItemRow;
}

export interface PlanAddCut {
  number: number;
  suffix: string;
  entries: AuditEntry[];
}

export interface WritePlan {
  verify: PlanVerify[];
  backfill: PlanBackfill[];
  /** 确认过的「文件比系统新」（写回时选 记成新的一版 / 不管）。 */
  newer: PlanBackfill[];
  redo: PlanRedo[];
  addCuts: PlanAddCut[];
  untouched: { total: number; foreign: number; dropped: number; skipped: number; wrong: number; notReviewed: number };
}

export interface PlanOptions {
  /** 文件比系统新的：记成新的一版（补录一版）· 不管。 */
  newer: "record" | "ignore";
}

export function backfillVersion(task: TaskRow, entry: AuditEntry): number {
  return Math.max(entry.place.version ?? 1, task.versions + 1);
}

export function writePlan(check: AuditCheck, opts: PlanOptions = { newer: "record" }): WritePlan {
  const verify: PlanVerify[] = [];
  const backfill: PlanBackfill[] = [];
  const newer: PlanBackfill[] = [];
  const redo: PlanRedo[] = [];
  const addCuts: PlanAddCut[] = [];
  const done = new Set<string>();
  const verified = new Set<string>();
  const redone = new Set<string>();

  for (const cell of check.cells) {
    const top = cell.top;
    if (top && top.review?.verdict === "ok") {
      const subs = check.facts.subsByTask.get(cell.task.id) ?? [];
      if (cell.outcome === "matched") {
        const sub = subs.find((s) => s.versionNo === top.place.version);
        if (sub && !sub.verified && !verified.has(sub.id)) {
          verify.push({ task: cell.task, stage: cell.stage, cut: cell.cut, sub, entry: top, decision: null });
          verified.add(sub.id);
        }
        done.add(top.key);
      } else if (cell.outcome === "unrecorded" || cell.outcome === "newer") {
        const b: PlanBackfill = { task: cell.task, stage: cell.stage, cut: cell.cut, entry: top, version: backfillVersion(cell.task, top), newer: cell.outcome === "newer" };
        if (b.newer) newer.push(b);
        if (!b.newer || opts.newer === "record") {
          backfill.push(b);
          done.add(top.key);
        }
      }
    }
    const d = cell.decision?.review;
    if (cell.decision && d && cell.outcome === "nofile") {
      if (d.verdict === "elsewhere" && cell.sysSub && !cell.sysSub.verified && !verified.has(cell.sysSub.id)) {
        verify.push({ task: cell.task, stage: cell.stage, cut: cell.cut, sub: cell.sysSub, entry: null, decision: cell.decision });
        verified.add(cell.sysSub.id);
        done.add(`cell:${cell.task.id}`);
      }
      if (d.verdict === "missing" && !redone.has(cell.task.id) && canRedo(cell.task)) {
        redo.push({ task: cell.task, stage: cell.stage, cut: cell.cut, why: "missing", item: cell.decision });
        redone.add(cell.task.id);
        done.add(`cell:${cell.task.id}`);
      }
    }
  }
  // 不对 · 没做完、勾了打回的
  for (const e of check.entries) {
    const r = e.review;
    if (!r || r.verdict !== "wrong" || !r.redo || !e.task || !e.stage) continue;
    if (redone.has(e.task.id) || !canRedo(e.task)) continue;
    redo.push({ task: e.task, stage: e.stage, cut: e.cut, why: "unfinished", item: e.primary });
    redone.add(e.task.id);
    done.add(e.key);
  }
  // 加卡
  const want = new Map<string, PlanAddCut>();
  for (const e of check.entries) {
    if (e.review?.verdict !== "add_cut" || e.cut || e.place.cutNumber === null) continue;
    const k = `${e.place.cutNumber}${e.place.cutSuffix}`;
    const cur = want.get(k);
    if (cur) cur.entries.push(e);
    else want.set(k, { number: e.place.cutNumber, suffix: e.place.cutSuffix, entries: [e] });
    done.add(e.key);
  }
  addCuts.push(...Array.from(want.values()).sort((a, b) => a.number - b.number || a.suffix.localeCompare(b.suffix)));

  // 不动的
  const untouched = { total: 0, foreign: 0, dropped: 0, skipped: 0, wrong: 0, notReviewed: 0 };
  untouched.foreign = check.foreign.length;
  const counted = new Set<string>();
  for (const q of check.queue) {
    if (done.has(q.id) || counted.has(q.id)) continue;
    counted.add(q.id);
    const r = q.entry ? q.entry.review : q.cell?.decision?.review ?? null;
    if (!r) untouched.notReviewed += 1;
    else if (r.verdict === "drop") untouched.dropped += 1;
    else if (r.verdict === "wrong") untouched.wrong += 1;
    else untouched.skipped += 1;
  }
  untouched.total = untouched.foreign + untouched.dropped + untouched.skipped + untouched.wrong + untouched.notReviewed;
  return { verify, backfill, newer, redo, addCuts, untouched };
}

/** 能打回重做的：通过的 · 交了等审的（在做的、退回的本来就在手上）。 */
export function canRedo(task: TaskRow): boolean {
  return task.status === "passed" || task.status === "submitted";
}

export function planIsEmpty(p: WritePlan): boolean {
  return !p.verify.length && !p.backfill.length && !p.redo.length && !p.addCuts.length;
}
