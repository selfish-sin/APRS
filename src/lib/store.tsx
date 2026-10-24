/**
 * 页面用的 store（store 里没有业务规则，写操作全是 src/domain 的命令）。
 *
 * 管三件事：
 *   1. 这台设备上有哪些工会、现在打开哪一个（arps:worlds），打开 = 底 + 重放日志（src/lib/worlds.ts）
 *   2. 谁登录着（选账号 + 输口令，口令只拿来算哈希比对，不存）
 *   3. 存：每一步之后把底之后的日志存进 arps:w:<worldId>；存不上要让人看见；导出 / 导入备份
 *
 * 打开工会、登录以后，自动把超过时限的任务收回到可接（SPEC §4 规则 3），每一张一条日志。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CommandInput, CommandName, DomainError } from "@/domain/commands";
import { dispatch as runCommand, type DispatchResult } from "@/domain/dispatch";
import { newId } from "@/domain/ids";
import { emptyWorldState, type AccountRow, type Id, type IsoDateTime, type JournalEntry, type JournalSource, type MemberRow, type WorldState } from "@/domain/model";
import { accounts as accountsOf, memberById, nowOf, overdueTasks, theWorld } from "@/domain/queries";
import type { WorldBase, WorldFile } from "@/lib/migrations";
import { makePasscode, verifyPasscode } from "@/lib/passcode";
import type { Session } from "@/lib/session";
import {
  BACKUP_REMIND_DAYS,
  STORAGE_QUOTA_CHARS,
  USAGE_WARN_RATIO,
  USAGE_WARN_RESET_RATIO,
  browserStorage,
  isQuotaError,
  measureUsage,
  worldKey,
  type StorageLike,
} from "@/lib/storage/keys";
import {
  backupWorldKey,
  buildExport,
  buildWorldFile,
  daysSince,
  exportFileName,
  indexEntry,
  markBackedUp,
  readIndex,
  readWorld,
  saveWorld,
  setCurrentWorld,
  upsertIndexEntry,
  writeIndex,
  type WorldIndexEntry,
} from "@/lib/storage/local";
import { DEMO_TITLE, DEMO_WORLD_ID, ownJournal, rebuildWorld, type Rebuilt } from "@/lib/worlds";

/** Everything the UI needs to say about where this world is stored. */
export interface StorageStatus {
  available: boolean;
  persisted: boolean | null;
  usedChars: number;
  quotaChars: number;
  ratio: number;
  /** 底之后做了几步。 */
  steps: number;
  lastBackupAt: IsoDateTime | null;
  saveFailed: { at: IsoDateTime; message: string } | null;
  skipped: { entry: JournalEntry; reason: string }[];
  skippedNew: number;
  reminder: { kind: "usage" | "backup"; message: string } | null;
}

export type ImportReport = { ok: true; applied: number; skipped: number; total: number; title: string } | { ok: false; message: string };

export interface Notice {
  id: number;
  message: string;
  tone: "Neutral" | "Success" | "Error";
}

interface Current {
  worldId: Id;
  base: WorldBase;
  world: WorldState;
  session: Session;
  skipped: Rebuilt["skipped"];
}

const EMPTY_STATUS: StorageStatus = {
  available: false,
  persisted: null,
  usedChars: 0,
  quotaChars: STORAGE_QUOTA_CHARS,
  ratio: 0,
  steps: 0,
  lastBackupAt: null,
  saveFailed: null,
  skipped: [],
  skippedNew: 0,
  reminder: null,
};

function realNow(): IsoDateTime {
  return new Date().toISOString();
}

function errorMessage(e: unknown): string {
  if (isQuotaError(e)) return "浏览器的存储满了";
  return e instanceof Error ? e.message : String(e);
}

