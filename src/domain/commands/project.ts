/**
 * 项目（SPEC §4 · P8）：开项目一步生成环节 + 卡 + 任务；改项目；指定审核员；
 * 改工时与系数；枢纽派发（按工作量批量生成或解锁下游任务，一条日志）。
 */
import { hubScope, TaskPatches, tasksToUnlock } from "../flow";
import { GROUP, PROJECT_STATUS, type Change, type CutLayer, type CutRow, type Group, type Id, type ProjectStatus, type RateOverride, type RowHeader, type StageRow, type TaskRow } from "../model";
import type { ReadModel } from "../readmodel";
import { rateFor } from "../rules";
import { groupTemplate, stageTemplate, type DefaultWorkload, type StageTemplate } from "../templates";
import { cutCode } from "../naming";
import { guarded, insert, isReviewer, mustAdmin, mustBeOneOf, mustGet, mustNumber, mustText, ok, optDate, optInteger, optNumber, reject, update, type Ctx } from "./core";
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
  if (!CODE_RE.test(code)) reject("invalid", "代号要 2–6 位大写字母（可以带数字，第一位是字母），例如 ANDLC");
  if (rm.where("projects").some((p) => p.code === code && p.id !== exceptId)) reject("invalid", `代号「${code}」已经用过了`);
  return code;
}

function mustEpisode(value: unknown, fallback: string): string {
  const s = value === undefined || value === null || value === "" ? fallback : String(value).trim().toUpperCase();
  if (!EPISODE_RE.test(s)) reject("invalid", "集数写成 EP01 这样");
  return s;
}

function mustScene(value: unknown, fallback: string): string {
  const s = value === undefined || value === null || value === "" ? fallback : String(value).trim().toUpperCase();
  if (!SCENE_RE.test(s)) reject("invalid", "场景写成 SC001 这样");
  return s;
}

