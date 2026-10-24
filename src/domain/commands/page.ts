/**
 * 资料页和块（SPEC §11.5）：像 Notion，但以图为主。
 *   page.create · page.rename · page.archive · block.add · block.update · block.move · block.remove
 * 块的内容存在日志里；图片块只存文件 id（文件本身在 IndexedDB）。
 */
import { BLOCK_TYPE, type BlockRow, type BlockType, type ChecklistItem, type Id } from "../model";
import type { ReadModel } from "../readmodel";
import { guarded, insert, isReviewer, mustBeOneOf, mustGet, mustMember, mustText, ok, reject, update, type Ctx } from "./core";

const MAX_TEXT = 4000;
const MAX_ITEMS = 50;
const MAX_FILES = 12;

export interface CreatePageInput {
  projectId: Id;
  title: string;
}

export const createPage = guarded<CreatePageInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const project = mustGet(rm, ctx, "projects", input.projectId, "项目");
  const title = mustText(input.title, "页面标题", 40);
  const p = insert(ctx, "pages", { projectId: project.id, title, byMemberId: me.id, at: ctx.worldNow });
  return ok([p.change], { pageId: p.row.id });
});

function mustEditPage(rm: ReadModel, ctx: Ctx, pageId: Id) {
  mustMember(rm, ctx);
  return mustGet(rm, ctx, "pages", pageId, "资料页");
}

export interface RenamePageInput {
  pageId: Id;
  title: string;
}

export const renamePage = guarded<RenamePageInput>((rm, input, ctx) => {
  const page = mustEditPage(rm, ctx, input.pageId);
  const ch = update("pages", page, { title: mustText(input.title, "页面标题", 40) });
  return ok(ch ? [ch] : [], { pageId: page.id });
});

export interface ArchivePageInput {
  pageId: Id;
}

/** 删页：建的人、审核员或管理员。 */
export const archivePage = guarded<ArchivePageInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const page = mustGet(rm, ctx, "pages", input.pageId, "资料页");
  if (page.byMemberId !== me.id && !isReviewer(me)) reject("forbidden", "只有建这页的人、审核员或管理员可以删这页");
  return ok([{ op: "archive", table: "pages", id: page.id, expectVersion: page.version }], { pageId: page.id });
});

function mustFiles(rm: ReadModel, ctx: Ctx, projectId: Id, value: unknown, type: BlockType): Id[] {
  const ids = Array.from(new Set(Array.isArray(value) ? (value as Id[]) : []));
  if (ids.length > MAX_FILES) reject("invalid", `一个块最多放 ${MAX_FILES} 个文件`);
  for (const id of ids) {
    const f = mustGet(rm, ctx, "files", id, "文件");
    if (f.projectId !== projectId) reject("invalid", "只能放这个项目资料库里的文件");
    if ((type === "image" || type === "gallery") && !f.width) reject("invalid", `「${f.name}」不是图片，放到文件块里`);
  }
  if (type === "image" && ids.length > 1) reject("invalid", "单张图片块只放一张；多张用图片网格");
  if ((type === "image" || type === "file") && ids.length === 0) reject("invalid", "先选一个文件");
  if (type === "gallery" && ids.length === 0) reject("invalid", "图片网格至少放一张图");
  return ids;
}

function mustItems(value: unknown): ChecklistItem[] {
  const list = Array.isArray(value) ? value : [];
  if (list.length > MAX_ITEMS) reject("invalid", `清单最多 ${MAX_ITEMS} 条`);
  return list.map((it, i) => {
    const text = typeof it?.text === "string" ? it.text.trim() : "";
    if (text.length > 300) reject("invalid", `清单第 ${i + 1} 条太长了`);
    return { text, done: !!it?.done };
  });
}

function mustBlockText(type: BlockType, value: unknown): string | null {
  if (type !== "heading" && type !== "text") return null;
  const s = typeof value === "string" ? value : "";
  if (type === "heading" && s.length > 120) reject("invalid", "标题太长了（最多 120 字）");
  if (s.length > MAX_TEXT) reject("invalid", `段落太长了（最多 ${MAX_TEXT} 字）`);
  return s;
}

function blocksOfPage(rm: ReadModel, pageId: Id): BlockRow[] {
  return rm.where("blocks", { pageId }).sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
}

