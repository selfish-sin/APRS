#!/usr/bin/env node
/**
 * 盘点（SPEC §18.9）测试用的假文件：一整棵假的文件夹树，全是代码画的色块图 + 字「TEST」，不是任何人的作品。
 *
 *   node scripts/make-audit-fixtures.mjs        → tests/fixtures/audit/
 *
 * 里面有：假的 .clip（照真实结构拼出 CSFCHUNK · CHNKHead · 几块 CHNKExta · CHNKSQLi · CHNKFoot；
 * SQLite 用 node:sqlite 建，CanvasPreview.ImageData 大到要用溢出页，Layer 表多到要用内部页）· png · 假 psd（图像资源 1036 是一张 JPEG）·
 * zip · 随便几个字节的 rar · .DS_Store；名字覆盖 §18.5 的每一种问题。还有一段 10 行的粘贴列表（audit-paste.txt）。
 * 生成的结果固定（同样的代码永远生成同样的字节），提交进仓库；要 Node 22.13 以上（node:sqlite）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 as zcrc32 } from "node:zlib";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
const OUT = join(ROOT, "audit");
const MTIME = new Date("2026-10-20T06:00:00Z");

// ---------------------------------------------------------------------------
// 画：RGB 画布 · 色块 · 5×7 点阵字
// ---------------------------------------------------------------------------

const FONT = {
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  0: ["01110", "10011", "10101", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
};

function canvas(w, h, bg) {
  const px = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) px.set(bg, i * 3);
  return { w, h, px };
}

function rect(c, x0, y0, x1, y1, rgb) {
  for (let y = Math.max(0, y0); y < Math.min(c.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(c.w, x1); x++) c.px.set(rgb, (y * c.w + x) * 3);
}

function text(c, s, x, y, scale, rgb) {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT[" "];
    g.forEach((row, ry) => {
      for (let rx = 0; rx < 5; rx++) if (row[rx] === "1") rect(c, cx + rx * scale, y + ry * scale, cx + (rx + 1) * scale, y + (ry + 1) * scale, rgb);
    });
    cx += 6 * scale;
  }
}

/** 一张假图：底色 · 几块色块 · 「TEST」· 一行标签（例「LO 001」）。noise = 加一条有花纹的带子，让 PNG 不那么好压（要用到溢出页）。 */
function picture(w, h, color, label, noise = 0) {
  const c = canvas(w, h, [251, 250, 247]);
  rect(c, Math.round(w * 0.08), Math.round(h * 0.12), Math.round(w * 0.46), Math.round(h * 0.88), color);
  rect(c, Math.round(w * 0.52), Math.round(h * 0.55), Math.round(w * 0.92), Math.round(h * 0.88), color.map((v) => Math.round(v * 0.7)));
  const s = Math.max(2, Math.round(h / 40));
  text(c, "TEST", Math.round(w * 0.54), Math.round(h * 0.14), s, [26, 26, 26]);
  text(c, label, Math.round(w * 0.54), Math.round(h * 0.14) + s * 10, Math.max(1, s - 1), [80, 80, 80]);
  if (noise) {
    let seed = noise;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 0xff;
    for (let y = Math.round(h * 0.9); y < h; y++) for (let x = 0; x < w; x++) c.px.set([rand(), rand(), rand()], (y * w + x) * 3);
  }
  return c;
}

// ---------------------------------------------------------------------------
// 编码：PNG · 灰度 JPEG（基线）
// ---------------------------------------------------------------------------

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  return Buffer.concat([u32(data.length), t, data, u32(zcrc32(Buffer.concat([t, data])))]);
}

function png(c) {
  const raw = Buffer.alloc((c.w * 3 + 1) * c.h);
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 3 + 1)] = 0;
    Buffer.from(c.px.buffer, y * c.w * 3, c.w * 3).copy(raw, y * (c.w * 3 + 1) + 1);
  }
  const ihdr = Buffer.concat([u32(c.w), u32(c.h), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const QLUM = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
  0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

/** 标准的规范 Huffman 码：同样长度的码连着排，长度加一时左移一位。 */
function huffCodes(bits, vals) {
  const out = new Map();
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) out.set(vals[k++], { code: code++, len });
    code <<= 1;
  }
  return out;
}

