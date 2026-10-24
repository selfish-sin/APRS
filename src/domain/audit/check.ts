/**
 * 盘点的第一层：读名字以后和系统里记的对一遍（SPEC §18.4 · §18.5）。全是纯函数，命令和页面用同一套。
 *
 *   - 一条「版本」（entry）= 名字一样、只是扩展名不同的几个文件（…_v04.clip + …_v04.rar + …_v04.png 合成一版的几种格式）；
 *   - 一个「格子」（cell）= 一张任务（卡 × 环节 × 层；项目级环节一个）；
 *   - 每个格子得出一种结果：对上了 · 有文件系统没记 · 系统说交了没找到 · 文件比系统新 · 缺。
 * 自动的只提示，不改项目。
 */
import type { AuditItemRow, AuditPlace, AuditReview, AuditRow, CutRow, Id, ProjectRow, StageRow, SubmissionRow, TaskRow } from "../model";
import type { ReadModel } from "../readmodel";
import { folderFor } from "../naming";
import { folderHints, parseName, type NameIssue, type ParsedName } from "./names";

// ---------------------------------------------------------------------------
// 项目里的事实
// ---------------------------------------------------------------------------

export interface ProjectFacts {
  project: ProjectRow;
  /** 没停用的环节，按顺序。 */
  stages: StageRow[];
  stageByKey: Map<string, StageRow>;
  /** 没停用的卡，按卡号。 */
  cuts: CutRow[];
  cutById: Map<Id, CutRow>;
  /** 普通任务（不含随时发的新任务）。 */
  tasks: TaskRow[];
  taskByCell: Map<string, TaskRow>;
  subsByTask: Map<Id, SubmissionRow[]>;
  /** 各环节的文件代码（大写，去重）。 */
  codes: string[];
  /** 这个项目里出现过的层。 */
  layers: string[];
}

export const stageCode = (s: Pick<StageRow, "code" | "fileCode">): string => (s.code ?? s.fileCode).toUpperCase();
const cellKey = (stageId: Id, cutId: Id | null, layer: string | null) => `${stageId}|${cutId ?? ""}|${layer ?? ""}`;

export function projectFacts(rm: ReadModel, projectId: Id): ProjectFacts | null {
  const project = rm.get("projects", projectId);
  if (!project || project.archivedAt) return null;
  const stages = rm
    .where("stages", { projectId })
    .filter((s) => !s.disabled)
    .sort((a, b) => a.sort - b.sort);
  const cuts = rm
    .where("cuts", { projectId })
    .filter((c) => !c.disabled)
    .sort((a, b) => a.number - b.number || (a.suffix ?? "").localeCompare(b.suffix ?? ""));
  const stageIds = new Set(stages.map((s) => s.id));
  const cutIds = new Set(cuts.map((c) => c.id));
  const tasks = rm.where("tasks", { projectId }).filter((t) => !t.extra && stageIds.has(t.stageId) && (!t.cutId || cutIds.has(t.cutId)));
  const taskByCell = new Map<string, TaskRow>();
  for (const t of tasks) taskByCell.set(cellKey(t.stageId, t.cutId, t.layer), t);
  const subsByTask = new Map<Id, SubmissionRow[]>();
  for (const t of tasks) subsByTask.set(t.id, rm.where("submissions", { taskId: t.id }).sort((a, b) => a.versionNo - b.versionNo));
  const codes = Array.from(new Set(stages.map(stageCode)));
  const layers = Array.from(new Set(cuts.flatMap((c) => c.layers.map((l) => l.name))));
  return { project, stages, stageByKey: new Map(stages.map((s) => [s.templateKey, s])), cuts, cutById: new Map(cuts.map((c) => [c.id, c])), tasks, taskByCell, subsByTask, codes, layers };
}

export function nameContext(f: ProjectFacts) {
  return { projectCode: f.project.code, stageCodes: f.codes, layers: f.layers };
}

