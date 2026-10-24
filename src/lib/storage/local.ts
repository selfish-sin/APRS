/**
 * 每个工会一个键的浏览器存储。
 *
 * 都是对 `StorageLike` 的纯函数，store 只是薄薄一层；这里用 MemoryStorage 测。
 * 布局见 keys.ts；形状：WorldFile（migrations/index.ts）、WorldIndex 在下面。
 */
import type { Id, IsoDateTime, JournalEntry } from "@/domain/model";
import { WORLD_FORMAT, WORLD_FORMAT_VERSION, migrateWorldFile, type WorldBase, type WorldFile } from "@/lib/migrations";
import type { Session } from "@/lib/session";
import { WORLDS_KEY, worldBackupKey, worldKey, type StorageLike } from "./keys";

export interface WorldIndexEntry {
  id: Id;
  title: string;
  /** demo = 示范工会（底在代码里）· own = 自己建的（底是空的）。 */
  kind: WorldBase;
  lastOpenedAt?: IsoDateTime;
  lastBackupAt?: IsoDateTime | null;
  /** Steps after the base at last save — for the list, not authoritative. */
  steps?: number;
}

export interface WorldIndex {
  schema: 1;
  currentWorldId: Id | null;
  worlds: WorldIndexEntry[];
  /** When the 70 % usage notice was last shown (reset once usage drops again). */
  usageWarnedAt?: IsoDateTime | null;
  /** When the backup reminder was last shown. */
  backupRemindedAt?: IsoDateTime | null;
  /** Result of navigator.storage.persist(), if the browser answered. */
  persisted?: boolean | null;
  /** How many skipped entries the user has already been told about, per world. */
  skippedSeen?: Record<Id, number>;
}

