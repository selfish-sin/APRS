/**
 * 不用打开整个文件就能读的几种（SPEC §18.3 · §18.9）：
 *   .zip：读末尾的目录（End of central directory → central directory），拿到里面每个文件的路径 · 大小 · 修改时间，不解压；
 *   .psd / .psb：读文件里自带的缩略图（图像资源 1036，一张 JPEG）。
 * 读不出来一律返回 null。
 */
import { ascii, beUint, leUint, type ByteSource } from "./bytes";

export interface ZipEntry {
  path: string;
  size: number;
  /** 本地时间（zip 里存的是 DOS 时间，没有时区）：YYYY-MM-DDTHH:MM:SS。 */
  mtime: string | null;
  dir: boolean;
}

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const MAX_CENTRAL = 8 * 1024 * 1024;

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  // 没标 UTF-8 的：先当 UTF-8 试（很多工具其实写的是 UTF-8），不像就当 GBK（Windows 中文压缩包）。
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gbk").decode(bytes);
    } catch {
      return new TextDecoder("latin1").decode(bytes);
    }
  }
}

function dosTime(date: number, time: number): string | null {
  if (!date) return null;
  const y = 1980 + (date >> 9);
  const mo = (date >> 5) & 15;
  const d = date & 31;
  const h = time >> 11;
  const mi = (time >> 5) & 63;
  const s = (time & 31) * 2;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}`;
}

export async function readZipDirectory(src: ByteSource): Promise<ZipEntry[] | null> {
  try {
    if (src.size < 22) return null;
    const tailLen = Math.min(src.size, 65_557);
    const tail = await src.read(src.size - tailLen, src.size);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (leUint(tail, i, 4) === EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    let count = leUint(tail, eocd + 10, 2);
    let size = leUint(tail, eocd + 12, 4);
    let offset = leUint(tail, eocd + 16, 4);
    // ZIP64：找定位器
    if (offset === 0xffffffff || size === 0xffffffff || count === 0xffff) {
      const loc = eocd - 20;
      if (loc >= 0 && leUint(tail, loc, 4) === 0x07064b50) {
        const z64at = leUint(tail, loc + 8, 8);
        const z = await src.read(z64at, z64at + 56);
        if (leUint(z, 0, 4) === 0x06064b50) {
          count = leUint(z, 32, 8);
          size = leUint(z, 40, 8);
          offset = leUint(z, 48, 8);
        }
      }
    }
    if (size > MAX_CENTRAL || offset + size > src.size) return null;
    const cen = await src.read(offset, offset + size);
    const out: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cen.length; i++) {
      if (leUint(cen, p, 4) !== CEN) break;
      const flags = leUint(cen, p + 8, 2);
      const time = leUint(cen, p + 12, 2);
      const date = leUint(cen, p + 14, 2);
      const usize = leUint(cen, p + 24, 4);
      const nameLen = leUint(cen, p + 28, 2);
      const extraLen = leUint(cen, p + 30, 2);
      const commentLen = leUint(cen, p + 32, 2);
      const path = decodeName(cen.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0).replace(/\\/g, "/");
      out.push({ path, size: usize, mtime: dosTime(date, time), dir: path.endsWith("/") });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } catch {
    return null;
  }
}

export interface PsdThumb {
  width: number;
  height: number;
  /** 画布大小（文件头里的）。 */
  canvas: { width: number; height: number };
  jpeg: Uint8Array | null;
}

const MAX_RESOURCES = 8 * 1024 * 1024;

export async function readPsdThumbnail(src: ByteSource): Promise<PsdThumb | null> {
  try {
    if (src.size < 34) return null;
    const head = await src.read(0, 30);
    if (ascii(head, 0, 4) !== "8BPS") return null;
    const version = beUint(head, 4, 2);
    if (version !== 1 && version !== 2) return null;
    const canvas = { height: beUint(head, 14, 4), width: beUint(head, 18, 4) };
    const colorLen = beUint(head, 26, 4);
    const resAt = 30 + colorLen;
    const resLenBytes = await src.read(resAt, resAt + 4);
    const resLen = beUint(resLenBytes, 0, 4);
    if (resLen > MAX_RESOURCES) return { width: 0, height: 0, canvas, jpeg: null };
    const res = await src.read(resAt + 4, resAt + 4 + resLen);
    let p = 0;
    while (p + 12 <= res.length) {
      if (ascii(res, p, 4) !== "8BIM") break;
      const id = beUint(res, p + 4, 2);
      const nameLen = res[p + 6];
      let q = p + 6 + 1 + nameLen;
      if ((1 + nameLen) % 2) q += 1;
      const dataLen = beUint(res, q, 4);
      const data = q + 4;
      if (id === 1036 || id === 1033) {
        const format = beUint(res, data, 4);
        const width = beUint(res, data + 4, 4);
        const height = beUint(res, data + 8, 4);
        if (format === 1) return { width, height, canvas, jpeg: res.slice(data + 28, data + dataLen) };
      }
      p = data + dataLen + (dataLen % 2);
    }
    return { width: 0, height: 0, canvas, jpeg: null };
  } catch {
    return null;
  }
}
