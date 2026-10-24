/**
 * 报到和任务（SPEC §4 规则 2–6）：
 *   报到 = 自动配任务 · 接任务再配一张 · 交（版本 +1，文件名按规范）· 放弃（返还）·
 *   超时收回 · 管理员收回 / 重新放出 / 指派（含外包）· 审核（通过 / 退回 / 自修后通过）。
 */
import { addHours } from "../clock";
import { compareBy, layerKey, numberKey } from "../agenda";
import { TaskPatches, blockersOf, unlockReady } from "../flow";
import { ACTIVE_STATUS, GROUP, QUALITY, SKILL, VERDICT, type Change, type EnrollmentRow, type Group, type Id, type MemberRow, type Quality, type ReviewComment, type Skill, type StageRow, type TaskRow, type WorldRules } from "../model";
import { fileNameFor, taskLabel } from "../naming";
import type { ReadModel } from "../readmodel";
import {
  DEFAULT_MAX_ACTIVE,
  EXPIRY_PENALTY_POINTS,
  RETURN_GRACE_MIN_HOURS,
  RETURN_GRACE_SHARE,
  RETURN_TAGS,
  SELF_FIX_HOURS_PER_CUT,
  deadlineHours,
  hoursOf,
  pointsOf,
  stageLocked,
  taskPoints,
  taskRate,
} from "../rules";
import { stageTemplate } from "../templates";
import { guarded, insert, isAdmin, isReviewer, mustAdmin, mustBeOneOf, mustGet, mustMember, ok, optInteger, optText, reject, round1, update, type Ctx } from "./core";
import { optFileName, optLink } from "./validate";
import { mustLinks } from "./links";

// ---------------------------------------------------------------------------
// 共用
// ---------------------------------------------------------------------------

function rulesOf(rm: ReadModel, ctx: Ctx): WorldRules | undefined {
  return rm.get("worlds", ctx.worldId)?.rules;
}

function stageOf(rm: ReadModel, ctx: Ctx, task: TaskRow): StageRow {
  return mustGet(rm, ctx, "stages", task.stageId, "环节");
}

function labelOf(rm: ReadModel, task: TaskRow, stage: StageRow): string {
  const project = rm.get("projects", task.projectId);
  const cut = task.cutId ? rm.get("cuts", task.cutId) ?? null : null;
  return taskLabel(stage, cut, task, project?.group);
}

function groupOf(rm: ReadModel, task: TaskRow): Group {
  return rm.get("projects", task.projectId)?.group ?? "animation";
}

/** 这个成员手上（已接 / 退回）这个环节的任务有几张。 */
function activeCount(rm: ReadModel, memberId: Id, group: Group, stageKey: string): number {
  return rm
    .where("tasks", { assigneeId: memberId })
    .filter((t) => ACTIVE_STATUS.includes(t.status))
    .filter((t) => {
      const s = rm.get("stages", t.stageId);
      return s?.templateKey === stageKey && groupOf(rm, t) === group;
    }).length;
}

function enrollmentFor(rm: ReadModel, memberId: Id, group: Group, stageKey: string): EnrollmentRow | undefined {
  return rm.where("enrollments", { memberId, group, stageKey })[0];
}

/** 接 / 派：记下现在的工时（之后改 Tn 不影响这张），按环节的时限参数算时限。 */
function claimPatch(rm: ReadModel, ctx: Ctx, stage: StageRow, task: TaskRow, memberId: Id | null, assignedById: Id | null = null): Partial<TaskRow> {
  const rate = { tn: stage.tn, per: stage.per };
  return {
    status: "claimed",
    assigneeId: memberId,
    claimedAt: ctx.worldNow,
    dueAt: addHours(ctx.worldNow, deadlineHours(stage, { ...task, rate }, rulesOf(rm, ctx))),
    rate,
    assignedById,
  };
}

/** 锁成「只给指派的人」的环节：没被指派的人不能接（SPEC §13.1）。 */
export const LOCKED_STAGE_MESSAGE = "这个环节只给指派的人，找管理员";

function mayWork(rm: ReadModel, memberId: Id, group: Group, stage: StageRow): boolean {
  if (!stageLocked(stage)) return true;
  return !!enrollmentFor(rm, memberId, group, stage.templateKey)?.assigned;
}

