/**
 * 文件名规范 v1.0（SPEC §1）：`[项目]_[集数]_[场景]_[镜头]_[层级]_[流程]_[版本]`，
 * 例 `LTHJ_EP01_SC001_CUT005_A_ANI_v04`。文件夹 `/EPxx/<流程>/SCxxx/CUTxxx/`。
 * 改了不覆盖，版本号 +1。扩展名照各自的软件，系统不写。
 */
import type { CutRow, Group, ProjectRow, StageRow, TaskRow } from "./model";
import { stageText } from "./templates";
import { t2, uc, type Phrase, type Text2, type TextParam } from "./text";

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

/** 卡名的两种说法（视频组：第 5 期 / Ep. 5）。 */
export function cutCode2(cut: Pick<CutRow, "number"> & Partial<Pick<CutRow, "suffix">>, group: Group = "animation"): Text2 {
  return t2(cutCode(cut, group, "zh"), cutCode(cut, group, "en"));
}

/** 环节名做参数：模板里的环节两种说法；管理员自己起的名字照原样（用户内容）。 */
export function stageParam(group: Group, stage: Pick<StageRow, "templateKey" | "name">): TextParam {
  const en = stageText(group, stage, "en");
  return en.custom ? uc(stage.name) : t2(stage.name, en.name);
}

export const EXTRA_KIND_TEXT: Record<NonNullable<TaskRow["extra"]>["kind"], Text2> = {
  extra: t2("额外任务", "extra task"),
  fix: t2("修正", "retake"),
  setting: t2("补设定", "settings fix"),
};

/** 任务的短名字（两种语言）：「C009 · 中割 · B 层」/「C009 · In-between · Layer B」。 */
export function taskLabelP(
  stage: Pick<StageRow, "name" | "templateKey">,
  cut: (Pick<CutRow, "number"> & Partial<Pick<CutRow, "suffix">>) | null,
  task: Pick<TaskRow, "layer"> & Partial<Pick<TaskRow, "extra">>,
  group: Group = "animation"
): Phrase {
  const p: Record<string, TextParam> = { stage: stageParam(group, stage) };
  const zh: string[] = [];
  const en: string[] = [];
  if (cut) {
    p.cut = cutCode2(cut, group);
    zh.push("{cut}");
    en.push("{cut}");
  }
  if (task.extra) {
    p.kind = EXTRA_KIND_TEXT[task.extra.kind];
    p.title = uc(task.extra.title);
    zh.push("{stage}{kind}", "{title}");
    en.push("{stage} {kind}", "{title}");
  } else {
    zh.push("{stage}");
    en.push("{stage}");
    if (task.layer) {
      p.layer = t2(`${task.layer} 层`, `Layer ${task.layer}`);
      zh.push("{layer}");
      en.push("{layer}");
    }
  }
  return { t: t2(zh.join(" · "), en.join(" · ")), p };
}
