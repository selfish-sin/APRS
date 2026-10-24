import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrateWorldFile, WORLD_FORMAT } from "@/lib/migrations";
import { saveToDevice, getDownloads } from "@/lib/download";
import { fakeIndexedDB } from "./fakeIdb";
import { base64ToBytes, bytesToBase64, sha256OfBytes } from "./sha";
import { IdbFileStore, MemoryFileStore, openFileStore } from "./store";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("文件的 SHA-256 和 base64", () => {
  it("和 node 的一样；base64 来回不变", async () => {
    for (const s of ["", "a", "示范图".repeat(1000)]) {
      expect(await sha256OfBytes(bytes(s))).toBe(createHash("sha256").update(s).digest("hex"));
    }
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(Array.from(base64ToBytes(bytesToBase64(big)))).toEqual(Array.from(big));
  });
});

describe("文件存哪", () => {
  it("IndexedDB（arps-files，按 sha256）：放 · 拿 · 列 · 删；同一个文件只存一份", async () => {
    const factory = fakeIndexedDB();
    const store = await IdbFileStore.open(factory);
    const sha = await sha256OfBytes(bytes("hello"));
    await store.put({ sha256: sha, mime: "text/plain", size: 5, data: bytes("hello").buffer as ArrayBuffer });
    await store.put({ sha256: sha, mime: "text/plain", size: 5, data: bytes("hello").buffer as ArrayBuffer });
    expect(await store.keys()).toEqual([sha]);
    const got = await store.get(sha);
    expect(new TextDecoder().decode(got!.data)).toBe("hello");
    expect(await store.get("nope")).toBeNull();
    // 再开一次还在（同一个库）
    const again = await IdbFileStore.open(factory);
    expect(await again.keys()).toEqual([sha]);
    await again.remove(sha);
    expect(await again.keys()).toEqual([]);
    expect(store.persistent).toBe(true);
  });

  it("不让用 IndexedDB 时降级成只在内存里", async () => {
    const s1 = await openFileStore(fakeIndexedDB(true));
    expect(s1).toBeInstanceOf(MemoryFileStore);
    expect(s1.persistent).toBe(false);
    const s2 = await openFileStore(undefined);
    expect(s2.persistent).toBe(false);
    await s2.put({ sha256: "x", mime: "", size: 1, data: new Uint8Array([7]).buffer });
    expect((await s2.get("x"))!.size).toBe(1);
    const s3 = await openFileStore(fakeIndexedDB());
    expect(s3.persistent).toBe(true);
    expect(await s3.keys()).toEqual([]);
  });
});

describe("备份里连文件一起", () => {
  it("信封带着 files（sha256 → base64）；坏的条目丢掉", () => {
    const sha = "a".repeat(64);
    const m = migrateWorldFile({ format: WORLD_FORMAT, formatVersion: 1, base: "empty", worldId: "w", journal: [], files: { [sha]: { mime: "image/png", size: 3, data: "AAEC" }, bad: { data: "x", size: 1 }, [`${"b".repeat(64)}`]: { size: "x" } } });
    expect(m.ok && m.file.files).toEqual({ [sha]: { mime: "image/png", size: 3, data: "AAEC" } });
    const plain = migrateWorldFile({ format: WORLD_FORMAT, formatVersion: 1, base: "empty", worldId: "w", journal: [] });
    expect(plain.ok && "files" in plain.file).toBe(false);
  });
});

describe("保存到这台设备", () => {
  function host(use?: (n: string) => unknown) {
    const clicks: string[] = [];
    const doc = {
      createElement: () => ({ click() { clicks.push(this.download); }, remove() {}, href: "", download: "", rel: "" }),
      body: { appendChild() {} },
    } as unknown as Document;
    return {
      clicks,
      host: { claude: use ? { use } : undefined, document: doc, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} } as unknown as typeof URL, setTimeout: ((fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 20))) as typeof setTimeout },
    };
  }
  const blob = new Blob(["{}"], { type: "application/json" });

  it("预览页面给了 downloads 就用它", async () => {
    const saved: string[] = [];
    const h = host(async () => ({ save: async ({ filename }: { filename: string }) => void saved.push(filename) }));
    expect(await saveToDevice("arps-备份.json", blob, h.host)).toEqual({ ok: true, via: "downloads" });
    expect(saved).toEqual(["arps-备份.json"]);
    expect(h.clicks).toEqual([]);
  });

  it("预览页面里存不了 .clip / .rar；被拒不重试", async () => {
    let calls = 0;
    const h = host(async () => ({ save: async () => { calls += 1; throw Object.assign(new Error("declined"), { code: "declined" }); } }));
    expect(await saveToDevice("C001.clip", blob, h.host)).toEqual({ ok: false, reason: "unsupported_type", message: { zh: "在这里存不了这种文件，请在装好的版本里下载", en: "This kind of file can't be saved here. Download it from the installed app" } });
    expect(await saveToDevice("a.png", blob, h.host)).toMatchObject({ ok: false, reason: "declined" });
    expect(calls).toBe(1);
  });

  it("没有 downloads（拿到 null 或者一直不回）就用普通下载", async () => {
    const none = host(async () => null);
    expect(await saveToDevice("a.rar", blob, none.host)).toEqual({ ok: true, via: "link" });
    expect(none.clicks).toEqual(["a.rar"]);
    const silent = host(() => new Promise(() => undefined));
    expect(await getDownloads(silent.host, 10)).toBeNull();
    const absent = host();
    expect(await saveToDevice("a.json", blob, absent.host)).toEqual({ ok: true, via: "link" });
  });
});
