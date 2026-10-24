/**
 * 管理员改项目（开工以后，SPEC §12.2）：
 *   环节：stage.add（接在某个环节后面，已有的卡按它的位置生成任务）· stage.update · stage.move · stage.remove（有交付的不能删）·
 *        stage.disable（停用：任务不再派，流程绕过它）· stage.accept（验收；最后一个环节验收 = 项目完成）
 *   打回重做：task.reopen（通过的任务回到退回，带意见；原来的活力点不扣）——在 task.ts 里，和「重新放出」共用一个名字
 *   延期：task.extend · stage.extend · project.extend（都记原因）
 *   加卡：cut.add（接着往后排，或插在某卡后面用 C005a）· cut.update（加层 / 改张数 / 改秒数，工作量和时限跟着变）· cut.archive（停用一卡）
 */
import { addHours, atWorldClock } from "../clock";
import { GRAIN, PHASE, STAGE_KIND, UNIT, type Change, type CutLayer, type CutRow, type Id, type StageRow, type TaskRow } from "../model";
import { cutCode, cutCode2, taskLabel, taskLabelP } from "../naming";
import { uc } from "../text";
import type { ReadModel } from "../readmodel";
import { deadlineHours } from "../rules";
import { groupTemplate } from "../templates";
import { guarded, insert, mustAdmin, mustBeOneOf, mustGet, mustText, ok, optDate, optNumber, rejectT, update, type Ctx } from "./core";
import { newTasks, openReady, workloadFor, workloadRuleOf } from "./materialize";
import { tasksToUnlock } from "../flow";
import { cmp } from "../agenda";

function mustActiveProject(rm: ReadModel, ctx: Ctx, projectId: Id) {
  const p = mustGet(rm, ctx, "projects", projectId, "项目");
  if (p.status === "zero") rejectT("state", "zero_not_started");
  return p;
}

function mustReason(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) rejectT("invalid", "reason_required");
  return s.slice(0, 200);
}

function liveStages(rm: ReadModel, projectId: Id): StageRow[] {
  return rm.where("stages", { projectId }).sort((a, b) => a.sort - b.sort);
}

function liveCuts(rm: ReadModel, projectId: Id): CutRow[] {
  return rm
    .where("cuts", { projectId })
    .filter((c) => !c.disabled)
    .sort((a, b) => a.number - b.number || cmp(a.suffix ?? "", b.suffix ?? ""));
}

// ---------------------------------------------------------------------------
// 环节
// ---------------------------------------------------------------------------

export interface AddStageInput {
  projectId: Id;
  name: string;
  phase: StageRow["phase"];
  kind: StageRow["kind"];
  grain: StageRow["grain"];
  unit: StageRow["unit"];
  tn: number;
  per?: number;
  /** 接在哪个环节后面（不写 = 没有上游，开工就能接）。 */
  afterKey?: string | null;
  /** 插进去：原来接在那个环节后面的，改成接在新环节后面（默认是）。 */
  insertBetween?: boolean;
  receive?: string;
  deliver?: string;
  handTo?: string;
  note?: string | null;
}

