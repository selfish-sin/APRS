/**
 * 交付物盘点（SPEC §18）：命令 → 变更 → 日志，和别的一样能重放。
 *   audit.start  开始一次盘点（管理员 · 审核员）
 *   audit.add    放进来一批（文件 / 粘贴的名字 / zip 里的目录）；放进来时给每条一个「最可能的归属」
 *   audit.step   做到第几步
 *   audit.review 复查一条（几种格式的文件一起）：确认 · 不对 · 改归属 · 跳过 · 加这一卡 · 不要
 *   audit.decide 复查「系统说交了没找到」的一格：文件在别处 · 确实没交 · 跳过
 *   audit.regroup 这一批 ANI 都算 中割（只改还没复查的建议）
 *   audit.write  写回项目（管理员）：一条日志；核实 · 补录 · 打回 · 加卡
 *   audit.undo   撤销这次盘点：之后没人动过的整批退回，有人动过的留着
 * 自动的只提示：只有 audit.write 改项目。
 */
import { liveUpstream, TaskPatches, unlockReady, upstreamReady } from "../flow";
import {
  AUDIT_WRONG,
  QUALITY,
  type AuditFileInfo,
  type AuditItemRow,
  type AuditPlace,
  type AuditRef,
  type AuditReview,
  type AuditRow,
  type AuditThumb,
  type AuditUnit,
  type AuditVerdict,
  type Change,
  type Id,
  type Quality,
  type TableName,
  type TaskRow,
} from "../model";
import type { ReadModel } from "../readmodel";
import { hoursOf, taskPoints, taskRate } from "../rules";
import { auditInputs, checkAudit, guessPlace, nameContext, projectFacts } from "../audit/check";
import { parseName } from "../audit/names";
import { planIsEmpty, writePlan } from "../audit/plan";
import { addCuts } from "./edit";
import { archive, guarded, insert, isReviewer, mustAdmin, mustBeOneOf, mustGet, mustMember, ok, optText, rejectT, round1, update, type Ctx } from "./core";
import { optLink } from "./validate";

export const MAX_ITEMS_PER_ADD = 2000;
export const MAX_ITEMS_PER_AUDIT = 5000;
const SHA_RE = /^[0-9a-f]{64}$/;

function mustAuditor(rm: ReadModel, ctx: Ctx) {
  const me = mustMember(rm, ctx);
  if (!isReviewer(me)) rejectT("forbidden", "audit_reviewers_only");
  return me;
}

function mustOpenAudit(rm: ReadModel, ctx: Ctx, auditId: Id): AuditRow {
  const a = mustGet(rm, ctx, "audits", auditId, "盘点");
  if (a.status === "written") rejectT("state", "audit_written");
  return a;
}

// ---------------------------------------------------------------------------
// 开始 · 放进来 · 步骤
// ---------------------------------------------------------------------------

export interface StartAuditInput {
  projectId: Id;
  /** 从环节页进来的：默认只看这个环节。 */
  stageKey?: string | null;
  link?: string | null;
  keep?: "thumbs" | "full";
  demo?: boolean;
}

export const startAudit = guarded<StartAuditInput>((rm, input, ctx) => {
  const me = mustAuditor(rm, ctx);
  const p = mustGet(rm, ctx, "projects", input.projectId, "项目");
  if (p.status === "zero") rejectT("state", "zero_not_started");
  const stageKey = input.stageKey ? String(input.stageKey) : null;
  if (stageKey && !rm.where("stages", { projectId: p.id, templateKey: stageKey }).length) rejectT("not_found", "not_found", { what: "环节" });
  const keep = input.keep === "full" ? "full" : "thumbs";
  const r = insert(ctx, "audits", {
    projectId: p.id,
    byMemberId: me.id,
    at: ctx.worldNow,
    stageKey,
    link: optLink(input.link, "放在哪的链接"),
    keep,
    step: 1,
    status: "open",
    sources: [],
    written: null,
    undone: [],
    ...(input.demo ? { demo: true } : {}),
  });
  return ok([r.change], { auditId: r.row.id });
});

