/**
 * 灵活性（SPEC §13）：人员指派 · 周期 · 随时发新任务。
 *   role.assign · role.unassign（指派职位 = 自动报到这个环节，标「指派」）
 *   stage.set_lock（只给指派的人）· stage.set_period（计划周期）· stage.set_rate（这个环节的时限参数）
 *   task.publish（在任何环节上发新任务：额外任务 · 修正 · 补设定）
 */
import { downstreamKeys } from "../flow";
import { EXTRA_KIND, GROUP, SKILL, type Change, type ExtraKind, type Group, type Id, type Skill, type TaskRow } from "../model";
import type { ReadModel } from "../readmodel";
import { DEFAULT_MAX_ACTIVE, deadlineHours } from "../rules";
import { stageTemplate } from "../templates";
import { addHours } from "../clock";
import { guarded, insert, isAdmin, isReviewer, mustAdmin, mustBeOneOf, mustGet, mustMember, mustText, ok, optInteger, optNumber, optText, rejectT, update, type Ctx } from "./core";
import { uc } from "../text";

// ---------------------------------------------------------------------------
// 指派职位
// ---------------------------------------------------------------------------

export interface RoleAssignInput {
  memberId: Id;
  group: Group;
  /** 职位 = 环节（模板里的 key）。 */
  stageKey: string;
  skill?: Skill;
}

function mustStageKey(group: Group, key: unknown): string {
  const t = typeof key === "string" ? stageTemplate(group, key) : undefined;
  if (!t) rejectT("not_found", "group_stage_missing");
  return t.key;
}

/** 给一个人指派一个职位：他自动报到这个环节（已经报到过就标上「指派」）。不会自动给他配任务。 */
export const assignRole = guarded<RoleAssignInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "指派职位");
  const member = mustGet(rm, ctx, "members", input.memberId, "成员");
  const group = mustBeOneOf(input.group, GROUP, "组");
  const stageKey = mustStageKey(group, input.stageKey);
  if (input.skill !== undefined && !SKILL.includes(input.skill)) rejectT("invalid", "skill_pick");
  const existing = rm.where("enrollments", { memberId: member.id, group, stageKey })[0];
  if (existing) {
    if (existing.assigned) rejectT("state", "role_already", { name: uc(member.nickname) });
    const c = update("enrollments", existing, { assigned: true, ...(input.skill !== undefined ? { skill: input.skill } : {}) });
    return ok(c ? [c] : [], { enrollmentId: existing.id });
  }
  const e = insert(ctx, "enrollments", { memberId: member.id, group, stageKey, skill: (input.skill ?? 0) as Skill, maxActive: DEFAULT_MAX_ACTIVE, origin: "assigned" as const, assigned: true });
  return ok([e.change], { enrollmentId: e.row.id });
});

export interface RoleUnassignInput {
  memberId: Id;
  group: Group;
  stageKey: string;
}

/** 撤掉指派：是因为指派才报到的就取消报到；自己报到过的只去掉「指派」。手上的任务不动。 */
export const unassignRole = guarded<RoleUnassignInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "撤掉职位");
  const member = mustGet(rm, ctx, "members", input.memberId, "成员");
  const group = mustBeOneOf(input.group, GROUP, "组");
  const stageKey = mustStageKey(group, input.stageKey);
  const e = rm.where("enrollments", { memberId: member.id, group, stageKey })[0];
  if (!e?.assigned) rejectT("state", "role_not_assigned", { name: uc(member.nickname) });
  if ((e.origin ?? "self") === "assigned") return ok([{ op: "archive", table: "enrollments", id: e.id, expectVersion: e.version }], { enrollmentId: e.id });
  const c = update("enrollments", e, { assigned: false });
  return ok(c ? [c] : [], { enrollmentId: e.id });
});

// ---------------------------------------------------------------------------
// 环节的设置
// ---------------------------------------------------------------------------

export interface StageLockInput {
  stageId: Id;
  locked: boolean;
}