function saveFailureMessage(result: ReturnType<typeof saveWorld>, box: { storage: StorageLike; persistent: boolean }): string {
  if (!box.persistent) return "这个浏览器不让存（无痕窗口或者禁了本机存储）";
  if (result.ok) return "没存上";
  if (isQuotaError(result.error)) {
    const usage = measureUsage(box.storage);
    return usage.ratio < 0.5 ? "这个浏览器不让存，可能是无痕窗口" : "浏览器的存储满了";
  }
  return errorMessage(result.error);
}

function buildId(): string | null {
  if (typeof document === "undefined") return null;
  return document.querySelector('meta[name="build"]')?.getAttribute("content") || null;
}

/** 读一个工会：底 + 存下来的日志。读不到 = 底本身（示范）或 null（自己的工会不见了）。 */
function loadWorld(storage: StorageLike, entry: Pick<WorldIndexEntry, "id" | "kind">): Current | null {
  const saved = readWorld(storage, entry.id);
  if (!saved.ok) {
    if (saved.reason !== "missing") console.warn("[store] saved world could not be read", saved.reason);
    if (entry.kind !== "demo") return null;
    const built = rebuildWorld("demo", entry.id, []);
    return { worldId: entry.id, base: "demo", world: built.state, session: { worldId: entry.id, accountId: null, memberId: null }, skipped: [] };
  }
  const file = saved.file;
  const built = rebuildWorld(file.base, file.worldId, file.journal, file.skipped ?? []);
  if (built.skipped.length) console.warn("[store] journal entries skipped on load (kept under `skipped`)", built.skipped.length);
  return { worldId: file.worldId, base: file.base, world: built.state, session: validSession(built.state, file.worldId, file.session), skipped: built.skipped };
}

/** 存的会话还对得上（账号还在、是那个成员）才算登录着。 */
function validSession(world: WorldState, worldId: Id, s: Partial<Session> | undefined): Session {
  const account = s?.accountId ? world.accounts[s.accountId] : undefined;
  if (account && !account.archivedAt && account.memberId === s?.memberId && world.members[account.memberId]) {
    return { worldId, accountId: account.id, memberId: account.memberId };
  }
  return { worldId, accountId: null, memberId: null };
}

function reminderFor(storage: StorageLike, status: Omit<StorageStatus, "reminder">, now: IsoDateTime): StorageStatus["reminder"] {
  if (!status.available) return null;
  const index = readIndex(storage);
  if (status.ratio >= USAGE_WARN_RATIO && !index.usageWarnedAt) {
    const days = daysSince(status.lastBackupAt, now);
    const backup = days === null ? "还没有导出过备份" : `上次备份是 ${days} 天前`;
    return { kind: "usage", message: `这台设备的存储已用 ${Math.round(status.ratio * 100)}%，${backup}。` };
  }
  if (status.steps >= 20) {
    const days = daysSince(status.lastBackupAt, now);
    const stale = days === null || days >= BACKUP_REMIND_DAYS;
    const remindedDays = daysSince(index.backupRemindedAt, now);
    if (stale && (remindedDays === null || remindedDays >= 1)) {
      return { kind: "backup", message: days === null ? "这个工会还没有导出过备份。" : `这个工会上次备份是 ${days} 天前。` };
    }
  }
  return null;
}

type Dispatch = <N extends CommandName>(name: N, input: CommandInput<N>, opts?: { quiet?: boolean; source?: JournalSource }) => DispatchResult;

export interface CreateGuildForm {
  title: string;
  nickname: string;
  login: string;
  passcode: string;
}

