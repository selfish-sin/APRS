/**
 * 主服务器的同步：
 *
 *   POST {base}/api/worlds/:id/commands
 *        { clientCmdId, baseSeq, name, input, ids, actorMemberId }
 *     → { ok: true, entries: baseSeq 之后的全部新日志 } | { ok: false, error: { message } }
 *   GET  {base}/api/worlds/:id/journal?after=N
 *     → { entries }
 *
 * clientCmdId = 浏览器里那条日志的 id：同一条重发，服务器认出来不执行两次。
 * 服务器用浏览器生成的 id 重跑（ids），所以「新建以后马上跳过去」的地址不会变。
 * 会话是 HttpOnly 的 Cookie，这里只带 credentials: "include"。
 */
import type { Id, JournalEntry } from "@/domain/model";
import type { SyncAdapter, SyncResult } from "./index";

export interface HttpSyncOptions {
  baseUrl: string;
  worldId: Id;
  fetch?: typeof fetch;
}

interface CommandBody {
  clientCmdId: Id;
  baseSeq: number;
  name: string;
  input: unknown;
  ids: Record<string, Id>;
  actorMemberId: Id | null;
}

function isEntryList(x: unknown): x is JournalEntry[] {
  return Array.isArray(x) && x.every((e) => e && typeof e === "object" && typeof (e as JournalEntry).seq === "number" && typeof (e as JournalEntry).id === "string");
}

export class HttpSyncAdapter implements SyncAdapter {
  readonly kind = "http" as const;
  readonly worldId: Id;
  private base: string;
  private fetcher: typeof fetch;

  constructor(opts: HttpSyncOptions) {
    this.worldId = opts.worldId;
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.fetcher = opts.fetch ?? ((...args) => fetch(...args));
  }

  private url(path: string): string {
    return `${this.base}/api/worlds/${encodeURIComponent(this.worldId)}${path}`;
  }

  static bodyOf(entry: JournalEntry): CommandBody {
    return {
      clientCmdId: entry.id,
      baseSeq: entry.seq - 1,
      name: entry.command,
      input: entry.payload,
      ids: entry.created ?? {},
      actorMemberId: entry.actorMemberId,
    };
  }

  private async json(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  async push(entries: JournalEntry[]): Promise<SyncResult> {
    const received: JournalEntry[] = [];
    let headSeq = 0;
    for (const entry of entries) {
      let res: Response;
      try {
        res = await this.fetcher(this.url("/commands"), {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(HttpSyncAdapter.bodyOf(entry)),
        });
      } catch {
        return { ok: false, message: "连不上主服务器，等网络好了再试", code: "network" };
      }
      const body = (await this.json(res)) as { ok?: boolean; entries?: unknown; error?: { message?: string; code?: string } } | null;
      if (res.status === 401) return { ok: false, message: "登录过期了，请重新登录", code: "unauthorized" };
      if (!res.ok || !body || body.ok === false) {
        return { ok: false, message: body?.error?.message ?? `主服务器没有接受（${res.status}）`, code: body?.error?.code ?? `http_${res.status}` };
      }
      if (!isEntryList(body.entries)) return { ok: false, message: "主服务器回的东西看不懂", code: "bad_response" };
      for (const e of body.entries) if (!received.some((x) => x.id === e.id)) received.push(e);
      if (body.entries.length) headSeq = Math.max(headSeq, body.entries[body.entries.length - 1].seq);
    }
    return { ok: true, entries: received, headSeq };
  }

  async pull(afterSeq: number): Promise<SyncResult> {
    let res: Response;
    try {
      res = await this.fetcher(this.url(`/journal?after=${Math.max(0, Math.floor(afterSeq))}`), { credentials: "include" });
    } catch {
      return { ok: false, message: "连不上主服务器，等网络好了再试", code: "network" };
    }
    if (res.status === 401) return { ok: false, message: "登录过期了，请重新登录", code: "unauthorized" };
    const body = (await this.json(res)) as { entries?: unknown } | null;
    if (!res.ok || !body || !isEntryList(body.entries)) return { ok: false, message: `拉不到新的记录（${res.status}）`, code: `http_${res.status}` };
    const entries = body.entries.filter((e) => e.seq > afterSeq).sort((a, b) => a.seq - b.seq);
    return { ok: true, entries, headSeq: entries.length ? entries[entries.length - 1].seq : afterSeq };
  }
}