export const setStageLock = guarded<StageLockInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改环节设置");
  const stage = mustGet(rm, ctx, "stages", input.stageId, "环节");
  if (typeof input.locked !== "boolean") rejectT("invalid", "lock_pick");
  const c = update("stages", stage, { locked: input.locked });
  return ok(c ? [c] : [], { stageId: stage.id });
});

export interface StagePeriodInput {
  stageId: Id;
  /** 从项目开始的第几个周期开始（1 起）。 */
  startWeek: number;
  /** 做几个周期。 */
  weeks: number;
}

export const setStagePeriod = guarded<StagePeriodInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改计划周期");
  const stage = mustGet(rm, ctx, "stages", input.stageId, "环节");
  const startWeek = optInteger(input.startWeek, "从第几周开始", 1, 520);
  const weeks = optInteger(input.weeks, "工期（几周）", 1, 260);
  if (startWeek === null || weeks === null) rejectT("invalid", "plan_required");
  const c = update("stages", stage, { plan: { startWeek, weeks } });
  return ok(c ? [c] : [], { stageId: stage.id });
});

export interface StageRateInput {
  stageId: Id;
  tn?: number;
  per?: number;
  deadlineFactor?: number | null;
  minDeadlineHours?: number | null;
}

/** 这个环节的时限参数（每单位小时 Tn · 时限系数 · 最短时限）。只影响之后派出的任务；已经派出的用「延期」改。 */
export const setStageRate = guarded<StageRateInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改时限参数");
  const stage = mustGet(rm, ctx, "stages", input.stageId, "环节");
  const patch: Partial<typeof stage> = {};
  if (input.tn !== undefined) {
    const tn = optNumber(input.tn, "Tn", 0, 200);
    if (tn === null || tn <= 0) rejectT("invalid", "tn_positive");
    patch.tn = tn;
  }
  if (input.per !== undefined) {
    const per = optNumber(input.per, "每多少单位", 1, 600);
    if (per !== null) patch.per = per;
  }
  if (input.deadlineFactor !== undefined) patch.deadlineFactor = optNumber(input.deadlineFactor, "时限系数", 0.5, 10);
  if (input.minDeadlineHours !== undefined) patch.minDeadlineHours = optNumber(input.minDeadlineHours, "最短时限（小时）", 1, 720);
  const c = update("stages", stage, patch);
  return ok(c ? [c] : [], { stageId: stage.id });
});

// ---------------------------------------------------------------------------
// 随时发新任务
// ---------------------------------------------------------------------------

export interface PublishInput {
  stageId: Id;
  kind: ExtraKind;
  title: string;
  description?: string | null;
  /** 挂哪几卡（可以不挂）。 */
  cutIds?: Id[];
  /** 工作量（单位照环节）。和 fixedPoints 二选一。 */
  workload?: number | null;
  /** 直接给一个固定活力点。 */
  fixedPoints?: number | null;
  /** 时限（小时，从接的时候算）。不写 = 按工作量算，最少 4 小时。 */
  deadlineHours?: number | null;
  /** 派给谁（不写 = 放出来让人认领）。 */
  assigneeId?: Id | null;
  /** 谁审（不写 = 这个环节的审核员）。 */
  reviewerId?: Id | null;
  /** 附图（资料库里的文件）。 */
  fileIds?: Id[];
  /** 这一卡要等它做完（挂着的卡的下游等它通过）。 */
  blocking?: boolean;
}

function mayPublish(rm: ReadModel, ctx: Ctx, stageReviewerId: Id | null) {
  const me = mustMember(rm, ctx);
  if (isAdmin(me)) return me;
  if (isReviewer(me) && stageReviewerId === me.id) return me;
  return rejectT("forbidden", "publish_forbidden");
}

