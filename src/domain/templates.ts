/**
 * 流程模板（SPEC §3）：纯数据。开项目时照着它生成「环节」行；管理员能改的工时和系数
 * 存在世界规则 `rules.rates` 里盖在上面（`template.set_rate`）。
 *
 * 每个环节：名字 · 阶段 · 类型（过渡 / 枢纽 / 审核）· 粒度 · 单位 · Tn（每 per 个单位几小时）·
 * 流程代号 · 上游 · 指示器文案（收什么、交什么、交给谁）· 默认工作量从哪来。
 */
import type { Grain, Group, Phase, StageKind, Unit } from "./model";

/** 开项目时任务的默认工作量从哪来（Layout / 原画监督这些枢纽之后还能在派发时改）。 */
export type DefaultWorkload = "one" | "layerSheets" | "cutSheets" | "keySheets" | "cutSeconds" | "projectSeconds";

export interface StageTemplate {
  key: string;
  name: string;
  phase: Phase;
  kind: StageKind;
  hub: boolean;
  grain: Grain;
  unit: Unit;
  tn: number;
  per: number;
  /** 工时由管理员定（这里是个占位数）。 */
  adminSet?: boolean;
  code: string | null;
  fileCode: string;
  folder: string;
  upstream: string[];
  workload: DefaultWorkload;
  receive: string;
  deliver: string;
  handTo: string;
  /** 补一句说明（报到页、环节节点上显示）。 */
  note?: string;
  /** 单位在这个组里叫什么（视频组的「期」）。 */
  unitLabel?: string;
}

export interface GroupTemplate {
  key: Group;
  name: string;
  /** 一「卡」在这个组里叫什么。 */
  cutLabel: string;
  /** 有没有 A / B 层。 */
  hasLayers: boolean;
  /** 还是草案（等用户确认）。 */
  draft: boolean;
  stages: StageTemplate[];
}

