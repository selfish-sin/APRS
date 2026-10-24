/**
 * 以图为主（SPEC §18.6）：每一格（卡 × 环节 × 层）现在是什么状态、最新一版的缩略图是哪张；按环节算「还差多少」。
 * 纯函数（只读 ReadModel），盘点页 · 项目页 · 环节页 · 卡详情 · 导出汇报用同一套。
 *
 * 状态（墙上格子右上角的小标）：
 *   已核实 ✓ —— 系统里最新那一版有「已核实」或「补录」（人看过对上了）；
 *   待复查 —— 名字对上了、还没写回；或者系统说交了、还没盘点过；
 *   没文件 —— 系统说交了，最近一次盘点没找到文件；
 *   有问题 ⚠ —— 最近一次盘点里归到这一格的那一版有问题（名字 / 放的地方），还没人确认；
 *   缺 —— 系统里没交，也没找到文件（或者打回重做了）。
 */
import type { AuditItemRow, AuditRow, CutRow, FileRow, Id, IsoDateTime, StageRow, SubmissionRow, TaskRow } from "../model";
import type { ReadModel } from "../readmodel";
import { auditInputs, checkAudit, projectFacts, type AuditCell, type AuditCheck, type AuditEntry, type ProjectFacts } from "./check";

export type DeliveryMark = "verified" | "pending" | "nofile" | "issue" | "missing";
/** 从最差到最好（墙上一卡几层时取最差的）。 */
export const MARK_ORDER: readonly DeliveryMark[] = ["missing", "issue", "nofile", "pending", "verified"];
export const MARKS_SHOWN: readonly DeliveryMark[] = ["verified", "pending", "nofile", "issue", "missing"];

export function worstMark(marks: DeliveryMark[]): DeliveryMark {
  let best = MARK_ORDER.length - 1;
  for (const m of marks) best = Math.min(best, MARK_ORDER.indexOf(m));
  return MARK_ORDER[best];
}

export interface ThumbRef {
  sha256: string;
  mime: string;
  name: string;
  /** 文件 = 交的时候附的图；audit = 盘点读出来的缩略图。 */
  from: "file" | "audit";
  demo: boolean;
}

export interface DeliveryCell {
  task: TaskRow;
  stage: StageRow;
  cut: CutRow | null;
  layer: string | null;
  mark: DeliveryMark;
  /** 显示的版本号（找到的文件的，没有就系统里的）。 */
  version: number | null;
  /** 版本号后面带的字（「第一次修改后」）。 */
  note: string | null;
  thumb: ThumbRef | null;
  /** 系统里最新的一版。 */
  sub: SubmissionRow | null;
  backfilled: boolean;
  verifiedAt: IsoDateTime | null;
  /** 最近一次盘点里这一格。 */
  cell: AuditCell | null;
  entry: AuditEntry | null;
  /** 最新的文件名。 */
  fileName: string | null;
}

export interface StageRemaining {
  stage: StageRow | null;
  /** 应交：卡数 × 层（项目级环节按集）。 */
  due: number;
  verified: number;
  pending: number;
  nofile: number;
  issue: number;
  missing: number;
  /** 有「缺」的卡有几张（路线行的「缺 N 卡」）。 */
  missingCuts: number;
}

export interface Deliveries {
  facts: ProjectFacts;
  /** 最近一次盘点。 */
  audit: AuditRow | null;
  check: AuditCheck | null;
  cells: DeliveryCell[];
  cellByTask: Map<Id, DeliveryCell>;
  stages: StageRemaining[];
  total: StageRemaining;
}

