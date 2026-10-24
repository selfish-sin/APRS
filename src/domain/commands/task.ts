/**
 * 报到和任务（SPEC §4 规则 2–6）：
 *   报到 = 自动配任务 · 接任务再配一张 · 交（版本 +1，文件名按规范）· 放弃（返还）·
 *   超时收回 · 管理员收回 / 重新放出 / 指派（含外包）· 审核（通过 / 退回 / 自修后通过）。
 */
import { addHours } from "../clock";
import { compareBy, layerKey, numberKey } from "../agenda";
import { TaskPatches, blockersOf, unlockReady } from "../flow";
import { ACTIVE_STATUS, GROUP, QUALITY, SKILL, VERDICT, type Change, type EnrollmentRow, type Group, type Id, type MemberRow, type Quality, type ReviewComment, type Skill, type StageRow, type TaskRow, type WorldRules } from "../model";
import { fileNameFor, stageParam, taskLabel, taskLabelP } from "../naming";
import { uc, type Phrase } from "../text";
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
import { guarded, insert, isAdmin, isReviewer, mustAdmin, mustBeOneOf, mustGet, mustMember, ok, optInteger, optText, rejectT, round1, update, type Ctx } from "./core";
import { ERRORS } from "../errors";
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

function labelOf(rm: ReadModel, task: TaskRow, stage: StageRow): Phrase {
  const project = rm.get("projects", task.projectId);
  const cut = task.cutId ? rm.get("cuts", task.cutId) ?? null : null;
  return taskLabelP(stage, cut, task, project?.group);
}

function labelZh(rm: ReadModel, task: TaskRow, stage: StageRow): string {
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
      .filter((s) => projects.has(s.projectId) && !s.disabled)
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
    if (!isAdmin(me)) rejectT("forbidden", "enroll_for_others");
    member = mustGet(rm, ctx, "members", input.memberId, "成员");
  }
  const group = mustBeOneOf(input.group, GROUP, "组");
  // 模板里的环节，或者管理员在某个项目里自己加的环节。
  const t = stageTemplate(group, input.stageKey) ?? (rm.where("stages", { templateKey: input.stageKey }).some((s) => rm.get("projects", s.projectId)?.group === group) ? { key: input.stageKey } : undefined);
  if (!t) rejectT("not_found", "group_stage_missing");
  if (!SKILL.includes(input.skill as Skill)) rejectT("invalid", "skill_pick");
  const skill = input.skill as Skill;
  const maxActive = optInteger(input.maxActive, "同时最多几张", 1, 9) ?? DEFAULT_MAX_ACTIVE;
  const changes: Change[] = [];
  const existing = enrollmentFor(rm, member.id, group, t.key);
  // 这个环节在所有项目里都锁成「只给指派的人」、他又没被指派：不让报到。
  const stagesHere = rm.where("stages", { templateKey: t.key }).filter((s) => rm.get("projects", s.projectId)?.group === group);
  if (!existing?.assigned && stagesHere.length > 0 && stagesHere.every((s) => stageLocked(s))) rejectT("forbidden", "stage_locked");
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
  if (e.memberId !== me.id && !isAdmin(me)) rejectT("forbidden", "enroll_cancel_own");
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
    if (task.status !== "open") rejectT("state", "claim_not_open", { label, why: ERRORS[task.status === "locked" ? "why_upstream" : "why_taken"] });
    if (stage.disabled) rejectT("state", "stage_disabled", { stage: stage.name });
    if (!mayWork(rm, me.id, group, stage)) rejectT("forbidden", "stage_locked");
    const changes: Change[] = [];
    // 不止能接自己报到的环节：第一次认领别的环节时自动报到（熟练度 0，「自己认领」）。
    const had = enrollmentFor(rm, me.id, group, stage.templateKey);
    const e = had ?? autoEnroll(rm, ctx, me.id, group, stage.templateKey, changes);
    if (activeCount(rm, me.id, group, stage.templateKey) >= e.maxActive) rejectT("state", "claim_full", { n: e.maxActive, stage: stageParam(group, stage) });
    const c = update("tasks", task, claimPatch(rm, ctx, stage, task, me.id));
    if (c) changes.push(c);
    return ok(changes, { taskId: task.id, ...(had ? {} : { enrollmentId: e.id }) });
  }
  let mine = rm.where("enrollments", { memberId: me.id });
  if (input.stageKey) mine = mine.filter((e) => e.stageKey === input.stageKey && (!input.group || e.group === input.group));
  if (mine.length === 0 && input.stageKey && input.group) {
    // 认领一个还没报到的环节：先看有没有能接的，有就自动报到再接。
    const group = mustBeOneOf(input.group, GROUP, "组");
    if (!stageTemplate(group, input.stageKey) && !rm.where("stages", { templateKey: input.stageKey }).length) rejectT("not_found", "group_stage_missing");
    const anyOpen = rm.where("stages", { templateKey: input.stageKey }).filter((s) => rm.get("projects", s.projectId)?.group === group);
    if (anyOpen.length && anyOpen.every((s) => !mayWork(rm, me.id, group, s))) rejectT("forbidden", "stage_locked");
    const next = nextOpenTask(rm, group, input.stageKey, me.id);
    if (!next) rejectT("state", "no_open_task");
    const changes: Change[] = [];
    const e = autoEnroll(rm, ctx, me.id, group, input.stageKey, changes);
    const c = update("tasks", next, claimPatch(rm, ctx, stageOf(rm, ctx, next), next, me.id));
    if (c) changes.push(c);
    return ok(changes, { taskId: next.id, enrollmentId: e.id });
  }
  if (mine.length === 0) rejectT("state", input.stageKey ? "not_enrolled_stage" : "not_enrolled_any");
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
  if (full === mine.length) rejectT("state", "hands_full");
  return rejectT("state", "nothing_open");
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
  if (task.status !== "claimed" && task.status !== "returned") rejectT("state", "submit_not_now", { label, why: ERRORS[task.status === "submitted" ? "why_waiting" : "why_nobody"] });
  const mineToDo = task.assigneeId === me.id;
  if (!mineToDo && !isAdmin(me)) rejectT("forbidden", "not_your_task");
  const links = mustLinks(input.links ?? (input.link ? [{ url: input.link }] : []));
  const link = links[0]?.url ?? null;
  const note = optText(input.note, 1000);
  if (!link && !note) rejectT("invalid", "link_or_note");
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
  if (task.status !== "claimed" && task.status !== "returned") rejectT("state", "release_not_held", { label: labelOf(rm, task, stage) });
  if (task.assigneeId !== me.id && !isAdmin(me)) rejectT("forbidden", "release_own_only");
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
  if ((task.status !== "claimed" && task.status !== "returned") || !task.dueAt) rejectT("state", "expire_not_held", { label: labelOf(rm, task, stage) });
  if (Date.parse(task.dueAt) >= Date.parse(ctx.worldNow)) rejectT("state", "not_due");
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
      note: `${labelZh(rm, task, stage)} 超时收回`,
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
  if (task.status === "passed" || task.status === "reclaimed" || task.status === "locked") rejectT("state", "reclaim_not_now", { label: labelOf(rm, task, stage) });
  const c = update("tasks", task, { status: "reclaimed", assigneeId: null, claimedAt: null, dueAt: null, outsourced: false, outsourceName: null });
  return ok(c ? [c] : [], { taskId: task.id });
});

