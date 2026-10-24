/**
 * 跑一条命令：命令 → 变更集 → apply → 一条日志。
 *
 * 以后接主服务器时，服务器在一个事务里做同样的三步；`replay` 从底（示范数据或空工会）
 * 加上存下来的日志重建世界——浏览器里只存日志，加载时重放；同步也是靠它追上。
 */
import { applyChanges, type ApplyError } from "./apply";
import { worldNow } from "./clock";
import { COMMANDS, type CommandInput, type CommandName } from "./commands";
import type { Ctx, DomainError } from "./commands/core";
import { newId, type IdTable, ID_PREFIX } from "./ids";
import type { Id, IsoDateTime, JournalEntry, JournalSource, WorldState } from "./model";
import { memoryReadModel } from "./readmodel";

export interface Actor {
  worldId: Id;
  /** 这台设备上登录的账号；建工会那一步还没有账号。 */
  accountId: Id | null;
  /** 以哪个成员的身份。 */
  actorMemberId: Id | null;
}

export type DispatchResult =
  | { ok: true; state: WorldState; entry: JournalEntry | null; created: Record<string, Id> }
  | { ok: false; error: DomainError };

export interface DispatchOptions {
  /** 真实时间（默认现在）。 */
  now?: IsoDateTime;
  /** 只给示范数据用：这一步在工会里发生的时间（不看冻结的时钟）。 */
  worldNow?: IsoDateTime;
  /** Inject for deterministic tests / seed. */
  newId?: (table: IdTable) => Id;
  source?: JournalSource;
}

function conflictError(e: ApplyError): DomainError {
  if (e.code === "conflict") {
    return { code: "conflict", message: "别人刚改过这里，请刷新后再试", detail: { ...e } };
  }
  return { code: "state", message: "数据不一致，请刷新后再试", detail: { ...e } };
}

export function lastSeq(state: WorldState): number {
  const j = state.journal;
  return j.length ? j[j.length - 1].seq : 0;
}

export function dispatch<N extends CommandName>(
  state: WorldState,
  actor: Actor,
  name: N,
  input: CommandInput<N>,
  opts: DispatchOptions = {}
): DispatchResult {
  const now = opts.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const makeId = opts.newId ?? ((t: IdTable) => newId(ID_PREFIX[t], Number.isNaN(nowMs) ? undefined : nowMs));
  const world = state.worlds[actor.worldId];
  const ctx: Ctx = { ...actor, now, worldNow: opts.worldNow ?? worldNow(world, now), newId: makeId };
  const command = COMMANDS[name] as unknown as (rm: ReturnType<typeof memoryReadModel>, i: unknown, c: Ctx) => ReturnType<(typeof COMMANDS)[N]>;
  if (!command) return { ok: false, error: { code: "invalid", message: `没有这个操作（${String(name)}）` } };
  const result = command(memoryReadModel(state), input, ctx);
  if (!result.ok) return result;
  if (result.changes.length === 0) return { ok: true, state, entry: null, created: result.created };

  const applied = applyChanges(state, result.changes, now);
  if (!applied.ok) return { ok: false, error: conflictError(applied.error) };

  const entry: JournalEntry = {
    id: makeId("journal"),
    seq: lastSeq(state) + 1,
    worldId: actor.worldId,
    accountId: actor.accountId,
    actorMemberId: actor.actorMemberId,
    command: name,
    payload: input,
    changes: result.changes,
    createdAt: now,
    worldAt: ctx.worldNow,
    source: opts.source ?? "manual",
    ...(Object.keys(result.created).length ? { created: result.created } : {}),
  };
  const journal = state.journal.slice();
  journal.push(entry);
  return { ok: true, state: { ...applied.state, journal }, entry, created: result.created };
}

export interface ReplayReport {
  state: WorldState;
  applied: number;
  /** Entries that no longer apply (the base changed underneath them). */
  skipped: { seq: number; command: string; reason: string }[];
}

/**
 * Re-apply journal entries (in seq order) on top of a base state. The caller
 * passes only entries the base does not contain yet. Entries that no longer
 * apply are skipped and reported instead of breaking the load; applied
 * entries are renumbered after the base's last seq.
 */
export function replay(base: WorldState, entries: JournalEntry[], worldId?: Id): ReplayReport {
  let state = base;
  let applied = 0;
  const skipped: ReplayReport["skipped"] = [];
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  // 日志只在最后拼一次：中间的 state.journal 一直是 base 的；applyChanges 不读日志。
  const journal = [...base.journal];
  let seq = lastSeq(base);
  for (const e of sorted) {
    if (worldId && e.worldId !== worldId) {
      skipped.push({ seq: e.seq, command: e.command, reason: "other_world" });
      continue;
    }
    const r = applyChanges(state, e.changes, e.createdAt, { checkPrev: true });
    if (!r.ok) {
      skipped.push({ seq: e.seq, command: e.command, reason: r.error.code });
      continue;
    }
    seq += 1;
    journal.push({ ...e, seq });
    state = r.state;
    applied += 1;
  }
  return { state: { ...state, journal }, applied, skipped };
}