/** 第一次认领别的环节：自动加一条报到（熟练度 0，标「自己认领」）。 */
function autoEnroll(rm: ReadModel, ctx: Ctx, memberId: Id, group: Group, stageKey: string, changes: Change[]): EnrollmentRow {
  const e = insert(ctx, "enrollments", { memberId, group, stageKey, skill: 0 as Skill, maxActive: DEFAULT_MAX_ACTIVE, origin: "claimed" as const, assigned: false });
  changes.push(e.change);
  return e.row as EnrollmentRow;
}

/**
 * 按卡号顺序找下一张可接的：先按项目开始的日子，再按卡号、层、环节顺序（只比 ASCII，最后按 id）。
 */
export function nextOpenTask(rm: ReadModel, group: Group, stageKey: string, memberId: Id | null = null): TaskRow | undefined {
  const projects = new Map(rm.where("projects", { group }).filter((p) => p.status === "active").map((p) => [p.id, p]));
  const stageIds = new Set(
    rm
      .where("stages", { templateKey: stageKey })
      .filter((s) => projects.has(s.projectId))
      .filter((s) => !memberId || mayWork(rm, memberId, group, s))
      .map((s) => s.id)
  );
  const cuts = new Map<Id, number>();
  // 随时发的新任务（额外 · 修正 · 补设定）不自动配，要点名认领。
  const open = rm.where("tasks", { status: "open" }).filter((t) => stageIds.has(t.stageId) && !t.outsourced && !t.extra);
  for (const t of open) if (t.cutId && !cuts.has(t.cutId)) cuts.set(t.cutId, rm.get("cuts", t.cutId)?.number ?? 0);
  return open.sort(
    compareBy<TaskRow>(
      (t) => projects.get(t.projectId)?.startOn ?? "",
      (t) => t.projectId,
      (t) => numberKey(t.cutId ? cuts.get(t.cutId) : 0),
      (t) => layerKey(t.layer),
      (t) => t.sort
    )
  )[0];
}

// ---------------------------------------------------------------------------
// 报到
// ---------------------------------------------------------------------------

export interface EnrollInput {
  group: Group;
  stageKey: string;
  skill: Skill;
  maxActive?: number;
  /** 管理员代录：替谁报到。 */
  memberId?: Id;
}

/** 报到一个环节（选熟练度），报到完立刻按卡号顺序配一张可接的（不超过上限）。 */
export const enroll = guarded<EnrollInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  let member: MemberRow = me;
  if (input.memberId && input.memberId !== me.id) {
    if (!isAdmin(me)) reject("forbidden", "只有管理员可以替别人报到");
    member = mustGet(rm, ctx, "members", input.memberId, "成员");
  }
  const group = mustBeOneOf(input.group, GROUP, "组");
  const t = stageTemplate(group, input.stageKey);
  if (!t) reject("not_found", "这个组里没有这个环节");
  if (!SKILL.includes(input.skill as Skill)) reject("invalid", "熟练度选一个：+0.5 / +0.2 / 0 / −0.2");
  const skill = input.skill as Skill;
  const maxActive = optInteger(input.maxActive, "同时最多几张", 1, 9) ?? DEFAULT_MAX_ACTIVE;
  const changes: Change[] = [];
  const existing = enrollmentFor(rm, member.id, group, t.key);
  // 这个环节在所有项目里都锁成「只给指派的人」、他又没被指派：不让报到。
  const stagesHere = rm.where("stages", { templateKey: t.key }).filter((s) => rm.get("projects", s.projectId)?.group === group);
  if (!existing?.assigned && stagesHere.length > 0 && stagesHere.every((s) => stageLocked(s))) reject("forbidden", LOCKED_STAGE_MESSAGE);
  let enrollmentId: Id;
  if (existing) {
    enrollmentId = existing.id;
    const c = update("enrollments", existing, { skill, maxActive });
    if (c) changes.push(c);
  } else {
    const e = insert(ctx, "enrollments", { memberId: member.id, group, stageKey: t.key, skill, maxActive, origin: "self" as const, assigned: false });
    enrollmentId = e.row.id;
    changes.push(e.change);
  }
  const created: Record<string, Id> = { enrollmentId };
  if (activeCount(rm, member.id, group, t.key) < maxActive) {
    const next = nextOpenTask(rm, group, t.key, member.id);
    if (next) {
      const stage = stageOf(rm, ctx, next);
      const c = update("tasks", next, claimPatch(rm, ctx, stage, next, member.id));
      if (c) changes.push(c);
      created.taskId = next.id;
    }
  }
  return ok(changes, created);
});

