/** 界面上的中文（枚举存英文代码，显示时查这里）。 */
import type { Grain, Group, LedgerKind, Phase, ProjectStatus, Role, StageKind, StageRow, TaskStatus, ThreadKind, ThreadStatus, Unit, Verdict } from "./model";
import { GROUPS } from "./templates";

export const ROLE_LABEL: Record<Role, string> = { admin: "管理员", reviewer: "审核员", member: "成员" };

export const GROUP_LABEL: Record<Group, string> = { animation: GROUPS.animation.name, video: GROUPS.video.name };

export const PHASE_LABEL: Record<Phase, string> = { pre: "前期", mid: "中期", post: "后期" };
/** 三段像三关。 */
export const PHASE_LEVEL: Record<Phase, string> = { pre: "第一关", mid: "第二关", post: "第三关" };

export const STAGE_KIND_LABEL: Record<StageKind, string> = { transit: "过渡", hub: "枢纽", review: "审核" };

export const GRAIN_LABEL: Record<Grain, string> = { project: "项目一份", cut: "每卡一份", layer: "每卡每层一份" };

export const UNIT_LABEL: Record<Unit, string> = { sheet: "张", second: "秒", cut: "卡", item: "项" };

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  locked: "锁住",
  open: "可接",
  claimed: "已接",
  submitted: "待审",
  returned: "退回",
  passed: "通过",
  reclaimed: "收回",
};

export const VERDICT_LABEL: Record<Verdict, string> = { pass: "通过", return: "退回", fix_pass: "自修后通过" };

export const THREAD_KIND_LABEL: Record<ThreadKind, string> = { comment: "意见", ask: "提问上游", setting: "设定问题", todo: "要补" };

export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = { open: "开着", answered: "已答", ruled: "已拍板", done: "已补" };

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = { active: "进行中", paused: "暂停", done: "完成" };

export const LEDGER_KIND_LABEL: Record<LedgerKind, string> = { task: "做任务", self_fix: "审核自修", penalty: "超时扣分" };

/** 「1.5 小时 / 张」「4 小时 / 15 秒」。 */
export function rateLabel(stage: Pick<StageRow, "tn" | "per" | "unit"> & { unitLabel?: string }): string {
  const unit = stage.unitLabel ?? UNIT_LABEL[stage.unit];
  const per = stage.per === 1 ? unit : `${stage.per} ${unit}`;
  return `${formatNumber(stage.tn)} 小时 / ${per}`;
}

/** 数字：整数不带小数点，其余一位小数。 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** 活力点：总是一位小数，「+12.0」。 */
export function formatPoints(n: number, sign = false): string {
  const r = (Math.round(n * 10) / 10).toFixed(1);
  return sign && n >= 0 ? `+${r}` : r.replace("-", "−");
}

export function skillLabel(skill: number): string {
  if (skill > 0) return `+${skill}`;
  if (skill < 0) return `−${Math.abs(skill)}`;
  return "0";
}
