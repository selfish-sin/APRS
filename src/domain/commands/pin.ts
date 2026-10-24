/**
 * 图上的评论（SPEC §11.4）：点一下 = 钉，拖一下 = 框。位置按图的比例存（0–1）。
 *   pin.add · pin.reply · pin.resolve · pin.reopen
 */
import { PIN_KIND, type Id, type PinRow } from "../model";
import type { ReadModel } from "../readmodel";
import { RETURN_TAGS } from "../rules";
import { guarded, insert, isReviewer, mustBeOneOf, mustGet, mustMember, mustText, ok, reject, update, type Ctx } from "./core";

function ratio(value: unknown, what: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) reject("invalid", `${what}要在图里面`);
  return Math.round(n * 10000) / 10000;
}

/** 这张图挂在哪张任务上（任务、版本）。 */
function taskOfFile(rm: ReadModel, subjectType: string, subjectId: Id): Id | null {
  if (subjectType === "task") return subjectId;
  if (subjectType === "submission") return rm.get("submissions", subjectId)?.taskId ?? null;
  return null;
}

export interface AddPinInput {
  fileId: Id;
  kind: "point" | "box";
  x: number;
  y: number;
  w?: number | null;
  h?: number | null;
  text: string;
  layer?: string | null;
  sheets?: string | null;
  tag?: string | null;
  mentions?: Id[];
  /** 审核退回时钉的（只有审核员和管理员）。 */
  forReview?: boolean;
}

export const addPin = guarded<AddPinInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const file = mustGet(rm, ctx, "files", input.fileId, "图");
  if (!file.width || !file.height) reject("invalid", "只能在图片上钉");
  const kind = mustBeOneOf(input.kind, PIN_KIND, "钉还是框");
  const x = ratio(input.x, "位置");
  const y = ratio(input.y, "位置");
  let w: number | null = null;
  let h: number | null = null;
  if (kind === "box") {
    w = ratio(input.w, "框的宽");
    h = ratio(input.h, "框的高");
    if (w < 0.005 || h < 0.005) reject("invalid", "框太小了，拖大一点");
    if (x + w > 1.0001 || y + h > 1.0001) reject("invalid", "框超出图了");
  }
  const text = mustText(input.text, "意见", 500);
  const layer = input.layer ? String(input.layer).trim().toUpperCase().slice(0, 4) : null;
  const sheets = input.sheets ? String(input.sheets).trim() : null;
  if (sheets && sheets.length > 40) reject("invalid", "张号太长了");
  const tag = input.tag ? String(input.tag) : null;
  if (tag && !(RETURN_TAGS as readonly string[]).includes(tag)) reject("invalid", "标签不在可选范围内");
  const mentions = Array.from(new Set(Array.isArray(input.mentions) ? input.mentions : []));
  if (mentions.length > 10) reject("invalid", "一次最多 @ 10 个人");
  for (const id of mentions) mustGet(rm, ctx, "members", id, "要 @ 的人");
  const taskId = taskOfFile(rm, file.subjectType, file.subjectId);
  if (input.forReview && !isReviewer(me)) reject("forbidden", "只有审核员和管理员能在审核时钉");
  if (input.forReview && !taskId) reject("invalid", "这张图没挂在任务上，审核时钉不了");
  const number = Math.max(0, ...rm.where("pins", { fileId: file.id }).map((p) => p.number)) + 1;
  const p = insert(ctx, "pins", {
    fileId: file.id,
    number,
    kind,
    x,
    y,
    w,
    h,
    layer: layer || null,
    sheets: sheets || null,
    tag,
    text,
    mentions,
    reviewTaskId: input.forReview ? taskId : null,
    projectId: file.projectId,
    cutId: file.cutId,
    taskId,
    status: "open",
    replies: [],
    byMemberId: me.id,
    at: ctx.worldNow,
  });
  return ok([p.change], { pinId: p.row.id });
});

export interface PinReplyInput {
  pinId: Id;
  text: string;
}

export const replyPin = guarded<PinReplyInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const pin = mustGet(rm, ctx, "pins", input.pinId, "这个钉");
  const text = mustText(input.text, "回复", 500);
  if (pin.replies.length >= 100) reject("state", "这个钉的回复太多了，另钉一个吧");
  const ch = update("pins", pin, { replies: [...pin.replies, { byMemberId: me.id, text, at: ctx.worldNow }] });
  return ok(ch ? [ch] : [], { pinId: pin.id });
});

/** 谁能解决：钉的人、审核员 / 管理员、被 @ 的人、这张图所在任务的接的人。 */
function mayResolve(rm: ReadModel, ctx: Ctx, pin: PinRow): boolean {
  const me = mustMember(rm, ctx);
  if (pin.byMemberId === me.id || isReviewer(me) || pin.mentions.includes(me.id)) return true;
  const task = pin.taskId ? rm.get("tasks", pin.taskId) : undefined;
  return !!task && task.assigneeId === me.id;
}

export interface PinIdInput {
  pinId: Id;
}

export const resolvePin = guarded<PinIdInput>((rm, input, ctx) => {
  const pin = mustGet(rm, ctx, "pins", input.pinId, "这个钉");
  if (pin.status === "resolved") reject("state", "这个钉已经解决了");
  if (!mayResolve(rm, ctx, pin)) reject("forbidden", "只有钉的人、被 @ 的人、做这张任务的人或审核员能解决");
  const ch = update("pins", pin, { status: "resolved" });
  return ok(ch ? [ch] : [], { pinId: pin.id });
});

export const reopenPin = guarded<PinIdInput>((rm, input, ctx) => {
  const pin = mustGet(rm, ctx, "pins", input.pinId, "这个钉");
  if (pin.status === "open") reject("state", "这个钉还开着");
  if (!mayResolve(rm, ctx, pin)) reject("forbidden", "只有钉的人、被 @ 的人、做这张任务的人或审核员能重新打开");
  const ch = update("pins", pin, { status: "open" });
  return ok(ch ? [ch] : [], { pinId: pin.id });
});
