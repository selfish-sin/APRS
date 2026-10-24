import { describe, expect, it } from "vitest";
import { DEMO_WORLD_ID } from "@/data/demo";
import type { JournalEntry } from "@/domain/model";
import { MemoryStorage } from "@/lib/storage/keys";
import { readWorld } from "@/lib/storage/local";
import { HttpSyncAdapter, LocalSyncAdapter } from "./index";

function entry(id: string, seq: number, worldId = DEMO_WORLD_ID): JournalEntry {
  return { id, seq, worldId, accountId: "acc_a", actorMemberId: "mem_a", command: "thread.open", payload: { text: id }, changes: [], createdAt: "2026-10-23T02:00:00.000Z", worldAt: "2026-10-23T02:00:00.000Z", created: { threadId: `thr_${id}` } };
}

describe("LocalSyncAdapter", () => {
  it("push 接到日志后面，重发不记两次；pull 按 seq 拿", async () => {
    const s = new MemoryStorage();
    const a = new LocalSyncAdapter(s, DEMO_WORLD_ID, "demo", 100, () => "2026-10-23T02:00:00.000Z");
    const r1 = await a.push([entry("jnl_a", 1), entry("jnl_b", 2)]);
    expect(r1).toMatchObject({ ok: true, headSeq: 102 });
    const r2 = await a.push([entry("jnl_b", 2), entry("jnl_c", 3)]);
    expect(r2.ok && r2.entries.map((e) => [e.id, e.seq])).toEqual([["jnl_c", 103]]);
    const pulled = await a.pull(101);
    expect(pulled.ok && pulled.entries.map((e) => e.id)).toEqual(["jnl_b", "jnl_c"]);
    const file = readWorld(s, DEMO_WORLD_ID);
    expect(file.ok && file.file.journal).toHaveLength(3);
    expect(await a.push([entry("jnl_x", 1, "wld_other")])).toMatchObject({ ok: false, code: "other_world" });
  });
});

describe("HttpSyncAdapter", () => {
  type Call = { url: string; init?: RequestInit };
  function fakeFetch(handler: (c: Call) => { status: number; body: unknown }) {
    const calls: Call[] = [];
    const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const c = { url: String(url), init };
      calls.push(c);
      const { status, body } = handler(c);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { f, calls };
  }

  it("push：每条命令 POST 一次，带上浏览器给的 id", async () => {
    const { f, calls } = fakeFetch((c) => {
      const body = JSON.parse(String(c.init?.body));
      return { status: 200, body: { ok: true, entries: [entry(body.clientCmdId, body.baseSeq + 1)] } };
    });
    const a = new HttpSyncAdapter({ baseUrl: "https://server.example.com/", worldId: DEMO_WORLD_ID, fetch: f });
    const r = await a.push([entry("jnl_a", 401), entry("jnl_b", 402)]);
    expect(r).toMatchObject({ ok: true, headSeq: 402 });
    expect(calls[0].url).toBe(`https://server.example.com/api/worlds/${DEMO_WORLD_ID}/commands`);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.credentials).toBe("include");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ clientCmdId: "jnl_a", baseSeq: 400, name: "thread.open", input: { text: "jnl_a" }, ids: { threadId: "thr_jnl_a" }, actorMemberId: "mem_a" });
  });

  it("被拒时把服务器的中文原因带回来；连不上、登录过期也说清楚", async () => {
    const rejected = new HttpSyncAdapter({ baseUrl: "https://s.example.com", worldId: "w", fetch: fakeFetch(() => ({ status: 409, body: { ok: false, error: { code: "conflict", message: "别人刚改过这里，请刷新后再试" } } })).f });
    expect(await rejected.push([entry("jnl_a", 1, "w")])).toEqual({ ok: false, message: "别人刚改过这里，请刷新后再试", code: "conflict" });
    const offline = new HttpSyncAdapter({ baseUrl: "https://s.example.com", worldId: "w", fetch: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });
    expect(await offline.push([entry("jnl_a", 1, "w")])).toMatchObject({ ok: false, code: "network" });
    expect(await offline.pull(0)).toMatchObject({ ok: false, code: "network" });
    const expired = new HttpSyncAdapter({ baseUrl: "https://s.example.com", worldId: "w", fetch: fakeFetch(() => ({ status: 401, body: {} })).f });
    expect(await expired.pull(0)).toMatchObject({ ok: false, code: "unauthorized" });
  });

  it("pull：GET journal?after=N，按 seq 排好", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { entries: [entry("jnl_c", 12), entry("jnl_b", 11), entry("jnl_a", 10)] } }));
    const a = new HttpSyncAdapter({ baseUrl: "https://s.example.com", worldId: "w", fetch: f });
    const r = await a.pull(10);
    expect(calls[0].url).toBe("https://s.example.com/api/worlds/w/journal?after=10");
    expect(r.ok && r.entries.map((e) => e.seq)).toEqual([11, 12]);
    expect(r).toMatchObject({ headSeq: 12 });
    const bad = new HttpSyncAdapter({ baseUrl: "https://s.example.com", worldId: "w", fetch: fakeFetch(() => ({ status: 200, body: { nope: 1 } })).f });
    expect(await bad.pull(0)).toMatchObject({ ok: false });
  });
});