export interface UnenrollInput {
  enrollmentId: Id;
}

/** 取消报到（手上的任务不动）。 */
export const unenroll = guarded<UnenrollInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const e = mustGet(rm, ctx, "enrollments", input.enrollmentId, "报到");
  if (e.memberId !== me.id && !isAdmin(me)) reject("forbidden", "只能取消自己的报到");
  return ok([{ op: "archive", table: "enrollments", id: e.id, expectVersion: e.version }]);
});

// ---------------------------------------------------------------------------
// 接 · 交 · 放弃 · 超时
// ---------------------------------------------------------------------------

export interface ClaimInput {
  /** 指定一张（在卡详情 / 总览上点「接这张」）。不写 = 从报到的环节里按顺序配一张。 */
  taskId?: Id;
  /** 只在这个环节里配。 */
  stageKey?: string;
  group?: Group;
}

export const claimTask = guarded<ClaimInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  if (input.taskId) {
    const task = mustGet(rm, ctx, "tasks", input.taskId, "任务");
    const stage = stageOf(rm, ctx, task);
    const group = groupOf(rm, task);
    const label = labelOf(rm, task, stage);
    if (task.status !== "open") reject("state", `${label}现在不能接（${task.status === "locked" ? "上游还没完" : "已经有人接了或做完了"}）`);
    if (!mayWork(rm, me.id, group, stage)) reject("forbidden", LOCKED_STAGE_MESSAGE);
    const changes: Change[] = [];
    // 不止能接自己报到的环节：第一次认领别的环节时自动报到（熟练度 0，「自己认领」）。
    const had = enrollmentFor(rm, me.id, group, stage.templateKey);
    const e = had ?? autoEnroll(rm, ctx, me.id, group, stage.templateKey, changes);
    if (activeCount(rm, me.id, group, stage.templateKey) >= e.maxActive) reject("state", `你手上已经有 ${e.maxActive} 张「${stage.name}」了，先交掉一张`);
    const c = update("tasks", task, claimPatch(rm, ctx, stage, task, me.id));
    if (c) changes.push(c);
    return ok(changes, { taskId: task.id, ...(had ? {} : { enrollmentId: e.id }) });
  }
  let mine = rm.where("enrollments", { memberId: me.id });
  if (input.stageKey) mine = mine.filter((e) => e.stageKey === input.stageKey && (!input.group || e.group === input.group));
  if (mine.length === 0 && input.stageKey && input.group) {
    // 认领一个还没报到的环节：先看有没有能接的，有就自动报到再接。
    const group = mustBeOneOf(input.group, GROUP, "组");
    if (!stageTemplate(group, input.stageKey)) reject("not_found", "这个组里没有这个环节");
    const anyOpen = rm.where("stages", { templateKey: input.stageKey }).filter((s) => rm.get("projects", s.projectId)?.group === group);
    if (anyOpen.length && anyOpen.every((s) => !mayWork(rm, me.id, group, s))) reject("forbidden", LOCKED_STAGE_MESSAGE);
    const next = nextOpenTask(rm, group, input.stageKey, me.id);
    if (!next) reject("state", "这个环节现在没有可接的任务");
    const changes: Change[] = [];
    const e = autoEnroll(rm, ctx, me.id, group, input.stageKey, changes);
    const c = update("tasks", next, claimPatch(rm, ctx, stageOf(rm, ctx, next), next, me.id));
    if (c) changes.push(c);
    return ok(changes, { taskId: next.id, enrollmentId: e.id });
  }
  if (mine.length === 0) reject("state", input.stageKey ? "你还没有报到这个环节" : "你还没有报到任何环节，先去报到");
  mine.sort(compareBy<EnrollmentRow>((e) => e.createdAt));
  let full = 0;
  for (const e of mine) {
    if (activeCount(rm, me.id, e.group, e.stageKey) >= e.maxActive) {
      full += 1;
      continue;
    }
    const next = nextOpenTask(rm, e.group, e.stageKey, me.id);
    if (!next) continue;
    const stage = stageOf(rm, ctx, next);
    const c = update("tasks", next, claimPatch(rm, ctx, stage, next, me.id));
    return ok(c ? [c] : [], { taskId: next.id });
  }
  if (full === mine.length) reject("state", "你手上的任务已经到上限了，先交掉一张再接");
  return reject("state", "你报到的环节现在都没有可接的任务，等上游放出来再来");
});

