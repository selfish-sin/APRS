/**
 * 零日（SPEC §12.1）：项目开工前的样子。建项目先进零日、不生成任务；管理员点「开工」才按模板生成环节、卡和任务。
 *   project.draft（用模板建一个零日项目）· project.set_structure（结构：批量填，再逐卡改）·
 *   staff.set（人员表：一个职位填几个人，成员或外部名字）· staff.add_position · project.start（开工）
 * 零日页（项目的封面：介绍 · 日期 · 关键日 · 封面图）开工后也能改，走 project.update。
 */
import { addDays } from "../clock";
import { GROUP, type Change, type CutLayer, type CutPlan, type CutRow, type Group, type Id, type ProjectRow, type ProjectStructure, type StaffPerson, type StaffPosition, type StageRow } from "../model";
import { cutCode } from "../naming";
import { PROJECT_TEMPLATES, PROJECT_TEMPLATE_KEYS, type ProjectTemplateKey } from "../positions";
import type { ReadModel } from "../readmodel";
import { DEFAULT_MAX_ACTIVE, rateFor } from "../rules";
import { groupTemplate } from "../templates";
import { guarded, insert, mustAdmin, mustBeOneOf, mustGet, mustText, ok, optDate, rejectT, update, type Ctx } from "./core";
import { t2, uc, type Text2 } from "../text";
import { whatText } from "../what";
import { newTasks, openReady } from "./materialize";
import { stageBody } from "./project";

const CODE_RE = /^[A-Z][A-Z0-9]{1,5}$/;
export const MAX_CUTS = 200;

function int(value: unknown, what: string | Text2, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) rejectT("invalid", "structure_range", { what: whatText(what), min, max });
  return n;
}

function mustLayerNames(value: unknown, hasLayers: boolean): string[] {
  const list = Array.isArray(value) ? value.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : [];
  if (!hasLayers) {
    if (list.length) rejectT("invalid", "layers_none_video");
    return [];
  }
  if (!list.length || list.length > 6 || list.some((x) => !/^[A-Z]$/.test(x)) || new Set(list).size !== list.length) rejectT("invalid", "layers_bad");
  return list;
}

export function mustStructure(value: Partial<ProjectStructure> | undefined, hasLayers: boolean): ProjectStructure {
  const v = value ?? {};
  const s: ProjectStructure = {
    episodes: int(v.episodes ?? 1, "几集", 1, 20),
    scenesPerEpisode: int(v.scenesPerEpisode ?? 1, "每集几场", 1, 50),
    cutsPerScene: int(v.cutsPerScene ?? 3, "每场几卡", 1, 200),
    layers: mustLayerNames(v.layers ?? (hasLayers ? ["A", "B"] : []), hasLayers),
    sheetsPerLayer: int(v.sheetsPerLayer ?? 12, "每层大概几张", 0, 999),
    secondsPerCut: int(v.secondsPerCut ?? 4, "每卡几秒", 0, 600),
  };
  const n = s.episodes * s.scenesPerEpisode * s.cutsPerScene;
  if (n > MAX_CUTS) rejectT("invalid", "structure_too_many", { max: MAX_CUTS, n });
  return s;
}

/** 照结构排出每一卡（卡号从 1 接着往后排）。 */
export function planCuts(s: ProjectStructure): CutPlan[] {
  const out: CutPlan[] = [];
  let number = 1;
  for (let e = 1; e <= s.episodes; e++)
    for (let sc = 1; sc <= s.scenesPerEpisode; sc++)
      for (let c = 1; c <= s.cutsPerScene; c++) {
        out.push({
          episode: `EP${String(e).padStart(2, "0")}`,
          scene: `SC${String(sc).padStart(3, "0")}`,
          number: number++,
          layers: s.layers.map((name) => ({ name, sheets: Math.max(1, s.sheetsPerLayer) })),
          seconds: s.secondsPerCut,
        });
      }
  return out;
}

function staffFromTemplate(tpl: ProjectTemplateKey): StaffPosition[] {
  return PROJECT_TEMPLATES[tpl].positions.map((p) => ({ key: p.key, custom: null, stageKeys: [...p.stageKeys], people: [] }));
}

export interface DraftProjectInput {
  template: ProjectTemplateKey;
  name: string;
  code: string;
  /** 不写 = 照模板的组。 */
  group?: Group;
  startOn?: string;
  planEndOn?: string;
}