export const addStage = guarded<AddStageInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改环节");
  const p = mustActiveProject(rm, ctx, input.projectId);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 30) rejectT("invalid", "stage_name_bad");
  const stages = liveStages(rm, p.id);
  if (stages.some((s) => s.name === name)) rejectT("invalid", "stage_name_taken", { name: uc(name) });
  const phase = mustBeOneOf(input.phase, PHASE, "阶段");
  const kind = mustBeOneOf(input.kind, STAGE_KIND, "类型");
  const grain = mustBeOneOf(input.grain, GRAIN, "粒度");
  const unit = mustBeOneOf(input.unit, UNIT, "单位");
  const tn = optNumber(input.tn, "Tn", 0, 200);
  if (tn === null || tn <= 0) rejectT("invalid", "structure_range", { what: "Tn", min: 0.1, max: 200 });
  const per = optNumber(input.per, "每多少单位", 1, 600) ?? 1;
  const after = input.afterKey ? stages.find((s) => s.templateKey === input.afterKey) : undefined;
  if (input.afterKey && !after) rejectT("not_found", "stage_after_missing");
  let n = 1;
  while (rm.where("stages", { projectId: p.id }).some((s) => s.templateKey === `x${n}`) || stages.some((s) => s.templateKey === `x${n}`)) n += 1;
  const key = `x${n}`;
  const nextSort = after ? (() => {
    const i = stages.indexOf(after);
    const next = stages[i + 1];
    return next ? (after.sort + next.sort) / 2 : after.sort + 1;
  })() : (stages[stages.length - 1]?.sort ?? 0) + 1;
  const changes: Change[] = [];
  const stageRow = insert(ctx, "stages", {
    projectId: p.id,
    templateKey: key,
    name,
    phase,
    kind,
    hub: kind === "hub",
    grain,
    unit,
    tn,
    per,
    control: 1,
    code: null,
    fileCode: key.toUpperCase(),
    folder: name,
    upstream: after ? [after.templateKey] : [],
    indicator: { receive: (input.receive ?? "").slice(0, 120) || (after ? after.indicator.deliver : "—"), deliver: (input.deliver ?? "").slice(0, 120) || name, handTo: (input.handTo ?? "").slice(0, 120) || "—" },
    reviewerId: null,
    sort: nextSort,
    adminSet: false,
    note: input.note ? String(input.note).slice(0, 200) : null,
    locked: kind === "review",
    workloadRule: null,
  });
  changes.push(stageRow.change);
  const stage = stageRow.row as StageRow;
  // 插进去：原来接在 after 后面的改成接在新环节后面。
  const updatedStages: StageRow[] = [];
  if (after && input.insertBetween !== false) {
    for (const s of stages) {
      if (!s.upstream.includes(after.templateKey)) continue;
      const upstream = s.upstream.map((k) => (k === after.templateKey ? key : k));
      const c = update("stages", s, { upstream });
      if (c) changes.push(c);
      updatedStages.push({ ...s, upstream });
    }
  }
  const allStages = [...stages.map((s) => updatedStages.find((u) => u.id === s.id) ?? s), stage];
  const cuts = liveCuts(rm, p.id);
  const r = newTasks(ctx, p.group, stage, cuts, cuts);
  changes.push(...r.changes);
  openReady(rm, p.id, allStages, r.rows, changes);
  return ok(changes, { stageId: stage.id });
});

export interface UpdateStageInput {
  stageId: Id;
  name?: string;
  phase?: StageRow["phase"];
  kind?: StageRow["kind"];
  tn?: number;
  per?: number;
  receive?: string;
  deliver?: string;
  handTo?: string;
  note?: string | null;
}

export const updateStage = guarded<UpdateStageInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改环节");
  const s = mustGet(rm, ctx, "stages", input.stageId, "环节");
  const patch: Partial<StageRow> = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name || name.length > 30) rejectT("invalid", "stage_name_bad");
    if (liveStages(rm, s.projectId).some((x) => x.id !== s.id && x.name === name)) rejectT("invalid", "stage_name_taken", { name: uc(name) });
    patch.name = name;
  }
  if (input.phase !== undefined) patch.phase = mustBeOneOf(input.phase, PHASE, "阶段");
  if (input.kind !== undefined) {
    patch.kind = mustBeOneOf(input.kind, STAGE_KIND, "类型");
    if (patch.kind === "hub") patch.hub = true;
  }
  if (input.tn !== undefined) {
    const tn = optNumber(input.tn, "Tn", 0, 200);
    if (tn === null || tn <= 0) rejectT("invalid", "structure_range", { what: "Tn", min: 0.1, max: 200 });
    patch.tn = tn;
  }
  if (input.per !== undefined) patch.per = optNumber(input.per, "每多少单位", 1, 600) ?? s.per;
  if (input.receive !== undefined || input.deliver !== undefined || input.handTo !== undefined) {
    patch.indicator = {
      receive: input.receive !== undefined ? String(input.receive).slice(0, 120) : s.indicator.receive,
      deliver: input.deliver !== undefined ? String(input.deliver).slice(0, 120) : s.indicator.deliver,
      handTo: input.handTo !== undefined ? String(input.handTo).slice(0, 120) : s.indicator.handTo,
    };
  }
  if (input.note !== undefined) patch.note = input.note ? String(input.note).slice(0, 200) : null;
  const c = update("stages", s, patch);
  return ok(c ? [c] : [], { stageId: s.id });
});