export interface SubmitLinkInput {
  url: string;
  name?: string | null;
  kind?: "file" | "folder" | "sheet" | "doc" | null;
}

export interface SubmitInput {
  taskId: Id;
  /** 一版可以挂几条链接（SPEC §15.1）。 */
  links?: SubmitLinkInput[];
  link?: string | null;
  note?: string | null;
  /** 不写就用规范文件名。 */
  fileName?: string | null;
}

/** 交一版：版本号 +1；必须有链接或说明其一。管理员可以代交（外包的、或替成员代录）。 */
export const submitTask = guarded<SubmitInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const task = mustGet(rm, ctx, "tasks", input.taskId, "任务");
  const stage = stageOf(rm, ctx, task);
  const label = labelOf(rm, task, stage);
  if (task.status !== "claimed" && task.status !== "returned") reject("state", `${label}现在不能交（${task.status === "submitted" ? "已经在等审核" : "不在谁手上"}）`);
  const mineToDo = task.assigneeId === me.id;
  if (!mineToDo && !isAdmin(me)) reject("forbidden", "这张任务不在你手上");
  const links = mustLinks(input.links ?? (input.link ? [{ url: input.link }] : []));
  const link = links[0]?.url ?? null;
  const note = optText(input.note, 1000);
  if (!link && !note) reject("invalid", "链接和说明至少写一个");
  const project = mustGet(rm, ctx, "projects", task.projectId, "项目");
  const cut = task.cutId ? mustGet(rm, ctx, "cuts", task.cutId, "卡") : null;
  const version = task.versions + 1;
  const fileName = optFileName(input.fileName) ?? fileNameFor(project, stage, cut, task.layer, version);
  const onTime = !task.dueAt || Date.parse(ctx.worldNow) <= Date.parse(task.dueAt);
  const sub = insert(ctx, "submissions", {
    taskId: task.id,
    versionNo: version,
    fileName,
    link,
    note,
    byMemberId: task.outsourced ? null : task.assigneeId,
    recordedById: mineToDo ? null : me.id,
    selfFix: false,
    onTime,
    at: ctx.worldNow,
    links,
  });
  const c = update("tasks", task, { status: "submitted", versions: version, submittedAt: ctx.worldNow });
  return ok([sub.change, ...(c ? [c] : [])], { submissionId: sub.row.id, taskId: task.id });
});

export interface ReleaseInput {
  taskId: Id;
}

/** 放弃 = 返还到可接，不扣分；管理员也可以用它把任务从某人手上收回给大家接。 */
export const releaseTask = guarded<ReleaseInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const task = mustGet(rm, ctx, "tasks", input.taskId, "任务");
  const stage = stageOf(rm, ctx, task);
  if (task.status !== "claimed" && task.status !== "returned") reject("state", `${labelOf(rm, task, stage)}不在谁手上，不用放弃`);
  if (task.assigneeId !== me.id && !isAdmin(me)) reject("forbidden", "只能放弃自己手上的任务");
  const c = update("tasks", task, { status: "open", assigneeId: null, claimedAt: null, dueAt: null, outsourced: false, outsourceName: null });
  return ok(c ? [c] : [], { taskId: task.id });
});

export interface ExpireInput {
  taskId: Id;
}