export const ANIMATION: GroupTemplate = {
  key: "animation",
  name: "动画组",
  cutLabel: "卡",
  hasLayers: true,
  draft: false,
  stages: [
    {
      key: "plan",
      name: "策划",
      phase: "pre",
      kind: "transit",
      hub: false,
      grain: "project",
      unit: "item",
      tn: 4,
      per: 1,
      adminSet: true,
      code: null,
      fileCode: "PLAN",
      folder: "策划",
      upstream: [],
      workload: "one",
      receive: "项目的想法、参考和预算",
      deliver: "策划案：做什么、多长、几个人、什么时候交",
      handTo: "剧本、美术设计",
    },
    {
      key: "script",
      name: "剧本",
      phase: "pre",
      kind: "transit",
      hub: false,
      grain: "project",
      unit: "second",
      tn: 2,
      per: 15,
      code: null,
      fileCode: "SCR",
      folder: "剧本",
      upstream: ["plan"],
      workload: "projectSeconds",
      receive: "策划案",
      deliver: "剧本文档",
      handTo: "分镜",
      note: "剧本和分镜合起来是 4 小时 / 15 秒，两边各算一半",
    },
    {
      key: "storyboard",
      name: "分镜",
      phase: "pre",
      kind: "hub",
      hub: true,
      grain: "project",
      unit: "second",
      tn: 2,
      per: 15,
      code: null,
      fileCode: "STB",
      folder: "分镜",
      upstream: ["script"],
      workload: "projectSeconds",
      receive: "剧本",
      deliver: "分镜表：每一卡的画面和秒数",
      handTo: "Layout、配音 · 音效",
      note: "剧本和分镜合起来是 4 小时 / 15 秒，两边各算一半",
    },
    {
      key: "art",
      name: "美术设计（人设 / 美设）",
      phase: "pre",
      kind: "transit",
      hub: false,
      grain: "project",
      unit: "item",
      tn: 8,
      per: 1,
      adminSet: true,
      code: null,
      fileCode: "ART",
      folder: "设定",
      upstream: ["plan"],
      workload: "one",
      receive: "策划案",
      deliver: "人设、美设图（设定）",
      handTo: "色指定设计、Layout",
    },
    {
      key: "color_design",
      name: "色指定设计",
      phase: "pre",
      kind: "transit",
      hub: false,
      grain: "project",
      unit: "item",
      tn: 4,
      per: 1,
      adminSet: true,
      code: null,
      fileCode: "COL",
      folder: "色指定",
      upstream: ["art"],
      workload: "one",
      receive: "人设、美设图",
      deliver: "色指定表",
      handTo: "上色",
    },
    {
      key: "layout",
      name: "Layout",
      phase: "pre",
      kind: "hub",
      hub: true,
      grain: "cut",
      unit: "sheet",
      tn: 2,
      per: 1,
      code: "LO",
      fileCode: "LO",
      folder: "LO",
      upstream: ["storyboard", "art"],
      workload: "one",
      receive: "分镜表和设定",
      deliver: "这一卡的 Layout 稿",
      handTo: "原画（在这里定原画张数、派发）、场景绘制",
      note: "分镜和设定都完成以后在这里拆卡、定原画工作量、派发",
    },
    {
      key: "key",
      name: "原画",
      phase: "mid",
      kind: "transit",
      hub: false,
      grain: "cut",
      unit: "sheet",
      tn: 3,
      per: 1,
      code: "H",
      fileCode: "H",
      folder: "H",
      upstream: ["layout"],
      workload: "keySheets",
      receive: "这一卡的 Layout 稿",
      deliver: "原画和动画轨目",
      handTo: "原画监督",
    },
    {
      key: "key_check",
      name: "原画监督",
      phase: "mid",
      kind: "review",
      hub: true,
      grain: "cut",
      unit: "cut",
      tn: 0.5,
      per: 1,
      code: "H",
      fileCode: "H",
      folder: "H",
      upstream: ["key"],
      workload: "one",
      receive: "这一卡的原画和轨目",
      deliver: "监修过的原画；定好中割张数",
      handTo: "清线、中割（在这里定中割工作量、派发）",
      note: "本身是审核，也是枢纽：在这里定中割工作量",
    },
    {
      key: "clean",
      name: "清线",
      phase: "mid",
      kind: "transit",
      hub: false,
      grain: "layer",
      unit: "sheet",
      tn: 1.5,
      per: 1,
      code: "CLN",
      fileCode: "CLN",
      folder: "CLN",
      upstream: ["key_check"],
      workload: "layerSheets",
      receive: "监修过的原画",
      deliver: "清好的线稿，每层一个文件",
      handTo: "中割",
    },
    {
      key: "inbetween",
      name: "中割",
      phase: "mid",
      kind: "transit",
      hub: false,
      grain: "layer",
      unit: "sheet",
      tn: 1.5,
      per: 1,
      code: "ANI",
      fileCode: "ANI",
      folder: "ANI",
      upstream: ["clean"],
      workload: "layerSheets",
      receive: "清好的线稿和原画的动画轨目",
      deliver: "这一层的中割（按张数），层分开",
      handTo: "中割检修",
    },
    {
      key: "inbetween_check",
      name: "中割检修",
      phase: "mid",
      kind: "review",
      hub: true,
      grain: "cut",
      unit: "cut",
      tn: 0.5,
      per: 1,
      code: "ANI",
      fileCode: "ANI",
      folder: "ANI",
      upstream: ["inbetween"],
      workload: "one",
      receive: "这一卡 A / B 层的中割",
      deliver: "检修过的动画；定好上色张数",
      handTo: "输出上色文件、上色（在这里派发上色）",
      note: "本身是审核，也是枢纽：在这里派发上色",
    },
    {
      key: "color_out",
      name: "输出上色文件（导出胶片）",
      phase: "post",
      kind: "transit",
      hub: false,
      grain: "cut",
      unit: "cut",
      tn: 0.5,
      per: 1,
      code: "ANI",
      fileCode: "ANI",
      folder: "ANI",
      upstream: ["inbetween_check"],
      workload: "one",
      receive: "检修过的动画",
      deliver: "上色用的胶片文件",
      handTo: "上色",
    },
    {
      key: "paint",
      name: "上色（执行色指定）",
      phase: "post",
      kind: "transit",
      hub: false,
      grain: "layer",
      unit: "sheet",
      tn: 0.2,
      per: 1,
      code: "ANI",
      fileCode: "ANI",
      folder: "ANI",
      upstream: ["color_out", "color_design"],
      workload: "layerSheets",
      receive: "胶片文件和色指定表",
      deliver: "上好色的这一层：直接在已有的 A / B 层动画文件夹里按张数新建图层上色",
      handTo: "检查色指定",
    },
    {
      key: "paint_check",
      name: "检查色指定",
      phase: "post",
      kind: "review",
      hub: false,
      grain: "cut",
      unit: "cut",
      tn: 0.5,
      per: 1,
      code: "ANI",
      fileCode: "ANI",
      folder: "ANI",
      upstream: ["paint"],
      workload: "one",
      receive: "这一卡上好色的动画",
      deliver: "检查过的上色（漏色、色线、分层都看过）",
      handTo: "导出",
    },
    {
      key: "export",
      name: "导出（上色 · 线稿 · 分层）",
      phase: "post",
      kind: "transit",
      hub: false,
      grain: "cut",
      unit: "cut",
      tn: 0.5,
      per: 1,
      code: "CMP",
      fileCode: "CMP",
      folder: "CMP",
      upstream: ["paint_check"],
      workload: "one",
      receive: "检查过的上色文件",
      deliver: "线稿、色彩、特殊分层各自导出，整理成一个文件夹",
      handTo: "影像合成",
    },
    {
      key: "background",
      name: "场景绘制",
      phase: "post",
      kind: "transit",
      hub: false,
      grain: "cut",
      unit: "sheet",
      tn: 3,
      per: 1,
      adminSet: true,
      code: "BG",
      fileCode: "BG",
      folder: "BG",
      upstream: ["layout"],
      workload: "one",
      receive: "这一卡的 Layout 稿",
      deliver: "场景图",
      handTo: "影像合成",
      note: "Layout 之后就能开始，和原画并行",
    },
    {
      key: "composite",
      name: "影像合成",
      phase: "post",
      kind: "hub",
      hub: true,
      grain: "cut",
      unit: "second",
      tn: 1.5,
      per: 10,
      code: "CMP",
      fileCode: "CMP",
      folder: "CMP",
      upstream: ["export", "background"],
      workload: "cutSeconds",
      receive: "导出的画面和场景图",
      deliver: "合成好的镜头",
      handTo: "特效 · 调色",
      note: "画面和场景在这里汇合",
    },
    {
      key: "fx",
      name: "特效 · 调色",
      phase: "post",
      kind: "transit",
      hub: false,
      grain: "cut",
      unit: "second",
      tn: 1.5,
      per: 10,
      code: "CMP",
      fileCode: "CMP",
      folder: "CMP",
      upstream: ["composite"],
      workload: "cutSeconds",
      receive: "合成好的镜头",
      deliver: "加好特效、调好色的镜头",
      handTo: "成片输出",
    },
    {
      key: "sound",
      name: "配音 · 音效",
      phase: "post",
      kind: "transit",
      hub: false,
      grain: "project",
      unit: "second",
      tn: 1,
      per: 10,
      adminSet: true,
      code: null,
      fileCode: "SND",
      folder: "音频",
      upstream: ["storyboard"],
      workload: "projectSeconds",
      receive: "分镜表",
      deliver: "配音和音效文件",
      handTo: "成片输出",
      note: "分镜之后就能开始，和画面并行",
    },
    {
      key: "final",
      name: "成片输出",
      phase: "post",
      kind: "hub",
      hub: true,
      grain: "project",
      unit: "item",
      tn: 4,
      per: 1,
      adminSet: true,
      code: "FIN",
      fileCode: "FIN",
      folder: "FIN",
      upstream: ["fx", "sound"],
      workload: "one",
      receive: "全部镜头和声音",
      deliver: "成片",
      handTo: "发布",
      note: "画面和声音在这里汇合",
    },
  ],
};