function jpegGray(c, quality = 80) {
  const w = c.w;
  const h = c.h;
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  const q = QLUM.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
  const dc = huffCodes(DC_BITS, DC_VALS);
  const ac = huffCodes(AC_BITS, AC_VALS);
  const bytes = [];
  let acc = 0;
  let nbits = 0;
  const put = (code, len) => {
    for (let i = len - 1; i >= 0; i--) {
      acc = (acc << 1) | ((code >> i) & 1);
      nbits++;
      if (nbits === 8) {
        bytes.push(acc);
        if (acc === 0xff) bytes.push(0);
        acc = 0;
        nbits = 0;
      }
    }
  };
  const cat = (v) => {
    let a = Math.abs(v);
    let n = 0;
    while (a) {
      n++;
      a >>= 1;
    }
    return n;
  };
  const bitsOf = (v, n) => (v >= 0 ? v : v + (1 << n) - 1);
  const gray = (x, y) => {
    const xx = Math.min(w - 1, x);
    const yy = Math.min(h - 1, y);
    const i = (yy * w + xx) * 3;
    return 0.299 * c.px[i] + 0.587 * c.px[i + 1] + 0.114 * c.px[i + 2];
  };
  const cos = [];
  for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) cos[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  let prevDc = 0;
  for (let by = 0; by < h; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      const block = new Array(64);
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          let sum = 0;
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sum += (gray(bx + x, by + y) - 128) * cos[x * 8 + u] * cos[y * 8 + v];
          const cu = u === 0 ? Math.SQRT1_2 : 1;
          const cv = v === 0 ? Math.SQRT1_2 : 1;
          block[v * 8 + u] = 0.25 * cu * cv * sum;
        }
      }
      const zz = ZIGZAG.map((n) => Math.round(block[n] / q[n]));
      const diff = zz[0] - prevDc;
      prevDc = zz[0];
      const dn = cat(diff);
      put(dc.get(dn).code, dc.get(dn).len);
      if (dn) put(bitsOf(diff, dn), dn);
      let run = 0;
      for (let k = 1; k < 64; k++) {
        if (zz[k] === 0) {
          run++;
          continue;
        }
        while (run > 15) {
          put(ac.get(0xf0).code, ac.get(0xf0).len);
          run -= 16;
        }
        const n = cat(zz[k]);
        const sym = (run << 4) | n;
        put(ac.get(sym).code, ac.get(sym).len);
        put(bitsOf(zz[k], n), n);
        run = 0;
      }
      if (run) put(ac.get(0x00).code, ac.get(0x00).len);
    }
  }
  if (nbits) put((1 << (8 - nbits)) - 1, 8 - nbits);
  const seg = (marker, body) => Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff]), Buffer.from(body)]);
  const dqt = [0, ...ZIGZAG.map((n) => q[n])];
  const sof = [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0];
  const dht = (cls, bits, vals) => [cls, ...bits, ...vals];
  const sos = [1, 1, 0x00, 0, 63, 0];
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    seg(0xdb, dqt),
    seg(0xc0, sof),
    seg(0xc4, dht(0x00, DC_BITS, DC_VALS)),
    seg(0xc4, dht(0x10, AC_BITS, AC_VALS)),
    seg(0xda, sos),
    Buffer.from(bytes),
    Buffer.from([0xff, 0xd9]),
  ]);
}

// ---------------------------------------------------------------------------
// 假 psd · 假 clip · zip
// ---------------------------------------------------------------------------

function be(n, len) {
  const b = Buffer.alloc(len);
  if (len === 8) b.writeBigUInt64BE(BigInt(n));
  else if (len === 4) b.writeUInt32BE(n);
  else b.writeUInt16BE(n);
  return b;
}

/** 照 Photoshop 文件格式拼：文件头 · 色彩模式（空）· 图像资源（1036 缩略图 = JPEG）· 图层（空）· 合成图（PackBits，全是 0）。 */
function psd(width, height, thumb) {
  const jpg = jpegGray(thumb, 80);
  const widthBytes = Math.floor((thumb.w * 24 + 31) / 32) * 4;
  const resData = Buffer.concat([be(1, 4), be(thumb.w, 4), be(thumb.h, 4), be(widthBytes, 4), be(widthBytes * thumb.h, 4), be(jpg.length, 4), be(24, 2), be(1, 2), jpg]);
  const padded = resData.length % 2 ? Buffer.concat([resData, Buffer.alloc(1)]) : resData;
  const res = Buffer.concat([Buffer.from("8BIM"), be(1036, 2), Buffer.from([0, 0]), be(resData.length, 4), padded]);
  const head = Buffer.concat([Buffer.from("8BPS"), be(1, 2), Buffer.alloc(6), be(3, 2), be(height, 4), be(width, 4), be(8, 2), be(3, 2)]);
  // 合成图：PackBits，每行 = 一串 0
  const rowBytes = [];
  let left = width;
  while (left > 0) {
    const n = Math.min(128, left);
    rowBytes.push(257 - n, 0);
    left -= n;
  }
  const row = Buffer.from(rowBytes);
  const counts = Buffer.concat(Array.from({ length: height * 3 }, () => be(row.length, 2)));
  const rows = Buffer.concat(Array.from({ length: height * 3 }, () => row));
  return Buffer.concat([head, be(0, 4), be(res.length, 4), res, be(0, 4), be(1, 2), counts, rows]);
}