/** 过了时限没交 → 收回到可接，记一条（打开时自动跑）。开关打开时扣活力点。 */
export const expireTask = guarded<ExpireInput>((rm, input, ctx) => {
  mustMember(rm, ctx);
  const task = mustGet(rm, ctx, "tasks", input.taskId, "任务");
  const stage = stageOf(rm, ctx, task);
  if ((task.status !== "claimed" && task.status !== "returned") || !task.dueAt) reject("state", `${labelOf(rm, task, stage)}不在谁手上`);
  if (Date.parse(task.dueAt) >= Date.parse(ctx.worldNow)) reject("state", "还没到时限");
  const changes: Change[] = [];
  const c = update("tasks", task, { status: "open", assigneeId: null, claimedAt: null, dueAt: null });
  if (c) changes.push(c);
  const created: Record<string, Id> = { taskId: task.id };
  if (rulesOf(rm, ctx)?.expiryPenalty && task.assigneeId) {
    const l = insert(ctx, "ledger", {
      memberId: task.assigneeId,
      taskId: task.id,
      kind: "penalty",
      hours: 0,
      factor: 0,
      quality: 0,
      points: -EXPIRY_PENALTY_POINTS,
      at: ctx.worldNow,
      note: `${labelOf(rm, task, stage)} 超时收回`,
    });
    changes.push(l.change);
    created.ledgerId = l.row.id;
  }
  return ok(changes, created);
});

// ---------------------------------------------------------------------------
// 管理员：收回 · 重新放出 · 指派 / 外包
// ---------------------------------------------------------------------------

export interface ReclaimInput {
  taskId: Id;
}

/** 管理员收回：从谁手上拿回来，暂时谁都不能接（「收回」），之后可以重新放出或指派。 */
export const reclaimTask = guarded<ReclaimInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "收回任务");
  const task = mustGet(rm, ctx, "tasks", input.taskId, "任务");
  const stage = stageOf(rm, ctx, task);
  if (task.status === "passed" || task.status === "reclaimed" || task.status === "locked") reject("state", `${labelOf(rm, task, stage)}现在不能收回`);
  const c = update("tasks", task, { status: "reclaimed", assigneeId: null, claimedAt: null, dueAt: null, outsourced: false, outsourceName: null });
  return ok(c ? [c] : [], { taskId: task.id });
});

export interface ReopenInput {
  taskId: Id;
}

/** 收回的任务重新放出来，回到「可接」（收回之前它已经放出来过，不再等上游）。 */
export const reopenTask = guarded<ReopenInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "重新放出任务");
  const task = mustGet(rm, ctx, "tasks", input.taskId, "任务");
  if (task.status !== "reclaimed") reject("state", "只有收回的任务才能重新放出");
  const c = update("tasks", task, { status: "open" });
  return ok(c ? [c] : [], { taskId: task.id });
});

export interface AssignInput {
  taskId?: Id;
  /** 一批（选几卡）一起派给同一个人（SPEC §13.1）。 */
  taskIds?: Id[];
  memberId?: Id | null;
  /** 外包：交的人不在工会里，写个名字，由管理员代交。 */
  outsourceName?: string | null;
}

export const assignTask = guarded<AssignInput>((rm, input, ctx) => {
  const me = mustAdmin(rm, ctx, "指派任务");
  const ids = Array.from(new Set([...(input.taskId ? [input.taskId] : []), ...(Array.isArray(input.taskIds) ? input.taskIds : [])]));
  if (ids.length === 0) reject("invalid", "选要派的任务");
  if (ids.length > 60) reject("invalid", "一次最多派 60 张");
  const outsourceName = optText(input.outsourceName, 24);
  if (input.memberId && outsourceName) reject("invalid", "指派给成员和外包只能选一个");
  if (!input.memberId && !outsourceName) reject("invalid", "选一个成员，或写外包的名字");
  const m = input.memberId ? mustGet(rm, ctx, "members", input.memberId, "成员") : null;
  const changes: Change[] = [];
  for (const id of ids) {
    const task = mustGet(rm, ctx, "tasks", id, "任务");
    const stage = stageOf(rm, ctx, task);
    const label = labelOf(rm, task, stage);
    if (task.status !== "open" && task.status !== "reclaimed") reject("state", `${label}现在不能指派（${task.status === "locked" ? "上游还没完" : "已经有人在做"}）`);
    const patch = m
      ? { ...claimPatch(rm, ctx, stage, task, m.id, me.id), outsourced: false, outsourceName: null }
      : { ...claimPatch(rm, ctx, stage, task, null, me.id), outsourced: true, outsourceName };
    const c = update("tasks", task, patch);
    if (c) changes.push(c);
  }
  return ok(changes, { taskId: ids[0] });
});

// ---------------------------------------------------------------------------
// 审核
// ---------------------------------------------------------------------------