/** 用模板建一个零日项目（不生成任务）。 */
export const draftProject = guarded<DraftProjectInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "开项目");
  const template = mustBeOneOf(input.template, PROJECT_TEMPLATE_KEYS, "模板");
  const tpl = PROJECT_TEMPLATES[template];
  const group = input.group ? mustBeOneOf(input.group, GROUP, "组") : tpl.group;
  const name = mustText(input.name, "项目名字", 40);
  const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  if (!CODE_RE.test(code)) rejectT("invalid", "project_code_bad");
  if (rm.where("projects").some((p) => p.code === code)) rejectT("invalid", "project_code_taken", { code });
  const today = ctx.worldNow.slice(0, 10);
  const startOn = optDate(input.startOn, "开始") ?? today;
  const planEndOn = optDate(input.planEndOn, "计划结束") ?? addDays(startOn, 90);
  if (planEndOn < startOn) rejectT("invalid", "project_extend_early");
  const structure = mustStructure(undefined, groupTemplate(group).hasLayers);
  const p = insert(ctx, "projects", {
    group,
    name,
    code,
    episode: "EP01",
    scene: "SC001",
    startOn,
    planEndOn,
    status: "zero",
    feishuRoot: null,
    cycleDays: 7,
    template,
    intro: null,
    coverFileId: null,
    keyDates: [],
    structure,
    cutsPlan: planCuts(structure),
    staff: staffFromTemplate(template),
    startedAt: null,
  });
  return ok([p.change], { projectId: p.row.id });
});

function mustZero(rm: ReadModel, ctx: Ctx, projectId: Id): ProjectRow {
  const p = mustGet(rm, ctx, "projects", projectId, "项目");
  if (p.status !== "zero") rejectT("state", "zero_only");
  return p;
}

export interface CutPlanInput {
  number: number;
  layers?: { name: string; sheets: number }[];
  seconds?: number;
}

export interface SetStructureInput {
  projectId: Id;
  structure: Partial<ProjectStructure>;
  /** 逐卡改（批量排好以后改某几卡的层、张数、秒数）。 */
  cuts?: CutPlanInput[];
}

export const setStructure = guarded<SetStructureInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改项目");
  const p = mustZero(rm, ctx, input.projectId);
  const hasLayers = groupTemplate(p.group).hasLayers;
  const structure = mustStructure(input.structure, hasLayers);
  const plan = planCuts(structure);
  for (const c of Array.isArray(input.cuts) ? input.cuts : []) {
    const row = plan.find((x) => x.number === Number(c.number));
    if (!row) continue;
    if (c.layers) {
      const names = mustLayerNames(c.layers.map((l) => l.name), hasLayers);
      row.layers = names.map((name, i) => ({ name, sheets: int(c.layers![i].sheets, t2(`${cutCode(row, p.group)} ${name} 层的张数`, `drawings for ${cutCode(row, p.group, "en")} layer ${name}`), 1, 999) }));
    }
    if (c.seconds !== undefined) row.seconds = int(c.seconds, t2(`${cutCode(row, p.group)} 的秒数`, `seconds for ${cutCode(row, p.group, "en")}`), 0, 600);
  }
  const ch = update("projects", p, { structure, cutsPlan: plan });
  return ok(ch ? [ch] : [], { projectId: p.id });
});

export interface StaffSetInput {
  projectId: Id;
  positionKey: string;
  people: ({ memberId: Id } | { name: string })[];
}

/** 一个职位填人：成员，或者直接写一个名字（不在工会里的人 / 外包，标「外部」）。开工以后填进来的成员马上报到对应环节。 */
export const setStaff = guarded<StaffSetInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改人员表");
  const p = mustGet(rm, ctx, "projects", input.projectId, "项目");
  const staff = (p.staff ?? []).map((x) => ({ ...x, people: [...x.people] }));
  const pos = staff.find((x) => x.key === input.positionKey);
  if (!pos) rejectT("not_found", "staff_position_missing");
  const list = Array.isArray(input.people) ? input.people : [];
  if (list.length > 8) rejectT("invalid", "staff_too_many", { max: 8 });
  const people: StaffPerson[] = [];
  for (const raw of list) {
    if ("memberId" in raw && raw.memberId) {
      const m = mustGet(rm, ctx, "members", raw.memberId, "成员");
      if (people.some((x) => "memberId" in x && x.memberId === m.id)) rejectT("invalid", "staff_dup", { name: uc(m.nickname) });
      people.push({ memberId: m.id });
    } else {
      const name = typeof (raw as { name?: unknown }).name === "string" ? (raw as { name: string }).name.trim() : "";
      if (!name || name.length > 24) rejectT("invalid", "staff_name_bad");
      if (people.some((x) => "name" in x && x.name === name)) rejectT("invalid", "staff_dup", { name: uc(name) });
      people.push({ name });
    }
  }
  const before = new Set(pos.people.flatMap((x) => ("memberId" in x ? [x.memberId] : [])));
  pos.people = people;
  const changes: Change[] = [];
  const ch = update("projects", p, { staff });
  if (ch) changes.push(ch);
  // 开工以后填进来的成员：马上报到这个职位对应的环节（标「指派」）。
  if (p.status !== "zero") {
    for (const x of people) if ("memberId" in x && !before.has(x.memberId)) changes.push(...enrollFor(rm, ctx, x.memberId, p.group, pos.stageKeys));
  }
  return ok(changes, { projectId: p.id });
});

