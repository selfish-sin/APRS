/**
 * 项目模板和人员表的职位（SPEC §12.1）：照日本动画制作的常见分工，加上工会自己的分工。
 * 每个职位一句话说做什么（中英两种），对上流程里的环节：开工时，填了人的职位 = 这些人自动报到对应环节。
 */
import type { Group } from "./model";
import { t2, type Text2 } from "./text";

export const PROJECT_TEMPLATE_KEYS = ["anim_standard", "video_standard", "blank"] as const;
export type ProjectTemplateKey = (typeof PROJECT_TEMPLATE_KEYS)[number];

export const POSITION_GROUPS = ["lead", "pre", "mid", "post"] as const;
export type PositionGroup = (typeof POSITION_GROUPS)[number];

export const POSITION_GROUP_LABEL: Record<PositionGroup, Text2> = {
  lead: t2("统筹", "Management"),
  pre: t2("前期", "Pre-production"),
  mid: t2("中期", "Production"),
  post: t2("后期", "Post-production"),
};

export interface PositionTemplate {
  key: string;
  group: PositionGroup;
  name: Text2;
  desc: Text2;
  /** 对应的环节（开工时自动报到这些）。可以没有（例如监督、制作进行）。 */
  stageKeys: string[];
}

const p = (key: string, group: PositionGroup, zh: string, en: string, descZh: string, descEn: string, stageKeys: string[] = []): PositionTemplate => ({ key, group, name: t2(zh, en), desc: t2(descZh, descEn), stageKeys });

export const ANIM_POSITIONS: PositionTemplate[] = [
  p("producer", "lead", "制作人", "Producer", "定预算、排期和人，对整个项目负责", "Owns the budget, schedule and team for the whole project", ["plan"]),
  p("director", "lead", "监督（导演）", "Director", "定片子的方向，最后拍板画面和节奏", "Sets the creative direction and signs off on picture and pacing"),
  p("production_assistant", "lead", "制作进行", "Production assistant", "催进度、管交接，盯着每一卡走到哪了", "Chases progress and handoffs, and tracks where every cut is"),
  p("settings_coordinator", "lead", "设定制作", "Settings coordinator", "整理设定、发资料，拍板以后通知要补的人", "Organizes settings sheets, sends references, and tells people what to fix after a ruling"),
  p("file_export", "lead", "文件导出整理", "File export & handoff", "把上色、线稿、分层单独导出，整理好交给后期", "Exports color, line and layer files and packages them for post", ["color_out", "export"]),
  p("script", "pre", "脚本（剧本）", "Script", "把故事写成剧本", "Writes the story as a script", ["script"]),
  p("storyboard", "pre", "分镜", "Storyboard", "把剧本画成分镜，定每一卡的画面和秒数", "Turns the script into storyboards, with framing and timing for every cut", ["storyboard"]),
  p("episode_director", "pre", "演出", "Episode director", "按分镜指导各卡的表演和镜头", "Directs the acting and camerawork of each cut from the storyboard"),
  p("character_design", "pre", "人物设计", "Character design", "画人物设定（正面、侧面、表情）", "Draws the character settings sheets (front, side, expressions)", ["art"]),
  p("art_design", "pre", "美术设定", "Art design", "画场景和道具的设定", "Designs locations and props", ["art"]),
  p("color_design", "pre", "色彩设计（色指定）", "Color design", "定每个人物、道具用什么颜色", "Picks the colors for every character and prop", ["color_design"]),
  p("layout", "pre", "设计稿（Layout）", "Layout", "按分镜画每一卡的构图和原画张数", "Draws each cut's composition from the storyboard and sets the number of keys", ["layout"]),
  p("key", "mid", "原画", "Key animation", "画动作的关键帧", "Draws the key poses of the motion", ["key"]),
  p("animation_director", "mid", "作画监督（原画监督）", "Animation director", "检查原画，统一人物的样子和质量", "Checks key animation and keeps characters on-model", ["key_check"]),
  p("second_key", "mid", "第二原画（清线）", "Second key animation (cleanup)", "把原画清成干净的线", "Cleans up the key drawings into final lines", ["clean"]),
  p("inbetween", "mid", "动画（中割）", "In-between", "在原画之间补中间张", "Draws the in-between frames", ["inbetween"]),
  p("inbetween_check", "mid", "动画检查（中割检修）", "In-between check", "检查中割，补漏、修线", "Checks in-betweens and fixes gaps and lines", ["inbetween_check"]),
  p("paint", "post", "上色", "Coloring", "照色指定上色", "Colors the frames from the color design", ["paint"]),
  p("color_check", "post", "色指定检查", "Color check", "检查上色有没有照色指定", "Checks the coloring against the color design", ["paint_check"]),
  p("background", "post", "背景", "Background", "画场景（背景）", "Paints the backgrounds", ["background"]),
  p("art_director", "post", "美术监督", "Art director", "检查背景，统一画面的美术风格", "Checks backgrounds and keeps the art style consistent"),
  p("compositing", "post", "摄影（合成）", "Compositing", "把人物、背景、特效合成画面", "Composites characters, backgrounds and effects", ["composite"]),
  p("dop", "post", "摄影监督", "Director of photography", "定合成的光、色调和镜头效果", "Sets lighting, grading and camera effects for compositing"),
  p("effects", "post", "特效", "Effects", "做特效和调色", "Does effects and color grading", ["fx"]),
  p("editing", "post", "剪辑", "Editing", "把各卡剪成片", "Edits the cuts together"),
  p("sound", "post", "音响（配音 · 音效）", "Sound (voice · SFX)", "配音、音效和音乐", "Voice, sound effects and music", ["sound"]),
  p("final_output", "post", "成片输出", "Final output", "输出最后的成片", "Renders and delivers the final film", ["final"]),
];