/** 视频组（草案，等用户确认；工时都是占位数，管理员能改）。粒度按「期」（相当于卡）。 */
export const VIDEO: GroupTemplate = {
  key: "video",
  name: "视频组",
  cutLabel: "期",
  hasLayers: false,
  draft: true,
  stages: [
    v("topic", "选题", "pre", "hub", true, "project", "item", 2, "TOPIC", "选题", [], "one", "大家的想法和最近的作品", "这一季做几期、每期讲什么、谁来做", "文稿撰写", "在这里定期数和分工"),
    v("draft", "文稿撰写", "pre", "transit", false, "cut", "cut", 4, "TXT", "文稿", ["topic"], "one", "这一期的选题", "讲稿", "分镜 / 脚本"),
    v("vboard", "分镜 / 脚本", "pre", "transit", false, "cut", "cut", 3, "STB", "分镜", ["draft"], "one", "讲稿", "分镜和拍摄脚本", "素材准备"),
    v("material", "素材准备", "pre", "transit", false, "cut", "cut", 4, "MAT", "素材", ["vboard"], "one", "分镜和脚本", "录好的绘画过程、要展示的稿件", "录制", "录制绘画过程 · 展示稿件"),
    v("record", "录制（理论讲解）", "mid", "transit", false, "cut", "cut", 3, "REC", "录制", ["material"], "one", "脚本和素材", "讲解的录像", "粗剪"),
    v("rough", "粗剪", "mid", "transit", false, "cut", "cut", 4, "RGH", "剪辑", ["record"], "one", "录像和素材", "粗剪版", "精剪"),
    v("fine", "精剪", "mid", "review", false, "cut", "cut", 2, "EDT", "剪辑", ["rough"], "one", "粗剪版", "精剪版", "配音字幕"),
    v("voice", "配音字幕", "post", "transit", false, "cut", "cut", 2, "VO", "字幕", ["fine"], "one", "精剪版", "加好配音和字幕的版本", "包装特效"),
    v("package", "包装特效", "post", "transit", false, "cut", "cut", 3, "PKG", "包装", ["voice"], "one", "配好字幕的版本", "加好片头、包装和特效的版本", "审片"),
    v("screening", "审片", "post", "review", true, "cut", "cut", 0.5, "CHK", "审片", ["package"], "one", "包装好的成片", "审过的成片", "发布", "本身是审核，也是枢纽"),
    v("publish", "发布", "post", "transit", false, "cut", "cut", 0.5, "PUB", "发布", ["screening"], "one", "审过的成片", "发布出去的链接", "—"),
  ],
};