export const publishTask = guarded<PublishInput>((rm, input, ctx) => {
  const stage = mustGet(rm, ctx, "stages", input.stageId, "环节");
  const me = mayPublish(rm, ctx, stage.reviewerId);
  const project = mustGet(rm, ctx, "projects", stage.projectId, "项目");
  const kind = mustBeOneOf(input.kind, EXTRA_KIND, "种类");
  const title = mustText(input.title, "标题", 60);
  const description = optText(input.description, 2000);
  const cutIds = Array.from(new Set(Array.isArray(input.cutIds) ? input.cutIds : []));
  if (cutIds.length > 40) rejectT("invalid", "publish_cuts_max");
  for (const id of cutIds) {
    const c = mustGet(rm, ctx, "cuts", id, "卡");
    if (c.projectId !== project.id) rejectT("invalid", "publish_cut_other");
  }
  if (kind === "fix" && cutIds.length === 0) rejectT("invalid", "fix_needs_cut");
  const blocking = !!input.blocking;
  if (blocking && cutIds.length === 0) rejectT("invalid", "blocking_needs_cut");
  const fixedPoints = optNumber(input.fixedPoints, "固定活力点", 0, 500);
  const workload = optNumber(input.workload, "工作量", 0, 100_000);
  if (fixedPoints !== null && fixedPoints <= 0) rejectT("invalid", "points_positive");
  if (fixedPoints === null && (workload === null || workload <= 0)) rejectT("invalid", "workload_positive");
  const reviewerId = input.reviewerId ? mustGet(rm, ctx, "members", input.reviewerId, "审核的人").id : stage.reviewerId;
  const fileIds = Array.from(new Set(Array.isArray(input.fileIds) ? input.fileIds : []));
  if (fileIds.length > 12) rejectT("invalid", "attach_max");
  for (const id of fileIds) {
    const f = mustGet(rm, ctx, "files", id, "附的文件");
    if (f.projectId !== project.id) rejectT("invalid", "attach_other_project");
  }
  const assignee = input.assigneeId ? mustGet(rm, ctx, "members", input.assigneeId, "派给的人") : null;
  const base = { workload: workload ?? 0 };
  const hours = input.deadlineHours === undefined || input.deadlineHours === null ? deadlineHours(stage, base, rm.get("worlds", ctx.worldId)?.rules) : optNumber(input.deadlineHours, "时限（小时）", 1, 2000)!;
  const extra = { kind, title, description, cutIds, fixedPoints, deadlineHours: Math.round(hours * 10) / 10, reviewerId, blocking, fileIds, byMemberId: me.id, at: ctx.worldNow };
  const sort = Math.max(0, ...rm.where("tasks", { projectId: project.id }).map((t) => t.sort)) + 1;
  const row: Omit<TaskRow, "id" | "worldId" | "createdAt" | "updatedAt" | "version" | "archivedAt"> = {
    projectId: project.id,
    stageId: stage.id,
    cutId: cutIds.length === 1 ? cutIds[0] : null,
    layer: null,
    workload: workload ?? 0,
    status: assignee ? "claimed" : "open",
    assigneeId: assignee?.id ?? null,
    claimedAt: assignee ? ctx.worldNow : null,
    dueAt: assignee ? addHours(ctx.worldNow, extra.deadlineHours) : null,
    outsourced: false,
    outsourceName: null,
    versions: 0,
    submittedAt: null,
    passedAt: null,
    dispatchedAt: null,
    sort,
    assignedById: assignee ? me.id : null,
    rate: { tn: stage.tn, per: stage.per },
    extra,
  };
  const changes: Change[] = [];
  const relocked: Id[] = [];
  // 勾了「这一卡要等它做完」：这几卡下游还没人接的任务先锁回去，等它通过再放。
  if (blocking) {
    const stages = rm.where("stages", { projectId: project.id });
    const down = downstreamKeys(stages, stage.templateKey);
    const downIds = new Set(stages.filter((s) => down.has(s.templateKey)).map((s) => s.id));
    for (const x of rm.where("tasks", { projectId: project.id })) {
      if (x.extra || x.status !== "open" || !downIds.has(x.stageId)) continue;
      if (x.cutId ? !cutIds.includes(x.cutId) : false) continue;
      const c = update("tasks", x, { status: "locked" });
      if (c) {
        changes.push(c);
        relocked.push(x.id);
      }
    }
  }
  const t = insert(ctx, "tasks", { ...row, extra: { ...extra, relocked } });
  return ok([t.change, ...changes], { taskId: t.row.id });
});