/** 照 SPEC §18.1 建 SQLite：CanvasPreview · Canvas · TimeLine · Layer（顶层文件夹 + 一堆普通层，让 Layer 表用到内部页）。 */
function clipSqlite({ preview, canvas: cv, fps, frames, folders }) {
  const path = join(tmpdir(), `arps-fixture-${process.pid}-${Math.random().toString(16).slice(2)}.sqlite`);
  const db = new DatabaseSync(path);
  db.exec("PRAGMA page_size = 4096; PRAGMA journal_mode = DELETE;");
  db.exec(`
    CREATE TABLE Canvas (MainId INTEGER PRIMARY KEY, CanvasUnit INTEGER, CanvasWidth REAL, CanvasHeight REAL, CanvasResolution REAL, CanvasRootFolder INTEGER);
    CREATE TABLE CanvasPreview (MainId INTEGER PRIMARY KEY, CanvasId INTEGER, ImageType INTEGER, ImageWidth INTEGER, ImageHeight INTEGER, ImageData BLOB);
    CREATE TABLE TimeLine (MainId INTEGER PRIMARY KEY, CanvasId INTEGER, FrameRate REAL, StartFrame INTEGER, EndFrame INTEGER);
    CREATE TABLE Layer (MainId INTEGER PRIMARY KEY, CanvasId INTEGER, LayerName TEXT, LayerFolder INTEGER, LayerFirstChildIndex INTEGER, LayerNextIndex INTEGER);
  `);
  db.prepare("INSERT INTO Canvas VALUES (1, 0, ?, ?, ?, 2)").run(cv.width, cv.height, cv.dpi);
  db.prepare("INSERT INTO CanvasPreview VALUES (1, 1, 1, ?, ?, ?)").run(preview.w, preview.h, png(preview));
  db.prepare("INSERT INTO TimeLine VALUES (1, 1, ?, 0, ?)").run(fps, frames);
  // 根文件夹 2 → 顶层：folders（文件夹）+ 一个普通层；每个文件夹下面挂一串普通层
  const ins = db.prepare("INSERT INTO Layer VALUES (?, 1, ?, ?, ?, ?)");
  let id = 10;
  const tops = folders.map((name) => ({ id: id++, name }));
  const plain = id++;
  ins.run(2, "root", 1, tops[0]?.id ?? plain, 0);
  tops.forEach((t, i) => {
    const first = id;
    const kids = 60;
    for (let k = 0; k < kids; k++) {
      ins.run(id, `layer ${t.id}-${k}`, 0, 0, k === kids - 1 ? 0 : id + 1);
      id++;
    }
    ins.run(t.id, t.name, 1, first, i === tops.length - 1 ? plain : tops[i + 1].id);
  });
  ins.run(plain, "paper", 0, 0, 0);
  db.close();
  const bytes = readFileSync(path);
  rmSync(path, { force: true });
  return bytes;
}

function chunk(name, body) {
  return Buffer.concat([Buffer.from(name, "ascii"), be(body.length, 8), body]);
}

function clip(opts) {
  const sqlite = clipSqlite(opts);
  const filler = (n, seed) => {
    const b = Buffer.alloc(n);
    let s = seed;
    for (let i = 0; i < n; i++) b[i] = (s = (s * 1664525 + 1013904223) >>> 0) >>> 24;
    return b;
  };
  const chunks = Buffer.concat([
    chunk("CHNKHead", Buffer.concat([be(1, 8), be(0, 8), Buffer.from("TEST-HEAD-FIXTURE-ONLY-0000000000", "ascii")])),
    chunk("CHNKExta", filler(3000, 1)),
    chunk("CHNKExta", filler(2000, 2)),
    chunk("CHNKExta", filler(1000, 3)),
    chunk("CHNKSQLi", sqlite),
    chunk("CHNKFoot", Buffer.alloc(0)),
  ]);
  const total = 24 + chunks.length;
  return Buffer.concat([Buffer.from("CSFCHUNK", "ascii"), be(total, 8), be(24, 8), chunks]);
}

