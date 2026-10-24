/**
 * 计分和成长的规则（SPEC §1 · §4 规则 3、6、8）。都是纯数据 + 纯函数。
 *
 * 活力点 = Tn × 工作量 ×（掌控系数 + 熟练度系数）× 质量系数
 * 时限   = Tn × 工作量 × 时限系数（默认 1.5）
 */
import { round1 } from "./commands/core";
import type { Group, Quality, Skill, StageRow, TaskRow, WorldRules } from "./model";

export const DEFAULT_DEADLINE_FACTOR = 1.5;
export const DEFAULT_MAX_ACTIVE = 2;
/** 退回以后，时限至少再给这么多（按原来时长的一半，最少 12 小时）。 */
export const RETURN_GRACE_SHARE = 0.5;
export const RETURN_GRACE_MIN_HOURS = 12;
/** 超时收回扣分（开关打开时）。 */
export const EXPIRY_PENALTY_POINTS = 2;
/** 审核员自修出新版本，另记给审核员：0.5 小时 × 卡。 */
export const SELF_FIX_HOURS_PER_CUT = 0.5;
/** 时限最少给几小时（0.5 小时 / 卡的检查也不至于只给 45 分钟）。 */
export const MIN_DEADLINE_HOURS = 4;
/** 估人数、天数时，每个人每天能做几小时。 */
export const HOURS_PER_DAY = 4;

export const SKILL_OPTIONS: { value: Skill; label: string; hint: string }[] = [
  { value: 0.5, label: "熟练 +0.5", hint: "做过很多，基本不用改" },
  { value: 0.2, label: "上手 +0.2", hint: "做过几次" },
  { value: 0, label: "一般 0", hint: "会做，还要多练" },
  { value: -0.2, label: "新手 −0.2", hint: "刚开始学" },
];

export const QUALITY_OPTIONS: { value: Quality; label: string; hint: string }[] = [
  { value: 0.5, label: "0.5", hint: "要大改" },
  { value: 1, label: "1.0", hint: "合格" },
  { value: 1.2, label: "1.2", hint: "做得好" },
];

/** 常见退回原因（标签）。 */
export const RETURN_TAGS = [
  "漏色",
  "色线缺失或不闭合",
  "背涂填错图层",
  "背涂涂到主线",
  "主线不透",
  "分层错误",
  "涂反",
  "漏轨目",
  "设定没补",
] as const;

export type ReturnTag = (typeof RETURN_TAGS)[number];

/** 退回原因的英文（标签存的是中文，显示时查这里）。 */
export const RETURN_TAG_EN: Record<ReturnTag, string> = {
  漏色: "Missed fill",
  色线缺失或不闭合: "Color line missing or not closed",
  背涂填错图层: "Underpaint on the wrong layer",
  背涂涂到主线: "Underpaint over the line art",
  主线不透: "Line art not showing through",
  分层错误: "Wrong layer split",
  涂反: "Colors swapped",
  漏轨目: "Missing timing marks",
  设定没补: "Settings fix not applied",
};

export function tagText(tag: string | null | undefined, lang: "zh" | "en"): string {
  if (!tag) return "";
  return lang === "en" ? RETURN_TAG_EN[tag as ReturnTag] ?? tag : tag;
}

/**
 * 等级表：Lv n 需要累计 5 × n × (n − 1) 活力点 —— 0 · 10 · 30 · 60 · 100 · 150 · 210 …
 * （SPEC §4 规则 8 的 10 · 30 · 60 · 100 · 150 …）。写成表，一共 60 级。
 */
export const LEVEL_TABLE: number[] = Array.from({ length: 60 }, (_, i) => 5 * (i + 1) * i);

export interface LevelInfo {
  level: number;
  /** 这一级从多少分开始。 */
  floor: number;
  /** 下一级要多少分（满级 = null）。 */
  next: number | null;
  /** 这一级里走了多少（0–1）。 */
  progress: number;
}

