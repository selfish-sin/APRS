/**
 * 命令层的积木。
 *
 * 命令是纯函数 `(ReadModel, input, Ctx) → Result`：只通过 `rm.get` / `rm.where` 读，
 * 只返回变更集，不碰存储。被拒时返回中文的 `error.message`，页面原样显示。
 */
import { ID_PREFIX, type IdTable } from "../ids";
import type { Change, Id, IsoDateTime, MemberRow, Patch, RowHeader, TableName, Tables } from "../model";
import type { ReadModel } from "../readmodel";

export interface Ctx {
  worldId: Id;
  /** 这台设备上登录的账号（建工会那一步还没有）。 */
  accountId: Id | null;
  /** 以哪个成员的身份。 */
  actorMemberId: Id | null;
  /** Real time — stamps rows and the journal. */
  now: IsoDateTime;
  /** World (guild) time — for business rules such as deadlines; may be frozen (worlds.rules.clock). */
  worldNow: IsoDateTime;
  newId: (table: IdTable) => Id;
}

/** Compare two ISO date-times as instants (offsets such as +08:00 are honoured). */
export function isBefore(a: IsoDateTime, b: IsoDateTime): boolean {
  return Date.parse(a) < Date.parse(b);
}

export type DomainErrorCode = "not_found" | "forbidden" | "invalid" | "state" | "conflict";

export interface DomainError {
  code: DomainErrorCode;
  /** Short, user-facing (Chinese) message. */
  message: string;
  detail?: Record<string, unknown>;
}

export type Result =
  | { ok: true; changes: Change[]; created: Record<string, Id> }
  | { ok: false; error: DomainError };

export type Command<I> = (rm: ReadModel, input: I, ctx: Ctx) => Result;

export function fail(code: DomainErrorCode, message: string, detail?: Record<string, unknown>): Result {
  return { ok: false, error: { code, message, detail } };
}

export function ok(changes: Change[], created: Record<string, Id> = {}): Result {
  return { ok: true, changes, created };
}

/** Thrown inside a command body to abort with a DomainError; see `guarded`. */
export class DomainFailure extends Error {
  constructor(public readonly error: DomainError) {
    super(error.message);
  }
}

export function reject(code: DomainErrorCode, message: string, detail?: Record<string, unknown>): never {
  throw new DomainFailure({ code, message, detail });
}

/** Lets command bodies use `reject(...)` / `must...` helpers instead of threading Results. */
export function guarded<I>(body: (rm: ReadModel, input: I, ctx: Ctx) => Result): Command<I> {
  return (rm, input, ctx) => {
    try {
      return body(rm, input, ctx);
    } catch (e) {
      if (e instanceof DomainFailure) return { ok: false, error: e.error };
      throw e;
    }
  };
}

// ---------------------------------------------------------------------------
// Change builders
// ---------------------------------------------------------------------------

type Body<K extends TableName> = Omit<Tables[K], keyof RowHeader>;

/** Build a full row (header filled from ctx) and its insert change. */
export function insert<K extends TableName>(
  ctx: Ctx,
  table: K,
  body: Body<K>,
  id?: Id
): { row: Tables[K]; change: Change } {
  const header: RowHeader = {
    id: id ?? ctx.newId(table as IdTable),
    worldId: ctx.worldId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    version: 1,
    archivedAt: null,
  };
  const row = { ...header, ...body } as Tables[K];
  return { row, change: { op: "insert", table, row } as Change };
}

/** Update change with `prev` captured from the current row. Returns null when nothing changes. */
export function update<K extends TableName>(
  table: K,
  current: Tables[K],
  patch: Patch<Tables[K]>,
  expectVersion?: number
): Change | null {
  const prev: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  const cur = current as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (JSON.stringify(cur[k]) === JSON.stringify(v)) continue;
    prev[k] = cur[k] ?? null;
    next[k] = v;
  }
  if (Object.keys(next).length === 0) return null;
  return {
    op: "update",
    table,
    id: current.id,
    patch: next,
    prev,
    expectVersion: expectVersion ?? current.version,
  } as Change;
}

export function archive<K extends TableName>(table: K, current: Tables[K], expectVersion?: number): Change {
  return { op: "archive", table, id: current.id, expectVersion: expectVersion ?? current.version } as Change;
}

export function compact(changes: (Change | null | undefined)[]): Change[] {
  return changes.filter((c): c is Change => !!c);
}

// ---------------------------------------------------------------------------
// Lookups & guards
// ---------------------------------------------------------------------------