export interface AddBlockInput {
  pageId: Id;
  type: BlockType;
  text?: string | null;
  fileIds?: Id[];
  items?: ChecklistItem[];
  /** 放在哪一块后面（不写 = 放在最后）。 */
  afterBlockId?: Id | null;
}

export const addBlock = guarded<AddBlockInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const page = mustEditPage(rm, ctx, input.pageId);
  const type = mustBeOneOf(input.type, BLOCK_TYPE, "块的类型");
  const list = blocksOfPage(rm, page.id);
  if (list.length >= 300) reject("state", "这一页的块太多了，另开一页吧");
  let sort = (list.length ? list[list.length - 1].sort : 0) + 1;
  if (input.afterBlockId) {
    const i = list.findIndex((b) => b.id === input.afterBlockId);
    if (i < 0) reject("not_found", "找不到要放在它后面的块");
    sort = i === list.length - 1 ? list[i].sort + 1 : (list[i].sort + list[i + 1].sort) / 2;
  }
  const b = insert(ctx, "blocks", {
    pageId: page.id,
    type,
    text: mustBlockText(type, input.text),
    fileIds: type === "image" || type === "gallery" || type === "file" ? mustFiles(rm, ctx, page.projectId, input.fileIds, type) : [],
    items: type === "checklist" ? mustItems(input.items ?? [{ text: "", done: false }]) : [],
    sort,
    byMemberId: me.id,
  });
  return ok([b.change], { blockId: b.row.id });
});

export interface UpdateBlockInput {
  blockId: Id;
  text?: string | null;
  fileIds?: Id[];
  items?: ChecklistItem[];
}

export const updateBlock = guarded<UpdateBlockInput>((rm, input, ctx) => {
  mustMember(rm, ctx);
  const block = mustGet(rm, ctx, "blocks", input.blockId, "块");
  const page = mustGet(rm, ctx, "pages", block.pageId, "资料页");
  const patch: Partial<BlockRow> = {};
  if (input.text !== undefined) {
    if (block.type !== "heading" && block.type !== "text") reject("invalid", "这种块没有字可以改");
    patch.text = mustBlockText(block.type, input.text);
  }
  if (input.fileIds !== undefined) {
    if (block.type !== "image" && block.type !== "gallery" && block.type !== "file") reject("invalid", "这种块不放文件");
    patch.fileIds = mustFiles(rm, ctx, page.projectId, input.fileIds, block.type);
  }
  if (input.items !== undefined) {
    if (block.type !== "checklist") reject("invalid", "只有清单块有清单");
    patch.items = mustItems(input.items);
  }
  const ch = update("blocks", block, patch);
  return ok(ch ? [ch] : [], { blockId: block.id });
});

export interface MoveBlockInput {
  blockId: Id;
  direction: "up" | "down";
}

/** 上下移动一格：和旁边那块换位置。 */
export const moveBlock = guarded<MoveBlockInput>((rm, input, ctx) => {
  mustMember(rm, ctx);
  const block = mustGet(rm, ctx, "blocks", input.blockId, "块");
  const direction = mustBeOneOf(input.direction, ["up", "down"] as const, "往哪移");
  const list = blocksOfPage(rm, block.pageId);
  const i = list.findIndex((b) => b.id === block.id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0) reject("state", "已经在最上面了");
  if (j >= list.length) reject("state", "已经在最下面了");
  const other = list[j];
  // 两块的顺序号一样时（以前插的），给出一个确定的新顺序。
  const a = other.sort === block.sort ? (direction === "up" ? block.sort - 0.5 : block.sort + 0.5) : other.sort;
  const changes = [update("blocks", block, { sort: a }), update("blocks", other, { sort: block.sort })].filter((c): c is NonNullable<typeof c> => !!c);
  return ok(changes, { blockId: block.id });
});

export interface RemoveBlockInput {
  blockId: Id;
}

/** 删块（资料页大家一起写，谁都能删；日志里还留着）。 */
export const removeBlock = guarded<RemoveBlockInput>((rm, input, ctx) => {
  mustMember(rm, ctx);
  const block = mustGet(rm, ctx, "blocks", input.blockId, "块");
  mustGet(rm, ctx, "pages", block.pageId, "资料页");
  return ok([{ op: "archive", table: "blocks", id: block.id, expectVersion: block.version }], { blockId: block.id });
});
