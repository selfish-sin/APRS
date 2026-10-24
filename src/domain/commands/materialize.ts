/**
 * 照着环节和卡生成任务（开工 · 加环节 · 加卡 · 改卡都用）。生成以后按上游推一遍：上游都过了的直接「可接」。
 */
import { tasksToUnlock } from "../flow";
import type { Change, CutLayer, CutRow, Group, Id, StageRow, TaskRow } from "../model";
import type { ReadModel } from "../readmodel";
import { stageTemplate, type DefaultWorkload } from "../templates";
import { insert, type Ctx } from "./core";

/** 工作量怎么算：模板里的环节照模板；自己加的照粒度和单位猜。 */
export function workloadRuleOf(group: Group, stage: Pick<StageRow, "templateKey" | "grain" | "unit"> & Partial<Pick<StageRow, "workloadRule">>): DefaultWorkload {
  if (stage.workloadRule) return stage.workloadRule;
  const t = stageTemplate(group, stage.templateKey);
  if (t) return t.workload;
  if (stage.unit === "sheet") return stage.grain === "layer" ? "layerSheets" : "cutSheets";
  if (stage.unit === "second") return stage.grain === "project" ? "projectSeconds" : "cutSeconds";
  return "one";
}

export function workloadFor(rule: DefaultWorkload, cut: Pick<CutRow, "layers" | "keySheets" | "seconds"> | null, layer: CutLayer | null, cuts: Pick<CutRow, "seconds">[]): number {
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

function blankTask(projectId: Id, stage: StageRow, cut: CutRow | null, layer: CutLayer | null, workload: number, sort: number): Omit<TaskRow, "id" | "worldId" | "createdAt" | "updatedAt" | "version" | "archivedAt"> {
  return {
    projectId,
    stageId: stage.id,
    cutId: cut?.id ?? null,
    layer: layer?.name ?? null,
    workload,
    status: "locked",
    assigneeId: null,
    claimedAt: null,
    dueAt: null,
    outsourced: false,
    outsourceName: null,
    versions: 0,
    submittedAt: null,
    passedAt: null,
    dispatchedAt: null,
    sort,
  };
}

/** 一个环节在这些卡上的任务（项目级的环节：一张）。 */
export function newTasks(ctx: Ctx, group: Group, stage: StageRow, cuts: CutRow[], allCuts: CutRow[]): { rows: TaskRow[]; changes: Change[] } {
  const rule = workloadRuleOf(group, stage);
  const rows: TaskRow[] = [];
  const changes: Change[] = [];
  const add = (cut: CutRow | null, layer: CutLayer | null, order: number) => {
    const r = insert(ctx, "tasks", blankTask(stage.projectId, stage, cut, layer, workloadFor(rule, cut, layer, allCuts), Math.round(stage.sort * 100000) + order));
    rows.push(r.row as TaskRow);
    changes.push(r.change);
  };
  if (stage.grain === "project") add(null, null, 0);
  else
    for (const cut of cuts) {
      const base = cut.number * 10 + (cut.suffix ? cut.suffix.charCodeAt(0) - 96 : 0);
      if (stage.grain === "cut") add(cut, null, base * 10);
      else cut.layers.forEach((l, li) => add(cut, l, base * 10 + li + 1));
    }
  return { rows, changes };
}

/** 新生成的任务里，上游都过了的改成「可接」（在插入的变更上直接改）。 */
export function openReady(rm: ReadModel, projectId: Id, stages: StageRow[], created: TaskRow[], changes: Change[]) {
  const existing = rm.where("tasks", { projectId });
  const ids = new Set(tasksToUnlock(stages, [...existing, ...created]));
  for (const c of changes) if (c.op === "insert" && c.table === "tasks" && ids.has(c.row.id)) (c.row as TaskRow).status = "open";
}