/** 照名字找卡：卡号 + 后缀，名字里有场 / 集时也要对上。 */
export function findCut(f: ProjectFacts, p: Pick<ParsedName, "cut" | "scene" | "episode">): CutRow | null {
  if (!p.cut) return null;
  let list = f.cuts.filter((c) => c.number === p.cut!.number && (c.suffix ?? "") === p.cut!.suffix);
  if (list.length > 1 && p.scene) list = list.filter((c) => c.scene === p.scene);
  if (list.length > 1 && p.episode) list = list.filter((c) => c.episode === p.episode);
  if (p.scene && list.length === 1 && list[0].scene !== p.scene && f.cuts.some((c) => c.scene === p.scene)) return null;
  return list[0] ?? null;
}

/** 一格的任务：项目级 = 那一张；每卡 = 那一卡；每卡每层 = 那一卡那一层（没写层 = 找不到）。 */
export function taskFor(f: ProjectFacts, stage: StageRow, cutId: Id | null, layer: string | null): TaskRow | null {
  if (stage.grain === "project") return f.taskByCell.get(cellKey(stage.id, null, null)) ?? null;
  if (!cutId) return null;
  if (stage.grain === "cut") return f.taskByCell.get(cellKey(stage.id, cutId, null)) ?? null;
  return layer ? f.taskByCell.get(cellKey(stage.id, cutId, layer)) ?? null : null;
}

function tasksOfCut(f: ProjectFacts, stage: StageRow, cutId: Id | null): TaskRow[] {
  if (stage.grain === "project") {
    const t = taskFor(f, stage, null, null);
    return t ? [t] : [];
  }
  return f.tasks.filter((t) => t.stageId === stage.id && t.cutId === cutId);
}

/** 这个代码可能是哪几个环节（有层的文件先看每卡每层的环节，没层的先看每卡的）。 */
export function stagesForCode(f: ProjectFacts, p: Pick<ParsedName, "code" | "kind" | "layer">): StageRow[] {
  if (!p.code) return [];
  const cands = f.stages.filter((s) => stageCode(s) === p.code);
  if (p.kind === "project") {
    const proj = cands.filter((s) => s.grain === "project");
    return proj.length ? proj : cands;
  }
  const layered = cands.filter((s) => s.grain === "layer");
  const perCut = cands.filter((s) => s.grain === "cut");
  const first = p.layer ? (layered.length ? layered : perCut) : perCut.length ? perCut : layered;
  return first.length ? first : cands;
}

/**
 * 最可能的归属（SPEC §18.4）：
 *   ① 系统里有哪一版的规范文件名和它完全一样（同卡 · 同层 · 同代码 · 同版本）→ 就是那一版的环节（几个都一样取最前的）；
 *   ①' 没有同名的，但某个环节这一格已经有更早的版本（v02 之前有 v01）→ 当那个环节的新一版（照设计 v7-4：v03 和 v02 在同一格）；
 *   ② 都没有的话，取这一卡在系统里还没通过的、最早的那个环节；都通过了就给最后一个。
 */