export const VIDEO_POSITIONS: PositionTemplate[] = [
  p("producer", "lead", "制作人", "Producer", "定这一季做什么、谁来做", "Decides what the season covers and who does it", ["topic"]),
  p("writer", "pre", "文稿撰写", "Writer", "把选题写成讲稿", "Writes the script for each episode", ["draft"]),
  p("vboard", "pre", "分镜 / 脚本", "Storyboard / shooting script", "把讲稿排成分镜和拍摄脚本", "Turns the script into a storyboard and shot list", ["vboard"]),
  p("materials", "pre", "素材准备", "Materials", "录绘画过程、准备要展示的稿件", "Records drawing sessions and prepares the artwork to show", ["material"]),
  p("recording", "mid", "录制", "Recording", "录理论讲解", "Records the explanation segments", ["record"]),
  p("rough_cut", "mid", "粗剪", "Rough cut", "把录像和素材剪成粗剪", "Assembles the rough cut", ["rough"]),
  p("fine_cut", "mid", "精剪", "Fine cut", "精剪成片", "Finishes the fine cut", ["fine"]),
  p("voice", "post", "配音字幕", "Voice & subtitles", "配音、加字幕", "Adds voice-over and subtitles", ["voice"]),
  p("packaging", "post", "包装特效", "Packaging & effects", "片头、包装和特效", "Titles, packaging and effects", ["package"]),
  p("screening", "post", "审片", "Screening", "看成片，决定能不能发", "Watches the final cut and approves it for release", ["screening"]),
  p("publish", "post", "发布", "Publishing", "发布出去，贴回链接", "Publishes it and posts the link", ["publish"]),
];

export interface ProjectTemplate {
  key: ProjectTemplateKey;
  group: Group;
  name: Text2;
  desc: Text2;
  positions: PositionTemplate[];
  /** 开工时按组模板生成环节（从空白开始 = 不生成，开工以后自己加）。 */
  stages: boolean;
}

export const PROJECT_TEMPLATES: Record<ProjectTemplateKey, ProjectTemplate> = {
  anim_standard: {
    key: "anim_standard",
    group: "animation",
    name: t2("动画短片 · 标准", "Animated short · standard"),
    desc: t2("照日本动画制作的常见分工：统筹 · 前期 · 中期 · 后期，二十几个职位，二十个环节。", "The usual anime production crew: management, pre-production, production and post, with about twenty positions and twenty stages."),
    positions: ANIM_POSITIONS,
    stages: true,
  },
  video_standard: {
    key: "video_standard",
    group: "video",
    name: t2("视频 · 标准", "Video · standard"),
    desc: t2("视频组的流程：选题 → 文稿 → 分镜 → 录制 → 剪辑 → 包装 → 审片 → 发布。", "The video team's pipeline: topic → script → storyboard → recording → editing → packaging → screening → publishing."),
    positions: VIDEO_POSITIONS,
    stages: true,
  },
  blank: {
    key: "blank",
    group: "animation",
    name: t2("从空白开始", "Start from blank"),
    desc: t2("没有职位、没有环节，开工以后自己加。", "No positions and no stages. Add your own after the project starts."),
    positions: [],
    stages: false,
  },
};

export function positionTemplate(tpl: ProjectTemplateKey | null | undefined, key: string): PositionTemplate | undefined {
  return tpl ? PROJECT_TEMPLATES[tpl]?.positions.find((x) => x.key === key) : undefined;
}
