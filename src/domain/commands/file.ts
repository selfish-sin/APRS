/**
 * 资料库的文件（SPEC §11.1）：文件本身在 IndexedDB，这里只记信息。
 *   file.add · file.rename · file.tag · file.move（换挂的地方）· file.archive
 */
import { FILE_SUBJECT, type FileSubject, type Id } from "../model";
import type { ReadModel } from "../readmodel";
import { guarded, insert, isReviewer, mustBeOneOf, mustGet, mustMember, ok, reject, update, type Ctx } from "./core";
import { optFileName } from "./validate";

/** 缩略图最多 20KB（dataURL 里的 base64 大概 27 300 个字）。 */
export const THUMB_MAX_CHARS = 27_400;
export const MAX_TAGS = 8;
/** 一个文件最大 2GB（浏览器里存得下的话）。 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export interface Placement {
  projectId: Id;
  cutId: Id | null;
  stageKey: string | null;
}

/** 文件挂在哪：要在这个工会里，并带出项目、卡、环节。 */
export function placementOf(rm: ReadModel, ctx: Ctx, type: FileSubject, id: Id): Placement {
  switch (type) {
    case "project": {
      const p = mustGet(rm, ctx, "projects", id, "项目");
      return { projectId: p.id, cutId: null, stageKey: null };
    }
    case "cut": {
      const c = mustGet(rm, ctx, "cuts", id, "卡");
      return { projectId: c.projectId, cutId: c.id, stageKey: null };
    }
    case "task": {
      const t = mustGet(rm, ctx, "tasks", id, "任务");
      const s = mustGet(rm, ctx, "stages", t.stageId, "环节");
      return { projectId: t.projectId, cutId: t.cutId, stageKey: s.templateKey };
    }
    case "submission": {
      const sub = mustGet(rm, ctx, "submissions", id, "版本");
      return placementOf(rm, ctx, "task", sub.taskId);
    }
    case "page": {
      const pg = mustGet(rm, ctx, "pages", id, "资料页");
      return { projectId: pg.projectId, cutId: null, stageKey: null };
    }
    case "thread": {
      const th = mustGet(rm, ctx, "threads", id, "意见");
      return { projectId: th.projectId, cutId: th.cutId, stageKey: th.stageKey };
    }
  }
}

function mustTags(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const raw of list) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t) continue;
    if (t.length > 12) reject("invalid", `标签「${t.slice(0, 12)}…」太长了（最多 12 个字）`);
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > MAX_TAGS) reject("invalid", `标签最多 ${MAX_TAGS} 个`);
  return out;
}

function mustName(value: unknown): string {
  const name = optFileName(value);
  if (!name) reject("invalid", "文件名不能为空");
  return name;
}

export interface AddFileInput {
  sha256: string;
  name: string;
  mime?: string;
  size: number;
  width?: number | null;
  height?: number | null;
  thumb?: string | null;
  subjectType: FileSubject;
  subjectId: Id;
  tags?: string[];
  /** 放进资料库时可以顺手说是哪个环节的。 */
  stageKey?: string | null;
}