export function guessPlace(f: ProjectFacts, p: ParsedName): AuditPlace {
  const place: AuditPlace = { cutId: null, cutNumber: p.cut?.number ?? null, cutSuffix: p.cut?.suffix ?? "", stageKey: null, layer: p.layer, version: p.version };
  if (p.kind === "none" || p.foreign) return place;
  const cut = p.kind === "cut" ? findCut(f, p) : null;
  place.cutId = cut?.id ?? null;
  const pool = stagesForCode(f, p);
  if (!pool.length) return place;
  const layerFor = (s: StageRow) => (s.grain === "layer" ? p.layer : null);
  let pick: StageRow | undefined;
  let rule: AuditPlace["rule"] = pool.length === 1 ? "single" : null;
  if (pool.length === 1) pick = pool[0];
  if (!pick && p.version !== null) {
    pick = pool.find((s) => {
      const t = taskFor(f, s, cut?.id ?? null, layerFor(s));
      return !!t && (f.subsByTask.get(t.id) ?? []).some((x) => x.versionNo === p.version);
    });
    if (pick) rule = "exact";
  }
  // ①' 接着往后的版本：系统里这一格已经有更早的几版（比文件的版本小）→ 多半是那个环节的新一版（文件比系统新）。
  //    几个都有的：取版本最大的；一样大的取还没通过的最早那个，都通过了取最后一个。
  if (!pick && p.version !== null && (cut || p.kind === "project")) {
    const cands = pool
      .map((s) => {
        const t = taskFor(f, s, cut?.id ?? null, layerFor(s));
        const v = t ? (f.subsByTask.get(t.id) ?? []).reduce((m, x) => Math.max(m, x.versionNo), 0) : 0;
        return { s, t, v };
      })
      .filter((x) => x.t && x.v > 0 && x.v < p.version!);
    const top = cands.reduce((m, x) => Math.max(m, x.v), 0);
    const best = cands.filter((x) => x.v === top);
    if (best.length) {
      pick = (best.find((x) => x.t!.status !== "passed") ?? best[best.length - 1]).s;
      rule = "continue";
    }
  }
  if (!pick && (cut || p.kind === "project")) {
    pick = pool.find((s) => {
      const exact = s.grain === "layer" && p.layer ? taskFor(f, s, cut?.id ?? null, p.layer) : null;
      const ts = exact ? [exact] : tasksOfCut(f, s, cut?.id ?? null);
      return ts.some((t) => t.status !== "passed");
    });
    if (pick) rule = "earliest";
  }
  // 卡不在卡表里：看整个项目里这个环节还有没有没通过的
  if (!pick && !cut && p.kind === "cut") {
    pick = pool.find((s) => f.tasks.some((t) => t.stageId === s.id && t.status !== "passed"));
    if (pick) rule = "earliest";
  }
  if (!pick) {
    pick = pool[pool.length - 1];
    rule = "last";
  }
  return { ...place, stageKey: pick.templateKey, layer: layerFor(pick), rule };
}

// ---------------------------------------------------------------------------
// 一次盘点对一遍
// ---------------------------------------------------------------------------

export type AuditIssueCode =
  | NameIssue["code"]
  | "no_cut"
  | "no_layer"
  | "need_layer"
  | "no_stage"
  | "wrong_folder"
  | "wrong_folder_code"
  | "duplicate";

export interface AuditIssue {
  code: AuditIssueCode;
  params: Record<string, string | number>;
}

/** 只是信息（不算错）：文件里有哪些文件夹 · 时长和卡表差得多 · 画布和大多数不一样 · 版本跳号 · 是旧版本 · 压缩包里面看不了。 */
export type AuditHintCode = "folders" | "duration" | "canvas" | "version_gap" | "older" | "archive_closed" | "zip_inside";

export interface AuditHint {
  code: AuditHintCode;
  params: Record<string, string | number>;
}

export type CellOutcome = "matched" | "unrecorded" | "nofile" | "newer" | "missing";
export const CELL_OUTCOMES: readonly CellOutcome[] = ["matched", "unrecorded", "nofile", "newer", "missing"];

export interface AuditEntry {
  key: string;
  items: AuditItemRow[];
  /** 拿来显示的那个（能读出图的优先）。 */
  primary: AuditItemRow;
  parsed: ParsedName;
  kind: "cut" | "project" | "none" | "foreign";
  place: AuditPlace;
  stage: StageRow | null;
  cut: CutRow | null;
  task: TaskRow | null;
  issues: AuditIssue[];
  hints: AuditHint[];
  /** 对它那一格的结果；旧版本 = older。 */
  outcome: CellOutcome | "older" | null;
  review: AuditReview | null;
  /** 几种格式（扩展名）。 */
  formats: string[];
  /** 同一版有两个文件、选了另一个算数。 */
  superseded: boolean;
}

export interface AuditCell {
  task: TaskRow;
  stage: StageRow;
  cut: CutRow | null;
  layer: string | null;
  /** 系统里最新的一版（0 = 没交过）。 */
  sysVersion: number;
  sysSub: SubmissionRow | null;
  /** 归到这一格的版本（新的在前）。 */
  entries: AuditEntry[];
  /** 算数的那一版。 */
  top: AuditEntry | null;
  outcome: CellOutcome;
  /** 复查「系统说交了没找到」时的结论。 */
  decision: AuditItemRow | null;
  /** 这次盘点管不管这一格（这个环节在这次盘点里有文件，或者是从这个环节进来的）。 */
  inScope: boolean;
}

