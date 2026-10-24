/**
 * 项目（SPEC §4 · P8）：开项目一步生成环节 + 卡 + 任务；改项目；指定审核员；
 * 改工时与系数；枢纽派发（按工作量批量生成或解锁下游任务，一条日志）。
 */
import { hubScope, TaskPatches, tasksToUnlock } from "../flow";
import { GROUP, PROJECT_STATUS, type Change, type CutLayer, type CutRow, type Group, type Id, type ProjectStatus, type RateOverride, type RowHeader, type StageRow, type TaskRow } from "../model";
import type { ReadModel } from "../readmodel";
import { rateFor } from "../rules";
import { GROUP_EN, groupTemplate, stageTemplate, type DefaultWorkload, type StageTemplate } from "../templates";
import { cutCode, cutCode2, stageParam, taskLabelP } from "../naming";
import { phraseText, t2, uc, type Phrase, type Text2 } from "../text";
import { guarded, insert, isReviewer, mustAdmin, mustBeOneOf, mustGet, mustNumber, mustText, ok, optDate, optInteger, optNumber, rejectT, update, type Ctx } from "./core";
import { optLink } from "./validate";

export interface CutInput {
  number?: number;
  layers?: CutLayer[];
  seconds?: number;
  keySheets?: number;
  episode?: string;
  scene?: string;
}

export interface CreateProjectInput {
  group: Group;
  name: string;
  code: string;
  episode?: string;
  scene?: string;
  startOn: string;
  planEndOn: string;
  feishuRoot?: string | null;
  cuts: CutInput[];
}

const CODE_RE = /^[A-Z][A-Z0-9]{1,5}$/;
const EPISODE_RE = /^EP\d{2,3}$/;
const SCENE_RE = /^SC\d{3}$/;

function mustCode(rm: ReadModel, value: unknown, exceptId?: Id): string {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!CODE_RE.test(code)) rejectT("invalid", "code_bad");
  if (rm.where("projects").some((p) => p.code === code && p.id !== exceptId)) rejectT("invalid", "code_used", { code });
  return code;
}

function mustEpisode(value: unknown, fallback: string): string {
  const s = value === undefined || value === null || value === "" ? fallback : String(value).trim().toUpperCase();
  if (!EPISODE_RE.test(s)) rejectT("invalid", "episode_bad");
  return s;
}

function mustScene(value: unknown, fallback: string): string {
  const s = value === undefined || value === null || value === "" ? fallback : String(value).trim().toUpperCase();
  if (!SCENE_RE.test(s)) rejectT("invalid", "scene_bad");
  return s;
}

function mustLayers(value: unknown, where: Text2, hasLayers: boolean): CutLayer[] {
  const list = Array.isArray(value) ? value : [];
  if (!hasLayers) {
    if (list.length) rejectT("invalid", "layers_none_video");
    return [];
  }
  if (list.length === 0) rejectT("invalid", "layers_min", { where });
  if (list.length > 6) rejectT("invalid", "layers_max", { where });
  const seen = new Set<string>();
  return list.map((l) => {
    const name = typeof l?.name === "string" ? l.name.trim().toUpperCase() : "";
    if (!/^[A-Z]$/.test(name)) rejectT("invalid", "layer_name_bad", { where });
    if (seen.has(name)) rejectT("invalid", "layer_dup", { where, name });
    seen.add(name);
    const sheets = optInteger(l?.sheets, t2(`${where.zh} ${name} 层的张数`, `drawings for layer ${name} of ${where.en}`), 1, 999);
    if (sheets === null) rejectT("invalid", "layer_sheets_missing", { where, name });
    return { name, sheets };
  });
}

function workloadFor(rule: DefaultWorkload, cut: CutRow | null, layer: CutLayer | null, cuts: CutRow[]): number {
  switch (rule) {
    case "one":
      return 1;
    case "layerSheets":
      return layer?.sheets ?? 1;
    case "cutSheets":
      return Math.max(1, (cut?.layers ?? []).reduce((n, l) => n + l.sheets, 0));
    case "keySheets":
      return Math.max(1, cut?.keySheets ?? 1);
    case "cutSeconds":
      return Math.max(1, cut?.seconds ?? 1);
    case "projectSeconds":
      return Math.max(1, cuts.reduce((n, c) => n + c.seconds, 0));
  }
}