export const addFile = guarded<AddFileInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const sha256 = typeof input.sha256 === "string" ? input.sha256.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(sha256)) reject("invalid", "文件没有读好，请重新放一次");
  const name = mustName(input.name);
  const mime = typeof input.mime === "string" && input.mime.length <= 100 ? input.mime : "";
  const size = Number(input.size);
  if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_BYTES) reject("invalid", "文件太大了（最大 2GB）");
  const dim = (v: unknown) => (v === undefined || v === null ? null : Number.isInteger(v) && (v as number) > 0 && (v as number) <= 100_000 ? (v as number) : reject("invalid", "图片的宽高不对"));
  const width = dim(input.width);
  const height = dim(input.height);
  let thumb: string | null = null;
  if (input.thumb) {
    if (typeof input.thumb !== "string" || !/^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/.test(input.thumb)) reject("invalid", "缩略图不是图片");
    if (input.thumb.length > THUMB_MAX_CHARS) reject("invalid", "缩略图太大了（最多 20KB）");
    thumb = input.thumb;
  }
  const subjectType = mustBeOneOf(input.subjectType, FILE_SUBJECT, "挂在哪");
  const place = placementOf(rm, ctx, subjectType, input.subjectId);
  let stageKey = place.stageKey;
  if (input.stageKey) {
    const ok = rm.where("stages", { projectId: place.projectId }).some((s) => s.templateKey === input.stageKey);
    if (!ok) reject("invalid", "这个环节不在这个项目的流程里");
    stageKey = input.stageKey;
  }
  const f = insert(ctx, "files", {
    sha256,
    name,
    mime,
    size,
    width,
    height,
    thumb,
    subjectType,
    subjectId: input.subjectId,
    projectId: place.projectId,
    cutId: place.cutId,
    stageKey,
    tags: mustTags(input.tags),
    byMemberId: me.id,
    at: ctx.worldNow,
  });
  return ok([f.change], { fileId: f.row.id });
});

function mustEditable(rm: ReadModel, ctx: Ctx, fileId: Id) {
  const me = mustMember(rm, ctx);
  const f = mustGet(rm, ctx, "files", fileId, "文件");
  if (f.byMemberId !== me.id && !isReviewer(me)) reject("forbidden", "只有传的人、审核员或管理员可以改这个文件");
  return f;
}

export interface RenameFileInput {
  fileId: Id;
  name: string;
}

export const renameFile = guarded<RenameFileInput>((rm, input, ctx) => {
  const f = mustEditable(rm, ctx, input.fileId);
  const ch = update("files", f, { name: mustName(input.name) });
  return ok(ch ? [ch] : [], { fileId: f.id });
});

export interface TagFileInput {
  fileId: Id;
  tags: string[];
}

export const tagFile = guarded<TagFileInput>((rm, input, ctx) => {
  const f = mustEditable(rm, ctx, input.fileId);
  const ch = update("files", f, { tags: mustTags(input.tags) });
  return ok(ch ? [ch] : [], { fileId: f.id });
});

export interface MoveFileInput {
  fileId: Id;
  subjectType: FileSubject;
  subjectId: Id;
}

/** 换挂的地方（只能在同一个项目里挪）。 */
export const moveFile = guarded<MoveFileInput>((rm, input, ctx) => {
  const f = mustEditable(rm, ctx, input.fileId);
  const subjectType = mustBeOneOf(input.subjectType, FILE_SUBJECT, "挂在哪");
  const place = placementOf(rm, ctx, subjectType, input.subjectId);
  if (place.projectId !== f.projectId) reject("invalid", "文件只能在同一个项目里挪");
  const ch = update("files", f, { subjectType, subjectId: input.subjectId, cutId: place.cutId, stageKey: place.stageKey ?? f.stageKey });
  const changes = ch ? [ch] : [];
  // 钉跟着图走：卡变了，钉上记的卡也跟着改。
  for (const p of rm.where("pins", { fileId: f.id })) {
    const c = update("pins", p, { cutId: place.cutId });
    if (c) changes.push(c);
  }
  return ok(changes, { fileId: f.id });
});

export interface ArchiveFileInput {
  fileId: Id;
}

/** 从资料库里拿掉（记录还在日志里；文件本身留在这台设备上，别的地方还可能用到）。 */
export const archiveFile = guarded<ArchiveFileInput>((rm, input, ctx) => {
  const f = mustEditable(rm, ctx, input.fileId);
  const used = rm.where("blocks").some((b) => b.fileIds.includes(f.id));
  if (used) reject("state", "这个文件还在资料页里用着，先把那个块删掉");
  return ok([{ op: "archive", table: "files", id: f.id, expectVersion: f.version }], { fileId: f.id });
});
