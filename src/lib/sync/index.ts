/**
 * 同步接口（SPEC §8）：以后接主服务器时只换这一层。
 *
 *   push(entries)    把这台设备上新的日志条目（命令）交给对面
 *   pull(afterSeq)   拿对面 seq 之后的日志
 *
 * 现在有两个实现：本机（存在 localStorage 里，就是现在用的）和 HTTP（
 * 形状：POST /api/worlds/:id/commands · GET /api/worlds/:id/journal?after=N）。
 * 界面上不放「连接」按钮——还没有主服务器。
 */
import type { Id, JournalEntry } from "@/domain/model";

export type SyncResult = { ok: true; entries: JournalEntry[]; headSeq: number } | { ok: false; message: string; code?: string };

export interface SyncAdapter {
  readonly kind: "local" | "http";
  readonly worldId: Id;
  push(entries: JournalEntry[]): Promise<SyncResult>;
  pull(afterSeq: number): Promise<SyncResult>;
}

export { LocalSyncAdapter } from "./local";
export { HttpSyncAdapter, type HttpSyncOptions } from "./http";