export function stageBody(t: StageTemplate, projectId: Id, sort: number, rate: RateOverride | undefined): Omit<StageRow, keyof RowHeader> {
  return {
    projectId,
    templateKey: t.key,
    name: t.name,
    phase: t.phase,
    kind: t.kind,
    hub: t.hub,
    grain: t.grain,
    unit: t.unit,
    tn: rate?.tn ?? t.tn,
    per: rate?.per ?? t.per,
    control: rate?.control ?? 1,
    code: t.code,
    fileCode: t.fileCode,
    folder: t.folder,
    upstream: [...t.upstream],
    indicator: { receive: t.receive, deliver: t.deliver, handTo: t.handTo },
    reviewerId: null,
    sort,
    adminSet: !!t.adminSet,
    note: t.note ?? null,
  };
}

export const createProject = guarded<CreateProjectInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "开项目");
  const group = mustBeOneOf(input.group, GROUP, "组");
  const tpl = groupTemplate(group);
  const name = mustText(input.name, "项目名字", 40);
  const code = mustCode(rm, input.code);
  const episode = mustEpisode(input.episode, "EP01");
  const scene = mustScene(input.scene, "SC001");
  const startOn = optDate(input.startOn, "开始");
  const planEndOn = optDate(input.planEndOn, "计划结束");
  if (!startOn || !planEndOn) rejectT("invalid", "dates_required");
  if (planEndOn < startOn) rejectT("invalid", "end_before_start");
  const feishuRoot = optLink(input.feishuRoot, "飞书根文件夹");
  const cutInputs = Array.isArray(input.cuts) ? input.cuts : [];
  if (cutInputs.length === 0) rejectT("invalid", "cuts_min", { unit: t2(tpl.cutLabel, GROUP_EN[group].cutLabel) });
  if (cutInputs.length > 200) rejectT("invalid", "cuts_max", { unit: t2(tpl.cutLabel, GROUP_EN[group].cutLabel) });

  const world = rm.get("worlds", ctx.worldId);
  const project = insert(ctx, "projects", { group, name, code, episode, scene, startOn, planEndOn, status: "active", feishuRoot });
  const changes: Change[] = [project.change];

  const numbers = new Set<number>();
  const cuts: CutRow[] = cutInputs.map((c, i) => {
    const number = optInteger(c?.number, "卡号", 1, 9999) ?? i + 1;
    if (numbers.has(number)) rejectT("invalid", "cut_dup", { cut: cutCode2({ number }, group) });
    numbers.add(number);
    const where = cutCode2({ number }, group);
    const layers = mustLayers(c?.layers, where, tpl.hasLayers);
    const seconds = optNumber(c?.seconds, t2(`${where.zh} 的秒数`, `seconds for ${where.en}`), 0, 600) ?? 0;
    const keySheets = optInteger(c?.keySheets, t2(`${where.zh} 的原画张数`, `key drawings for ${where.en}`), 0, 999) ?? 0;
    const row = insert(ctx, "cuts", {
      projectId: project.row.id,
      episode: mustEpisode(c?.episode, episode),
      scene: mustScene(c?.scene, scene),
      number,
      layers,
      seconds,
      keySheets,
    });
    changes.push(row.change);
    return row.row as CutRow;
  });
  cuts.sort((a, b) => a.number - b.number);

  const stages: StageRow[] = tpl.stages.map((t, i) => {
    const s = insert(ctx, "stages", stageBody(t, project.row.id, i + 1, rateFor(world?.rules, group, t.key)));
    changes.push(s.change);
    return s.row as StageRow;
  });

  const tasks: TaskRow[] = [];
  const addTask = (stage: StageRow, t: StageTemplate, cut: CutRow | null, layer: CutLayer | null, order: number) => {
    const row = insert(ctx, "tasks", {
      projectId: project.row.id,
      stageId: stage.id,
      cutId: cut?.id ?? null,
      layer: layer?.name ?? null,
      workload: workloadFor(t.workload, cut, layer, cuts),
      status: stage.upstream.length === 0 ? "open" : "locked",
      assigneeId: null,
      claimedAt: null,
      dueAt: null,
      outsourced: false,
      outsourceName: null,
      versions: 0,
      submittedAt: null,
      passedAt: null,
      dispatchedAt: null,
      sort: stage.sort * 100000 + order,
    });
    tasks.push(row.row as TaskRow);
    changes.push(row.change);
  };
  stages.forEach((stage, i) => {
    const t = tpl.stages[i];
    if (stage.grain === "project") addTask(stage, t, null, null, 0);
    else
      for (const cut of cuts) {
        if (stage.grain === "cut") addTask(stage, t, cut, null, cut.number * 10);
        else cut.layers.forEach((l, li) => addTask(stage, t, cut, l, cut.number * 10 + li + 1));
      }
  });
  // 没有上游的已经是「可接」；保险起见再推一遍（纯函数，不会多放）。
  const unlock = new Set(tasksToUnlock(stages, tasks));
  if (unlock.size) {
    for (const c of changes) if (c.op === "insert" && c.table === "tasks" && unlock.has(c.row.id)) (c.row as TaskRow).status = "open";
  }
  return ok(changes, { projectId: project.row.id });
});

