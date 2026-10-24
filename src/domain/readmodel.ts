/**
 * ReadModel — the only way commands read data.
 *
 * Two query shapes on purpose: `get` by id and `where` by field equality.
 * Both translate directly to SQL, so the Postgres adapter (ARCH-03) can
 * implement this interface without loading a whole world.
 */
import type { Id, Tables, TableName, WorldState } from "./model";

export interface ReadModel {
  /** Row by id, archived rows included (callers decide). */
  get<K extends TableName>(table: K, id: Id): Tables[K] | undefined;
  /** Live (non-archived) rows whose fields equal every value in `match`. */
  where<K extends TableName>(table: K, match?: Partial<Tables[K]>): Tables[K][];
}

export function memoryReadModel(state: WorldState): ReadModel {
  return {
    get<K extends TableName>(table: K, id: Id) {
      return (state[table] as Record<Id, Tables[K]>)[id];
    },
    where<K extends TableName>(table: K, match?: Partial<Tables[K]>) {
      const rows = Object.values(state[table] as Record<Id, Tables[K]>);
      const entries = match ? Object.entries(match) : [];
      return rows.filter((row) => {
        if (row.archivedAt) return false;
        for (const [k, v] of entries) {
          if ((row as unknown as Record<string, unknown>)[k] !== v) return false;
        }
        return true;
      });
    },
  };
}