export interface AuditItemInput {
  name: string;
  path?: string | null;
  size?: number | null;
  mtime?: string | null;
  origin: "file" | "paste" | "zip";
  container?: string | null;
  fingerprint?: string | null;
  thumb?: AuditThumb | null;
  originalSha?: string | null;
  info?: AuditFileInfo | null;
  demo?: boolean;
}

export interface AddAuditInput {
  auditId: Id;
  source: { kind: "folder" | "files" | "paste" | "zip"; label?: string | null };
  items: AuditItemInput[];
  /** 改「放在哪」的链接 · 存什么（第 ① 步右边那两块）。 */
  link?: string | null;
  keep?: "thumbs" | "full";
}

function cleanName(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\r\n\t]/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function cleanInt(v: unknown, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.round(n)) : null;
}

function cleanThumb(t: AuditThumb | null | undefined): AuditThumb | null {
  if (!t || typeof t !== "object" || typeof t.sha256 !== "string" || !SHA_RE.test(t.sha256)) return null;
  const mime = typeof t.mime === "string" && /^image\/[a-z0-9.+-]+$/.test(t.mime) ? t.mime : "image/jpeg";
  return { sha256: t.sha256, mime, width: cleanInt(t.width, 20000) ?? 0, height: cleanInt(t.height, 20000) ?? 0 };
}

const INFO_KIND = ["clip", "image", "psd", "video", "zip", "archive", "other"] as const;

function cleanInfo(i: AuditFileInfo | null | undefined): AuditFileInfo | null {
  if (!i || typeof i !== "object") return null;
  const kind = (INFO_KIND as readonly string[]).includes(i.kind) ? i.kind : "other";
  const out: AuditFileInfo = { kind };
  if (i.canvas && typeof i.canvas === "object") {
    const w = cleanInt(i.canvas.width, 100000);
    const h = cleanInt(i.canvas.height, 100000);
    if (w && h) out.canvas = { width: w, height: h, dpi: i.canvas.dpi == null ? null : cleanInt(i.canvas.dpi, 10000) };
  }
  const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : null);
  if (i.fps != null) out.fps = num(i.fps, 1000);
  if (i.frames != null) out.frames = num(i.frames, 10_000_000);
  if (i.seconds != null) out.seconds = num(i.seconds, 1_000_000);
  if (Array.isArray(i.folders)) out.folders = i.folders.map((x) => cleanName(x, 80)).filter((x): x is string => !!x).slice(0, 40);
  if (i.entries != null) out.entries = cleanInt(i.entries, 1_000_000);
  return out;
}