export interface AuditSummary {
  read: number;
  recognized: number;
  matched: number;
  unrecorded: number;
  nofile: number;
  newer: number;
  missing: number;
  issues: number;
  foreign: number;
  unknown: number;
}

export type QueueBucket = "issue" | "unrecorded" | "nofile" | "newer" | "matched";
export const QUEUE_BUCKETS: readonly QueueBucket[] = ["issue", "unrecorded", "nofile", "newer", "matched"];

export interface QueueItem {
  /** entry 的 key 或 cell:<taskId>。 */
  id: string;
  bucket: QueueBucket;
  entry: AuditEntry | null;
  cell: AuditCell | null;
  reviewed: boolean;
}

export interface AuditCheck {
  audit: AuditRow;
  facts: ProjectFacts;
  entries: AuditEntry[];
  cells: AuditCell[];
  cellByTask: Map<Id, AuditCell>;
  summary: AuditSummary;
  queue: QueueItem[];
  foreign: AuditEntry[];
  unknown: AuditEntry[];
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
export const vTag = (v: number) => `v${pad(v, 2)}`;
export const cutSeg = (n: number, suffix = "") => `CUT${pad(n, 3)}${suffix}`;

/** 这一条最后认成哪：复查改过归属就照改的，没有就照放进来时的建议。 */
export function placeOf(f: ProjectFacts, items: AuditItemRow[], parsed: ParsedName): AuditPlace {
  const reviewed = items.find((i) => i.review?.place)?.review?.place;
  if (reviewed) return reviewed;
  const g = items.find((i) => i.guess)?.guess;
  return g ?? guessPlace(f, parsed);
}

const isOk = (r: AuditReview | null) => r?.verdict === "ok";
const isOut = (r: AuditReview | null) => r?.verdict === "wrong" || r?.verdict === "drop" || r?.verdict === "add_cut";

function entriesOf(f: ProjectFacts, items: AuditItemRow[]): AuditEntry[] {
  const ctx = nameContext(f);
  const groups = new Map<string, { items: AuditItemRow[]; parsed: ParsedName }>();
  for (const it of items) {
    if (it.origin === "cell") continue;
    const parsed = parseName(it.name, ctx);
    const key = parsed.kind === "none" ? `id:${it.id}` : `b:${parsed.base}`;
    const g = groups.get(key);
    if (g) g.items.push(it);
    else groups.set(key, { items: [it], parsed });
  }
  const out: AuditEntry[] = [];
  for (const [key, g] of Array.from(groups.entries())) {
    const primary = g.items.find((i) => i.thumb) ?? g.items[0];
    const kind = g.parsed.kind === "none" ? "none" : g.parsed.foreign ? "foreign" : g.parsed.kind;
    const place = kind === "cut" || kind === "project" ? placeOf(f, g.items, g.parsed) : { cutId: null, cutNumber: null, cutSuffix: "", stageKey: null, layer: null, version: null };
    const stage = place.stageKey ? f.stageByKey.get(place.stageKey) ?? null : null;
    const cut = place.cutId ? f.cutById.get(place.cutId) ?? null : null;
    const task = stage ? taskFor(f, stage, cut?.id ?? null, place.layer) : null;
    const formats = Array.from(new Set(g.items.flatMap((i) => (g.parsed.kind === "none" ? [] : parseName(i.name, ctx).exts.slice(-1)))));
    out.push({
      key,
      items: g.items,
      primary,
      parsed: g.parsed,
      kind,
      place,
      stage,
      cut,
      task,
      issues: [],
      hints: [],
      outcome: null,
      review: g.items.find((i) => i.review)?.review ?? null,
      formats,
      superseded: false,
    });
  }
  return out;
}

function placementIssues(f: ProjectFacts, e: AuditEntry): AuditIssue[] {
  const out: AuditIssue[] = [];
  const p = e.parsed;
  const reviewedPlace = !!e.items.find((i) => i.review?.place);
  if (e.kind === "cut" && !e.cut && e.place.cutNumber !== null) out.push({ code: "no_cut", params: { cut: cutSeg(e.place.cutNumber, e.place.cutSuffix), total: f.cuts.length } });
  if (!e.stage && p.code && !p.issues.some((i) => i.code === "unknown_code")) out.push({ code: "no_stage", params: { code: p.code } });
  if (e.stage?.grain === "layer" && e.cut) {
    if (!e.place.layer) out.push({ code: "need_layer", params: { layers: e.cut.layers.map((l) => l.name).join(" / ") } });
    else if (!e.cut.layers.some((l) => l.name === e.place.layer)) out.push({ code: "no_layer", params: { layer: e.place.layer, cut: cutSeg(e.cut.number, e.cut.suffix ?? ""), layers: e.cut.layers.map((l) => l.name).join(" / ") } });
  }
  if (!reviewedPlace) {
    const knownFolders = new Set([...f.codes, ...f.stages.map((s) => s.folder.toUpperCase())]);
    for (const it of e.items) {
      if (!it.path) continue;
      const h = folderHints(it.path);
      const folder = it.path.replace(/\\/g, "/").split("/").slice(0, -1).join("/") + "/";
      const want = e.stage ? folderFor(f.project, e.stage, e.cut) : null;
      if (h.cut !== null && p.cut && h.cut !== p.cut.number) {
        out.push({ code: "wrong_folder", params: { got: cutSeg(p.cut.number, p.cut.suffix), folder, want: want ?? "" } });
        break;
      }
      if (h.code && knownFolders.has(h.code.toUpperCase()) && p.code && h.code.toUpperCase() !== p.code && (!e.stage || h.code.toUpperCase() !== e.stage.folder.toUpperCase())) {
        out.push({ code: "wrong_folder_code", params: { code: p.code, folder, want: want ?? "" } });
        break;
      }
    }
  }
  return out;
}

function hintsOf(e: AuditEntry, canvasMost: string | null): AuditHint[] {
  const out: AuditHint[] = [];
  const info = e.items.find((i) => i.info?.kind === "clip" || i.info?.kind === "video")?.info ?? null;
  if (info?.folders?.length) out.push({ code: "folders", params: { names: info.folders.join(" · ") } });
  if (info?.seconds != null && e.cut && e.cut.seconds > 0) {
    const diff = Math.abs(info.seconds - e.cut.seconds);
    if (diff >= 1 && diff / e.cut.seconds >= 0.15) out.push({ code: "duration", params: { file: info.seconds.toFixed(1), table: e.cut.seconds } });
  }
  const canvas = e.items.find((i) => i.info?.canvas)?.info?.canvas;
  if (canvas && canvasMost && `${canvas.width}×${canvas.height}` !== canvasMost) out.push({ code: "canvas", params: { got: `${canvas.width}×${canvas.height}`, most: canvasMost } });
  if (e.items.some((i) => i.info?.kind === "archive")) out.push({ code: "archive_closed", params: {} });
  const zip = e.items.find((i) => i.info?.kind === "zip" && i.info.entries != null);
  if (zip) out.push({ code: "zip_inside", params: { n: zip.info!.entries ?? 0 } });
  return out;
}

function compareKey(f: ProjectFacts, stage: StageRow | null, cut: CutRow | null, layer: string | null): string {
  const si = stage ? f.stages.indexOf(stage) : 999;
  return `${pad(si < 0 ? 999 : si, 3)}|${cut ? pad(cut.number, 4) + (cut.suffix ?? "") : "0000"}|${layer ?? ""}`;
}

export interface AuditInputs {
  audit: AuditRow;
  items: AuditItemRow[];
  facts: ProjectFacts;
}

export function auditInputs(rm: ReadModel, auditId: Id): AuditInputs | null {
  const audit = rm.get("audits", auditId);
  if (!audit || audit.archivedAt) return null;
  const facts = projectFacts(rm, audit.projectId);
  if (!facts) return null;
  return { audit, items: rm.where("auditItems", { auditId }), facts };
}

export function checkAudit(input: AuditInputs): AuditCheck {
  const { audit, items, facts: f } = input;
  const entries = entriesOf(f, items);
  // 画布：同一批大多数是多大
  const canvasCount = new Map<string, number>();
  for (const e of entries) {
    const c = e.items.find((i) => i.info?.canvas)?.info?.canvas;
    if (c) canvasCount.set(`${c.width}×${c.height}`, (canvasCount.get(`${c.width}×${c.height}`) ?? 0) + 1);
  }
  let canvasMost: string | null = null;
  let most = 0;
  for (const [k, n] of Array.from(canvasCount.entries())) if (n > most) [canvasMost, most] = [k, n];
  if (most < 2) canvasMost = null;

  for (const e of entries) {
    if (e.kind === "cut" || e.kind === "project") e.issues = [...e.parsed.issues, ...placementIssues(f, e)];
    e.hints = hintsOf(e, canvasMost);
  }

  // 归到格子
  const byTask = new Map<Id, AuditEntry[]>();
  for (const e of entries) {
    if (!e.task || isOut(e.review)) continue;
    const list = byTask.get(e.task.id);
    if (list) list.push(e);
    else byTask.set(e.task.id, [e]);
  }
  const decisions = new Map<Id, AuditItemRow>();
  for (const it of items) if (it.origin === "cell" && it.taskId) decisions.set(it.taskId, it);
  const scopeStages = new Set<Id>();
  if (audit.stageKey) {
    const s = f.stageByKey.get(audit.stageKey);
    if (s) scopeStages.add(s.id);
  }
  for (const e of entries) if (e.stage && (e.kind === "cut" || e.kind === "project")) scopeStages.add(e.stage.id);

  const cells: AuditCell[] = [];
  const cellByTask = new Map<Id, AuditCell>();
  for (const task of f.tasks) {
    const stage = f.stages.find((s) => s.id === task.stageId)!;
    const cut = task.cutId ? f.cutById.get(task.cutId) ?? null : null;
    const subs = f.subsByTask.get(task.id) ?? [];
    const sysSub = subs[subs.length - 1] ?? null;
    const sysVersion = sysSub?.versionNo ?? 0;
    const list = (byTask.get(task.id) ?? []).sort((a, b) => (b.place.version ?? -1) - (a.place.version ?? -1) || Number(isOk(b.review)) - Number(isOk(a.review)));
    // 同一版有两个文件：名字不一样、读出来是同一版
    const topV = list[0]?.place.version ?? null;
    const same = list.filter((e) => e.place.version === topV);
    let top: AuditEntry | null = list[0] ?? null;
    let dups: AuditEntry[] = [];
    if (same.length > 1) {
      const chosen = same.find((e) => isOk(e.review));
      if (chosen) {
        top = chosen;
        for (const e of same) if (e !== chosen) e.superseded = true;
      } else {
        const names = same.map((e) => e.parsed.base).join(" · ");
        dups = same;
        for (const e of same) e.issues.push({ code: "duplicate", params: { names, version: topV === null ? "" : vTag(topV) } });
      }
    }
    // 版本跳号（只是信息）
    const versions = Array.from(new Set(list.map((e) => e.place.version).filter((v): v is number => v !== null))).sort((a, b) => a - b);
    if (versions.length >= 2) {
      const gaps: string[] = [];
      for (let v = versions[0]; v < versions[versions.length - 1]; v++) if (!versions.includes(v)) gaps.push(vTag(v));
      if (gaps.length && top) top.hints.push({ code: "version_gap", params: { have: versions.map(vTag).join(" "), missing: gaps.join(" ") } });
    }
    let outcome: CellOutcome;
    const foundV = top?.place.version ?? null;
    if (!top) outcome = sysVersion > 0 ? "nofile" : "missing";
    else if (sysVersion === 0) outcome = "unrecorded";
    else if (foundV !== null && foundV > sysVersion) outcome = "newer";
    else if (foundV === sysVersion) outcome = "matched";
    else outcome = "nofile";
    for (const e of list) {
      const counted = e === top || dups.includes(e);
      e.outcome = counted ? outcome : "older";
      if (!counted && !e.superseded && top) e.hints.push({ code: "older", params: { top: foundV === null ? "" : vTag(foundV) } });
    }
    const cell: AuditCell = { task, stage, cut, layer: task.layer, sysVersion, sysSub, entries: list, top, outcome, decision: decisions.get(task.id) ?? null, inScope: scopeStages.has(stage.id) };
    cells.push(cell);
    cellByTask.set(task.id, cell);
  }

  const recognizedEntries = entries.filter((e) => e.kind === "cut" || e.kind === "project");
  const foreign = entries.filter((e) => e.kind === "foreign");
  const unknown = entries.filter((e) => e.kind === "none");
  const scoped = cells.filter((c) => c.inScope);
  const count = (o: CellOutcome) => scoped.filter((c) => c.outcome === o).length;
  const itemCount = (list: AuditEntry[]) => list.reduce((n, e) => n + e.items.length, 0);
  const summary: AuditSummary = {
    read: items.filter((i) => i.origin !== "cell").length,
    recognized: itemCount(recognizedEntries),
    matched: count("matched"),
    unrecorded: count("unrecorded"),
    nofile: count("nofile"),
    newer: count("newer"),
    missing: count("missing"),
    issues: recognizedEntries.filter((e) => e.issues.length > 0 && !e.superseded).length,
    foreign: itemCount(foreign),
    unknown: itemCount(unknown),
  };

  // 复查队列：有问题的 → 有文件系统没记的 → 系统说交了没找到的 → 文件比系统新的 → 对上了的
  const queue: QueueItem[] = [];
  const sortEntries = (list: AuditEntry[]) => list.sort((a, b) => compareKey(f, a.stage, a.cut, a.place.layer).localeCompare(compareKey(f, b.stage, b.cut, b.place.layer)));
  for (const e of sortEntries(recognizedEntries.filter((e) => e.issues.length > 0 && !e.superseded))) queue.push({ id: e.key, bucket: "issue", entry: e, cell: e.task ? cellByTask.get(e.task.id) ?? null : null, reviewed: !!e.review });
  for (const e of unknown) queue.push({ id: e.key, bucket: "issue", entry: e, cell: null, reviewed: !!e.review });
  const tops = (o: CellOutcome) =>
    sortEntries(
      scoped
        .filter((c) => c.outcome === o && c.top && c.top.issues.length === 0)
        .map((c) => c.top!)
    );
  for (const e of tops("unrecorded")) queue.push({ id: e.key, bucket: "unrecorded", entry: e, cell: cellByTask.get(e.task!.id) ?? null, reviewed: !!e.review });
  for (const c of scoped.filter((c) => c.outcome === "nofile").sort((a, b) => compareKey(f, a.stage, a.cut, a.layer).localeCompare(compareKey(f, b.stage, b.cut, b.layer))))
    queue.push({ id: `cell:${c.task.id}`, bucket: "nofile", entry: null, cell: c, reviewed: !!c.decision?.review });
  for (const e of tops("newer")) queue.push({ id: e.key, bucket: "newer", entry: e, cell: cellByTask.get(e.task!.id) ?? null, reviewed: !!e.review });
  for (const e of tops("matched")) queue.push({ id: e.key, bucket: "matched", entry: e, cell: cellByTask.get(e.task!.id) ?? null, reviewed: !!e.review });

  return { audit, facts: f, entries, cells, cellByTask, summary, queue, foreign, unknown };
}

/** 同一卡上一个有图的环节（复查时并排对照；上一个环节没图就往前找）。 */
export function previousWithPicture<T>(f: ProjectFacts, stage: StageRow, cutId: Id | null, pictureOf: (stage: StageRow) => T | null): { stage: StageRow; picture: T; skipped: StageRow[] } | null {
  const i = f.stages.indexOf(stage);
  const skipped: StageRow[] = [];
  for (let j = i - 1; j >= 0; j--) {
    const s = f.stages[j];
    if (s.grain === "project" && cutId) continue;
    const pic = pictureOf(s);
    if (pic) return { stage: s, picture: pic, skipped };
    skipped.push(s);
  }
  return null;
}