/** 让一个人报到这些环节（标「指派」）；已经报到过的只加上「指派」。 */
function enrollFor(rm: ReadModel, ctx: Ctx, memberId: Id, group: Group, stageKeys: string[], pending: Map<string, true> = new Map()): Change[] {
  const out: Change[] = [];
  for (const stageKey of stageKeys) {
    const k = `${memberId}:${group}:${stageKey}`;
    if (pending.has(k)) continue;
    pending.set(k, true);
    const e = rm.where("enrollments", { memberId, group, stageKey })[0];
    if (e) {
      const c = e.assigned ? null : update("enrollments", e, { assigned: true });
      if (c) out.push(c);
    } else {
      out.push(insert(ctx, "enrollments", { memberId, group, stageKey, skill: 0, maxActive: DEFAULT_MAX_ACTIVE, origin: "assigned" as const, assigned: true }).change);
    }
  }
  return out;
}

export interface AddPositionInput {
  projectId: Id;
  name: string;
  desc?: string | null;
  stageKeys?: string[];
}

export const addPosition = guarded<AddPositionInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改人员表");
  const p = mustGet(rm, ctx, "projects", input.projectId, "项目");
  const name = mustText(input.name, "职位名字", 30);
  const desc = typeof input.desc === "string" && input.desc.trim() ? input.desc.trim().slice(0, 120) : null;
  const staff = [...(p.staff ?? [])];
  let n = staff.length + 1;
  while (staff.some((x) => x.key === `c${n}`)) n += 1;
  const stageKeys = Array.isArray(input.stageKeys) ? input.stageKeys.filter((k) => typeof k === "string").slice(0, 6) : [];
  staff.push({ key: `c${n}`, custom: { name, desc }, stageKeys, people: [] });
  const ch = update("projects", p, { staff });
  return ok(ch ? [ch] : [], { projectId: p.id });
});

export interface StartProjectInput {
  projectId: Id;
}

/** 开工：按模板生成环节、照 cutsPlan 生成卡和任务；填了人的职位 = 这些人自动报到对应环节。 */
export const startProject = guarded<StartProjectInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "开工");
  const p = mustGet(rm, ctx, "projects", input.projectId, "项目");
  if (p.status !== "zero") rejectT("state", "not_zero");
  const plan = p.cutsPlan ?? [];
  const tpl = PROJECT_TEMPLATES[p.template ?? "anim_standard"];
  const gt = groupTemplate(p.group);
  const world = rm.get("worlds", ctx.worldId);
  const changes: Change[] = [];
  const cuts: CutRow[] = plan.map((c) => {
    const r = insert(ctx, "cuts", { projectId: p.id, episode: c.episode, scene: c.scene, number: c.number, layers: c.layers.map((l: CutLayer) => ({ ...l })), seconds: c.seconds, keySheets: 0 });
    changes.push(r.change);
    return r.row as CutRow;
  });
  const stages: StageRow[] = tpl.stages
    ? gt.stages.map((t, i) => {
        const s = insert(ctx, "stages", stageBody(t, p.id, i + 1, rateFor(world?.rules, p.group, t.key)));
        changes.push(s.change);
        return s.row as StageRow;
      })
    : [];
  const created = [];
  for (const s of stages) {
    const r = newTasks(ctx, p.group, s, cuts, cuts);
    created.push(...r.rows);
    changes.push(...r.changes);
  }
  openReady(rm, p.id, stages, created, changes);
  const ch = update("projects", p, { status: "active", startedAt: ctx.worldNow, episode: plan[0]?.episode ?? p.episode, scene: plan[0]?.scene ?? p.scene });
  if (ch) changes.unshift(ch);
  const pending = new Map<string, true>();
  for (const pos of p.staff ?? []) for (const x of pos.people) if ("memberId" in x) changes.push(...enrollFor(rm, ctx, x.memberId, p.group, pos.stageKeys, pending));
  return ok(changes, { projectId: p.id });
});