/** Live row in this world, or reject with not_found. */
export function mustGet<K extends TableName>(rm: ReadModel, ctx: Ctx, table: K, id: Id | null | undefined, what: string): Tables[K] {
  const row = id ? rm.get(table, id) : undefined;
  if (!row || row.archivedAt || (table !== "accounts" && row.worldId !== ctx.worldId)) {
    reject("not_found", `找不到${what}`, { table, id });
  }
  return row;
}

export function mustBeOneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    reject("invalid", `${what}不在可选范围内`, { value, allowed });
  }
  return value as T;
}

export function mustText(value: unknown, what: string, max = 200): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) reject("invalid", `${what}不能为空`);
  if (s.length > max) reject("invalid", `${what}太长了（最多 ${max} 字）`);
  return s;
}

export function optText(value: unknown, max = 2000): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > max) reject("invalid", `内容太长了（最多 ${max} 字）`);
  return s;
}

/** A web address (http / https only, ≤ 500 chars) or null. */
export function optUrl(value: unknown, what: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const s = typeof value === "string" ? value.trim() : "";
  if (!/^https?:\/\/[^\s/?#]+/i.test(s)) reject("invalid", `${what}要以 http:// 或 https:// 开头`);
  if (s.length > 500) reject("invalid", `${what}太长了（最多 500 字）`);
  return s;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function optDate(value: unknown, what: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE_RE.test(value)) reject("invalid", `${what}的日期格式不对（YYYY-MM-DD）`);
  return value;
}

/** A date (YYYY-MM-DD, all day) or an ISO date-time — the two shapes `events.startAt / endAt` hold. */
export function optWhen(value: unknown, what: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && DATE_RE.test(value)) return value;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) reject("invalid", `${what}的时间格式不对`);
  return value;
}

/** Milliseconds of a date or date-time (a bare date counts from 00:00 in UTC+8). */
export function whenMs(value: string): number {
  return Date.parse(DATE_RE.test(value) ? `${value}T00:00:00+08:00` : value);
}

export function optNumber(value: unknown, what: string, min = 0, max = 1e6): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) reject("invalid", `${what}要填 ${min}–${max} 之间的数字`);
  return n;
}

export function optDateTime(value: unknown, what: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) reject("invalid", `${what}的时间格式不对`);
  return value;
}

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:"]);

/** Any absolute link (https, weixin:// …) except schemes that run code or read local files. */
export function mustUrl(value: unknown): string {
  const s = mustText(value, "链接", 2000);
  let protocol = "";
  try {
    protocol = new URL(s).protocol.toLowerCase();
  } catch {
    reject("invalid", "这不像一个链接（需要完整地址，例如 https://…）");
  }
  if (BLOCKED_SCHEMES.has(protocol)) reject("invalid", "不支持这种链接");
  return s;
}

// ---------------------------------------------------------------------------
// 权限（SPEC §2）：管理员 · 审核员 · 成员
// ---------------------------------------------------------------------------

/** 现在操作的成员（并核对：登录的账号就是这个成员的）。 */
export function mustMember(rm: ReadModel, ctx: Ctx): MemberRow {
  if (!ctx.actorMemberId) reject("forbidden", "请先登录");
  const member = rm.get("members", ctx.actorMemberId);
  if (!member || member.archivedAt || member.worldId !== ctx.worldId) reject("forbidden", "找不到你在这个工会里的成员资料，请重新登录");
  if (ctx.accountId) {
    const account = rm.get("accounts", ctx.accountId);
    if (!account || account.archivedAt || account.memberId !== member.id) reject("forbidden", "登录的账号和成员对不上，请重新登录");
  }
  return member;
}

export function isAdmin(member: MemberRow | undefined | null): boolean {
  return member?.role === "admin";
}

/** 审核员和管理员都能审核。 */
export function isReviewer(member: MemberRow | undefined | null): boolean {
  return member?.role === "admin" || member?.role === "reviewer";
}

export function mustAdmin(rm: ReadModel, ctx: Ctx, what = "这一步"): MemberRow {
  const m = mustMember(rm, ctx);
  if (!isAdmin(m)) reject("forbidden", `只有管理员可以${what}`);
  return m;
}

export function optInteger(value: unknown, what: string, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) reject("invalid", `${what}要填 ${min}–${max} 之间的整数`);
  return n;
}

export function mustNumber(value: unknown, what: string, min: number, max: number): number {
  const n = optNumber(value, what, min, max);
  if (n === null) reject("invalid", `${what}不能为空`);
  return n;
}

/** 四舍五入到一位小数（活力点、小时）。 */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export { ID_PREFIX };