export interface MoveStageInput {
  stageId: Id;
  direction: "up" | "down";
}

/** 上下移动（只是显示的顺序；流程照上游走）。 */
export const moveStage = guarded<MoveStageInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改环节");
  const s = mustGet(rm, ctx, "stages", input.stageId, "环节");
  const direction = mustBeOneOf(input.direction, ["up", "down"] as const, "往哪移");
  const list = liveStages(rm, s.projectId);
  const i = list.findIndex((x) => x.id === s.id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0) rejectT("state", "stage_already_top");
  if (j >= list.length) rejectT("state", "stage_already_bottom");
  const o = list[j];
  const changes = [update("stages", s, { sort: o.sort }), update("stages", o, { sort: s.sort })].filter((c): c is NonNullable<typeof c> => !!c);
  return ok(changes, { stageId: s.id });
});

export interface StageIdInput {
  stageId: Id;
}

/** 删环节：没人交过才能删（连它的任务一起）；下游接到它的上游上。 */
export const removeStage = guarded<StageIdInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改环节");
  const s = mustGet(rm, ctx, "stages", input.stageId, "环节");
  const tasks = rm.where("tasks", { stageId: s.id });
  if (tasks.some((t) => t.versions > 0 || rm.where("submissions", { taskId: t.id }).length)) rejectT("state", "stage_delivered");
  const changes: Change[] = [{ op: "archive", table: "stages", id: s.id, expectVersion: s.version }];
  for (const t of tasks) changes.push({ op: "archive", table: "tasks", id: t.id, expectVersion: t.version });
  for (const d of liveStages(rm, s.projectId)) {
    if (d.id === s.id || !d.upstream.includes(s.templateKey)) continue;
    const upstream = Array.from(new Set(d.upstream.flatMap((k) => (k === s.templateKey ? s.upstream : [k]))));
    const c = update("stages", d, { upstream });
    if (c) changes.push(c);
  }
  return ok(changes, { stageId: s.id });
});

export interface DisableStageInput {
  stageId: Id;
  disabled: boolean;
}

/** 停用 / 重新启用：停用的环节任务不再派，下游绕过它直接看它的上游。 */
export const disableStage = guarded<DisableStageInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改环节");
  const s = mustGet(rm, ctx, "stages", input.stageId, "环节");
  const c = update("stages", s, { disabled: !!input.disabled });
  const changes: Change[] = c ? [c] : [];
  if (input.disabled) {
    // 停用以后：下游绕过它，有的可能就够条件了，推一遍。
    const stages = rm.where("stages", { projectId: s.projectId }).map((x) => (x.id === s.id ? { ...x, disabled: true } : x));
    const tasks = rm.where("tasks", { projectId: s.projectId });
    for (const id of tasksToUnlock(stages, tasks)) {
      const t = tasks.find((x) => x.id === id);
      const u = t ? update("tasks", t, { status: "open" }) : null;
      if (u) changes.push(u);
    }
  }
  return ok(changes, { stageId: s.id });
});

export interface AcceptStageInput {
  stageId: Id;
  note?: string | null;
}