/** 这个项目的盘点，新的在前。 */
export function auditsOfProject(rm: ReadModel, projectId: Id): AuditRow[] {
  return rm.where("audits", { projectId }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

const isImage = (f: Pick<FileRow, "mime">) => f.mime.startsWith("image/");

function entryThumb(e: AuditEntry | null): ThumbRef | null {
  if (!e) return null;
  const it = e.items.find((i) => i.thumb) ?? null;
  return it?.thumb ? { sha256: it.thumb.sha256, mime: it.thumb.mime, name: it.name, from: "audit", demo: !!it.demo } : null;
}

export function deliveriesOf(rm: ReadModel, projectId: Id): Deliveries | null {
  const facts = projectFacts(rm, projectId);
  if (!facts) return null;
  const audits = auditsOfProject(rm, projectId);
  const audit = audits[0] ?? null;
  const inputs = audit ? auditInputs(rm, audit.id) : null;
  const check = inputs ? checkAudit(inputs) : null;

  // 交的时候附的图：版本上的 · 任务上的
  const filesBy = new Map<Id, FileRow[]>();
  for (const f of rm.where("files", { projectId })) {
    if (!isImage(f) || (f.subjectType !== "submission" && f.subjectType !== "task")) continue;
    const list = filesBy.get(f.subjectId);
    if (list) list.push(f);
    else filesBy.set(f.subjectId, [f]);
  }
  // 补录 / 核实指着的那一条（可能是更早那次盘点的）
  const itemCache = new Map<Id, AuditItemRow | undefined>();
  const itemOf = (id: Id | null | undefined) => {
    if (!id) return undefined;
    if (!itemCache.has(id)) itemCache.set(id, rm.get("auditItems", id));
    return itemCache.get(id);
  };

  const cells: DeliveryCell[] = [];
  const cellByTask = new Map<Id, DeliveryCell>();
  for (const task of facts.tasks) {
    const stage = facts.stages.find((s) => s.id === task.stageId)!;
    const cut = task.cutId ? facts.cutById.get(task.cutId) ?? null : null;
    const subs = facts.subsByTask.get(task.id) ?? [];
    const sub = subs[subs.length - 1] ?? null;
    const cell = check?.cellByTask.get(task.id) ?? null;
    const top = cell?.top ?? null;
    const mark = markOf(task, sub, cell);
    // 缩略图：最新一版附的图 → 补录 / 核实时的那张 → 这次盘点读到的 → 任务上附的图
    let thumb: ThumbRef | null = null;
    const subFile = sub ? (filesBy.get(sub.id) ?? [])[0] : undefined;
    if (subFile) thumb = { sha256: subFile.sha256, mime: subFile.mime, name: subFile.name, from: "file", demo: subFile.tags.includes("示范图") };
    if (!thumb && sub) {
      const it = itemOf(sub.backfill?.itemId ?? sub.verified?.itemId ?? null);
      if (it?.thumb) thumb = { sha256: it.thumb.sha256, mime: it.thumb.mime, name: it.name, from: "audit", demo: !!it.demo };
    }
    if (!thumb && top && (top.place.version ?? 0) >= (sub?.versionNo ?? 0)) thumb = entryThumb(top);
    if (!thumb) {
      const tf = (filesBy.get(task.id) ?? []).slice(-1)[0];
      if (tf) thumb = { sha256: tf.sha256, mime: tf.mime, name: tf.name, from: "file", demo: tf.tags.includes("示范图") };
    }
    if (!thumb && top) thumb = entryThumb(top);
    const showTop = top && (top.place.version ?? 0) >= (sub?.versionNo ?? 0);
    const dc: DeliveryCell = {
      task,
      stage,
      cut,
      layer: task.layer,
      mark,
      version: showTop ? top!.place.version : sub?.versionNo ?? null,
      note: showTop ? top!.parsed.note : null,
      thumb,
      sub,
      backfilled: !!sub?.backfill,
      verifiedAt: sub?.verified?.at ?? (sub?.backfill ? sub.at : null),
      cell,
      entry: top,
      fileName: showTop ? top!.primary.name : sub?.fileName ?? null,
    };
    cells.push(dc);
    cellByTask.set(task.id, dc);
  }

  const empty = (stage: StageRow | null): StageRemaining => ({ stage, due: 0, verified: 0, pending: 0, nofile: 0, issue: 0, missing: 0, missingCuts: 0 });
  const stages: StageRemaining[] = facts.stages.map((s) => empty(s));
  const byId = new Map(stages.map((r) => [r.stage!.id, r]));
  const missingCuts = new Map<Id, Set<string>>();
  for (const c of cells) {
    const r = byId.get(c.stage.id);
    if (!r) continue;
    r.due += 1;
    r[c.mark] += 1;
    if (c.mark === "missing") {
      const set = missingCuts.get(c.stage.id) ?? new Set<string>();
      set.add(c.cut?.id ?? "project");
      missingCuts.set(c.stage.id, set);
    }
  }
  for (const r of stages) r.missingCuts = missingCuts.get(r.stage!.id)?.size ?? 0;
  const total = empty(null);
  for (const r of stages) {
    total.due += r.due;
    total.verified += r.verified;
    total.pending += r.pending;
    total.nofile += r.nofile;
    total.issue += r.issue;
    total.missing += r.missing;
    total.missingCuts += r.missingCuts;
  }
  return { facts, audit, check, cells, cellByTask, stages, total };
}

function markOf(task: TaskRow, sub: SubmissionRow | null, cell: AuditCell | null): DeliveryMark {
  if (task.redo) return "missing";
  if (sub && (sub.verified || sub.backfill)) {
    // 盘点里又看到更新的一版（还没写回）：照这次盘点的说
    if (!(cell?.top && cell.outcome === "newer")) return "verified";
  }
  if (cell) {
    const top = cell.top;
    if (top) {
      const r = top.review;
      if (r?.verdict === "wrong") return "issue";
      if (top.issues.length && r?.verdict !== "ok") return "issue";
      if (cell.outcome === "nofile") return cell.inScope ? "nofile" : sub ? "pending" : "missing";
      return "pending";
    }
    if (cell.inScope && cell.outcome === "nofile") return cell.decision?.review?.verdict === "elsewhere" ? "pending" : "nofile";
  }
  return sub ? "pending" : "missing";
}

/** 墙上的一格 = 一卡（几层的卡显示 A 层的图，状态取各层里最差的）。 */
export interface WallCell {
  stage: StageRow;
  cut: CutRow | null;
  layers: DeliveryCell[];
  mark: DeliveryMark;
  /** 显示的那一层（A 层；A 层没图就用有图的那层）。 */
  shown: DeliveryCell | null;
}

/** 墙上默认放的环节：有画面的（审核类 · 输出上色文件 · 导出默认收起）。 */
export const WALL_FOLDED_KEYS = ["color_out", "export"];

export function wallStages(facts: ProjectFacts, all = false): StageRow[] {
  return facts.stages.filter((s) => s.grain !== "project" && (all || (s.kind !== "review" && !WALL_FOLDED_KEYS.includes(s.templateKey))));
}

export function wallCell(d: Deliveries, stage: StageRow, cut: CutRow | null): WallCell {
  const layers = d.cells.filter((c) => c.stage.id === stage.id && (stage.grain === "project" ? true : c.cut?.id === cut?.id));
  const order = cut?.layers.map((l) => l.name) ?? [];
  layers.sort((a, b) => order.indexOf(a.layer ?? "") - order.indexOf(b.layer ?? ""));
  const shown = layers.find((l) => l.thumb) ? (layers[0]?.thumb ? layers[0] : layers.find((l) => l.thumb)!) : layers[0] ?? null;
  return { stage, cut, layers, mark: layers.length ? worstMark(layers.map((l) => l.mark)) : "missing", shown };
}
