/**
 * 命令被拒的原因（SPEC §16）：数据层返回 code + 参数，界面按语言拼句子。中文照原来的说法。
 * 每一条都有中英两种，占位符一样（errors.test.ts 查）。
 */
import { t2, type Text2 } from "./text";

export const ERRORS = {
  // —— 零日 · 改项目（§12）——
  zero_only: t2("项目开工以后就不能改结构了，用「加卡」「改卡」", "The structure can't change after the project starts. Use Add cuts / Edit cut instead."),
  not_zero: t2("这个项目已经开工了", "This project has already started."),
  zero_not_started: t2("项目还在零日（筹备），先开工", "The project is still in pre-start. Start it first."),
  structure_range: t2("{what}要填 {min}–{max} 之间的整数", "{what} must be a whole number from {min} to {max}"),
  structure_too_many: t2("一个项目最多 {max} 卡（现在是 {n} 卡）", "A project can have at most {max} cuts (this would be {n})."),
  layers_bad: t2("层名写一个大写字母（A、B …），最多 6 层", "Layers are single capital letters (A, B …), up to 6."),
  layers_none_video: t2("视频组不分层", "Video projects don't have layers."),
  staff_position_missing: t2("人员表里没有这个职位", "That position isn't in the staff list."),
  staff_too_many: t2("一个职位最多 {max} 个人", "A position can have at most {max} people."),
  staff_name_bad: t2("外部的名字写 1–24 个字", "External names must be 1–24 characters."),
  staff_dup: t2("{name}已经在这个职位上了", "{name} is already in this position."),
  key_dates_too_many: t2("关键日最多 {max} 个", "At most {max} key dates."),
  key_date_bad: t2("关键日要有名字和日期", "Each key date needs a name and a date."),
  cover_not_image: t2("封面要选资料库里的一张图", "The cover must be an image from the library."),
  stage_name_bad: t2("环节名字写 1–30 个字", "Stage names must be 1–30 characters."),
  stage_name_taken: t2("这个项目里已经有「{name}」了", "This project already has a stage called “{name}”."),
  stage_after_missing: t2("找不到要接在后面的那个环节", "Can't find the stage to put it after."),
  stage_delivered: t2("这个环节已经有人交过，不能删，可以停用", "Work has already been submitted in this stage, so it can't be deleted. You can disable it instead."),
  stage_disabled: t2("「{stage}」停用了，任务不再派", "“{stage}” is disabled, so its tasks aren't handed out."),
  stage_already_top: t2("已经在最前面了", "It's already first."),
  stage_already_bottom: t2("已经在最后面了", "It's already last."),
  accept_unfinished: t2("还有 {n} 张没通过，先等它们做完或打回", "{n} {n|task hasn't|tasks haven't} passed yet. Wait for them to finish, or send some back."),
  accept_already: t2("这个环节已经验收过了", "This stage has already been accepted."),
  reopen_not_passed: t2("只有收回的任务能重新放出、通过的任务能打回重做", "Only reclaimed tasks can be reopened, and only passed tasks can be sent back for a redo."),
  reopen_need_comment: t2("打回重做要写意见", "Write what needs redoing."),
  extend_not_running: t2("{label}现在没有在做，没有时限可以延", "{label} isn't in progress, so there's no deadline to extend."),
  extend_amount: t2("延期写加几小时、加几天，或者改到哪一天", "Give hours or days to add, or a new date."),
  extend_until_past: t2("新的时限要比现在的晚", "The new deadline must be later than the current one."),
  extend_none_running: t2("这个环节现在没有在做的任务", "Nothing in this stage is in progress right now."),
  reason_required: t2("写一下原因", "Please give a reason."),
  project_extend_early: t2("计划结束要晚于开始", "The planned end must be after the start."),
  cut_add_count: t2("一次加 1–50 卡", "Add 1–50 cuts at a time."),
  cut_after_missing: t2("找不到 {cut}", "Can't find {cut}."),
  cut_suffix_full: t2("{cut} 后面插不下更多了", "No room to insert more cuts after {cut}."),
  cut_layer_delivered: t2("{layer} 层已经有人交过，不能去掉", "Layer {layer} already has submitted work, so it can't be removed."),
  cut_disabled: t2("{cut} 停用了", "{cut} is disabled."),
  cut_already_disabled: t2("{cut} 已经停用了", "{cut} is already disabled."),
} satisfies Record<string, Text2>;

export type ErrorKey = keyof typeof ERRORS;