export interface ReviewCommentInput {
  layer?: string | null;
  sheets?: string | null;
  tag?: string | null;
  text: string;
}

export interface ReviewInput {
  taskId: Id;
  verdict: "pass" | "return" | "fix_pass";
  quality?: Quality;
  comments?: ReviewCommentInput[];
  /** 自修出的新版本。 */
  fix?: { link?: string | null; note?: string | null; fileName?: string | null };
}

function mustComments(value: unknown, layers: string[]): ReviewComment[] {
  const list = Array.isArray(value) ? value : [];
  if (list.length > 30) reject("invalid", "意见太多了（最多 30 条）");
  return list.map((c, i) => {
    const text = typeof c?.text === "string" ? c.text.trim() : "";
    if (!text) reject("invalid", `第 ${i + 1} 条意见没写内容`);
    if (text.length > 300) reject("invalid", `第 ${i + 1} 条意见太长了（最多 300 字）`);
    const layer = c?.layer ? String(c.layer).trim().toUpperCase() : null;
    if (layer && layers.length && !layers.includes(layer)) reject("invalid", `第 ${i + 1} 条意见的层（${layer}）这一卡没有`);
    const sheets = c?.sheets ? String(c.sheets).trim() : null;
    if (sheets && sheets.length > 40) reject("invalid", `第 ${i + 1} 条意见的张号太长了`);
    const tag = c?.tag ? String(c.tag) : null;
    if (tag && !(RETURN_TAGS as readonly string[]).includes(tag)) reject("invalid", `第 ${i + 1} 条意见的标签不在可选范围内`);
    return { layer, sheets: sheets || null, tag, text };
  });
}

/**
 * 审核：通过（选质量系数，记活力点给交的人）· 退回（带意见，回到原来的人手上）·
 * 自修后通过（审核员出一版新的，这一版另记给审核员 0.5 小时 × 卡）。通过以后推进下游。
 */