function readJson(storage: StorageLike, key: string): unknown {
  const raw = storage.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// --- world index -----------------------------------------------------------

export function readIndex(storage: StorageLike): WorldIndex {
  const raw = readJson(storage, WORLDS_KEY);
  if (!isRecord(raw) || raw.schema !== 1 || !Array.isArray(raw.worlds)) {
    return { schema: 1, currentWorldId: null, worlds: [] };
  }
  const worlds = raw.worlds.filter(
    (w): w is WorldIndexEntry => isRecord(w) && typeof w.id === "string" && typeof w.title === "string" && (w.kind === "demo" || w.kind === "empty")
  );
  return {
    schema: 1,
    currentWorldId: typeof raw.currentWorldId === "string" ? raw.currentWorldId : null,
    worlds,
    ...(typeof raw.usageWarnedAt === "string" || raw.usageWarnedAt === null ? { usageWarnedAt: raw.usageWarnedAt } : {}),
    ...(typeof raw.backupRemindedAt === "string" || raw.backupRemindedAt === null ? { backupRemindedAt: raw.backupRemindedAt } : {}),
    ...(typeof raw.persisted === "boolean" ? { persisted: raw.persisted } : {}),
    ...(isRecord(raw.skippedSeen) ? { skippedSeen: raw.skippedSeen as Record<Id, number> } : {}),
  };
}

export function writeIndex(storage: StorageLike, index: WorldIndex): void {
  storage.setItem(WORLDS_KEY, JSON.stringify(index));
}

/** Insert or update one world's row; other rows untouched. */
export function upsertIndexEntry(index: WorldIndex, entry: WorldIndexEntry): WorldIndex {
  const worlds = index.worlds.some((w) => w.id === entry.id)
    ? index.worlds.map((w) => (w.id === entry.id ? { ...w, ...entry } : w))
    : [...index.worlds, entry];
  return { ...index, worlds };
}

export function indexEntry(index: WorldIndex, worldId: Id): WorldIndexEntry | undefined {
  return index.worlds.find((w) => w.id === worldId);
}

/** 把「现在打开的工会」记下来（null = 回到进门）。 */
export function setCurrentWorld(storage: StorageLike, worldId: Id | null): void {
  try {
    writeIndex(storage, { ...readIndex(storage), currentWorldId: worldId });
  } catch {
    /* 下一次存的时候会再写 */
  }
}

// --- one world -------------------------------------------------------------

export type ReadWorldResult = { ok: true; file: WorldFile; from: string } | { ok: false; reason: "missing" | string };

/** The stored world under its key, upgraded to the current envelope. `missing` = never saved here. */
export function readWorld(storage: StorageLike, worldId: Id): ReadWorldResult {
  const raw = readJson(storage, worldKey(worldId));
  if (raw === undefined) return { ok: false, reason: "missing" };
  const m = migrateWorldFile(raw);
  if (!m.ok) return m;
  if (m.file.worldId !== worldId) return { ok: false, reason: "other_world" };
  return m;
}

export interface SaveInput {
  worldId: Id;
  base: WorldBase;
  title: string;
  /** Entries after the base only. */
  journal: JournalEntry[];
  session: Session;
  skipped: JournalEntry[];
}

export function buildWorldFile(input: SaveInput, now: IsoDateTime): WorldFile {
  return {
    format: WORLD_FORMAT,
    formatVersion: WORLD_FORMAT_VERSION,
    base: input.base,
    worldId: input.worldId,
    title: input.title,
    journal: input.journal,
    session: input.session,
    ...(input.skipped.length ? { skipped: input.skipped } : {}),
    savedAt: now,
  };
}

export type SaveResult = { ok: true; chars: number } | { ok: false; error: unknown };

/**
 * Write one world under its key and refresh its index row.
 * Throws nothing: a full store or a blocked storage comes back as `{ ok: false }`
 * so the UI can show it (存不上要让人看见).
 */
export function saveWorld(storage: StorageLike, input: SaveInput, now: IsoDateTime): SaveResult {
  const file = buildWorldFile(input, now);
  const text = JSON.stringify(file);
  try {
    storage.setItem(worldKey(input.worldId), text);
  } catch (error) {
    return { ok: false, error };
  }
  try {
    const index = readIndex(storage);
    const prev = indexEntry(index, input.worldId);
    writeIndex(
      storage,
      upsertIndexEntry(
        { ...index, currentWorldId: input.worldId },
        { id: input.worldId, title: input.title, kind: input.base, lastOpenedAt: now, lastBackupAt: prev?.lastBackupAt ?? null, steps: input.journal.length }
      )
    );
  } catch (error) {
    return { ok: false, error };
  }
  return { ok: true, chars: text.length };
}

/** Copy the current value of a world's key to its `:bak` key (before import or reset). Best effort. */
export function backupWorldKey(storage: StorageLike, worldId: Id): boolean {
  const raw = storage.getItem(worldKey(worldId));
  if (raw === null) return false;
  try {
    storage.setItem(worldBackupKey(worldId), raw);
    return true;
  } catch {
    return false;
  }
}

// --- export / import -------------------------------------------------------

export function exportFileName(title: string, worldId: Id, now: IsoDateTime): string {
  const stamp = now.slice(0, 16).replace(/[:T]/g, "-");
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 20) || worldId;
  return `arps-${safe}-${stamp}.json`;
}

/** The exported file = the stored envelope + when/which build. Byte-identical journal. */
export function buildExport(file: WorldFile, now: IsoDateTime, build: string | null | undefined): WorldFile {
  return { ...file, exportedAt: now, build: build ?? null };
}

export type ParsedImport = { ok: true; file: WorldFile } | { ok: false; reason: string };

/** Text of a chosen file → envelope, or a reason the UI can show (migrationReasonZh). */
export function parseImport(text: string): ParsedImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_a_world_file" };
  }
  const m = migrateWorldFile(raw);
  if (!m.ok) return m;
  return { ok: true, file: m.file };
}

/** Mark a world as backed up now (after a successful export). */
export function markBackedUp(storage: StorageLike, worldId: Id, now: IsoDateTime): void {
  try {
    const index = readIndex(storage);
    const entry = indexEntry(index, worldId);
    if (!entry) return;
    writeIndex(storage, upsertIndexEntry(index, { ...entry, lastBackupAt: now }));
  } catch {
    /* cosmetic */
  }
}

/** Days since `then`, floored; null when unknown. */
export function daysSince(then: IsoDateTime | null | undefined, now: IsoDateTime): number | null {
  if (!then) return null;
  const ms = Date.parse(now) - Date.parse(then);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
}
