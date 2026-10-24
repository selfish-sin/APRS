/**
 * 本机的同步：对面就是这台设备的 localStorage（`arps:w:<worldId>`）。
 * push 把没见过的条目（按 id）接到日志后面，seq 顺着往下排；同一条重发不会记两次。
 */
import type { Id, JournalEntry } from "@/domain/model";
import type { WorldBase } from "@/lib/migrations";
import type { StorageLike } from "@/lib/storage/keys";
import { readWorld, saveWorld } from "@/lib/storage/local";
import type { SyncAdapter, SyncResult } from "./index";

export class LocalSyncAdapter implements SyncAdapter {
  readonly kind = "local" as const;
  constructor(
    private storage: StorageLike,
    readonly worldId: Id,
    private base: WorldBase,
    private baseSeq: number,
    private now: () => string = () => new Date().toISOString()
  ) {}

  private journal(): { journal: JournalEntry[]; title: string; session: { worldId: Id; accountId: Id | null; memberId: Id | null } } {
    const r = readWorld(this.storage, this.worldId);
    if (!r.ok) return { journal: [], title: this.worldId, session: { worldId: this.worldId, accountId: null, memberId: null } };
    const s = r.file.session ?? {};
    return {
      journal: r.file.journal,
      title: r.file.title ?? this.worldId,
      session: { worldId: this.worldId, accountId: s.accountId ?? null, memberId: s.memberId ?? null },
    };
  }

  private head(journal: JournalEntry[]): number {
    return journal.length ? journal[journal.length - 1].seq : this.baseSeq;
  }

  async push(entries: JournalEntry[]): Promise<SyncResult> {
    const cur = this.journal();
    const seen = new Set(cur.journal.map((e) => e.id));
    const added: JournalEntry[] = [];
    let seq = this.head(cur.journal);
    for (const e of entries) {
      if (e.worldId !== this.worldId) return { ok: false, message: "这条记录是别的工会的", code: "other_world" };
      if (seen.has(e.id)) continue;
      seq += 1;
      const next = { ...e, seq };
      added.push(next);
      seen.add(e.id);
    }
    if (added.length) {
      const r = saveWorld(this.storage, { worldId: this.worldId, base: this.base, title: cur.title, journal: [...cur.journal, ...added], session: cur.session, skipped: [] }, this.now());
      if (!r.ok) return { ok: false, message: "这台设备存不上了", code: "save_failed" };
    }
    return { ok: true, entries: added, headSeq: seq };
  }

  async pull(afterSeq: number): Promise<SyncResult> {
    const cur = this.journal();
    return { ok: true, entries: cur.journal.filter((e) => e.seq > afterSeq), headSeq: this.head(cur.journal) };
  }
}
