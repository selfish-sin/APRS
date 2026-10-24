/**
 * 不打开整个文件就能读的几种（SPEC §18.1 · §18.9 · §18.10）：.clip（尾部那一块的 SQLite）· 自己写的 SQLite 读取器（溢出页 · 内部页）·
 * zip 目录 · psd 自带的缩略图。用的全是 scripts/make-audit-fixtures.mjs 生成的假文件。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ascii, beUint, bytesSource, countingSource, type ByteSource } from "./bytes";
import { CLIP_TAIL_BYTES, readClip } from "./clip";
import { openSqlite } from "./sqlite";
import { readPsdThumbnail, readZipDirectory } from "./archive";
import { fingerprintOf } from "./intake";

const FIX = join(__dirname, "..", "..", "..", "tests", "fixtures", "audit", "EP01");
const load = (rel: string) => new Uint8Array(readFileSync(join(FIX, rel)));
const LO_CLIP = "LO/SC001/CUT001/ANDLC_EP01_SC001_CUT001_LO_v01.clip";

/** 从 .clip 里拿出 CHNKSQLi 那一块（测试里自己拼大文件用）。 */
function sqliteChunk(clip: Uint8Array): Uint8Array {
  for (let i = 24; i + 16 <= clip.length; ) {
    const name = ascii(clip, i, 8);
    const len = beUint(clip, i + 8, 8);
    if (name === "CHNKSQLi") return clip.slice(i + 16, i + 16 + len);
    i += 16 + len;
  }
  throw new Error("no CHNKSQLi");
}

