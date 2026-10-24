/**
 * 读文件的一小段（SPEC §18.3：不为了缩略图 / 指纹去读整个大文件）。
 * ByteSource 只要 size 和 read(start, end)；浏览器里用 Blob.slice，测试里可以数到底读了多少字节。
 */

export interface ByteSource {
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
}

/** 浏览器的 File / Blob → ByteSource。 */
export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: async (start, end) => new Uint8Array(await blob.slice(Math.max(0, start), Math.min(blob.size, end)).arrayBuffer()),
  };
}

/** 内存里的一段字节 → ByteSource（测试 · 压缩包里的小文件）。 */
export function bytesSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (start, end) => bytes.slice(Math.max(0, start), Math.min(bytes.length, end)) };
}

/** 数一共读了多少字节（测试用：读 30 MB 的 .clip 时读进内存的不超过 5 MB）。 */
export function countingSource(src: ByteSource): ByteSource & { bytesRead: () => number } {
  let n = 0;
  return {
    size: src.size,
    read: async (start, end) => {
      const b = await src.read(start, end);
      n += b.length;
      return b;
    },
    bytesRead: () => n,
  };
}

export function ascii(b: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = 0; i < len && start + i < b.length; i++) s += String.fromCharCode(b[start + i]);
  return s;
}

/** 大端无符号整数（最多 8 字节；超过 2^53 的当作坏文件）。 */
export function beUint(b: Uint8Array, start: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + b[start + i];
  return v;
}

export function leUint(b: Uint8Array, start: number, len: number): number {
  let v = 0;
  for (let i = len - 1; i >= 0; i--) v = v * 256 + b[start + i];
  return v;
}