export const addAuditItems = guarded<AddAuditInput>((rm, input, ctx) => {
  mustAuditor(rm, ctx);
  const a = mustOpenAudit(rm, ctx, input.auditId);
  const facts = projectFacts(rm, a.projectId);
  if (!facts) rejectT("not_found", "not_found", { what: "项目" });
  const list = Array.isArray(input.items) ? input.items : [];
  if (list.length > MAX_ITEMS_PER_ADD) rejectT("invalid", "audit_add_max", { max: MAX_ITEMS_PER_ADD });
  const existing = rm.where("auditItems", { auditId: a.id }).filter((i) => i.origin !== "cell");
  const kind = mustBeOneOf(input.source?.kind, ["folder", "files", "paste", "zip"] as const, "放进来的方式");
  const seen = new Set(existing.map((i) => (i.fingerprint ? `f:${i.fingerprint}` : `n:${i.origin}|${i.name}|${i.path ?? ""}`)));
  const batch = (a.sources.reduce((n, s) => Math.max(n, s.batch), 0) || 0) + 1;
  const ctxName = nameContext(facts);
  const changes: Change[] = [];
  let added = 0;
  for (const raw of list) {
    const name = cleanName(raw?.name, 255);
    if (!name) continue;
    const origin = mustBeOneOf(raw.origin, ["file", "paste", "zip"] as const, "来源");
    const path = cleanName(raw.path, 1000);
    const fingerprint = cleanName(raw.fingerprint, 1400);
    const key = fingerprint ? `f:${fingerprint}` : `n:${origin}|${name}|${path ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mtime = typeof raw.mtime === "string" && !Number.isNaN(Date.parse(raw.mtime)) ? raw.mtime : null;
    const parsed = parseName(name, ctxName);
    const r = insert(ctx, "auditItems", {
      auditId: a.id,
      projectId: a.projectId,
      batch,
      origin,
      name,
      path,
      size: cleanInt(raw.size, Number.MAX_SAFE_INTEGER),
      mtime,
      container: cleanName(raw.container, 255),
      fingerprint,
      thumb: cleanThumb(raw.thumb),
      originalSha: typeof raw.originalSha === "string" && SHA_RE.test(raw.originalSha) ? raw.originalSha : null,
      info: cleanInfo(raw.info),
      guess: parsed.kind === "none" || parsed.foreign ? null : guessPlace(facts, parsed),
      taskId: null,
      review: null,
      written: null,
      ...(raw.demo ? { demo: true } : {}),
    });
    changes.push(r.change);
    added += 1;
  }
  if (existing.length + added > MAX_ITEMS_PER_AUDIT) rejectT("invalid", "audit_total_max", { max: MAX_ITEMS_PER_AUDIT });
  const patch: Partial<AuditRow> = {};
  if (added || list.length) patch.sources = [...a.sources, { batch, kind, label: cleanName(input.source?.label, 255), count: added, at: ctx.worldNow }];
  if (input.link !== undefined) patch.link = optLink(input.link, "放在哪的链接");
  if (input.keep === "thumbs" || input.keep === "full") patch.keep = input.keep;
  const c = update("audits", a, patch);
  if (c) changes.push(c);
  return ok(changes, { auditId: a.id });
});

export const setAuditStep = guarded<{ auditId: Id; step: number; link?: string | null; keep?: "thumbs" | "full" }>((rm, input, ctx) => {
  mustAuditor(rm, ctx);
  const a = mustGet(rm, ctx, "audits", input.auditId, "盘点");
  const step = Number(input.step);
  if (!Number.isInteger(step) || step < 1 || step > 4) rejectT("invalid", "audit_step_bad");
  if (a.status === "written" && step !== 4) rejectT("state", "audit_written");
  const patch: Partial<AuditRow> = { step };
  if (input.link !== undefined) patch.link = optLink(input.link, "放在哪的链接");
  if (input.keep === "thumbs" || input.keep === "full") patch.keep = input.keep;
  const c = update("audits", a, patch);
  return ok(c ? [c] : [], { auditId: a.id });
});

// ---------------------------------------------------------------------------
// 复查
// ---------------------------------------------------------------------------

export interface PlaceInput {
  cutId?: Id | null;
  stageKey?: string | null;
  layer?: string | null;
  version?: number | null;
}

export interface ReviewAuditInput {
  auditId: Id;
  /** 一条版本里的几个文件（几种格式）一起；「对上了」一次全确认时是很多条。 */
  itemIds: Id[];
  verdict: "ok" | "wrong" | "skip" | "add_cut" | "drop" | "clear";
  reason?: string | null;
  text?: string | null;
  /** 改归属（改完算确认）。 */
  place?: PlaceInput | null;
  /** 不对 · 没做完、系统里已经通过：打回重做。 */
  redo?: boolean;
}

function mustPlace(rm: ReadModel, ctx: Ctx, projectId: Id, p: PlaceInput, base: AuditPlace | null): AuditPlace {
  const stageKey = p.stageKey ?? base?.stageKey ?? null;
  const stage = stageKey ? rm.where("stages", { projectId, templateKey: stageKey })[0] : undefined;
  if (stageKey && !stage) rejectT("not_found", "not_found", { what: "环节" });
  const cutId = p.cutId === undefined ? base?.cutId ?? null : p.cutId;
  const cut = cutId ? mustGet(rm, ctx, "cuts", cutId, "卡") : null;
  if (cut && cut.projectId !== projectId) rejectT("not_found", "not_found", { what: "卡" });
  let layer = p.layer === undefined ? base?.layer ?? null : p.layer ? String(p.layer).trim().toUpperCase() : null;
  if (stage && stage.grain !== "layer") layer = null;
  if (stage?.grain === "layer" && cut && layer && !cut.layers.some((l) => l.name === layer)) rejectT("invalid", "audit_layer_missing", { layer });
  const version = p.version === undefined ? base?.version ?? null : p.version === null ? null : Number(p.version);
  if (version !== null && (!Number.isInteger(version) || version < 1 || version > 999)) rejectT("invalid", "integer_range", { what: "版本", min: 1, max: 999 });
  return { cutId: cut?.id ?? null, cutNumber: cut?.number ?? base?.cutNumber ?? null, cutSuffix: cut ? cut.suffix ?? "" : base?.cutSuffix ?? "", stageKey: stage?.templateKey ?? null, layer, version };
}

export const reviewAudit = guarded<ReviewAuditInput>((rm, input, ctx) => {
  const me = mustAuditor(rm, ctx);
  const a = mustOpenAudit(rm, ctx, input.auditId);
  const ids = Array.from(new Set(Array.isArray(input.itemIds) ? input.itemIds : []));
  if (!ids.length) rejectT("invalid", "audit_pick");
  if (ids.length > MAX_ITEMS_PER_AUDIT) rejectT("invalid", "audit_total_max", { max: MAX_ITEMS_PER_AUDIT });
  const verdict = mustBeOneOf(input.verdict, ["ok", "wrong", "skip", "add_cut", "drop", "clear"] as const, "复查的结论");
  const reason = verdict === "wrong" ? mustBeOneOf(input.reason ?? "other", AUDIT_WRONG, "不对的原因") : null;
  const text = optText(input.text, 300);
  if (verdict === "wrong" && reason === "other" && !text) rejectT("invalid", "audit_wrong_text");
  const changes: Change[] = [];
  for (const id of ids) {
    const it = mustGet(rm, ctx, "auditItems", id, "盘点的一条");
    if (it.auditId !== a.id || it.origin === "cell") rejectT("not_found", "not_found", { what: "盘点的一条" });
    let review: AuditReview | null = null;
    if (verdict !== "clear") {
      const place = input.place ? mustPlace(rm, ctx, a.projectId, input.place, it.guess) : null;
      review = { verdict: verdict as AuditVerdict, reason, text, link: null, place, redo: verdict === "wrong" && !!input.redo, byMemberId: me.id, at: ctx.worldNow };
    }
    const c = update("auditItems", it, { review });
    if (c) changes.push(c);
  }
  if (a.step < 3 && verdict !== "clear") {
    const c = update("audits", a, { step: 3 });
    if (c) changes.push(c);
  }
  return ok(changes, { auditId: a.id });
});

export interface DecideCellInput {
  auditId: Id;
  taskId: Id;
  verdict: "elsewhere" | "missing" | "skip" | "clear";
  link?: string | null;
  text?: string | null;
}

export const decideAuditCell = guarded<DecideCellInput>((rm, input, ctx) => {
  const me = mustAuditor(rm, ctx);
  const a = mustOpenAudit(rm, ctx, input.auditId);
  const task = mustGet(rm, ctx, "tasks", input.taskId, "任务");
  if (task.projectId !== a.projectId) rejectT("not_found", "not_found", { what: "任务" });
  const verdict = mustBeOneOf(input.verdict, ["elsewhere", "missing", "skip", "clear"] as const, "复查的结论");
  const link = optLink(input.link, "放在别处的链接");
  const text = optText(input.text, 300);
  if (verdict === "elsewhere" && !link && !text) rejectT("invalid", "audit_elsewhere_need");
  if (verdict === "missing" && !text) rejectT("invalid", "reopen_need_comment");
  const review: AuditReview | null = verdict === "clear" ? null : { verdict, reason: null, text, link, place: null, redo: verdict === "missing", byMemberId: me.id, at: ctx.worldNow };
  const cur = rm.where("auditItems", { auditId: a.id, taskId: task.id }).find((i) => i.origin === "cell");
  const changes: Change[] = [];
  if (cur) {
    const c = update("auditItems", cur, { review });
    if (c) changes.push(c);
  } else if (review) {
    const stage = mustGet(rm, ctx, "stages", task.stageId, "环节");
    const cut = task.cutId ? rm.get("cuts", task.cutId) ?? null : null;
    const r = insert(ctx, "auditItems", {
      auditId: a.id,
      projectId: a.projectId,
      batch: 0,
      origin: "cell",
      name: stage.templateKey,
      path: null,
      size: null,
      mtime: null,
      container: null,
      fingerprint: null,
      thumb: null,
      originalSha: null,
      info: null,
      guess: { cutId: cut?.id ?? null, cutNumber: cut?.number ?? null, cutSuffix: cut?.suffix ?? "", stageKey: stage.templateKey, layer: task.layer, version: task.versions || null },
      taskId: task.id,
      review,
      written: null,
    });
    changes.push(r.change);
  }
  if (a.step < 3 && review) {
    const c = update("audits", a, { step: 3 });
    if (c) changes.push(c);
  }
  return ok(changes, { auditId: a.id });
});

/** 这一批 ANI 都算 中割：还没复查的、这个代码的，建议都改成这个环节。 */
export const regroupAudit = guarded<{ auditId: Id; code: string; stageKey: string }>((rm, input, ctx) => {
  mustAuditor(rm, ctx);
  const a = mustOpenAudit(rm, ctx, input.auditId);
  const facts = projectFacts(rm, a.projectId);
  if (!facts) rejectT("not_found", "not_found", { what: "项目" });
  const stage = facts.stageByKey.get(String(input.stageKey));
  if (!stage) rejectT("not_found", "not_found", { what: "环节" });
  const code = String(input.code ?? "").toUpperCase();
  const ctxName = nameContext(facts);
  const changes: Change[] = [];
  for (const it of rm.where("auditItems", { auditId: a.id })) {
    if (it.origin === "cell" || it.review || !it.guess) continue;
    const p = parseName(it.name, ctxName);
    if (p.code !== code) continue;
    const layer = stage.grain === "layer" ? p.layer : null;
    const c = update("auditItems", it, { guess: { ...it.guess, stageKey: stage.templateKey, layer } });
    if (c) changes.push(c);
  }
  if (!changes.length) rejectT("state", "audit_regroup_none", { code });
  return ok(changes, { auditId: a.id });
});

// ---------------------------------------------------------------------------
// 写回 · 撤销
// ---------------------------------------------------------------------------

export type PersonInput = { memberId: Id } | { name: string } | null;

export interface WriteAuditInput {
  auditId: Id;
  /** 文件比系统新的：记成新的一版 · 不管（默认记）。 */
  newer?: "record" | "ignore";
  /** 补录的版本谁做的：默认不记人；可以给一批（全部）或者一个环节一批选一个人。 */
  person?: PersonInput;
  personByStage?: Record<string, PersonInput>;
  /** 按规则给做的人记活力点（默认不记）。 */
  points?: boolean;
  quality?: Quality;
}

function versionAfter(rm: ReadModel, ch: Change): AuditRef {
  if (ch.op === "insert") return { table: ch.table, id: ch.row.id, version: 1, prev: null };
  const cur = rm.get(ch.table, ch.id) as { version: number };
  return { table: ch.table, id: ch.id, version: cur.version + 1, prev: ch.op === "update" ? (ch.prev as Record<string, unknown>) : null };
}

function mustPerson(rm: ReadModel, ctx: Ctx, p: PersonInput | undefined): { memberId: Id | null; name: string | null } {
  if (!p) return { memberId: null, name: null };
  if ("memberId" in p) {
    const m = mustGet(rm, ctx, "members", p.memberId, "成员");
    return { memberId: m.id, name: null };
  }
  const name = typeof p.name === "string" ? p.name.trim() : "";
  if (!name || name.length > 24) rejectT("invalid", "staff_name_bad");
  return { memberId: null, name };
}

export const writeAudit = guarded<WriteAuditInput>((rm, input, ctx) => {
  const me = mustAdmin(rm, ctx, "写回项目");
  const a = mustOpenAudit(rm, ctx, input.auditId);
  const p = mustGet(rm, ctx, "projects", a.projectId, "项目");
  if (p.status === "zero") rejectT("state", "zero_not_started");
  const inputs = auditInputs(rm, a.id);
  if (!inputs) rejectT("not_found", "not_found", { what: "盘点" });
  const check = checkAudit(inputs);
  const plan = writePlan(check, { newer: input.newer === "ignore" ? "ignore" : "record" });
  if (planIsEmpty(plan)) rejectT("state", "audit_nothing");
  const qualityN = (input.quality ?? 1) as Quality;
  if (!QUALITY.includes(qualityN)) rejectT("invalid", "not_option", { what: "质量系数" });
  const batchPerson = mustPerson(rm, ctx, input.person);
  const stagePeople = new Map<string, { memberId: Id | null; name: string | null }>();
  for (const [k, v] of Object.entries(input.personByStage ?? {})) stagePeople.set(k, mustPerson(rm, ctx, v));

  const acc = new TaskPatches(rm);
  const units: { kind: AuditUnit["kind"]; taskId: Id | null; cutId: Id | null; changes: Change[] }[] = [];
  const owned = new Map<Id, number>();
  const itemWrites = new Map<Id, AuditItemRow["written"]>();
  const written = new Set<Id>();

  // 核实：那一版记「已核实」，状态不变
  for (const v of plan.verify) {
    const c = update("submissions", v.sub, { verified: { auditId: a.id, itemId: v.entry?.primary.id ?? v.decision?.id ?? null, byMemberId: me.id, at: ctx.worldNow } });
    if (!c) continue;
    units.push({ kind: "verify", taskId: v.task.id, cutId: v.cut?.id ?? null, changes: [c] });
    for (const it of v.entry?.items ?? (v.decision ? [v.decision] : [])) itemWrites.set(it.id, { action: "verify", taskId: v.task.id, submissionId: v.sub.id });
  }
  // 补录：记一版「补录」，任务变「通过」，下游照常解锁
  for (const b of plan.backfill) {
    if (written.has(b.task.id)) continue;
    written.add(b.task.id);
    const who = stagePeople.get(b.stage.templateKey) ?? batchPerson;
    const sub = insert(ctx, "submissions", {
      taskId: b.task.id,
      versionNo: b.version,
      fileName: b.entry.primary.name,
      link: a.link,
      note: b.entry.primary.path,
      byMemberId: who.memberId,
      recordedById: me.id,
      selfFix: false,
      onTime: true,
      at: ctx.worldNow,
      backfill: { auditId: a.id, itemId: b.entry.primary.id },
    });
    const changes: Change[] = [sub.change];
    const patch: Partial<TaskRow> = { status: "passed", versions: b.version, submittedAt: ctx.worldNow, passedAt: ctx.worldNow, ...(b.task.redo ? { redo: false } : {}) };
    if (!b.task.assigneeId && (b.task.status === "open" || b.task.status === "locked" || b.task.status === "reclaimed")) {
      if (who.memberId) Object.assign(patch, { assigneeId: who.memberId });
      else if (who.name) Object.assign(patch, { outsourced: true, outsourceName: who.name });
    }
    acc.set(b.task, patch);
    if (input.points && who.memberId) {
      const enr = rm.where("enrollments", { memberId: who.memberId, group: p.group, stageKey: b.stage.templateKey })[0];
      const skill = enr?.skill ?? 0;
      const l = insert(ctx, "ledger", {
        memberId: who.memberId,
        taskId: b.task.id,
        kind: "task",
        hours: round1(hoursOf(taskRate(b.stage, b.task), b.task.workload)),
        factor: round1(b.stage.control + skill),
        quality: qualityN,
        points: taskPoints(b.stage, b.task, skill, qualityN),
        at: ctx.worldNow,
        note: null,
      });
      changes.push(l.change);
    }
    owned.set(b.task.id, units.length);
    units.push({ kind: "backfill", taskId: b.task.id, cutId: b.cut?.id ?? null, changes });
    for (const it of b.entry.items) itemWrites.set(it.id, { action: "backfill", taskId: b.task.id, submissionId: sub.row.id });
  }
  // 打回：照 §12.2 打回重做那一卡那一环节
  for (const r of plan.redo) {
    if (written.has(r.task.id)) continue;
    written.add(r.task.id);
    const subs = rm.where("submissions", { taskId: r.task.id }).sort((x, y) => x.versionNo - y.versionNo);
    const last = subs[subs.length - 1];
    const text = r.item.review?.text ?? "";
    const changes: Change[] = [];
    if (last) changes.push(insert(ctx, "reviews", { taskId: r.task.id, submissionId: last.id, verdict: "return", quality: null, comments: [{ layer: null, sheets: null, tag: null, text }], byMemberId: me.id, at: ctx.worldNow }).change);
    const back = r.task.outsourced ? null : subs.filter((s) => !s.selfFix).pop()?.byMemberId ?? r.task.assigneeId;
    acc.set(r.task, { status: back || r.task.outsourced ? "returned" : "open", assigneeId: back ?? null, passedAt: null, claimedAt: r.task.claimedAt ?? ctx.worldNow, dueAt: r.task.dueAt ?? ctx.worldNow, redo: true });
    owned.set(r.task.id, units.length);
    units.push({ kind: "redo", taskId: r.task.id, cutId: r.cut?.id ?? null, changes });
    itemWrites.set(r.item.id, { action: "redo", taskId: r.task.id, submissionId: null });
  }
  unlockReady(rm, acc, p.id);
  // 加卡
  if (plan.addCuts.length) {
    const res = addCuts(rm, { projectId: p.id, count: plan.addCuts.length }, ctx);
    if (!res.ok) return res;
    let cutId: Id | null = null;
    for (const ch of res.changes) if (ch.op === "insert" && ch.table === "cuts") cutId = cutId ?? ch.row.id;
    units.push({ kind: "add_cut", taskId: null, cutId, changes: res.changes });
    for (const ac of plan.addCuts) for (const e of ac.entries) for (const it of e.items) itemWrites.set(it.id, { action: "add_cut", taskId: null, submissionId: null });
  }
  // 任务的改动：归到它的那一条；别的（下游解锁）归到「解锁」
  const unlock: Change[] = [];
  for (const ch of acc.changes()) {
    const id = ch.op === "insert" ? ch.row.id : ch.id;
    const at = owned.get(id);
    if (at !== undefined) units[at].changes.push(ch);
    else unlock.push(ch);
  }
  if (unlock.length) units.push({ kind: "unlock", taskId: null, cutId: null, changes: unlock });

  const all: Change[] = units.flatMap((u) => u.changes);
  const auditUnits: AuditUnit[] = units.map((u) => ({ kind: u.kind, taskId: u.taskId, cutId: u.cutId, refs: u.changes.map((ch) => versionAfter(rm, ch)) }));
  const bookkeeping: Change[] = [];
  for (const [id, w] of Array.from(itemWrites.entries())) {
    const it = rm.get("auditItems", id);
    if (!it) continue;
    const c = update("auditItems", it, { written: w });
    if (c) bookkeeping.push(c);
  }
  const counts = {
    verify: units.filter((u) => u.kind === "verify").length,
    backfill: units.filter((u) => u.kind === "backfill").length,
    redo: units.filter((u) => u.kind === "redo").length,
    addCut: plan.addCuts.length,
    untouched: plan.untouched.total,
  };
  const ac = update("audits", a, { status: "written", step: 4, written: { at: ctx.worldNow, byMemberId: me.id, counts, units: auditUnits } });
  if (ac) bookkeeping.push(ac);
  return ok([...all, ...bookkeeping], { auditId: a.id });
});

// ---------------------------------------------------------------------------

export interface UndoPreview {
  /** 能退回的。 */
  revert: AuditUnit[];
  /** 之后有人动过（或者下游已经接着做了）的，留着。 */
  kept: AuditUnit[];
  /** 解锁过、现在要锁回去的下游任务。 */
  relock: Id[];
}

function touched(rm: ReadModel, ref: AuditRef): boolean {
  const row = rm.get(ref.table, ref.id) as { version: number; archivedAt: string | null } | undefined;
  return !row || row.version !== ref.version || (ref.prev === null && !!row.archivedAt);
}

export function undoPreview(rm: ReadModel, a: AuditRow): UndoPreview {
  const units = a.written?.units ?? [];
  const work = units.filter((u) => u.kind !== "unlock");
  const unlockRefs = units.filter((u) => u.kind === "unlock").flatMap((u) => u.refs);
  const keptIdx = new Set<number>();
  work.forEach((u, i) => {
    if (u.refs.some((r) => touched(rm, r))) keptIdx.add(i);
  });
  // 下游已经接着做了（解锁以后被人接了）：它上游那几条留着
  const stages = rm.where("stages", { projectId: a.projectId });
  const stagesByKey = new Map(stages.map((s) => [s.templateKey, s]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const tasks = rm.where("tasks", { projectId: a.projectId });
  const byStage = new Map<Id, TaskRow[]>();
  for (const t of tasks) byStage.set(t.stageId, [...(byStage.get(t.stageId) ?? []), t]);
  const upstreamIds = (t: TaskRow): Set<Id> => {
    const out = new Set<Id>();
    const stage = stageById.get(t.stageId);
    if (!stage) return out;
    for (const up of liveUpstream(stage, stagesByKey)) {
      for (const x of byStage.get(up.id) ?? []) {
        if (x.extra) continue;
        if (up.grain === "project" || !t.cutId || x.cutId === t.cutId) out.add(x.id);
      }
    }
    return out;
  };
  for (const ref of unlockRefs) {
    if (!touched(rm, ref)) continue;
    const t = rm.get("tasks", ref.id);
    if (!t) continue;
    const ups = upstreamIds(t);
    work.forEach((u, i) => {
      if (u.taskId && ups.has(u.taskId)) keptIdx.add(i);
    });
  }
  const revert = work.filter((_, i) => !keptIdx.has(i));
  const kept = work.filter((_, i) => keptIdx.has(i));
  // 退回以后：解锁过的下游，上游不再都通过的锁回去
  const simulated = new Map<Id, TaskRow>(tasks.map((t) => [t.id, t]));
  for (const u of revert) for (const r of u.refs) if (r.table === "tasks" && r.prev) simulated.set(r.id, { ...simulated.get(r.id)!, ...(r.prev as Partial<TaskRow>) });
  const simByStage = new Map<Id, TaskRow[]>();
  for (const t of Array.from(simulated.values())) simByStage.set(t.stageId, [...(simByStage.get(t.stageId) ?? []), t]);
  const relock: Id[] = [];
  for (const ref of unlockRefs) {
    if (touched(rm, ref)) continue;
    const t = simulated.get(ref.id);
    const stage = t ? stageById.get(t.stageId) : undefined;
    if (!t || !stage) continue;
    if (!upstreamReady(t, stage, stagesByKey, simByStage)) relock.push(t.id);
  }
  return { revert, kept, relock };
}

export const undoAudit = guarded<{ auditId: Id }>((rm, input, ctx) => {
  const me = mustAdmin(rm, ctx, "撤销盘点");
  const a = mustGet(rm, ctx, "audits", input.auditId, "盘点");
  if (a.status !== "written" || !a.written) rejectT("state", "audit_not_written");
  const pv = undoPreview(rm, a);
  if (!pv.revert.length && !pv.relock.length) rejectT("state", "audit_undo_none", { n: pv.kept.length });
  const changes: Change[] = [];
  const done = new Set<string>();
  for (const u of pv.revert) {
    for (const ref of u.refs) {
      const key = `${ref.table}|${ref.id}`;
      if (done.has(key)) continue;
      done.add(key);
      const row = rm.get(ref.table as TableName, ref.id);
      if (!row) continue;
      if (ref.prev) {
        const c = update(ref.table as TableName, row as never, ref.prev as never);
        if (c) changes.push(c);
      } else changes.push(archive(ref.table as TableName, row as never));
    }
  }
  for (const id of pv.relock) {
    const t = rm.get("tasks", id);
    if (!t) continue;
    const c = update("tasks", t, { status: "locked" });
    if (c) changes.push(c);
  }
  const keptTasks = new Set(pv.kept.map((u) => u.taskId).filter(Boolean));
  for (const it of rm.where("auditItems", { auditId: a.id })) {
    if (!it.written || (it.written.taskId && keptTasks.has(it.written.taskId))) continue;
    const c = update("auditItems", it, { written: null });
    if (c) changes.push(c);
  }
  const ac = update("audits", a, { status: "open", step: 4, written: null, undone: [...a.undone, { at: ctx.worldNow, byMemberId: me.id, kept: pv.kept.length }] });
  if (ac) changes.push(ac);
  return ok(changes, { auditId: a.id });
});

/** 给页面用：这次盘点能不能撤销、要留几条。 */
export function undoPreviewOf(rm: ReadModel, auditId: Id): UndoPreview | null {
  const a = rm.get("audits", auditId);
  if (!a || a.status !== "written" || !a.written) return null;
  return undoPreview(rm, a);
}