/** 整个环节验收通过；最后一个环节（成片输出）验收通过 = 项目完成。 */
export const acceptStage = guarded<AcceptStageInput>((rm, input, ctx) => {
  const me = mustAdmin(rm, ctx, "验收");
  const s = mustGet(rm, ctx, "stages", input.stageId, "环节");
  if (s.acceptedAt) rejectT("state", "accept_already");
  if (!rm.where("tasks", { stageId: s.id }).some((t) => !t.extra && t.status === "passed")) rejectT("state", "accept_unfinished", { n: rm.where("tasks", { stageId: s.id }).filter((t) => !t.extra).length });
  const tasks = rm.where("tasks", { stageId: s.id }).filter((t) => !t.extra);
  // 打回重做的那几张不挡验收（其余的验收通过，它们重做完照常走）。
  const left = tasks.filter((t) => t.status !== "passed" && !t.redo).length;
  if (left) rejectT("state", "accept_unfinished", { n: left });
  const changes: Change[] = [];
  const c = update("stages", s, { acceptedAt: ctx.worldNow, acceptedById: me.id });
  if (c) changes.push(c);
  const stages = liveStages(rm, s.projectId).filter((x) => !x.disabled);
  const ends = stages.filter((x) => !stages.some((y) => y.upstream.includes(x.templateKey)));
  if (ends.length && ends.every((x) => x.id === s.id || x.acceptedAt)) {
    const p = mustGet(rm, ctx, "projects", s.projectId, "项目");
    const pc = update("projects", p, { status: "done" });
    if (pc) changes.push(pc);
  }
  return ok(changes, { stageId: s.id });
});

// ---------------------------------------------------------------------------
// 延期
// ---------------------------------------------------------------------------

export interface ExtendInput {
  hours?: number | null;
  days?: number | null;
  /** 改到某一天（那天 23:00 世界时间）。 */
  until?: string | null;
  reason: string;
}

function newDue(current: string, input: ExtendInput): string {
  const hours = optNumber(input.hours, "加几小时", 0, 2000) ?? 0;
  const days = optNumber(input.days, "加几天", 0, 365) ?? 0;
  const until = optDate(input.until, "改到哪一天");
  if (!hours && !days && !until) rejectT("invalid", "extend_amount");
  const next = until ? atWorldClock(until, "23:00") : addHours(current, hours + days * 24);
  if (Date.parse(next) <= Date.parse(current)) rejectT("invalid", "extend_until_past");
  return next;
}

export interface TaskExtendInput extends ExtendInput {
  taskId: Id;
}

export const extendTask = guarded<TaskExtendInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "延期");
  mustReason(input.reason);
  const t = mustGet(rm, ctx, "tasks", input.taskId, "任务");
  const s = mustGet(rm, ctx, "stages", t.stageId, "环节");
  const p = mustGet(rm, ctx, "projects", t.projectId, "项目");
  const cut = t.cutId ? rm.get("cuts", t.cutId) ?? null : null;
  if ((t.status !== "claimed" && t.status !== "returned") || !t.dueAt) rejectT("state", "extend_not_running", { label: taskLabelP(s, cut, t, p.group) });
  const c = update("tasks", t, { dueAt: newDue(t.dueAt, input) });
  return ok(c ? [c] : [], { taskId: t.id });
});

export interface StageExtendInput extends ExtendInput {
  stageId: Id;
}

/** 一个环节所有在做（已接 / 退回）的任务一起延。 */
export const extendStage = guarded<StageExtendInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "延期");
  mustReason(input.reason);
  const s = mustGet(rm, ctx, "stages", input.stageId, "环节");
  const running = rm.where("tasks", { stageId: s.id }).filter((t) => (t.status === "claimed" || t.status === "returned") && t.dueAt);
  if (!running.length) rejectT("state", "extend_none_running");
  const changes = running.map((t) => update("tasks", t, { dueAt: newDue(t.dueAt!, input) })).filter((c): c is NonNullable<typeof c> => !!c);
  return ok(changes, { stageId: s.id });
});

export interface ProjectExtendInput {
  projectId: Id;
  until: string;
  reason: string;
}

export const extendProject = guarded<ProjectExtendInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "延期");
  mustReason(input.reason);
  const p = mustGet(rm, ctx, "projects", input.projectId, "项目");
  const until = optDate(input.until, "计划结束");
  if (!until || until < p.startOn) rejectT("invalid", "project_extend_early");
  const c = update("projects", p, { planEndOn: until });
  return ok(c ? [c] : [], { projectId: p.id });
});

