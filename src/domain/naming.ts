/**
 * 文件名规范 v1.0（SPEC §1）：`[项目]_[集数]_[场景]_[镜头]_[层级]_[流程]_[版本]`，
 * 例 `LTHJ_EP01_SC001_CUT005_A_ANI_v04`。文件夹 `/EPxx/<流程>/SCxxx/CUTxxx/`。
 * 改了不覆盖，版本号 +1。扩展名照各自的软件，系统不写。
 */
import type { CutRow, Group, ProjectRow, StageRow, TaskRow } from "./model";

/** 卡在界面上的名字：动画组 C005，视频组 第 5 期。 */
export function cutCode(cut: Pick<CutRow, "number"> & Partial<Pick<CutRow, "suffix">>, group: Group = "animation", lang: "zh" | "en" = "zh"): string {
  const sfx = cut.suffix ?? "";
  if (group === "video") return lang === "en" ? `Ep. ${cut.number}${sfx}` : `第 ${cut.number}${sfx} 期`;
  return `C${String(cut.number).padStart(3, "0")}${sfx}`;
}

/** 文件名里的镜头段：CUT005（视频组 P005）；插进去的 CUT005a。 */
export function cutFileSegment(cut: Pick<CutRow, "number"> & Partial<Pick<CutRow, "suffix">>, group: Group = "animation"): string {
  return `${group === "video" ? "P" : "CUT"}${String(cut.number).padStart(3, "0")}${cut.suffix ?? ""}`;
}

export function versionTag(version: number): string {
  return `v${String(Math.max(1, version)).padStart(2, "0")}`;
}

/** 规范文件名（不带扩展名）。 */
export function fileNameFor(
  project: Pick<ProjectRow, "code" | "episode" | "scene" | "group">,
  stage: Pick<StageRow, "code" | "fileCode">,
  cut: Pick<CutRow, "number" | "episode" | "scene"> | null,
  layer: string | null,
  version: number
): string {
  const parts = [project.code, cut?.episode ?? project.episode];
  if (cut) parts.push(cut.scene, cutFileSegment(cut, project.group));
  if (layer) parts.push(layer);
  parts.push(stage.code ?? stage.fileCode, versionTag(version));
  return parts.join("_");
}

/** 交到哪个文件夹：/EP01/ANI/SC001/CUT005/（项目级的：/EP01/分镜/）。 */
export function folderFor(
  project: Pick<ProjectRow, "episode" | "group">,
  stage: Pick<StageRow, "folder">,
  cut: Pick<CutRow, "number" | "episode" | "scene"> | null
): string {
  if (!cut) return `/${project.episode}/${stage.folder}/`;
  return `/${cut.episode}/${stage.folder}/${cut.scene}/${cutFileSegment(cut, project.group)}/`;
}

/** 任务的短名字：「C009 · 中割 · B 层」。 */
export const EXTRA_KIND_LABEL: Record<NonNullable<TaskRow["extra"]>["kind"], string> = { extra: "额外任务", fix: "修正", setting: "补设定" };

export function taskLabel(stage: Pick<StageRow, "name">, cut: Pick<CutRow, "number"> | null, task: Pick<TaskRow, "layer"> & Partial<Pick<TaskRow, "extra">>, group: Group = "animation"): string {
  if (task.extra) return [cut ? cutCode(cut, group) : null, `${stage.name}${EXTRA_KIND_LABEL[task.extra.kind]}`, task.extra.title].filter(Boolean).join(" · ");
  const parts: string[] = [];
  if (cut) parts.push(cutCode(cut, group));
  parts.push(stage.name);
  if (task.layer) parts.push(`${task.layer} 层`);
  return parts.join(" · ");
}