export interface UpdateProjectInput {
  projectId: Id;
  name?: string;
  code?: string;
  startOn?: string;
  planEndOn?: string;
  feishuRoot?: string | null;
  status?: ProjectStatus;
  /** 一周期几天（排期用，默认 7）。 */
  cycleDays?: number;
  /** 零日页（封面）：介绍 · 封面图 · 关键日。 */
  intro?: string | null;
  coverFileId?: Id | null;
  keyDates?: { id?: string; name: string; date: string }[];
}

export const updateProject = guarded<UpdateProjectInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改项目");
  const p = mustGet(rm, ctx, "projects", input.projectId, "项目");
  const patch: Partial<typeof p> = {};
  if (input.name !== undefined) patch.name = mustText(input.name, "项目名字", 40);
  if (input.code !== undefined) patch.code = mustCode(rm, input.code, p.id);
  if (input.startOn !== undefined) patch.startOn = optDate(input.startOn, "开始") ?? p.startOn;
  if (input.planEndOn !== undefined) patch.planEndOn = optDate(input.planEndOn, "计划结束") ?? p.planEndOn;
  if ((patch.planEndOn ?? p.planEndOn) < (patch.startOn ?? p.startOn)) rejectT("invalid", "end_before_start");
  if (input.feishuRoot !== undefined) patch.feishuRoot = optLink(input.feishuRoot, "飞书根文件夹");
  if (input.status !== undefined) patch.status = mustBeOneOf(input.status, PROJECT_STATUS, "状态");
  if (input.cycleDays !== undefined) patch.cycleDays = optInteger(input.cycleDays, "一周期几天", 1, 31) ?? 7;
  if (input.intro !== undefined) patch.intro = typeof input.intro === "string" && input.intro.trim() ? input.intro.trim().slice(0, 1000) : null;
  if (input.coverFileId !== undefined) {
    if (input.coverFileId) {
      const f = mustGet(rm, ctx, "files", input.coverFileId, "封面图");
      if (f.projectId !== p.id || !f.width) rejectT("invalid", "cover_not_image");
      patch.coverFileId = f.id;
    } else patch.coverFileId = null;
  }
  if (input.keyDates !== undefined) {
    const list = Array.isArray(input.keyDates) ? input.keyDates : [];
    if (list.length > 12) rejectT("invalid", "key_dates_too_many", { max: 12 });
    patch.keyDates = list.map((k, i) => {
      const name = typeof k?.name === "string" ? k.name.trim().slice(0, 30) : "";
      const date = optDate(k?.date, "关键日");
      if (!name || !date) rejectT("invalid", "key_date_bad");
      return { id: typeof k.id === "string" && k.id ? k.id.slice(0, 12) : `k${i + 1}`, name, date };
    });
  }
  const ch = update("projects", p, patch);
  return ok(ch ? [ch] : []);
});