export interface StoreApi {
  ready: boolean;
  /** 这台设备上的工会。 */
  guilds: WorldIndexEntry[];
  /** 现在打开的工会（没打开 = null，显示进门页）。 */
  world: WorldState | null;
  worldId: Id | null;
  base: WorldBase | null;
  session: Session | null;
  /** 世界的「现在」。 */
  now: IsoDateTime;
  me: MemberRow | null;
  account: AccountRow | null;
  /** 以登录的成员身份跑一条命令。同步返回；被拒时 `error.message` 是中文。 */
  dispatch: Dispatch;
  login: (accountId: Id, passcode: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  logout: () => void;
  openDemo: () => void;
  openGuild: (worldId: Id) => boolean;
  leaveGuild: () => void;
  createGuild: (form: CreateGuildForm) => Promise<{ ok: true } | { ok: false; message: string }>;
  resetDemo: () => void;
  lastError: DomainError | null;
  clearError: () => void;
  notice: Notice | null;
  notify: (message: string, tone?: Notice["tone"]) => void;
  clearNotice: () => void;
  storage: StorageStatus;
  exportWorld: () => { ok: true; fileName: string } | { ok: false; message: string };
  worldFile: () => WorldFile | null;
  /** 导入一份备份：同一个工会在这台设备上就替换（先留 :bak），没有就加进来，然后打开它。 */
  importWorld: (file: WorldFile) => ImportReport;
  dismissReminder: () => void;
  dismissSkipped: () => void;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState<Current | null>(null);
  const [guilds, setGuilds] = useState<WorldIndexEntry[]>([]);
  const [lastError, setLastError] = useState<DomainError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>(EMPTY_STATUS);
  const currentRef = useRef<Current | null>(null);
  const storageRef = useRef<{ storage: StorageLike; persistent: boolean } | null>(null);
  const noticeSeq = useRef(0);
  /** 下一次存不用写（刚从别的标签页读进来的）。 */
  const skipSave = useRef(false);

  const commit = useCallback((next: Current | null) => {
    currentRef.current = next;
    setCurrent(next);
  }, []);

  const refreshGuilds = useCallback(() => {
    const box = storageRef.current;
    if (!box) return;
    setGuilds(readIndex(box.storage).worlds);
  }, []);

  const refreshStatus = useCallback((saveFailed: StorageStatus["saveFailed"]) => {
    const box = storageRef.current;
    const cur = currentRef.current;
    if (!box) return;
    const now = realNow();
    const usage = measureUsage(box.storage);
    const index = readIndex(box.storage);
    const entry = cur ? indexEntry(index, cur.worldId) : undefined;
    const skipped = cur?.skipped ?? [];
    const base: Omit<StorageStatus, "reminder"> = {
      available: box.persistent,
      persisted: index.persisted ?? null,
      usedChars: usage.usedChars,
      quotaChars: usage.quotaChars,
      ratio: usage.ratio,
      steps: cur ? ownJournal(cur.world, cur.base).length : 0,
      lastBackupAt: entry?.lastBackupAt ?? null,
      saveFailed,
      skipped,
      skippedNew: cur ? Math.max(0, skipped.length - (index.skippedSeen?.[cur.worldId] ?? 0)) : 0,
    };
    setStorageStatus((prev) => ({ ...base, reminder: prev.reminder ?? reminderFor(box.storage, base, now) }));
  }, []);

  // —— 第一次打开：读目录，打开上次的工会 ——
  useEffect(() => {
    const box = browserStorage();
    storageRef.current = box;
    const index = readIndex(box.storage);
    const entry = index.currentWorldId ? indexEntry(index, index.currentWorldId) : undefined;
    if (entry) {
      try {
        commit(loadWorld(box.storage, entry));
      } catch (e) {
        console.warn("[store] could not open the last guild", e);
      }
    }
    setGuilds(index.worlds);
    refreshStatus(null);
    setReady(true);
    try {
      if (box.persistent && index.persisted !== true && typeof navigator !== "undefined" && navigator.storage?.persist) {
        navigator.storage
          .persist()
          .then((granted) => {
            writeIndex(box.storage, { ...readIndex(box.storage), persisted: granted });
            setStorageStatus((prev) => ({ ...prev, persisted: granted }));
          })
          .catch(() => undefined);
      }
    } catch {
      /* unsupported */
    }
    // 别的标签页存了同一个工会：用它的，不要拿我们的盖掉。
    const onStorage = (e: StorageEvent) => {
      const cur = currentRef.current;
      if (cur && e.key === worldKey(cur.worldId)) {
        const next = loadWorld(box.storage, { id: cur.worldId, kind: cur.base });
        if (next) {
          skipSave.current = true;
          commit({ ...next, session: cur.session });
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [commit, refreshStatus]);

  // —— 每一步之后存 ——
  useEffect(() => {
    if (!ready || !current) return;
    if (skipSave.current) {
      skipSave.current = false;
      refreshStatus(null);
      return;
    }
    const box = storageRef.current;
    if (!box) return;
    const now = realNow();
    const result = saveWorld(
      box.storage,
      {
        worldId: current.worldId,
        base: current.base,
        title: theWorld(current.world)?.title ?? DEMO_TITLE,
        journal: ownJournal(current.world, current.base),
        session: current.session,
        skipped: current.skipped.map((s) => s.entry),
      },
      now
    );
    if (result.ok && box.persistent) refreshStatus(null);
    else {
      if (!result.ok) console.warn("[store] could not save", result.error);
      refreshStatus({ at: now, message: saveFailureMessage(result, box) });
    }
    refreshGuilds();
  }, [current, ready, refreshStatus, refreshGuilds]);

  // —— 超时收回（打开、登录以后跑一次）——
  const sweptFor = useRef<string | null>(null);
  useEffect(() => {
    if (!current?.session.memberId) return;
    const key = `${current.worldId}:${current.session.memberId}`;
    if (sweptFor.current === key) return;
    sweptFor.current = key;
    const overdue = overdueTasks(current.world);
    let state = current.world;
    let n = 0;
    for (const t of overdue) {
      const r = runCommand(state, { worldId: current.worldId, accountId: current.session.accountId, actorMemberId: current.session.memberId }, "task.expire", { taskId: t.id }, { source: "system" });
      if (r.ok) {
        state = r.state;
        n += 1;
      }
    }
    if (n > 0) {
      commit({ ...current, world: state });
      setNotice({ id: ++noticeSeq.current, message: `有 ${n} 张任务过了时限没交，已经收回到可接。`, tone: "Neutral" });
    }
  }, [current, commit]);

  const dispatch = useCallback<Dispatch>((name, input, opts = {}) => {
    const cur = currentRef.current;
    if (!cur) {
      const error: DomainError = { code: "state", message: "还没有打开工会" };
      if (!opts.quiet) setLastError(error);
      return { ok: false, error };
    }
    const result = runCommand(cur.world, { worldId: cur.worldId, accountId: cur.session.accountId, actorMemberId: cur.session.memberId }, name, input, { source: opts.source });
    if (result.ok) {
      commit({ ...cur, world: result.state });
      setLastError(null);
    } else {
      console.warn(`[store] ${name} rejected:`, result.error.message);
      if (!opts.quiet) setLastError(result.error);
    }
    return result;
  }, [commit]);

  const login = useCallback<StoreApi["login"]>(
    async (accountId, passcode) => {
      const cur = currentRef.current;
      if (!cur) return { ok: false, message: "还没有打开工会" };
      const account = cur.world.accounts[accountId];
      if (!account || account.archivedAt) return { ok: false, message: "找不到这个账号" };
      if (!passcode) return { ok: false, message: "请输口令" };
      const ok = await verifyPasscode(account, passcode);
      if (!ok) return { ok: false, message: "口令不对，再试一次" };
      const latest = currentRef.current;
      if (!latest || latest.worldId !== cur.worldId) return { ok: false, message: "工会换了，请重新登录" };
      commit({ ...latest, session: { worldId: latest.worldId, accountId: account.id, memberId: account.memberId } });
      setLastError(null);
      return { ok: true };
    },
    [commit]
  );

  const logout = useCallback(() => {
    const cur = currentRef.current;
    if (!cur) return;
    sweptFor.current = null;
    commit({ ...cur, session: { worldId: cur.worldId, accountId: null, memberId: null } });
  }, [commit]);

  const openGuild = useCallback(
    (worldId: Id) => {
      const box = storageRef.current;
      if (!box) return false;
      const entry = indexEntry(readIndex(box.storage), worldId) ?? (worldId === DEMO_WORLD_ID ? { id: worldId, kind: "demo" as const } : undefined);
      if (!entry) return false;
      const next = loadWorld(box.storage, entry);
      if (!next) return false;
      sweptFor.current = null;
      setLastError(null);
      commit(next);
      setCurrentWorld(box.storage, worldId);
      return true;
    },
    [commit]
  );

  const openDemo = useCallback(() => {
    openGuild(DEMO_WORLD_ID);
  }, [openGuild]);

  const leaveGuild = useCallback(() => {
    const box = storageRef.current;
    if (box) setCurrentWorld(box.storage, null);
    sweptFor.current = null;
    commit(null);
    refreshGuilds();
    setStorageStatus(EMPTY_STATUS);
  }, [commit, refreshGuilds]);

  const createGuild = useCallback<StoreApi["createGuild"]>(
    async (form) => {
      const { salt, hash } = await makePasscode(form.passcode);
      const worldId = newId("wld");
      const r = runCommand(emptyWorldState(), { worldId, accountId: null, actorMemberId: null }, "guild.create", {
        title: form.title,
        nickname: form.nickname,
        login: form.login,
        salt,
        hash,
      });
      if (!r.ok) return { ok: false, message: r.error.message };
      sweptFor.current = null;
      commit({ worldId, base: "empty", world: r.state, session: { worldId, accountId: r.created.accountId, memberId: r.created.memberId }, skipped: [] });
      return { ok: true };
    },
    [commit]
  );

  const resetDemo = useCallback(() => {
    const box = storageRef.current;
    const cur = currentRef.current;
    if (!cur || cur.base !== "demo") return;
    if (box) backupWorldKey(box.storage, cur.worldId);
    const built = rebuildWorld("demo", cur.worldId, []);
    sweptFor.current = null;
    commit({ ...cur, world: built.state, skipped: [] });
    setLastError(null);
  }, [commit]);

  const worldFile = useCallback<StoreApi["worldFile"]>(() => {
    const cur = currentRef.current;
    if (!cur) return null;
    return buildWorldFile(
      { worldId: cur.worldId, base: cur.base, title: theWorld(cur.world)?.title ?? DEMO_TITLE, journal: ownJournal(cur.world, cur.base), session: cur.session, skipped: cur.skipped.map((x) => x.entry) },
      realNow()
    );
  }, []);

  const exportWorld = useCallback<StoreApi["exportWorld"]>(() => {
    const box = storageRef.current;
    if (typeof document === "undefined") return { ok: false, message: "只能在浏览器里导出" };
    const file0 = worldFile();
    if (!file0) return { ok: false, message: "还没有打开工会" };
    try {
      const now = realNow();
      const file = buildExport(file0, now, buildId());
      const fileName = exportFileName(file.title ?? "", file.worldId, now);
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (box) {
        markBackedUp(box.storage, file.worldId, now);
        setStorageStatus((prev) => ({ ...prev, lastBackupAt: now, reminder: null }));
        try {
          writeIndex(box.storage, { ...readIndex(box.storage), backupRemindedAt: now });
        } catch {
          /* cosmetic */
        }
        refreshGuilds();
      }
      return { ok: true, fileName };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }, [worldFile, refreshGuilds]);

  const importWorld = useCallback<StoreApi["importWorld"]>(
    (file) => {
      const box = storageRef.current;
      if (box) {
        backupWorldKey(box.storage, file.worldId);
        try {
          const index = readIndex(box.storage);
          if (!indexEntry(index, file.worldId)) {
            writeIndex(box.storage, upsertIndexEntry(index, { id: file.worldId, title: file.title ?? "", kind: file.base, lastBackupAt: null, steps: file.journal.length }));
          }
        } catch {
          /* 存的时候会再写 */
        }
      }
      let built: Rebuilt;
      try {
        built = rebuildWorld(file.base, file.worldId, file.journal, file.skipped ?? []);
      } catch (e) {
        return { ok: false, message: `备份读不了（${errorMessage(e)}）。` };
      }
      if (!theWorld(built.state)) return { ok: false, message: "备份里没有能恢复的工会。" };
      sweptFor.current = null;
      commit({ worldId: file.worldId, base: file.base, world: built.state, session: validSession(built.state, file.worldId, file.session), skipped: built.skipped });
      setLastError(null);
      return { ok: true, applied: built.applied, skipped: built.skipped.length, total: file.journal.length, title: theWorld(built.state)?.title ?? "" };
    },
    [commit]
  );

  const dismissReminder = useCallback(() => {
    const box = storageRef.current;
    setStorageStatus((prev) => {
      if (box && prev.reminder) {
        try {
          const index = readIndex(box.storage);
          const now = realNow();
          writeIndex(box.storage, prev.reminder.kind === "usage" ? { ...index, usageWarnedAt: now } : { ...index, backupRemindedAt: now });
        } catch {
          /* cosmetic */
        }
      }
      return { ...prev, reminder: null };
    });
  }, []);

  const dismissSkipped = useCallback(() => {
    const box = storageRef.current;
    const cur = currentRef.current;
    if (box && cur) {
      try {
        const index = readIndex(box.storage);
        writeIndex(box.storage, { ...index, skippedSeen: { ...(index.skippedSeen ?? {}), [cur.worldId]: cur.skipped.length } });
      } catch {
        /* cosmetic */
      }
    }
    setStorageStatus((prev) => ({ ...prev, skippedNew: 0 }));
  }, []);

  useEffect(() => {
    const box = storageRef.current;
    if (!box || !ready || storageStatus.ratio >= USAGE_WARN_RESET_RATIO) return;
    try {
      const index = readIndex(box.storage);
      if (index.usageWarnedAt) writeIndex(box.storage, { ...index, usageWarnedAt: null });
    } catch {
      /* cosmetic */
    }
  }, [ready, storageStatus.ratio]);

  const notify = useCallback((message: string, tone: Notice["tone"] = "Success") => setNotice({ id: ++noticeSeq.current, message, tone }), []);
  const clearNotice = useCallback(() => setNotice(null), []);
  const clearError = useCallback(() => setLastError(null), []);

  const world = current?.world ?? null;
  const session = current?.session ?? null;
  const me = world && session?.memberId ? memberById(world, session.memberId) ?? null : null;
  const account = world && session?.accountId ? accountsOf(world).find((a) => a.id === session.accountId) ?? null : null;
  const now = world ? nowOf(world) : realNow();

  const api = useMemo<StoreApi>(
    () => ({
      ready,
      guilds,
      world,
      worldId: current?.worldId ?? null,
      base: current?.base ?? null,
      session,
      now,
      me,
      account,
      dispatch,
      login,
      logout,
      openDemo,
      openGuild,
      leaveGuild,
      createGuild,
      resetDemo,
      lastError,
      clearError,
      notice,
      notify,
      clearNotice,
      storage: storageStatus,
      exportWorld,
      worldFile,
      importWorld,
      dismissReminder,
      dismissSkipped,
    }),
    [ready, guilds, world, current?.worldId, current?.base, session, now, me, account, dispatch, login, logout, openDemo, openGuild, leaveGuild, createGuild, resetDemo, lastError, clearError, notice, notify, clearNotice, storageStatus, exportWorld, worldFile, importWorld, dismissReminder, dismissSkipped]
  );

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

/** 登录以后的页面用：工会、我、dispatch 都一定有。 */
export function useGuild() {
  const s = useStore();
  if (!s.world || !s.session || !s.me) throw new Error("useGuild needs an open guild and a logged-in member");
  return { ...s, world: s.world, session: s.session, me: s.me };
}