/** 不压缩的 zip（stored），名字标 UTF-8。 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = (6 << 11) | (0 << 5);
  const dosDate = ((2026 - 1980) << 9) | (10 << 5) | 20;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = zcrc32(e.data);
    const local = Buffer.concat([le(0x04034b50, 4), Buffer.from([20, 0, 0, 8, 0, 0]), le(dosTime, 2), le(dosDate, 2), le(crc, 4), le(e.data.length, 4), le(e.data.length, 4), le(name.length, 2), le(0, 2), name, e.data]);
    const central = Buffer.concat([le(0x02014b50, 4), Buffer.from([20, 0, 20, 0, 0, 8, 0, 0]), le(dosTime, 2), le(dosDate, 2), le(crc, 4), le(e.data.length, 4), le(e.data.length, 4), le(name.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4), name]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([le(0x06054b50, 4), le(0, 2), le(0, 2), le(entries.length, 2), le(entries.length, 2), le(cd.length, 4), le(offset, 4), le(0, 2)]);
  return Buffer.concat([...locals, cd, eocd]);
}

function le(n, len) {
  const b = Buffer.alloc(len);
  if (len === 4) b.writeUInt32LE(n >>> 0);
  else b.writeUInt16LE(n);
  return b;
}

// ---------------------------------------------------------------------------
// 文件夹树（安娜的旅程 ANDLC 的盘点）
// ---------------------------------------------------------------------------

const COLORS = { LO: [214, 214, 214], H: [201, 162, 122], CLN: [159, 183, 214], ANI: [246, 220, 200], BG: [150, 190, 150] };
const pic = (code, label, w = 320, h = 180) => png(picture(w, h, COLORS[code] ?? [200, 200, 200], label));

const files = [
  // LO：对上 · 没补零 · 放错文件夹（名字 CUT005 放在 /CUT004/）
  ["EP01/LO/SC001/CUT001/ANDLC_EP01_SC001_CUT001_LO_v01.clip", clip({ preview: picture(736, 414, COLORS.LO, "LO 001", 7), canvas: { width: 1920, height: 1080, dpi: 350 }, fps: 24, frames: 144, folders: ["原画", "修线", "动画", "标注"] })],
  ["EP01/LO/SC001/CUT002/ANDLC_EP01_SC001_CUT002_LO_v01.png", pic("LO", "LO 002")],
  ["EP01/LO/SC001/CUT003/ANDLC_EP01_SC001_CUT3_LO_v01.png", pic("LO", "LO 003")],
  ["EP01/LO/SC001/CUT004/ANDLC_EP01_SC001_CUT005_LO_v01.png", pic("LO", "LO 005")],
  // 放错文件夹：流程是 H、放在 /LO/ 里
  ["EP01/LO/SC001/CUT006/ANDLC_EP01_SC001_CUT006_H_v01.png", pic("H", "H 006")],
  // H：psd（读自带的缩略图）· 项目代号差一个字母
  ["EP01/H/SC001/CUT001/ANDLC_EP01_SC001_CUT001_H_v01.psd", psd(1920, 64, picture(160, 90, COLORS.H, "H 001"))],
  ["EP01/H/SC001/CUT002/ANLDC_EP01_SC001_CUT002_H_v01.png", pic("H", "H 002")],
  // CLN：对上
  ["EP01/CLN/SC001/CUT001/ANDLC_EP01_SC001_CUT001_A_CLN_v01.png", pic("CLN", "CLN 001")],
  ["EP01/CLN/SC001/CUT002/ANDLC_EP01_SC001_CUT002_B_CLN_v01.png", pic("CLN", "CLN 002")],
  // ANI：对上（.clip + 同名 .rar 合成一版）· zip（读目录）· 有文件系统没记 · 文件比系统新 · 同一版两个文件 · 不认识的流程代码 ·
  //      层不在这一卡里 · 卡不在卡表里 · 顺序不对 · 少一段（没有版本号）· 大小写不统一
  ["EP01/ANI/SC001/CUT001/ANDLC_EP01_SC001_CUT001_A_ANI_v01.clip", clip({ preview: picture(736, 414, COLORS.ANI, "ANI 001", 11), canvas: { width: 1920, height: 1080, dpi: 350 }, fps: 24, frames: 120, folders: ["原画", "动画"] })],
  ["EP01/ANI/SC001/CUT001/ANDLC_EP01_SC001_CUT001_A_ANI_v01.rar", Buffer.from("Rar!\u001a\u0007\u0001\u0000TEST-FIXTURE", "latin1")],
  ["EP01/ANI/SC001/CUT002/ANDLC_EP01_SC001_CUT002_A_ANI_v01.zip", zip([
    { name: "ANDLC_EP01_SC001_CUT002_A_ANI_v01.png", data: pic("ANI", "ANI 002") },
    { name: "readme.txt", data: Buffer.from("TEST fixture\n") },
  ])],
  ["EP01/ANI/SC001/CUT011/ANDLC_EP01_SC001_CUT011_B_ANI_v01.clip", clip({ preview: picture(736, 414, COLORS.ANI, "ANI 011", 13), canvas: { width: 2560, height: 1440, dpi: 350 }, fps: 24, frames: 120, folders: ["动画"] })],
  ["EP01/ANI/SC001/CUT009/ANDLC_EP01_SC001_CUT009_B_ANI_v04.png", pic("ANI", "ANI 009 4")],
  ["EP01/ANI/SC001/CUT014/ANDLC_EP01_SC001_CUT014_A_ANI_v01.png", pic("ANI", "ANI 014")],
  ["EP01/ANI/SC001/CUT014/ANDLC_EP01_SC001_CUT014_A_ANI_v01第一次修改后.png", pic("ANI", "ANI 014 2")],
  ["EP01/ANI/SC001/CUT010/ANDLC_EP01_SC001_CUT010_A_ANM_v01.png", pic("ANI", "ANI 010")],
  ["EP01/ANI/SC001/CUT001/ANDLC_EP01_SC001_CUT001_C_ANI_v01.png", pic("ANI", "ANI 001 C")],
  ["EP01/ANI/SC001/CUT021/ANDLC_EP01_SC001_CUT021_A_ANI_v01.png", pic("ANI", "ANI 021")],
  ["EP01/ANI/SC001/CUT003/ANDLC_EP01_CUT003_SC001_A_ANI_v02.png", pic("ANI", "ANI 003")],
  ["EP01/ANI/SC001/CUT004/ANDLC_EP01_SC001_CUT004_B_ANI.png", pic("ANI", "ANI 004")],
  ["EP01/ANI/SC001/CUT005/andlc_ep01_sc001_cut005_a_ani_v01.png", pic("ANI", "ANI 005")],
  // 不认识的层 · 版本跳号（C009 B 有 v01 v04，没有 v02 v03：只是信息）
  ["EP01/ANI/SC001/CUT006/ANDLC_EP01_SC001_CUT006_AB_ANI_v01.png", pic("ANI", "ANI 006")],
  ["EP01/ANI/SC001/CUT009/ANDLC_EP01_SC001_CUT009_B_ANI_v01.png", pic("ANI", "ANI 009 1")],
  // BG：有文件系统没记
  ["EP01/BG/SC001/CUT001/ANDLC_EP01_SC001_CUT001_BG_v01.png", pic("BG", "BG 001")],
  // 不是这个项目的 · 认不出的
  ["EP01/ANI/DMDS_EP01_SC001_CUT002_A_ANI_v01.png", pic("ANI", "DMDS")],
  ["EP01/.DS_Store", Buffer.from([0, 0, 0, 1, 0x42, 0x75, 0x64, 0x31, 0, 0, 0x10, 0])],
  ["EP01/IMG_0001.png", pic("LO", "IMG")],
];

rmSync(OUT, { recursive: true, force: true });
for (const [rel, data] of files) {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  utimesSync(p, MTIME, MTIME);
}

// 粘贴的列表：10 行，混着大小 · 日期 · 上传人这些字；有一行不像文件名
const paste = [
  "ANDLC_EP01_SC001_CUT006_A_ANI_v01.clip    18.2 MB   2026-10-20 14:02   测试员",
  "ANDLC_EP01_SC001_CUT006_B_ANI_v01.clip    17.9 MB   2026-10-20 14:05   测试员",
  "/EP01/ANI/SC001/CUT007/ANDLC_EP01_SC001_CUT007_A_ANI_v01.clip 3.1MB",
  "/EP01/ANI/SC001/CUT007/ANDLC_EP01_SC001_CUT007_B_ANI_v01.clip 3.0MB",
  "· ANDLC_EP01_SC001_CUT008_A_ANI_v01.png，上传者 测试员",
  "ANDLC_EP01_SC001_CUT008_B_ANI_v01.png\t2.2 MB\t10-21",
  "ANDLC_EP01_SC001_CUT012_A_ANI_v01.png  1.0MB",
  "ANDLC_EP01_SC001_CUT013_A_ANI_v01.png  1.0MB",
  "ANDLC_EP01_SC001_CUT002_BG_v01.png  0.8MB  2026-10-19",
  "名称\t大小\t修改时间",
].join("\n");
writeFileSync(join(ROOT, "audit-paste.txt"), paste + "\n");

console.log(`写好了 ${files.length} 个文件 → ${OUT}`);