export interface SetReviewerInput {
  stageId: Id;
  memberId: Id | null;
}

/** 给一个环节指定审核员（空 = 审核员和管理员谁都能审）。 */
export const setReviewer = guarded<SetReviewerInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "指定审核员");
  const stage = mustGet(rm, ctx, "stages", input.stageId, "环节");
  let reviewerId: Id | null = null;
  if (input.memberId) {
    const m = mustGet(rm, ctx, "members", input.memberId, "成员");
    if (!isReviewer(m)) rejectT("invalid", "not_reviewer", { name: uc(m.nickname) });
    reviewerId = m.id;
  }
  const ch = update("stages", stage, { reviewerId });
  return ok(ch ? [ch] : []);
});

export interface SetRateInput {
  group: Group;
  stageKey: string;
  tn?: number;
  per?: number;
  control?: number;
}

/**
 * 改工时与系数：记在工会规则里（以后开的项目照这个），并改到现有项目的这个环节上
 * （只影响以后的审核；已经记下的活力点不变）。
 */
export const setRate = guarded<SetRateInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改工时和系数");
  const group = mustBeOneOf(input.group, GROUP, "组");
  const t = stageTemplate(group, input.stageKey);
  if (!t) rejectT("not_found", "stage_missing");
  const world = mustGet(rm, ctx, "worlds", ctx.worldId, "工会");
  const prev = rateFor(world.rules, group, t.key) ?? {};
  const next: RateOverride = { ...prev };
  const tn = optNumber(input.tn, "工时", 0, 200);
  const per = optNumber(input.per, "每多少单位", 1, 600);
  const control = optNumber(input.control, "掌控系数", 0, 3);
  if (tn !== null) next.tn = tn;
  if (per !== null) next.per = per;
  if (control !== null) next.control = control;
  const rates = { ...(world.rules.rates ?? {}) };
  rates[group] = { ...(rates[group] ?? {}), [t.key]: next };
  const changes: Change[] = [];
  const wc = update("worlds", world, { rules: { ...world.rules, rates } });
  if (wc) changes.push(wc);
  const projectIds = new Set(rm.where("projects", { group }).map((p) => p.id));
  for (const s of rm.where("stages", { templateKey: t.key })) {
    if (!projectIds.has(s.projectId)) continue;
    const c = update("stages", s, { tn: next.tn ?? t.tn, per: next.per ?? t.per, control: next.control ?? 1 });
    if (c) changes.push(c);
  }
  return ok(changes);
});

export interface DispatchRow {
  taskId: Id;
  workload: number;
}

export interface DispatchAdd {
  stageId: Id;
  cutId: Id;
  layer: string;
  workload: number;
}

export interface HubDispatchInput {
  hubStageId: Id;
  rows: DispatchRow[];
  /** 加一层（例如某一卡多了 C 层）：生成新的任务。 */
  add?: DispatchAdd[];
  /** ready = 上游通过的才放出来（其余的等上游通过自动放）· all = 全部马上放出来（不等上游）。 */
  release: "ready" | "all";
}

const EDITABLE: TaskRow["status"][] = ["locked", "open", "reclaimed"];

