/**
 * 图上的评论（SPEC §11.4）：点一下 = 钉，拖一下 = 框。位置按图的比例存（0–1）。
 *   pin.add · pin.reply · pin.resolve · pin.reopen
 */
import { PIN_KIND, type Id, type PinRow } from "../model";
import type { ReadModel } from "../readmodel";
import { RETURN_TAGS } from "../rules";
import { guarded, insert, isReviewer, mustBeOneOf, mustGet, mustMember, mustText, ok, rejectT, update, type Ctx } from "./core";
import { whatText } from "../what";

/** 表格文件（能在格子上留意见的）。 */
export const SHEET_FILE = /\.(xlsx|xlsm|xls|csv|ods)$/i;
const CELL_REF = /^[A-Z]{1,3}[1-9]\d{0,6}(:[A-Z]{1,3}[1-9]\d{0,6})?$/;

function ratio(value: unknown, what: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) rejectT("invalid", "pin_outside", { what: whatText(what) });
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
  kind?: "point" | "box";
  x?: number;
  y?: number;
  /** 表格上的意见：哪个工作表、哪一格 / 哪一片（SPEC §15.2）。 */
  cell?: { sheet: string; ref: string } | null;
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
  let cell: { sheet: string; ref: string } | null = null;
  if (input.cell) {
    if (!SHEET_FILE.test(file.name)) rejectT("invalid", "pin_cell_sheet_only");
    const sheet = typeof input.cell.sheet === "string" ? input.cell.sheet.trim() : "";
    if (!sheet || sheet.length > 31) rejectT("invalid", "pin_sheet_name");
    const ref = typeof input.cell.ref === "string" ? input.cell.ref.trim().toUpperCase() : "";
    if (!CELL_REF.test(ref)) rejectT("invalid", "pin_cell_ref");
    cell = { sheet, ref };
  } else if (!file.width || !file.height) rejectT("invalid", "pin_image_only");
  const kind = cell ? (cell.ref.includes(":") ? "box" : "point") : mustBeOneOf(input.kind, PIN_KIND, "钉还是框");
  const x = cell ? 0 : ratio(input.x, "位置");
  const y = cell ? 0 : ratio(input.y, "位置");
  let w: number | null = null;
  let h: number | null = null;
  if (kind === "box" && !cell) {
    w = ratio(input.w, "框的宽");
    h = ratio(input.h, "框的高");
    if (w < 0.005 || h < 0.005) rejectT("invalid", "box_small");
    if (x + w > 1.0001 || y + h > 1.0001) rejectT("invalid", "box_outside");
  }
  const text = mustText(input.text, "意见", 500);
  const layer = input.layer ? String(input.layer).trim().toUpperCase().slice(0, 4) : null;
  const sheets = input.sheets ? String(input.sheets).trim() : null;
  if (sheets && sheets.length > 40) rejectT("invalid", "sheets_long");
  const tag = input.tag ? String(input.tag) : null;
  if (tag && !(RETURN_TAGS as readonly string[]).includes(tag)) rejectT("invalid", "tag_bad");
  const mentions = Array.from(new Set(Array.isArray(input.mentions) ? input.mentions : []));
  if (mentions.length > 10) rejectT("invalid", "mentions_max");
  for (const id of mentions) mustGet(rm, ctx, "members", id, "要 @ 的人");
  const taskId = taskOfFile(rm, file.subjectType, file.subjectId);
  if (input.forReview && !isReviewer(me)) rejectT("forbidden", "pin_review_forbidden");
  if (input.forReview && !taskId) rejectT("invalid", "pin_review_no_task");
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
    cell,
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
  if (pin.replies.length >= 100) rejectT("state", "pin_replies_full");
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
  if (pin.status === "resolved") rejectT("state", "pin_resolved");
  if (!mayResolve(rm, ctx, pin)) rejectT("forbidden", "pin_resolve_forbidden");
  const ch = update("pins", pin, { status: "resolved" });
  return ok(ch ? [ch] : [], { pinId: pin.id });
});

export const reopenPin = guarded<PinIdInput>((rm, input, ctx) => {
  const pin = mustGet(rm, ctx, "pins", input.pinId, "这个钉");
  if (pin.status === "open") rejectT("state", "pin_open");
  if (!mayResolve(rm, ctx, pin)) rejectT("forbidden", "pin_reopen_forbidden");
  const ch = update("pins", pin, { status: "open" });
  return ok(ch ? [ch] : [], { pinId: pin.id });
});