function mustLayers(value: unknown, where: string, hasLayers: boolean): CutLayer[] {
  const list = Array.isArray(value) ? value : [];
  if (!hasLayers) {
    if (list.length) reject("invalid", "视频组不分层");
    return [];
  }
  if (list.length === 0) reject("invalid", `${where}至少要有一层（A 层）`);
  if (list.length > 6) reject("invalid", `${where}最多 6 层`);
  const seen = new Set<string>();
  return list.map((l) => {
    const name = typeof l?.name === "string" ? l.name.trim().toUpperCase() : "";
    if (!/^[A-Z]$/.test(name)) reject("invalid", `${where}的层名写一个大写字母（A、B …）`);
    if (seen.has(name)) reject("invalid", `${where}有两个 ${name} 层`);
    seen.add(name);
    const sheets = optInteger(l?.sheets, `${where} ${name} 层的张数`, 1, 999);
    if (sheets === null) reject("invalid", `${where} ${name} 层要填张数`);
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
  if (!startOn || !planEndOn) reject("invalid", "开始和计划结束的日期都要填");
  if (planEndOn < startOn) reject("invalid", "计划结束不能早于开始");
  const feishuRoot = optLink(input.feishuRoot, "飞书根文件夹");
  const cutInputs = Array.isArray(input.cuts) ? input.cuts : [];
  if (cutInputs.length === 0) reject("invalid", `至少要有 1 ${tpl.cutLabel}`);
  if (cutInputs.length > 200) reject("invalid", `一个项目最多 200 ${tpl.cutLabel}`);

  const world = rm.get("worlds", ctx.worldId);
  const project = insert(ctx, "projects", { group, name, code, episode, scene, startOn, planEndOn, status: "active", feishuRoot });
  const changes: Change[] = [project.change];

  const numbers = new Set<number>();
  const cuts: CutRow[] = cutInputs.map((c, i) => {
    const number = optInteger(c?.number, "卡号", 1, 9999) ?? i + 1;
    if (numbers.has(number)) reject("invalid", `${cutCode({ number }, group)} 重复了`);
    numbers.add(number);
    const where = cutCode({ number }, group);
    const layers = mustLayers(c?.layers, where, tpl.hasLayers);
    const seconds = optNumber(c?.seconds, `${where} 的秒数`, 0, 600) ?? 0;
    const keySheets = optInteger(c?.keySheets, `${where} 的原画张数`, 0, 999) ?? 0;
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
}

export const updateProject = guarded<UpdateProjectInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改项目");
  const p = mustGet(rm, ctx, "projects", input.projectId, "项目");
  const patch: Partial<typeof p> = {};
  if (input.name !== undefined) patch.name = mustText(input.name, "项目名字", 40);
  if (input.code !== undefined) patch.code = mustCode(rm, input.code, p.id);
  if (input.startOn !== undefined) patch.startOn = optDate(input.startOn, "开始") ?? p.startOn;
  if (input.planEndOn !== undefined) patch.planEndOn = optDate(input.planEndOn, "计划结束") ?? p.planEndOn;
  if ((patch.planEndOn ?? p.planEndOn) < (patch.startOn ?? p.startOn)) reject("invalid", "计划结束不能早于开始");
  if (input.feishuRoot !== undefined) patch.feishuRoot = optLink(input.feishuRoot, "飞书根文件夹");
  if (input.status !== undefined) patch.status = mustBeOneOf(input.status, PROJECT_STATUS, "状态");
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
    if (!isReviewer(m)) reject("invalid", `「${m.nickname}」不是审核员，先在成员里把角色改成审核员`);
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
  if (!t) reject("not_found", "找不到这个环节");
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
  if (!hub.hub) reject("invalid", `「${hub.name}」不是枢纽环节`);
  const release = input.release === "all" ? "all" : input.release === "ready" ? "ready" : reject("invalid", "选一下怎么放出来");
  const project = mustGet(rm, ctx, "projects", hub.projectId, "项目");
  const stages = rm.where("stages", { projectId: project.id });
  const scope = new Map(hubScope(stages, hub).map((s) => [s.id, s]));
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const adds = Array.isArray(input.add) ? input.add : [];
  if (rows.length === 0 && adds.length === 0) reject("invalid", "没有选要派发的任务");
  const acc = new TaskPatches(rm);
  const changes: Change[] = [];
  const touched = new Set<Id>();
  for (const r of rows) {
    const task = mustGet(rm, ctx, "tasks", r?.taskId, "任务");
    const stage = scope.get(task.stageId);
    if (!stage) reject("invalid", `这张任务不在「${hub.name}」管的范围里`);
    if (touched.has(task.id)) reject("invalid", "同一张任务写了两次");
    touched.add(task.id);
    const label = taskWhere(rm, task, stage, project.group);
    if (!EDITABLE.includes(task.status)) reject("state", `${label}已经有人在做或做完了，不能再派发`);
    const workload = mustNumber(r.workload, `${label}的工作量`, 0.5, 9999);
    acc.set(task, { workload, dispatchedAt: ctx.worldNow, ...(release === "all" && task.status === "locked" ? { status: "open" as const } : {}) });
  }
  for (const a of adds) {
    const stage = scope.get(a?.stageId);
    if (!stage) reject("invalid", "要加的任务不在这个枢纽管的范围里");
    if (stage.grain !== "layer") reject("invalid", `「${stage.name}」不分层，不能加层`);
    const cut = mustGet(rm, ctx, "cuts", a.cutId, "卡");
    if (cut.projectId !== project.id) reject("invalid", "这一卡不在这个项目里");
    const layer = typeof a.layer === "string" ? a.layer.trim().toUpperCase() : "";
    if (!/^[A-Z]$/.test(layer)) reject("invalid", "层名写一个大写字母");
    const exists = rm.where("tasks", { stageId: stage.id, cutId: cut.id }).some((t) => t.layer === layer);
    if (exists) reject("invalid", `${cutCode(cut, project.group)} 的「${stage.name}」已经有 ${layer} 层了`);
    const workload = mustNumber(a.workload, `${cutCode(cut, project.group)} ${layer} 层的工作量`, 0.5, 9999);
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

function taskWhere(rm: ReadModel, task: TaskRow, stage: StageRow, group: Group): string {
  const cut = task.cutId ? rm.get("cuts", task.cutId) : undefined;
  return `${cut ? `${cutCode(cut, group)} ` : ""}「${stage.name}」${task.layer ? ` ${task.layer} 层` : ""}`;
}

export type { Ctx };