export const hubDispatch = guarded<HubDispatchInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "枢纽派发");
  const hub = mustGet(rm, ctx, "stages", input.hubStageId, "枢纽环节");
  if (!hub.hub) rejectT("invalid", "not_hub", { stage: stageParam(groupOfStage(rm, hub), hub) });
  const release = input.release === "all" ? "all" : input.release === "ready" ? "ready" : rejectT("invalid", "release_pick");
  const project = mustGet(rm, ctx, "projects", hub.projectId, "项目");
  const stages = rm.where("stages", { projectId: project.id });
  const scope = new Map(hubScope(stages, hub).map((s) => [s.id, s]));
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const adds = Array.isArray(input.add) ? input.add : [];
  if (rows.length === 0 && adds.length === 0) rejectT("invalid", "dispatch_none");
  const acc = new TaskPatches(rm);
  const changes: Change[] = [];
  const touched = new Set<Id>();
  for (const r of rows) {
    const task = mustGet(rm, ctx, "tasks", r?.taskId, "任务");
    const stage = scope.get(task.stageId);
    if (!stage) rejectT("invalid", "dispatch_out_of_scope", { stage: stageParam(project.group, hub) });
    if (touched.has(task.id)) rejectT("invalid", "dispatch_dup");
    touched.add(task.id);
    const label = taskWhere(rm, task, stage, project.group);
    if (!EDITABLE.includes(task.status)) rejectT("state", "dispatch_busy", { label });
    const workload = mustNumber(r.workload, t2(`${phraseText(label, "zh")}的工作量`, `workload for ${phraseText(label, "en")}`), 0.5, 9999);
    acc.set(task, { workload, dispatchedAt: ctx.worldNow, ...(release === "all" && task.status === "locked" ? { status: "open" as const } : {}) });
  }
  for (const a of adds) {
    const stage = scope.get(a?.stageId);
    if (!stage) rejectT("invalid", "dispatch_add_out_of_scope");
    if (stage.grain !== "layer") rejectT("invalid", "dispatch_no_layers", { stage: stageParam(project.group, stage) });
    const cut = mustGet(rm, ctx, "cuts", a.cutId, "卡");
    if (cut.projectId !== project.id) rejectT("invalid", "cut_other_project");
    const layer = typeof a.layer === "string" ? a.layer.trim().toUpperCase() : "";
    if (!/^[A-Z]$/.test(layer)) rejectT("invalid", "layer_letter");
    const exists = rm.where("tasks", { stageId: stage.id, cutId: cut.id }).some((t) => t.layer === layer);
    if (exists) rejectT("invalid", "layer_exists", { cut: cutCode2(cut, project.group), stage: stageParam(project.group, stage), layer });
    const workload = mustNumber(a.workload, t2(`${cutCode(cut, project.group)} ${layer} 层的工作量`, `workload for ${cutCode(cut, project.group, "en")} layer ${layer}`), 0.5, 9999);
    const t = insert(ctx, "tasks", {
      projectId: project.id,
      stageId: stage.id,
      cutId: cut.id,
      layer,
      workload,
      status: release === "all" ? "open" : "locked",
      assigneeId: null,
      claimedAt: null,
      dueAt: null,
      outsourced: false,
      outsourceName: null,
      versions: 0,
      submittedAt: null,
      passedAt: null,
      dispatchedAt: ctx.worldNow,
      sort: stage.sort * 100000 + cut.number * 10 + (layer.charCodeAt(0) - 64),
    });
    changes.push(t.change);
    if (!cut.layers.some((l) => l.name === layer)) {
      const cc = update("cuts", cut, { layers: [...cut.layers, { name: layer, sheets: Math.max(1, Math.round(workload)) }] });
      if (cc) changes.push(cc);
    }
  }
  if (release === "ready") {
    const added = changes.filter((c) => c.op === "insert" && c.table === "tasks").map((c) => (c as { row: TaskRow }).row);
    const ready = new Set(tasksToUnlock(stages, [...acc.projectTasks(project.id), ...added]));
    for (const t of added) if (ready.has(t.id)) t.status = "open";
    for (const id of Array.from(ready)) {
      const t = acc.get(id);
      if (t) acc.set(t, { status: "open" });
    }
  }
  return ok([...acc.changes(), ...changes], { projectId: project.id });
});

function taskWhere(rm: ReadModel, task: TaskRow, stage: StageRow, group: Group): Phrase {
  const cut = task.cutId ? rm.get("cuts", task.cutId) ?? null : null;
  return taskLabelP(stage, cut, task, group);
}

function groupOfStage(rm: ReadModel, stage: StageRow): Group {
  return rm.get("projects", stage.projectId)?.group ?? "animation";
}

export type { Ctx };
