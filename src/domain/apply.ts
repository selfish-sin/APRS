/**
 * Apply a change set to in-memory state (localStorage adapter).
 *
 * All-or-nothing: either every change applies or the state is returned
 * untouched with the first error. Version checks here are the same rule the
 * Postgres adapter enforces with `WHERE version = $expect`.
 */
import type { Change, Id, IsoDateTime, TableName, WorldState } from "./model";

export type ApplyError =
  | { code: "duplicate"; table: TableName; id: Id }
  | { code: "not_found"; table: TableName; id: Id }
  | { code: "conflict"; table: TableName; id: Id; expected: number; actual: number }
  /** Replay only: the row's current values differ from what the change was computed against. */
  | { code: "prev_mismatch"; table: TableName; id: Id; field: string };

export type ApplyResult = { ok: true; state: WorldState } | { ok: false; error: ApplyError };

const FORBIDDEN_PATCH_KEYS = ["id", "worldId", "createdAt", "updatedAt", "version", "archivedAt"];

export interface ApplyOptions {
  /**
   * Also require each update's `prev` values to match the current row.
   * Used by replay: a stored entry must not land on a row that only happens
   * to share an id and version with the one it was written against.
   */
  checkPrev?: boolean;
}

export function applyChanges(state: WorldState, changes: Change[], at: IsoDateTime, opts: ApplyOptions = {}): ApplyResult {
  // Copy-on-write per touched table.
  const next: WorldState = { ...state };
  const copied = new Set<TableName>();
  const tableFor = (t: TableName) => {
    if (!copied.has(t)) {
      (next as unknown as Record<string, unknown>)[t] = { ...state[t] };
      copied.add(t);
    }
    return next[t] as unknown as Record<Id, Record<string, unknown>>;
  };

  for (const ch of changes) {
    const rows = tableFor(ch.table);
    if (ch.op === "insert") {
      if (rows[ch.row.id]) return { ok: false, error: { code: "duplicate", table: ch.table, id: ch.row.id } };
      rows[ch.row.id] = { ...(ch.row as unknown as Record<string, unknown>) };
      continue;
    }
    const cur = rows[ch.id] as { version: number } | undefined;
    if (!cur) return { ok: false, error: { code: "not_found", table: ch.table, id: ch.id } };
    if (cur.version !== ch.expectVersion) {
      return {
        ok: false,
        error: { code: "conflict", table: ch.table, id: ch.id, expected: ch.expectVersion, actual: cur.version },
      };
    }
    if (ch.op === "update" && opts.checkPrev) {
      const row = cur as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(ch.prev as Record<string, unknown>)) {
        if (JSON.stringify(row[k] ?? null) !== JSON.stringify(v ?? null)) {
          return { ok: false, error: { code: "prev_mismatch", table: ch.table, id: ch.id, field: k } };
        }
      }
    }
    if (ch.op === "update") {
      const patch: Record<string, unknown> = { ...(ch.patch as Record<string, unknown>) };
      for (const k of FORBIDDEN_PATCH_KEYS) delete patch[k];
      rows[ch.id] = { ...cur, ...patch, updatedAt: at, version: cur.version + 1 };
    } else {
      rows[ch.id] = { ...cur, archivedAt: at, updatedAt: at, version: cur.version + 1 };
    }
  }
  return { ok: true, state: next };
}
