/**
 * 读 CSP（Clip Studio Paint）的 .clip（SPEC §18.1）：只读文件尾部那一块，不读整个大文件。
 *   文件开头 `CSFCHUNK` + 8 字节总长 + 8 字节；后面一块接一块：8 字节块名 + 8 字节长度（大端）+ 内容。
 *   块：CHNKHead · 很多 CHNKExta（图层像素）· CHNKSQLi（一个 SQLite 数据库）· 最后 CHNKFoot（长度 0）。
 *   SQLite 里：CanvasPreview（ImageData = 一张 PNG）· Canvas（画布大小 · 分辨率 · 根文件夹）· TimeLine（帧率 · 起止帧）· Layer（顶层文件夹名）。
 * 先读最后 TAIL 字节找 CHNKSQLi（7 个真文件里它都紧挨着 CHNKFoot）；找不到再一块一块往后走（只读每块的 16 字节头）。
 * 读不出来返回 null（当「只有名字」），不报错、不卡住。
 */
import { ascii, beUint, type ByteSource } from "./bytes";
import { openSqlite, type SqlRow, type SqlValue } from "./sqlite";

/** 尾部先读多少（7 个真文件里 CHNKSQLi 是 0.5–2.4 MB）。 */
export const CLIP_TAIL_BYTES = 2.5 * 1024 * 1024;
/** CHNKSQLi 最大读多少（再大就不读了）。 */
const MAX_SQLITE = 16 * 1024 * 1024;
const HEADER = 24;

export interface ClipInfo {
  preview: { width: number; height: number; type: string; bytes: Uint8Array } | null;
  canvas: { width: number; height: number; dpi: number | null } | null;
  fps: number | null;
  frames: number | null;
  seconds: number | null;
  /** 顶层文件夹名（从根文件夹往下走一层）。 */
  folders: string[];
}

const num = (v: SqlValue | undefined): number | null => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : null);

/** 在尾部那段里找「CHNKSQLi + 长度」，而且这一块正好结束在 CHNKFoot 前面。 */
function findSqliteInTail(tail: Uint8Array, tailStart: number, fileSize: number): { start: number; length: number } | null {
  const foot = tail.length >= 16 && ascii(tail, tail.length - 16, 8) === "CHNKFoot" ? tail.length - 16 : -1;
  const want = "CHNKSQLi";
  for (let i = tail.length - 16; i >= 0; i--) {
    if (tail[i] !== 0x43 || ascii(tail, i, 8) !== want) continue;
    const len = beUint(tail, i + 8, 8);
    const end = i + 16 + len;
    if (foot >= 0 ? end === foot : tailStart + end <= fileSize) return { start: tailStart + i + 16, length: len };
  }
  return null;
}

async function walkForSqlite(src: ByteSource): Promise<{ start: number; length: number } | null> {
  let pos = HEADER;
  let guard = 0;
  while (pos + 16 <= src.size && guard++ < 100_000) {
    const h = await src.read(pos, pos + 16);
    const name = ascii(h, 0, 8);
    const len = beUint(h, 8, 8);
    if (!name.startsWith("CHNK")) return null;
    if (name === "CHNKSQLi") return { start: pos + 16, length: len };
    if (name === "CHNKFoot") return null;
    pos += 16 + len;
  }
  return null;
}

function topFolders(layers: SqlRow[], root: number | null): string[] {
  if (root === null) return [];
  const byId = new Map<number, SqlRow>();
  for (const l of layers) {
    const id = num(l.MainId);
    if (id !== null) byId.set(id, l);
  }
  const rootRow = byId.get(root);
  if (!rootRow) return [];
  const out: { name: string; folder: boolean }[] = [];
  let next = num(rootRow.LayerFirstChildIndex);
  const seen = new Set<number>();
  while (next && !seen.has(next) && out.length < 200) {
    seen.add(next);
    const l = byId.get(next);
    if (!l) break;
    if (typeof l.LayerName === "string") out.push({ name: l.LayerName, folder: !!num(l.LayerFolder) });
    next = num(l.LayerNextIndex);
  }
  const folders = out.filter((x) => x.folder);
  return (folders.length ? folders : out).map((x) => x.name);
}

export async function readClip(src: ByteSource): Promise<ClipInfo | null> {
  try {
    if (src.size < HEADER + 16) return null;
    const head = await src.read(0, 8);
    if (ascii(head, 0, 8) !== "CSFCHUNK") return null;
    const tailStart = Math.max(HEADER, src.size - CLIP_TAIL_BYTES);
    const tail = await src.read(tailStart, src.size);
    let at = findSqliteInTail(tail, tailStart, src.size);
    let bytes: Uint8Array | null = null;
    if (at && at.start >= tailStart) bytes = tail.subarray(at.start - tailStart, at.start - tailStart + at.length);
    else {
      at = await walkForSqlite(src);
      if (!at || at.length > MAX_SQLITE || at.start + at.length > src.size) return null;
      bytes = await src.read(at.start, at.start + at.length);
    }
    const db = openSqlite(bytes);
    const has = (t: string) => db.tables().includes(t);
    let preview: ClipInfo["preview"] = null;
    if (has("CanvasPreview")) {
      const rows = db.rows("CanvasPreview").filter((r) => r.ImageData instanceof Uint8Array);
      rows.sort((a, b) => (num(b.ImageWidth) ?? 0) - (num(a.ImageWidth) ?? 0));
      const r = rows[0];
      if (r) preview = { width: num(r.ImageWidth) ?? 0, height: num(r.ImageHeight) ?? 0, type: "image/png", bytes: r.ImageData as Uint8Array };
    }
    let canvas: ClipInfo["canvas"] = null;
    let root: number | null = null;
    if (has("Canvas")) {
      const c = db.rows("Canvas", 1)[0];
      if (c) {
        canvas = { width: Math.round(num(c.CanvasWidth) ?? 0), height: Math.round(num(c.CanvasHeight) ?? 0), dpi: num(c.CanvasResolution) };
        root = num(c.CanvasRootFolder);
      }
    }
    let fps: number | null = null;
    let frames: number | null = null;
    if (has("TimeLine")) {
      const t = db.rows("TimeLine", 1)[0];
      if (t) {
        fps = num(t.FrameRate);
        const s = num(t.StartFrame);
        const e = num(t.EndFrame);
        if (s !== null && e !== null) frames = e - s;
      }
    }
    const folders = has("Layer") ? topFolders(db.rows("Layer"), root) : [];
    return { preview, canvas, fps, frames, seconds: fps && frames !== null ? Math.round((frames / fps) * 10) / 10 : null, folders };
  } catch {
    return null;
  }
}