function v(
  key: string,
  name: string,
  phase: Phase,
  kind: StageKind,
  hub: boolean,
  grain: Grain,
  unit: Unit,
  tn: number,
  fileCode: string,
  folder: string,
  upstream: string[],
  workload: DefaultWorkload,
  receive: string,
  deliver: string,
  handTo: string,
  note?: string
): StageTemplate {
  return {
    key,
    name,
    phase,
    kind,
    hub,
    grain,
    unit,
    tn,
    per: 1,
    adminSet: true,
    code: null,
    fileCode,
    folder,
    upstream,
    workload,
    receive,
    deliver,
    handTo,
    ...(note ? { note } : {}),
    ...(unit === "cut" ? { unitLabel: "期" } : {}),
  };
}

export const GROUPS: Record<Group, GroupTemplate> = { animation: ANIMATION, video: VIDEO };
export const GROUP_LIST: GroupTemplate[] = [ANIMATION, VIDEO];

export function groupTemplate(group: Group): GroupTemplate {
  return GROUPS[group];
}

export function stageTemplate(group: Group, key: string): StageTemplate | undefined {
  return GROUPS[group]?.stages.find((s) => s.key === key);
}

/** 模板里环节的英文（SPEC §16：模板自带中英两种名字；管理员自己起的环节名就是他写的那个）。 */
export interface StageEn {
  name: string;
  receive: string;
  deliver: string;
  handTo: string;
  note?: string;
}