// ---------------------------------------------------------------------------
// 加卡 · 改卡 · 停用一卡
// ---------------------------------------------------------------------------

export interface AddCutsInput {
  projectId: Id;
  count: number;
  /** 插在这一卡后面（C005a、C005b …）；不写 = 卡号接着往后排。 */
  afterCutId?: Id | null;
  layers?: { name: string; sheets: number }[];
  seconds?: number;
  reason?: string | null;
}

export const addCuts = guarded<AddCutsInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "加卡");
  const p = mustActiveProject(rm, ctx, input.projectId);
  const count = Number(input.count);
  if (!Number.isInteger(count) || count < 1 || count > 50) rejectT("invalid", "cut_add_count");
  const all = rm.where("cuts", { projectId: p.id });
  const hasLayers = groupTemplate(p.group).hasLayers;
  const last = [...all].sort((a, b) => b.number - a.number)[0];
  const layers: CutLayer[] = hasLayers
    ? (input.layers?.length ? input.layers : last?.layers ?? [{ name: "A", sheets: 12 }]).map((l) => ({ name: String(l.name).trim().toUpperCase(), sheets: Math.max(1, Math.min(999, Math.round(Number(l.sheets) || 1))) }))
    : [];
  if (hasLayers && (layers.some((l) => !/^[A-Z]$/.test(l.name)) || new Set(layers.map((l) => l.name)).size !== layers.length || layers.length > 6)) rejectT("invalid", "layers_bad");
  const seconds = Math.max(0, Math.min(600, Number(input.seconds ?? last?.seconds ?? 4) || 0));
  const changes: Change[] = [];
  const cuts: CutRow[] = [];
  const after = input.afterCutId ? mustGet(rm, ctx, "cuts", input.afterCutId, "卡") : null;
  if (after && after.projectId !== p.id) rejectT("not_found", "cut_after_missing", { cut: cutCode2(after, p.group) });
  const used = new Set(all.filter((c) => after && c.number === after.number).map((c) => c.suffix ?? ""));
  let nextNumber = (last?.number ?? 0) + 1;
  for (let i = 0; i < count; i++) {
    let number = nextNumber;
    let suffix: string | null = null;
    if (after) {
      number = after.number;
      const letter = "abcdefghijklmnopqrstuvwxyz".split("").find((l) => !used.has(l));
      if (!letter) rejectT("state", "cut_suffix_full", { cut: cutCode2(after, p.group) });
      used.add(letter);
      suffix = letter;
    } else nextNumber += 1;
    const r = insert(ctx, "cuts", { projectId: p.id, episode: after?.episode ?? last?.episode ?? p.episode, scene: after?.scene ?? last?.scene ?? p.scene, number, layers: layers.map((l) => ({ ...l })), seconds, keySheets: 0, suffix, disabled: false });
    changes.push(r.change);
    cuts.push(r.row as CutRow);
  }
  const stages = liveStages(rm, p.id);
  const created: TaskRow[] = [];
  const allCuts = [...liveCuts(rm, p.id), ...cuts];
  for (const s of stages) {
    if (s.grain === "project" || s.disabled) continue;
    const r = newTasks(ctx, p.group, s, cuts, allCuts);
    created.push(...r.rows);
    changes.push(...r.changes);
  }
  openReady(rm, p.id, stages, created, changes);
  return ok(changes, { cutId: cuts[0].id });
});

export interface UpdateCutInput {
  cutId: Id;
  layers?: { name: string; sheets: number }[];
  seconds?: number;
  keySheets?: number;
  reason?: string | null;
}

