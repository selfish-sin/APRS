/**
 * 浏览器里的键（每个工会一个键）。这个程序写的东西都以 `arps:` 开头：
 *   arps:worlds          这台设备上有哪些工会（最近打开 / 备份的时间）
 *   arps:w:<worldId>     一个工会 = 底（示范 / 空）之后的日志 + 谁登录着 + 没能恢复的条目
 *   arps:w:<worldId>:bak 替换之前留的一份（导入 · 恢复示范）
 */

export const KEY_PREFIX = "arps:";
export const WORLDS_KEY = `${KEY_PREFIX}worlds`;

export function worldKey(worldId: string): string {
  return `${KEY_PREFIX}w:${worldId}`;
}

export function worldBackupKey(worldId: string): string {
  return `${worldKey(worldId)}:bak`;
}

/**
 * Chromium's localStorage limit per origin, measured 2026-10-10:
 * 5,242,880 UTF-16 code units for keys + values together, shared by every
 * world on this origin. Firefox / Safari differ, so the meter is advisory.
 */
export const STORAGE_QUOTA_CHARS = 5_242_880;
/** Say something once usage crosses this share of the quota. */
export const USAGE_WARN_RATIO = 0.7;
/** Stop nagging again once usage falls back below this share. */
export const USAGE_WARN_RESET_RATIO = 0.6;
/** Suggest a backup when the last one is older than this. */
export const BACKUP_REMIND_DAYS = 7;

/** The subset of the Storage interface the store uses — lets tests pass a Map-backed fake. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StorageUsage {
  /** UTF-16 code units used by every key + value on this origin (the quota is per origin, so all of it counts). */
  usedChars: number;
  quotaChars: number;
  /** usedChars / quotaChars, 0..1 (can exceed 1 on browsers with a bigger quota). */
  ratio: number;
  /** Per key, for the storage dialog. */
  keys: { key: string; chars: number }[];
}

export function measureUsage(storage: StorageLike, quotaChars: number = STORAGE_QUOTA_CHARS): StorageUsage {
  const keys: StorageUsage["keys"] = [];
  let usedChars = 0;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key === null) continue;
    const chars = key.length + (storage.getItem(key)?.length ?? 0);
    keys.push({ key, chars });
    usedChars += chars;
  }
  keys.sort((a, b) => b.chars - a.chars);
  return { usedChars, quotaChars, ratio: quotaChars > 0 ? usedChars / quotaChars : 0, keys };
}

/** In-memory Storage for tests and for browsers that throw on access (private mode on some engines). */
export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

/**
 * `window.localStorage` when it can be read; otherwise a throwaway MemoryStorage
 * (nothing persists, and the UI says so). Only reads are probed: a *full* store
 * still reads fine and must not be mistaken for a blocked one — its writes fail
 * later with a quota error, which the store shows as 「存满了」.
 * 发成单文件预览时页面在别人的框里，localStorage 可能一碰就报错——那时也走 MemoryStorage。
 */
export function browserStorage(): { storage: StorageLike; persistent: boolean } {
  if (typeof window === "undefined") return { storage: new MemoryStorage(), persistent: false };
  try {
    const s = window.localStorage;
    // Some engines expose the object but throw on first touch (blocked cookies / private mode).
    void s.length;
    s.getItem(`${KEY_PREFIX}probe`);
    return { storage: s, persistent: true };
  } catch {
    return { storage: new MemoryStorage(), persistent: false };
  }
}

/** A write was refused for space (every engine names it differently). */
export function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || /quota/i.test(e.message);
}
