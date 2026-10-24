/**
 * 交成果时挂的链接（SPEC §15.1）：
 *   - mustLinks：交一版时的格式检查（只收 http / https · 去掉前后空格和中文标点 · 同一版里重复的拒）
 *   - link.mark_broken：审核员点开以后标「打不开」（交的人在「等我处理」里看到）
 *   - link.replace：交的人换一条，「打不开」清掉
 */
import { LINK_KINDS, LINK_REASON, defaultLinkName, linkKey, normalizeLink, recognizeLink, type LinkKind } from "../links";
import type { Id, SubmissionLink } from "../model";
import { guarded, isAdmin, isReviewer, mustGet, mustMember, ok, reject, update } from "./core";

export const MAX_LINKS = 10;

function cleanName(value: unknown, fallback: string): string {
  const s = typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
  if (s.length > 60) reject("invalid", "链接的名字太长了（最多 60 字）");
  return s || fallback;
}

function mustOne(raw: { url?: unknown; name?: unknown; kind?: unknown }, n: number): Omit<SubmissionLink, "id" | "broken"> {
  const r = normalizeLink(raw.url);
  if (!r.ok) reject("invalid", `第 ${n} 条链接：${LINK_REASON[r.reason].zh}`);
  if (r.url.length > 1000) reject("invalid", `第 ${n} 条链接太长了`);
  const info = recognizeLink(r.url);
  const kind = raw.kind && (LINK_KINDS as readonly string[]).includes(String(raw.kind)) ? (raw.kind as LinkKind) : info.kind;
  return { url: r.url, name: cleanName(raw.name, defaultLinkName(info)), kind };
}

/** 交一版时挂的几条链接：空的跳过；格式不对、同一版里重复的都拒（中文原因带第几条）。 */
export function mustLinks(value: unknown): SubmissionLink[] {
  const list = Array.isArray(value) ? value : [];
  const out: SubmissionLink[] = [];
  const seen = new Map<string, number>();
  list.forEach((raw, i) => {
    const r = raw as { url?: unknown; name?: unknown; kind?: unknown };
    if (typeof r?.url !== "string" || !r.url.trim()) return;
    const one = mustOne(r, i + 1);
    const key = linkKey(one.url);
    const dup = seen.get(key);
    if (dup !== undefined) reject("invalid", `第 ${i + 1} 条和第 ${dup} 条是同一个链接`);
    seen.set(key, i + 1);
    out.push({ id: `l${out.length + 1}`, ...one, broken: null });
  });
  if (out.length > MAX_LINKS) reject("invalid", `一版最多挂 ${MAX_LINKS} 条链接`);
  return out;
}

/** 旧的记录只有 link：当成一条。 */
export function linksOf(sub: { link: string | null; links?: SubmissionLink[] }): SubmissionLink[] {
  if (sub.links && sub.links.length) return sub.links;
  if (!sub.link) return [];
  const info = recognizeLink(sub.link);
  return [{ id: "l1", url: sub.link, name: defaultLinkName(info), kind: info.kind, broken: null }];
}

export interface MarkBrokenInput {
  submissionId: Id;
  linkId: string;
}

export const markLinkBroken = guarded<MarkBrokenInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  if (!isReviewer(me)) reject("forbidden", "只有审核员和管理员能标「打不开」");
  const sub = mustGet(rm, ctx, "submissions", input.submissionId, "版本");
  const links = linksOf(sub);
  const i = links.findIndex((l) => l.id === input.linkId);
  if (i < 0) reject("not_found", "这一版没有这条链接");
  if (links[i].broken) reject("state", "这条已经标过「打不开」了");
  const next = links.map((l, j) => (j === i ? { ...l, broken: { byMemberId: me.id, at: ctx.worldNow } } : l));
  const c = update("submissions", sub, { links: next });
  return ok(c ? [c] : [], { submissionId: sub.id });
});

export interface ReplaceLinkInput {
  submissionId: Id;
  linkId: string;
  url: string;
  name?: string | null;
  kind?: LinkKind | null;
}

/** 交的人换一条（「打不开」清掉）。管理员也能替他换。 */
export const replaceLink = guarded<ReplaceLinkInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const sub = mustGet(rm, ctx, "submissions", input.submissionId, "版本");
  const task = mustGet(rm, ctx, "tasks", sub.taskId, "任务");
  const mine = sub.byMemberId === me.id || (task.assigneeId === me.id && !sub.byMemberId);
  if (!mine && !isAdmin(me)) reject("forbidden", "只有交这一版的人能换链接");
  const links = linksOf(sub);
  const i = links.findIndex((l) => l.id === input.linkId);
  if (i < 0) reject("not_found", "这一版没有这条链接");
  const one = mustOne({ url: input.url, name: input.name, kind: input.kind ?? links[i].kind }, i + 1);
  const key = linkKey(one.url);
  const dup = links.findIndex((l, j) => j !== i && linkKey(l.url) === key);
  if (dup >= 0) reject("invalid", `和第 ${dup + 1} 条是同一个链接`);
  const next = links.map((l, j) => (j === i ? { ...l, ...one, name: input.name ? one.name : one.name, broken: null } : l));
  const c = update("submissions", sub, { links: next, link: next[0]?.url ?? null });
  return ok(c ? [c] : [], { submissionId: sub.id });
});
