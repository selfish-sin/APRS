/**
 * 浏览器里存的、导出成文件的东西怎么升级。
 *
 * 规矩：换版本不清空。存的形状一变就：`WORLD_FORMAT_VERSION` 加一；在 `MIGRATIONS` 里加一条
 * `旧版本号: (旧形状) => 新形状`；加一个测试把旧形状喂进去。升不了的返回 `{ ok: false, reason }`，
 * 界面用 `migrationReasonZh` 说清楚，原来的键留着不动。
 *
 * 这里管的是「信封」（键和文件的外层）。信封里的日志归数据层：加载时按现在的底（示范 / 空）重放，
 * 对不上的条目留在 `skipped`，界面上有一行提示，没有丢。
 */
import type { Id, IsoDateTime, JournalEntry } from "@/domain/model";
import type { Session } from "@/lib/session";

/** Bump when the envelope below changes; add a migration for the old number. */
export const WORLD_FORMAT_VERSION = 1;
export const WORLD_FORMAT = "arps-guild-world";

/** 日志重放在什么底上：示范工会（代码里建）· 空工会（建工会那一步也在日志里）。 */
export type WorldBase = "demo" | "empty";
export const WORLD_BASES: WorldBase[] = ["demo", "empty"];

/** One world as stored under `arps:w:<id>` and as exported to a file. */
export interface WorldFile {
  format: typeof WORLD_FORMAT;
  formatVersion: number;
  base: WorldBase;
  worldId: Id;
  /** For the world index and the import dialog; the state's own title wins once replayed. */
  title?: string;
  /** 底之后的日志，按 seq。 */
  journal: JournalEntry[];
  /** 这台设备上谁登录着。 */
  session?: Partial<Session>;
  /** Entries that no longer applied on some load — kept, never silently dropped. */
  skipped?: JournalEntry[];
  /** When this envelope was written (real clock). */
  savedAt?: IsoDateTime;
  /** Only in exported files: when and from which build. */
  exportedAt?: IsoDateTime;
  build?: string | null;
  /**
   * 只在勾了「连文件一起」的备份里：sha256 → 文件本身（base64）。浏览器里存的那一份没有它
   * （文件在 IndexedDB）。加的是可选字段，信封版本不用变。
   */
  files?: Record<string, EmbeddedFile>;
}

export interface EmbeddedFile {
  mime: string;
  size: number;
  /** base64 */
  data: string;
}

function embeddedFiles(x: unknown): Record<string, EmbeddedFile> | undefined {
  if (!isRecord(x)) return undefined;
  const out: Record<string, EmbeddedFile> = {};
  for (const [sha, v] of Object.entries(x)) {
    if (!/^[0-9a-f]{64}$/.test(sha) || !isRecord(v)) continue;
    if (typeof v.data !== "string" || typeof v.size !== "number") continue;
    out[sha] = { mime: typeof v.mime === "string" ? v.mime : "", size: v.size, data: v.data };
  }
  return Object.keys(out).length ? out : undefined;
}

export type MigrationResult = { ok: true; file: WorldFile; from: string } | { ok: false; reason: string };

type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

/**
 * formatVersion N → N+1, keyed by N. Empty today: version 1 is the first envelope.
 * Example for later: `1: (file) => ({ ...file, formatVersion: 2, journal: renameField(file.journal) })`.
 */
export const MIGRATIONS: Record<number, Migration> = {};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isJournalEntry(x: unknown): x is JournalEntry {
  return (
    isRecord(x) &&
    typeof x.id === "string" &&
    typeof x.seq === "number" &&
    typeof x.worldId === "string" &&
    typeof x.command === "string" &&
    Array.isArray(x.changes) &&
    typeof x.createdAt === "string"
  );
}

/**
 * Anything that claims to be a world (stored key or imported file) → current envelope.
 * Runs the chain in MIGRATIONS from the file's version up to WORLD_FORMAT_VERSION.
 */
export function migrateWorldFile(raw: unknown): MigrationResult {
  if (!isRecord(raw)) return { ok: false, reason: "not_an_object" };
  if (raw.format !== WORLD_FORMAT) return { ok: false, reason: "not_a_world_file" };
  let version = typeof raw.formatVersion === "number" ? raw.formatVersion : NaN;
  if (!Number.isInteger(version) || version < 1) return { ok: false, reason: "bad_version" };
  if (version > WORLD_FORMAT_VERSION) return { ok: false, reason: `newer_than_app_${version}` };
  let current: Record<string, unknown> = raw;
  while (version < WORLD_FORMAT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { ok: false, reason: `no_migration_from_${version}` };
    current = step(current);
    version = typeof current.formatVersion === "number" ? current.formatVersion : version + 1;
  }
  if (typeof current.worldId !== "string" || !current.worldId) return { ok: false, reason: "no_world_id" };
  if (!WORLD_BASES.includes(current.base as WorldBase)) return { ok: false, reason: "bad_base" };
  if (!Array.isArray(current.journal)) return { ok: false, reason: "no_journal" };
  const journal = current.journal.filter(isJournalEntry);
  if (journal.length !== current.journal.length) return { ok: false, reason: "bad_journal_entry" };
  const skipped = Array.isArray(current.skipped) ? current.skipped.filter(isJournalEntry) : [];
  const file: WorldFile = {
    format: WORLD_FORMAT,
    formatVersion: WORLD_FORMAT_VERSION,
    base: current.base as WorldBase,
    worldId: current.worldId,
    ...(typeof current.title === "string" ? { title: current.title } : {}),
    journal,
    ...(isRecord(current.session) ? { session: current.session as Partial<Session> } : {}),
    ...(skipped.length ? { skipped } : {}),
    ...(typeof current.savedAt === "string" ? { savedAt: current.savedAt } : {}),
    ...(typeof current.exportedAt === "string" ? { exportedAt: current.exportedAt } : {}),
    ...(typeof current.build === "string" ? { build: current.build } : {}),
  };
  const files = embeddedFiles(current.files);
  if (files) file.files = files;
  return { ok: true, file, from: raw.formatVersion === WORLD_FORMAT_VERSION ? "current" : `v${String(raw.formatVersion)}` };
}

/** Plain words for the import dialog. */
export function migrationReasonZh(reason: string): string {
  if (reason === "not_an_object" || reason === "not_a_world_file") return "这不是工会导出的备份文件。";
  if (reason.startsWith("newer_than_app_")) return "这份备份是更新的版本导出的，先更新这里的程序再导入。";
  if (reason === "bad_journal_entry" || reason === "no_journal") return "备份文件里的记录不完整。";
  if (reason === "no_world_id") return "备份文件里没有写是哪个工会。";
  if (reason === "bad_base") return "备份文件里没有写是示范工会还是自己的工会。";
  return `备份读不了（${reason}）。`;
}