export const STAGE_EN: Record<Group, Record<string, StageEn>> = {
  animation: {
    plan: { name: "Planning", receive: "Ideas, references and budget", deliver: "Project plan: what, how long, how many people, when it's due", handTo: "Script, Art design" },
    script: { name: "Script", receive: "Project plan", deliver: "Script", handTo: "Storyboard", note: "Script and storyboard together are 4 h per 15 s, half each" },
    storyboard: { name: "Storyboard", receive: "Script", deliver: "Storyboard: framing and seconds for every cut", handTo: "Layout, Sound", note: "Script and storyboard together are 4 h per 15 s, half each" },
    art: { name: "Art design (characters / settings)", receive: "Project plan", deliver: "Character and setting sheets", handTo: "Color design, Layout" },
    color_design: { name: "Color design", receive: "Character and setting sheets", deliver: "Color model sheets", handTo: "Coloring" },
    layout: { name: "Layout", receive: "Storyboard and settings sheets", deliver: "Layout for this cut", handTo: "Key animation (key counts and dispatch are set here), Backgrounds", note: "Once the storyboard and settings are done, split cuts, set key animation workloads and dispatch here" },
    key: { name: "Key animation", receive: "Layout for this cut", deliver: "Key drawings and timing sheet", handTo: "Animation direction" },
    key_check: { name: "Animation direction", receive: "Key drawings and timing for this cut", deliver: "Corrected keys; in-between counts set", handTo: "Cleanup, In-between (in-between workloads and dispatch are set here)", note: "A review stage and a hub: in-between workloads are set here" },
    clean: { name: "Cleanup", receive: "Corrected keys", deliver: "Clean lines, one file per layer", handTo: "In-between" },
    inbetween: { name: "In-between", receive: "Clean lines and the key timing sheet", deliver: "In-betweens for this layer (by drawing count), layers kept separate", handTo: "In-between check" },
    inbetween_check: { name: "In-between check", receive: "In-betweens for layers A / B of this cut", deliver: "Checked animation; coloring counts set", handTo: "Color export, Coloring (coloring is dispatched here)", note: "A review stage and a hub: coloring is dispatched here" },
    color_out: { name: "Color export (film files)", receive: "Checked animation", deliver: "Film files for coloring", handTo: "Coloring" },
    paint: { name: "Coloring (ink & paint)", receive: "Film files and color model sheets", deliver: "This layer colored: add color layers per drawing inside the existing A / B animation folders", handTo: "Color check" },
    paint_check: { name: "Color check", receive: "Colored animation for this cut", deliver: "Checked coloring (gaps, color lines and layers all checked)", handTo: "Export" },
    export: { name: "Export (color · lines · layers)", receive: "Checked color files", deliver: "Lines, color and special layers exported separately, packed in one folder", handTo: "Compositing" },
    background: { name: "Backgrounds", receive: "Layout for this cut", deliver: "Background art", handTo: "Compositing", note: "Can start right after Layout, alongside key animation" },
    composite: { name: "Compositing", receive: "Exported frames and backgrounds", deliver: "Composited shot", handTo: "Effects · grading", note: "Frames and backgrounds come together here" },
    fx: { name: "Effects · grading", receive: "Composited shot", deliver: "Shot with effects and grading", handTo: "Final output" },
    sound: { name: "Sound (voice · SFX)", receive: "Storyboard", deliver: "Voice and sound effect files", handTo: "Final output", note: "Can start after the storyboard, alongside the picture" },
    final: { name: "Final output", receive: "All shots and sound", deliver: "Final film", handTo: "Release", note: "Picture and sound come together here" },
  },
  video: {
    topic: { name: "Topic", receive: "Everyone's ideas and recent work", deliver: "How many episodes this season, what each covers, who makes them", handTo: "Writing", note: "Episode count and roles are set here" },
    draft: { name: "Writing", receive: "This episode's topic", deliver: "Script", handTo: "Storyboard / shot list" },
    vboard: { name: "Storyboard / shot list", receive: "Script", deliver: "Storyboard and shot list", handTo: "Materials" },
    material: { name: "Materials", receive: "Storyboard and shot list", deliver: "Recorded drawing sessions and artwork to show", handTo: "Recording", note: "Record drawing sessions · artwork to show" },
    record: { name: "Recording (explanations)", receive: "Script and materials", deliver: "Recorded explanations", handTo: "Rough cut" },
    rough: { name: "Rough cut", receive: "Recordings and materials", deliver: "Rough cut", handTo: "Fine cut" },
    fine: { name: "Fine cut", receive: "Rough cut", deliver: "Fine cut", handTo: "Voice & subtitles" },
    voice: { name: "Voice & subtitles", receive: "Fine cut", deliver: "Version with voice-over and subtitles", handTo: "Packaging & effects" },
    package: { name: "Packaging & effects", receive: "Subtitled version", deliver: "Version with titles, packaging and effects", handTo: "Screening" },
    screening: { name: "Screening", receive: "Packaged final cut", deliver: "Approved final cut", handTo: "Publishing", note: "A review stage and a hub" },
    publish: { name: "Publishing", receive: "Approved final cut", deliver: "Published link", handTo: "—" },
  },
};