export const reviewTask = guarded<ReviewInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  if (!isReviewer(me)) reject("forbidden", "只有审核员和管理员可以审核");
  const task = mustGet(rm, ctx, "tasks", input.taskId, "任务");
  const stage = stageOf(rm, ctx, task);
  const label = labelOf(rm, task, stage);
  if (task.status !== "submitted") reject("state", `${label}现在没有等审核的版本`);
  const reviewerId = task.extra?.reviewerId ?? stage.reviewerId;
  if (reviewerId && reviewerId !== me.id && !isAdmin(me)) {
    const who = rm.get("members", reviewerId)?.nickname ?? "指定的审核员";
    reject("forbidden", task.extra ? `「${task.extra.title}」由${who}审核` : `「${stage.name}」由${who}审核`);
  }
  const sub = rm.where("submissions", { taskId: task.id, versionNo: task.versions })[0];
  if (!sub) reject("state", "找不到要审的那一版");
  if (sub.byMemberId === me.id) reject("forbidden", "不能审自己交的版本");
  const verdict = mustBeOneOf(input.verdict, VERDICT, "审核结论");
  const cut = task.cutId ? rm.get("cuts", task.cutId) ?? null : null;
  const layerNames = cut?.layers.map((l) => l.name) ?? [];
  let comments = mustComments(input.comments, layerNames);
  const changes: Change[] = [];
  const created: Record<string, Id> = { taskId: task.id };
  const rules = rulesOf(rm, ctx);

  if (verdict === "return") {
    if (comments.length === 0) {
      // 只在图上钉了（审核时附图 + 钉，SPEC §11.4）：把这一版之后钉的那几处当成退回意见。
      const pins = rm
        .where("pins", { reviewTaskId: task.id })
        .filter((p) => p.status === "open" && p.at >= sub.at)
        .sort((a, b) => a.number - b.number);
      if (pins.length === 0) reject("invalid", "退回要写意见（至少一条），或者在图上钉一处");
      comments = pins.slice(0, 20).map((p) => ({
        layer: p.layer && layerNames.includes(p.layer) ? p.layer : null,
        sheets: p.sheets,
        tag: p.tag,
        text: `图上 ${p.number} 号：${p.text}`.slice(0, 500),
      }));
    }
    const r = insert(ctx, "reviews", { taskId: task.id, submissionId: sub.id, verdict, quality: null, comments, byMemberId: me.id, at: ctx.worldNow });
    changes.push(r.change);
    created.reviewId = r.row.id;
    const grace = Math.max(RETURN_GRACE_MIN_HOURS, deadlineHours(stage, task, rules) * RETURN_GRACE_SHARE);
    const graceDue = addHours(ctx.worldNow, grace);
    const dueAt = task.dueAt && Date.parse(task.dueAt) > Date.parse(graceDue) ? task.dueAt : graceDue;
    const c = update("tasks", task, { status: task.assigneeId || task.outsourced ? "returned" : "open", dueAt });
    if (c) changes.push(c);
    return ok(changes, created);
  }

  if (!QUALITY.includes(input.quality as Quality)) reject("invalid", "通过要选质量系数：0.5 / 1.0 / 1.2");
  const quality = input.quality as Quality;
  let version = task.versions;
  let reviewedSubmissionId = sub.id;
  if (verdict === "fix_pass") {
    const link = optLink(input.fix?.link, "自修版的链接");
    const note = optText(input.fix?.note, 1000);
    if (!link && !note) reject("invalid", "自修要填新版本的链接或说明");
    const project = mustGet(rm, ctx, "projects", task.projectId, "项目");
    version += 1;
    const fixed = insert(ctx, "submissions", {
      taskId: task.id,
      versionNo: version,
      fileName: optFileName(input.fix?.fileName) ?? fileNameFor(project, stage, cut, task.layer, version),
      link,
      note,
      byMemberId: me.id,
      recordedById: null,
      selfFix: true,
      onTime: true,
      at: ctx.worldNow,
    });
    changes.push(fixed.change);
    created.submissionId = fixed.row.id;
    reviewedSubmissionId = fixed.row.id;
  }
  const r = insert(ctx, "reviews", { taskId: task.id, submissionId: reviewedSubmissionId, verdict, quality, comments, byMemberId: me.id, at: ctx.worldNow });
  changes.push(r.change);
  created.reviewId = r.row.id;

  // 活力点：交的人（外包的不记）。
  const group = groupOf(rm, task);
  if (sub.byMemberId && !task.outsourced) {
    const skill = enrollmentFor(rm, sub.byMemberId, group, stage.templateKey)?.skill ?? 0;
    const hours = task.extra?.fixedPoints != null ? 0 : round1(hoursOf(taskRate(stage, task), task.workload));
    const l = insert(ctx, "ledger", {
      memberId: sub.byMemberId,
      taskId: task.id,
      kind: "task",
      hours,
      factor: round1(stage.control + skill),
      quality,
      points: taskPoints(stage, task, skill, quality),
      at: ctx.worldNow,
      note: null,
    });
    changes.push(l.change);
    created.ledgerId = l.row.id;
  }
  if (verdict === "fix_pass") {
    const cuts = 1;
    const l = insert(ctx, "ledger", {
      memberId: me.id,
      taskId: task.id,
      kind: "self_fix",
      hours: SELF_FIX_HOURS_PER_CUT * cuts,
      factor: 1,
      quality: 1,
      points: pointsOf(SELF_FIX_HOURS_PER_CUT * cuts, 1, 0, 1),
      at: ctx.worldNow,
      note: `自修出 v${String(version).padStart(2, "0")}`,
    });
    changes.push(l.change);
    created.selfFixLedgerId = l.row.id;
  }

  const acc = new TaskPatches(rm);
  acc.set(task, { status: "passed", versions: version, passedAt: ctx.worldNow, dueAt: task.dueAt });
  unlockReady(rm, acc, task.projectId);
  // 「要等它」的新任务通过了：发布时锁回去的那几张放回可接（别的新任务还挡着的除外）。
  if (task.extra?.blocking && task.extra.relocked?.length) {
    const stages = rm.where("stages", { projectId: task.projectId }).filter((s) => !s.archivedAt);
    const all = acc.projectTasks(task.projectId);
    for (const id of task.extra.relocked) {
      const t = acc.get(id);
      const st = t ? stages.find((s) => s.id === t.stageId) : undefined;
      if (t && st && t.status === "locked" && blockersOf(t, st, stages, all).length === 0) acc.set(t, { status: "open" });
    }
  }
  return ok([...acc.changes(), ...changes], created);
});