export interface ReopenInput {
  taskId: Id;
  /** 打回重做（通过的任务）时的意见。 */
  comments?: ReviewCommentInput[];
}

/**
 * 两种用法：
 *   - 收回的任务重新放出来，回到「可接」（收回之前它已经放出来过，不再等上游）
 *   - 打回重做（验收时，SPEC §12.2）：通过的任务回到退回，带意见；原来的活力点不扣，重做通过后按新的算
 */
export const reopenTask = guarded<ReopenInput>((rm, input, ctx) => {
  const me = mustAdmin(rm, ctx, "重新放出任务");
  const task = mustGet(rm, ctx, "tasks", input.taskId, "任务");
  if (task.status === "passed") {
    const stage = stageOf(rm, ctx, task);
    const cut = task.cutId ? rm.get("cuts", task.cutId) ?? null : null;
    const comments = mustComments(input.comments, cut?.layers.map((l) => l.name) ?? []);
    if (!comments.length) rejectT("invalid", "reopen_need_comment");
    const subs = rm.where("submissions", { taskId: task.id }).sort((a, b) => a.versionNo - b.versionNo);
    const last = subs[subs.length - 1];
    const changes: Change[] = [];
    if (last) changes.push(insert(ctx, "reviews", { taskId: task.id, submissionId: last.id, verdict: "return", quality: null, comments, byMemberId: me.id, at: ctx.worldNow }).change);
    // 回到最后交这一版的人手上（审核员自修出的版本：回到原来做的人）。
    const back = task.outsourced ? null : subs.filter((s) => !s.selfFix).pop()?.byMemberId ?? task.assigneeId;
    const grace = Math.max(RETURN_GRACE_MIN_HOURS, deadlineHours(stage, task, rulesOf(rm, ctx)) * RETURN_GRACE_SHARE);
    const c = update("tasks", task, { status: back || task.outsourced ? "returned" : "open", assigneeId: back ?? null, passedAt: null, dueAt: addHours(ctx.worldNow, grace), claimedAt: task.claimedAt ?? ctx.worldNow, redo: true });
    if (c) changes.push(c);
    return ok(changes, { taskId: task.id });
  }
  if (task.status !== "reclaimed") rejectT("state", "reopen_not_passed");
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
  if (ids.length === 0) rejectT("invalid", "assign_pick");
  if (ids.length > 60) rejectT("invalid", "assign_max");
  const outsourceName = optText(input.outsourceName, 24);
  if (input.memberId && outsourceName) rejectT("invalid", "assign_one_target");
  if (!input.memberId && !outsourceName) rejectT("invalid", "assign_target");
  const m = input.memberId ? mustGet(rm, ctx, "members", input.memberId, "成员") : null;
  const changes: Change[] = [];
  for (const id of ids) {
    const task = mustGet(rm, ctx, "tasks", id, "任务");
    const stage = stageOf(rm, ctx, task);
    const label = labelOf(rm, task, stage);
    if (task.status !== "open" && task.status !== "reclaimed") rejectT("state", "assign_not_now", { label, why: ERRORS[task.status === "locked" ? "why_upstream" : "why_busy"] });
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
  if (list.length > 30) rejectT("invalid", "comments_max");
  return list.map((c, i) => {
    const text = typeof c?.text === "string" ? c.text.trim() : "";
    if (!text) rejectT("invalid", "comment_empty", { n: i + 1 });
    if (text.length > 300) rejectT("invalid", "comment_long", { n: i + 1 });
    const layer = c?.layer ? String(c.layer).trim().toUpperCase() : null;
    if (layer && layers.length && !layers.includes(layer)) rejectT("invalid", "comment_layer", { n: i + 1, layer });
    const sheets = c?.sheets ? String(c.sheets).trim() : null;
    if (sheets && sheets.length > 40) rejectT("invalid", "comment_sheets_long", { n: i + 1 });
    const tag = c?.tag ? String(c.tag) : null;
    if (tag && !(RETURN_TAGS as readonly string[]).includes(tag)) rejectT("invalid", "comment_tag", { n: i + 1 });
    return { layer, sheets: sheets || null, tag, text };
  });
}

/**
 * 审核：通过（选质量系数，记活力点给交的人）· 退回（带意见，回到原来的人手上）·
 * 自修后通过（审核员出一版新的，这一版另记给审核员 0.5 小时 × 卡）。通过以后推进下游。
 */
export const reviewTask = guarded<ReviewInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  if (!isReviewer(me)) rejectT("forbidden", "review_forbidden");
  const task = mustGet(rm, ctx, "tasks", input.taskId, "任务");
  const stage = stageOf(rm, ctx, task);
  const label = labelOf(rm, task, stage);
  if (task.status !== "submitted") rejectT("state", "review_nothing", { label });
  const reviewerId = task.extra?.reviewerId ?? stage.reviewerId;
  if (reviewerId && reviewerId !== me.id && !isAdmin(me)) {
    const nick = rm.get("members", reviewerId)?.nickname;
    rejectT("forbidden", "review_assigned", { what: task.extra ? uc(task.extra.title) : stageParam(groupOf(rm, task), stage), who: nick ? uc(nick) : ERRORS.someone_assigned });
  }
  const sub = rm.where("submissions", { taskId: task.id, versionNo: task.versions })[0];
  if (!sub) rejectT("state", "review_sub_missing");
  if (sub.byMemberId === me.id) rejectT("forbidden", "review_own");
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
      if (pins.length === 0) rejectT("invalid", "return_needs_comment");
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

  if (!QUALITY.includes(input.quality as Quality)) rejectT("invalid", "quality_pick");
  const quality = input.quality as Quality;
  let version = task.versions;
  let reviewedSubmissionId = sub.id;
  if (verdict === "fix_pass") {
    const link = optLink(input.fix?.link, "自修版的链接");
    const note = optText(input.fix?.note, 1000);
    if (!link && !note) rejectT("invalid", "selffix_needs");
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
  acc.set(task, { status: "passed", versions: version, passedAt: ctx.worldNow, dueAt: task.dueAt, ...(task.redo ? { redo: false } : {}) });
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