const be8 = (n: number) => {
  const b = new Uint8Array(8);
  let v = n;
  for (let i = 7; i >= 0; i--) {
    b[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return b;
};
const head = (name: string, len: number) => {
  const b = new Uint8Array(16);
  for (let i = 0; i < 8; i++) b[i] = name.charCodeAt(i);
  b.set(be8(len), 8);
  return b;
};

/**
 * 一个「虚拟」的大 .clip：CSFCHUNK · CHNKHead · 一块很大的 CHNKExta（全是 0，读的时候才现算）· 其余几块。
 * 不在内存里放 30 MB，读哪一段现拼哪一段——这样才能数「读进内存的字节」。
 */
function virtualClip(sqlite: Uint8Array, padding: number, sqliteLast = true): ByteSource {
  const parts: { at: number; len: number; bytes: Uint8Array | null }[] = [];
  let at = 0;
  const push = (bytes: Uint8Array | null, len = bytes?.length ?? 0) => {
    parts.push({ at, len, bytes });
    at += len;
  };
  const sig = new Uint8Array(24);
  "CSFCHUNK".split("").forEach((c, i) => (sig[i] = c.charCodeAt(0)));
  push(sig);
  push(head("CHNKHead", 8));
  push(new Uint8Array(8));
  push(head("CHNKExta", padding));
  push(null, padding);
  if (sqliteLast) {
    push(head("CHNKSQLi", sqlite.length));
    push(sqlite);
  } else {
    push(head("CHNKSQLi", sqlite.length));
    push(sqlite);
    // SQLite 后面又跟了一块大的：尾部里找不到，要一块一块往后走
    push(head("CHNKExta", CLIP_TAIL_BYTES + 1024));
    push(null, CLIP_TAIL_BYTES + 1024);
  }
  push(head("CHNKFoot", 0));
  const size = at;
  sig.set(be8(size), 8);
  sig.set(be8(24), 16);
  return {
    size,
    read: async (start, end) => {
      const s = Math.max(0, start);
      const e = Math.min(size, end);
      const out = new Uint8Array(Math.max(0, e - s));
      for (const p of parts) {
        const a = Math.max(s, p.at);
        const b = Math.min(e, p.at + p.len);
        if (a >= b || !p.bytes) continue;
        out.set(p.bytes.subarray(a - p.at, b - p.at), a - s);
      }
      return out;
    },
  };
}

describe("自己写的 SQLite 只读小读取器", () => {
  const db = openSqlite(sqliteChunk(load(LO_CLIP)));

  it("读页头 · 表 · 列", () => {
    expect(db.pageSize).toBe(4096);
    expect(db.tables().sort()).toEqual(["Canvas", "CanvasPreview", "Layer", "TimeLine"]);
    expect(db.columns("Canvas")).toEqual(["MainId", "CanvasUnit", "CanvasWidth", "CanvasHeight", "CanvasResolution", "CanvasRootFolder"]);
  });

  it("记录解码：整数（INTEGER PRIMARY KEY 是 rowid）· 小数 · 字", () => {
    const c = db.rows("Canvas")[0];
    expect(c).toMatchObject({ MainId: 1, CanvasWidth: 1920, CanvasHeight: 1080, CanvasResolution: 350, CanvasRootFolder: 2 });
    expect(db.rows("TimeLine")[0]).toMatchObject({ FrameRate: 24, StartFrame: 0, EndFrame: 144 });
  });

  it("溢出页：ImageData（一张约 12 KB 的 PNG）比一页大，照链子读全", () => {
    const p = db.rows("CanvasPreview")[0];
    const img = p.ImageData as Uint8Array;
    expect(img.length).toBeGreaterThan(4096 * 2);
    expect(Array.from(img.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(ascii(img, img.length - 8, 4)).toBe("IEND");
    expect(p).toMatchObject({ ImageWidth: 736, ImageHeight: 414 });
  });

  it("内部页：Layer 表有几百行，跨好几页", () => {
    const rows = db.rows("Layer");
    expect(rows.length).toBe(246);
    expect(new Set(rows.map((r) => r.MainId)).size).toBe(246);
  });

  it("不是 SQLite 的字节：报错（读 .clip 的地方接住，当「只有名字」）", () => {
    expect(() => openSqlite(new Uint8Array(200))).toThrow();
  });
});

describe(".clip：只读尾部那一块", () => {
  it("假 .clip：预览图 · 画布大小 · 帧率 · 时长 · 顶层文件夹", async () => {
    const info = await readClip(bytesSource(load(LO_CLIP)));
    expect(info).not.toBeNull();
    expect(info!.preview).toMatchObject({ width: 736, height: 414, type: "image/png" });
    expect(info!.canvas).toEqual({ width: 1920, height: 1080, dpi: 350 });
    expect(info!.fps).toBe(24);
    expect(info!.frames).toBe(144);
    expect(info!.seconds).toBe(6);
    expect(info!.folders).toEqual(["原画", "修线", "动画", "标注"]);
  });

  it("30 MB 的假 .clip（大部分是 CHNKExta 填充）：读进内存的不超过 5 MB", async () => {
    const src = countingSource(virtualClip(sqliteChunk(load(LO_CLIP)), 30 * 1024 * 1024));
    expect(src.size).toBeGreaterThan(30 * 1024 * 1024);
    const info = await readClip(src);
    expect(info?.canvas).toEqual({ width: 1920, height: 1080, dpi: 350 });
    expect(info?.preview?.width).toBe(736);
    expect(src.bytesRead()).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it("CHNKSQLi 不在尾部：一块一块往后走（只读每块的 16 字节头）", async () => {
    const sqlite = sqliteChunk(load(LO_CLIP));
    const src = countingSource(virtualClip(sqlite, 30 * 1024 * 1024, false));
    const info = await readClip(src);
    expect(info?.fps).toBe(24);
    expect(src.bytesRead()).toBeLessThanOrEqual(5 * 1024 * 1024);
  });

  it("不是 .clip · 截断了的：返回 null，不报错", async () => {
    expect(await readClip(bytesSource(load("LO/SC001/CUT002/ANDLC_EP01_SC001_CUT002_LO_v01.png")))).toBeNull();
    const clip = load(LO_CLIP);
    expect(await readClip(bytesSource(clip.slice(0, 5000)))).toBeNull();
    // SQLite 的文件头坏了
    const broken = clip.slice();
    const at = Buffer.from(broken).indexOf("SQLite format 3");
    expect(at).toBeGreaterThan(0);
    broken.fill(0, at, at + 16);
    expect(await readClip(bytesSource(broken))).toBeNull();
  });
});

describe("zip 目录 · psd 缩略图", () => {
  it("zip：读末尾的目录就有每个文件的路径 · 大小 · 修改时间（不解压）", async () => {
    const zip = load("ANI/SC001/CUT002/ANDLC_EP01_SC001_CUT002_A_ANI_v01.zip");
    const src = countingSource(bytesSource(zip));
    const list = await readZipDirectory(src);
    expect(list?.map((e) => e.path)).toEqual(["ANDLC_EP01_SC001_CUT002_A_ANI_v01.png", "readme.txt"]);
    expect(list?.[1]).toMatchObject({ size: 13, mtime: "2026-10-20T06:00:00", dir: false });
    expect(await readZipDirectory(bytesSource(new Uint8Array(100)))).toBeNull();
  });

  it("psd：图像资源 1036 是一张 JPEG", async () => {
    const t = await readPsdThumbnail(bytesSource(load("H/SC001/CUT001/ANDLC_EP01_SC001_CUT001_H_v01.psd")));
    expect(t).toMatchObject({ width: 160, height: 90, canvas: { width: 1920, height: 64 } });
    expect(Array.from(t!.jpeg!.slice(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(t!.jpeg!.slice(-2))).toEqual([0xff, 0xd9]);
    expect(await readPsdThumbnail(bytesSource(load("IMG_0001.png")))).toBeNull();
  });
});

describe("认「同一个文件又放了一次」", () => {
  it("大小 · 时间 · 缩略图都一样的两个文件（同一批生成的 v01 和 v04）：路径不同就不算重复", () => {
    const a = fingerprintOf(889, 1_760_940_000_000, "a".repeat(64), "EP01/ANI/SC001/CUT009/ANDLC_EP01_SC001_CUT009_B_ANI_v01.png");
    const b = fingerprintOf(889, 1_760_940_000_000, "a".repeat(64), "EP01/ANI/SC001/CUT009/ANDLC_EP01_SC001_CUT009_B_ANI_v04.png");
    expect(a).not.toBe(b);
    expect(fingerprintOf(889, 1_760_940_000_000, "a".repeat(64), "EP01/ANI/SC001/CUT009/ANDLC_EP01_SC001_CUT009_B_ANI_v01.png")).toBe(a);
  });
});