/** 给一卡加层 / 改张数 / 改秒数：没做完的任务工作量跟着变，在做的时限也跟着变；加的层生成新任务。 */
export const updateCut = guarded<UpdateCutInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改卡");
  const cut = mustGet(rm, ctx, "cuts", input.cutId, "卡");
  const p = mustGet(rm, ctx, "projects", cut.projectId, "项目");
  const hasLayers = groupTemplate(p.group).hasLayers;
  const patch: Partial<CutRow> = {};
  if (input.layers !== undefined) {
    if (!hasLayers) rejectT("invalid", "layers_none_video");
    const layers = input.layers.map((l) => ({ name: String(l.name).trim().toUpperCase(), sheets: Math.round(Number(l.sheets)) }));
    if (!layers.length || layers.length > 6 || layers.some((l) => !/^[A-Z]$/.test(l.name) || !(l.sheets >= 1 && l.sheets <= 999)) || new Set(layers.map((l) => l.name)).size !== layers.length) rejectT("invalid", "layers_bad");
    patch.layers = layers;
  }
  if (input.seconds !== undefined) patch.seconds = Math.max(0, Math.min(600, Number(input.seconds) || 0));
  if (input.keySheets !== undefined) patch.keySheets = Math.max(0, Math.min(999, Math.round(Number(input.keySheets) || 0)));
  const next: CutRow = { ...cut, ...patch };
  const changes: Change[] = [];
  const cc = update("cuts", cut, patch);
  if (cc) changes.push(cc);
  const stages = liveStages(rm, p.id);
  const allCuts = liveCuts(rm, p.id).map((c) => (c.id === cut.id ? next : c));
  const rules = rm.get("worlds", ctx.worldId)?.rules;
  const tasks = rm.where("tasks", { cutId: cut.id }).filter((t) => !t.extra);
  // 去掉的层：有人交过就不让去。
  const removed = cut.layers.filter((l) => !next.layers.some((x) => x.name === l.name)).map((l) => l.name);
  for (const t of tasks) {
    if (t.layer && removed.includes(t.layer)) {
      if (t.versions > 0) rejectT("state", "cut_layer_delivered", { layer: t.layer });
      changes.push({ op: "archive", table: "tasks", id: t.id, expectVersion: t.version });
      continue;
    }
    if (t.status === "passed" || t.status === "submitted") continue;
    const s = stages.find((x) => x.id === t.stageId);
    if (!s) continue;
    const layer = t.layer ? next.layers.find((l) => l.name === t.layer) ?? null : null;
    const workload = workloadFor(workloadRuleOf(p.group, s), next, layer, allCuts);
    const tp: Partial<TaskRow> = {};
    if (workload !== t.workload) tp.workload = workload;
    if (tp.workload !== undefined && (t.status === "claimed" || t.status === "returned") && t.claimedAt) tp.dueAt = addHours(t.claimedAt, deadlineHours(s, { ...t, workload }, rules));
    const c = update("tasks", t, tp);
    if (c) changes.push(c);
  }
  // 加的层：每卡每层的环节生成新任务。
  const added = next.layers.filter((l) => !cut.layers.some((x) => x.name === l.name));
  if (added.length) {
    const created: TaskRow[] = [];
    const onlyNew = { ...next, layers: added };
    for (const s of stages) {
      if (s.grain !== "layer" || s.disabled) continue;
      const r = newTasks(ctx, p.group, s, [onlyNew as CutRow], allCuts);
      created.push(...r.rows);
      changes.push(...r.changes);
    }
    openReady(rm, p.id, stages, created, changes);
  }
  return ok(changes, { cutId: cut.id });
});

export interface ArchiveCutInput {
  cutId: Id;
  reason: string;
}

/** 停用一卡：还没人接的任务拿掉（不再派）；在做的、交过的、通过的留着。 */
export const archiveCut = guarded<ArchiveCutInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "停用一卡");
  mustReason(input.reason);
  const cut = mustGet(rm, ctx, "cuts", input.cutId, "卡");
  const p = mustGet(rm, ctx, "projects", cut.projectId, "项目");
  if (cut.disabled) rejectT("state", "cut_already_disabled", { cut: cutCode2(cut, p.group) });
  const changes: Change[] = [];
  const c = update("cuts", cut, { disabled: true });
  if (c) changes.push(c);
  for (const t of rm.where("tasks", { cutId: cut.id })) {
    if (t.status === "open" || t.status === "locked" || t.status === "reclaimed") changes.push({ op: "archive", table: "tasks", id: t.id, expectVersion: t.version });
  }
  return ok(changes, { cutId: cut.id });
});