/** 环节在这种语言里叫什么：模板里的（名字没改过）用模板的说法；管理员自己起的、改过名字的照原样（算用户写的）。 */
export function stageText(
  group: Group,
  stage: { templateKey: string; name: string; indicator?: { receive: string; deliver: string; handTo: string }; note?: string | null },
  lang: "zh" | "en"
): { name: string; receive: string; deliver: string; handTo: string; note: string | null; custom: boolean; uc: { receive: boolean; deliver: boolean; handTo: boolean; note: boolean } } {
  const t = stageTemplate(group, stage.templateKey);
  const custom = !t || t.name !== stage.name;
  const ind = stage.indicator ?? { receive: "", deliver: "", handTo: "" };
  // 哪几段是管理员自己写的（和模板不一样）：照原样显示，算用户内容。
  const uc = {
    receive: !t || ind.receive !== t.receive,
    deliver: !t || ind.deliver !== t.deliver,
    handTo: !t || ind.handTo !== t.handTo,
    note: !!stage.note && (!t || stage.note !== t.note),
  };
  if (lang === "zh" || !t) return { name: stage.name, receive: ind.receive, deliver: ind.deliver, handTo: ind.handTo, note: stage.note ?? null, custom, uc };
  const e = STAGE_EN[group][t.key];
  return {
    name: custom ? stage.name : e?.name ?? stage.name,
    receive: uc.receive ? ind.receive : e?.receive ?? ind.receive,
    deliver: uc.deliver ? ind.deliver : e?.deliver ?? ind.deliver,
    handTo: uc.handTo ? ind.handTo : e?.handTo ?? ind.handTo,
    note: stage.note ? (uc.note ? stage.note : e?.note ?? stage.note) : null,
    custom,
    uc,
  };
}

export const GROUP_EN: Record<Group, { name: string; cutLabel: string }> = {
  animation: { name: "Animation", cutLabel: "cut" },
  video: { name: "Video", cutLabel: "episode" },
};