export function levelOf(points: number): LevelInfo {
  const p = Math.max(0, points);
  let level = 1;
  for (let i = 0; i < LEVEL_TABLE.length; i++) if (p >= LEVEL_TABLE[i]) level = i + 1;
  const floor = LEVEL_TABLE[level - 1];
  const next = level < LEVEL_TABLE.length ? LEVEL_TABLE[level] : null;
  const progress = next === null ? 1 : (p - floor) / (next - floor);
  return { level, floor, next, progress: Math.max(0, Math.min(1, progress)) };
}

/** Tn × 工作量（小时）。 */
export function hoursOf(stage: Pick<StageRow, "tn" | "per">, workload: number): number {
  const per = stage.per > 0 ? stage.per : 1;
  return (stage.tn / per) * workload;
}

export function deadlineFactorOf(rules: WorldRules | undefined): number {
  const f = rules?.deadlineFactor;
  return typeof f === "number" && f > 0 ? f : DEFAULT_DEADLINE_FACTOR;
}

type RateStage = Pick<StageRow, "tn" | "per"> & Partial<Pick<StageRow, "deadlineFactor" | "minDeadlineHours">>;
type RateTask = Pick<TaskRow, "workload"> & Partial<Pick<TaskRow, "rate" | "extra">>;

/** 这张任务按哪个工时算：接的时候记下的（之后改 Tn 不影响已经派出去的），没接过就用环节现在的。 */
export function taskRate(stage: Pick<StageRow, "tn" | "per">, task: Partial<Pick<TaskRow, "rate">>): { tn: number; per: number } {
  return task.rate ?? { tn: stage.tn, per: stage.per };
}

/**
 * 时限（小时）= 工作量 × Tn × 时限系数，最少 MIN_DEADLINE_HOURS。
 * 环节自己改过时限系数 / 最短时限（§13.2）就用环节的；随时发的新任务用发布时写的时限。
 */
export function deadlineHours(stage: RateStage, task: RateTask, rules: WorldRules | undefined): number {
  if (task.extra) return Math.max(1, task.extra.deadlineHours);
  const factor = typeof stage.deadlineFactor === "number" && stage.deadlineFactor > 0 ? stage.deadlineFactor : deadlineFactorOf(rules);
  const min = typeof stage.minDeadlineHours === "number" && stage.minDeadlineHours > 0 ? stage.minDeadlineHours : MIN_DEADLINE_HOURS;
  return Math.max(min, hoursOf(taskRate(stage, task), task.workload) * factor);
}

/** 只给指派的人（没写 = 审核类环节锁）。 */
export function stageLocked(stage: Pick<StageRow, "kind"> & Partial<Pick<StageRow, "locked">>): boolean {
  return stage.locked ?? stage.kind === "review";
}

export function pointsOf(hours: number, control: number, skill: number, quality: number): number {
  return round1(hours * (control + skill) * quality);
}

/** 任务单上的奖励（按质量 1.0 估）。 */
export function rewardOf(stage: Pick<StageRow, "tn" | "per" | "control">, workload: number, skill: number, task?: Partial<Pick<TaskRow, "rate" | "extra">>): number {
  return taskPoints(stage, { workload, ...(task ?? {}) }, skill, 1);
}

/** 一张任务通过时记多少活力点：固定活力点的新任务 = 固定值 × 质量；别的照公式。 */
export function taskPoints(stage: Pick<StageRow, "tn" | "per" | "control">, task: RateTask, skill: number, quality: number): number {
  if (task.extra && task.extra.fixedPoints !== null) return round1(task.extra.fixedPoints * quality);
  return pointsOf(hoursOf(taskRate(stage, task), task.workload), stage.control, skill, quality);
}

/** 管理员改过的工时盖在模板上。 */
export function rateFor(rules: WorldRules | undefined, group: Group, key: string) {
  return rules?.rates?.[group]?.[key];
}
