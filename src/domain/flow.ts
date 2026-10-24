/**
 * 连线推进（SPEC §4 规则 1：在同一个变更集里把下游叫醒）。
 *
 * 上游任务全部「通过」→ 下游同一卡的任务从「锁住」变「可接」。
 * 「同一卡」怎么算：
 *   - 上游是项目级（或下游是项目级）→ 上游这个环节的全部任务
 *   - 上游是每卡 / 每卡每层 → 同一卡的那些任务；两边都是每卡每层时，只看同一层
 * 只会解锁，不会把已经放出来的任务再锁回去。
 */
import { update } from "./commands/core";
import type { Change, Id, StageRow, TaskRow } from "./model";
import type { ReadModel } from "./readmodel";

/** 一个命令里对任务的改动先收在这里，同一行改两次合成一次更新。 */
export class TaskPatches {
  private patches = new Map<Id, { orig: TaskRow; patch: Partial<TaskRow> }>();
  constructor(private rm: ReadModel) {}

  get(id: Id): TaskRow | undefined {
    const p = this.patches.get(id);
    if (p) return { ...p.orig, ...p.patch };
    const row = this.rm.get("tasks", id);
    return row && !row.archivedAt ? row : undefined;
  }

  set(task: TaskRow, patch: Partial<TaskRow>) {
    const cur = this.patches.get(task.id);
    if (cur) Object.assign(cur.patch, patch);
    else this.patches.set(task.id, { orig: this.rm.get("tasks", task.id) as TaskRow, patch: { ...patch } });
  }

  /** 这个项目的全部任务（带上这次的改动）。 */
  projectTasks(projectId: Id): TaskRow[] {
    return this.rm.where("tasks", { projectId }).map((t) => this.get(t.id) ?? t);
  }

  changes(): Change[] {
    const out: Change[] = [];
    for (const { orig, patch } of Array.from(this.patches.values())) {
      const c = update("tasks", orig, patch);
      if (c) out.push(c);
    }
    return out;
  }
}

function groupByStage(tasks: TaskRow[]): Map<Id, TaskRow[]> {
  const m = new Map<Id, TaskRow[]>();
  for (const t of tasks) {
    if (t.archivedAt) continue;
    const list = m.get(t.stageId);
    if (list) list.push(t);
    else m.set(t.stageId, [t]);
  }
  return m;
}

/** 这个任务等的上游任务（每个上游环节一组）。 */
export function upstreamTasksOf(task: TaskRow, stage: StageRow, stagesByKey: Map<string, StageRow>, byStage: Map<Id, TaskRow[]>): { stage: StageRow; tasks: TaskRow[] }[] {
  const out: { stage: StageRow; tasks: TaskRow[] }[] = [];
  for (const key of stage.upstream) {
    const up = stagesByKey.get(key);
    if (!up) continue;
    const ups = byStage.get(up.id) ?? [];
    let relevant: TaskRow[];
    if (up.grain === "project" || !task.cutId) relevant = ups;
    else {
      relevant = ups.filter((t) => t.cutId === task.cutId);
      if (up.grain === "layer" && stage.grain === "layer" && task.layer) {
        const same = relevant.filter((t) => t.layer === task.layer);
        if (same.length) relevant = same;
      }
    }
    out.push({ stage: up, tasks: relevant });
  }
  return out;
}

export function upstreamReady(task: TaskRow, stage: StageRow, stagesByKey: Map<string, StageRow>, byStage: Map<Id, TaskRow[]>): boolean {
  return upstreamTasksOf(task, stage, stagesByKey, byStage).every((g) => g.tasks.every((t) => t.status === "passed"));
}

/**
 * 一个项目里哪些「锁住」的任务现在该放出来（纯函数：开项目时任务还没进读模型，也能用）。
 */
export function tasksToUnlock(stages: StageRow[], tasks: TaskRow[]): Id[] {
  const stagesByKey = new Map(stages.filter((s) => !s.archivedAt).map((s) => [s.templateKey, s]));
  const stagesById = new Map(stages.map((s) => [s.id, s]));
  const byStage = groupByStage(tasks);
  const out: Id[] = [];
  for (const t of tasks) {
    if (t.archivedAt || t.status !== "locked") continue;
    const stage = stagesById.get(t.stageId);
    if (!stage) continue;
    if (upstreamReady(t, stage, stagesByKey, byStage)) out.push(t.id);
  }
  return out;
}

/** 在一个命令里推进：把该放出来的任务记进 `acc`。 */
export function unlockReady(rm: ReadModel, acc: TaskPatches, projectId: Id) {
  const stages = rm.where("stages", { projectId });
  const tasks = acc.projectTasks(projectId);
  for (const id of tasksToUnlock(stages, tasks)) {
    const t = acc.get(id);
    if (t) acc.set(t, { status: "open" });
  }
}

/**
 * 一个枢纽管到哪：从它往下游走，碰到下一个枢纽就停（下一个枢纽本身不算）。
 * 例：原画监督 → 清线、中割（到中割检修为止）。
 */
export function hubScope(stages: StageRow[], hub: StageRow): StageRow[] {
  const live = stages.filter((s) => !s.archivedAt);
  const downstream = (key: string) => live.filter((s) => s.upstream.includes(key));
  const seen = new Set<string>([hub.templateKey]);
  const out: StageRow[] = [];
  // 直接接在后面的环节都算（哪怕它自己也是枢纽，例如 分镜 → Layout），再往后碰到枢纽就停。
  const queue: { stage: StageRow; direct: boolean }[] = downstream(hub.templateKey).map((stage) => ({ stage, direct: true }));
  while (queue.length) {
    const { stage, direct } = queue.shift()!;
    if (seen.has(stage.templateKey)) continue;
    if (stage.hub && !direct) continue;
    seen.add(stage.templateKey);
    out.push(stage);
    if (stage.hub) continue;
    for (const next of downstream(stage.templateKey)) queue.push({ stage: next, direct: false });
  }
  return out.sort((a, b) => a.sort - b.sort);
}

/** 直接接在这个环节后面的环节。 */
export function directDownstream(stages: StageRow[], stage: StageRow): StageRow[] {
  return stages.filter((s) => !s.archivedAt && s.upstream.includes(stage.templateKey)).sort((a, b) => a.sort - b.sort);
}
