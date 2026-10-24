/**
 * 盘点第 ① 步「放进来」（SPEC §18.3）：把拖进来 / 选的文件、粘贴的名字、zip 里的目录变成一条条「盘点的条目」。
 *
 *   - 文件本身默认不进浏览器：只读名字 · 路径 · 大小 · 修改时间 · 缩略图 · 读出来的信息；
 *   - 缩略图：图片和 .clip 预览缩到长边 640 像素再存（文件仓 = IndexedDB，按内容的 SHA-256，和资料库同一套）；
 *   - 指纹 = 大小 + 修改时间 + 缩略图的 SHA-256（不为了算指纹去读整个大文件）；
 *   - 一次最多同时读 4 个，能取消；读不出来的当「只有名字」，不报错、不卡住。
 * 纯的部分（认扩展名 · zip 里的条目 · 粘贴的名字 · 指纹）在上面，浏览器里才跑的（画缩略图 · 视频取帧）在下面。
 */
import type { AuditFileInfo, AuditThumb } from "@/domain/model";
import type { AuditItemInput } from "@/domain/commands/audit";
import { namesFromPaste, splitExt } from "@/domain/audit/names";
import { blobSource, bytesSource } from "./bytes";
import { readClip } from "./clip";
import { readPsdThumbnail, readZipDirectory, type ZipEntry } from "./archive";

export const THUMB_SIDE = 640;
export const CONCURRENCY = 4;
/** 「小图连原图一起存」只对这么大以下的图片。 */
export const FULL_KEEP_MAX = 20 * 1024 * 1024;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);
const ARCHIVE_EXT = new Set(["rar", "7z"]);

export function extOfName(name: string): string {
  const { exts } = splitExt(name.trim());
  if (exts.length) return exts[exts.length - 1];
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function kindOfName(name: string): AuditFileInfo["kind"] {
  const ext = extOfName(name);
  if (ext === "clip") return "clip";
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === "psd" || ext === "psb") return "psd";
  if (VIDEO_EXT.has(ext)) return "video";
  if (ext === "zip") return "zip";
  if (ARCHIVE_EXT.has(ext)) return "archive";
  return "other";
}

/** 认「同一个文件又放了一次」：大小 · 修改时间 · 缩略图 · 在文件夹里的路径（没有路径就是名字）。路径要算进去：同一批生成的两个文件，大小、时间、图都可能一样。 */
export function fingerprintOf(size: number, lastModified: number | null, thumbSha: string | null, where: string): string {
  return `${size}:${lastModified ?? ""}:${thumbSha ?? ""}:${where}`;
}

/** zip 里的文件（只读目录，不解压）：每个文件一条，路径 = zip 所在的文件夹 + zip 里的路径。 */
export function zipItems(zip: { name: string; path: string | null }, entries: ZipEntry[]): AuditItemInput[] {
  const folder = (zip.path ?? zip.name).replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  const out: AuditItemInput[] = [];
  for (const e of entries) {
    if (e.dir) continue;
    const name = e.path.split("/").pop() ?? e.path;
    if (!name || name.startsWith("__MACOSX") || e.path.startsWith("__MACOSX/")) continue;
    const mtime = e.mtime ? new Date(e.mtime).toISOString() : null;
    out.push({
      name,
      path: `${folder ? `${folder}/` : ""}${e.path}`,
      size: e.size,
      mtime,
      origin: "zip",
      container: zip.name,
      fingerprint: `zip:${zip.name}:${e.path}:${e.size}:${e.mtime ?? ""}`,
      thumb: null,
      info: { kind: kindOfName(name) },
    });
  }
  return out;
}

/** 粘贴的文件名列表：每行找像规范文件名的那一段（只有名字，没有图）。 */
export function pasteItems(text: string): AuditItemInput[] {
  return namesFromPaste(text).map((x) => ({ name: x.name, path: x.path, size: null, mtime: null, origin: "paste" as const, fingerprint: null, thumb: null, info: { kind: kindOfName(x.name) } }));
}

// ---------------------------------------------------------------------------
// 浏览器里：读一个文件
// ---------------------------------------------------------------------------

export interface ThumbStore {
  /** 存进文件仓，返回 SHA-256。 */
  put(bytes: Uint8Array, mime: string): Promise<string>;
}

export interface IntakeFile {
  file: File;
  /** 在拖进来的文件夹里的路径（没有 = 单个文件）。 */
  path: string | null;
}

export interface IntakeOptions {
  store: ThumbStore;
  keep: "thumbs" | "full";
  cancelled: () => boolean;
  onProgress: (done: number, total: number, current: IntakeLine | null) => void;
}

/** 读的时候列出来的一行（「✓ 预览 1472 × 828 · 24 帧 / 秒 · 6.0 秒」）。 */
export interface IntakeLine {
  name: string;
  size: number;
  state: "reading" | "done" | "nameOnly" | "unknown" | "archive" | "zip";
  thumb: AuditThumb | null;
  info: AuditFileInfo | null;
}

async function decodeToCanvas(blob: Blob): Promise<{ canvas: HTMLCanvasElement; width: number; height: number } | null> {
  if (typeof document === "undefined") return null;
  // 空文件 · 读不了的文件（读的时候被删了 / 网盘没下下来）：不往下试，免得 <img> 在控制台报「文件不可用」
  if (!blob.size) return null;
  try {
    await blob.slice(0, 1).arrayBuffer();
  } catch {
    return null;
  }
  let width = 0;
  let height = 0;
  let source: CanvasImageSource | null = null;
  let url: string | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(blob);
      width = bmp.width;
      height = bmp.height;
      source = bmp;
    }
  } catch {
    source = null;
  }
  if (!source) {
    url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("not an image"));
        el.src = url!;
      });
      width = img.naturalWidth;
      height = img.naturalHeight;
      source = img;
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
  }
  const scale = Math.min(1, THUMB_SIDE / Math.max(width, height, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (url) URL.revokeObjectURL(url);
  if ("close" in (source as ImageBitmap) && typeof (source as ImageBitmap).close === "function") (source as ImageBitmap).close();
  return { canvas, width, height };
}

async function canvasThumb(canvas: HTMLCanvasElement, store: ThumbStore): Promise<AuditThumb | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sha256 = await store.put(bytes, "image/jpeg");
  return { sha256, mime: "image/jpeg", width: canvas.width, height: canvas.height };
}

async function imageThumb(blob: Blob, store: ThumbStore): Promise<{ thumb: AuditThumb; width: number; height: number } | null> {
  const d = await decodeToCanvas(blob);
  if (!d) return null;
  const thumb = await canvasThumb(d.canvas, store);
  return thumb ? { thumb, width: d.width, height: d.height } : null;
}

/** 视频（浏览器能播的）：取第 1 秒一帧 + 读时长。 */
async function videoFrame(file: File, store: ThumbStore): Promise<{ thumb: AuditThumb | null; seconds: number | null; width: number; height: number } | null> {
  if (typeof document === "undefined" || !file.size) return null;
  try {
    await file.slice(0, 1).arrayBuffer();
  } catch {
    return null;
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  try {
    const meta = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 6000);
      video.onloadedmetadata = () => {
        clearTimeout(t);
        resolve(true);
      };
      video.onerror = () => {
        clearTimeout(t);
        resolve(false);
      };
    });
    if (!meta) return null;
    const seconds = Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : null;
    const at = Math.min(1, (video.duration || 2) / 2);
    const seeked = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 6000);
      video.onseeked = () => {
        clearTimeout(t);
        resolve(true);
      };
      video.currentTime = at;
    });
    let thumb: AuditThumb | null = null;
    if (seeked && video.videoWidth) {
      const scale = Math.min(1, THUMB_SIDE / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      thumb = await canvasThumb(canvas, store);
    }
    return { thumb, seconds, width: video.videoWidth, height: video.videoHeight };
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** 读一个文件 → 一条（zip 还有里面的几条）。读不出来就是「只有名字」。 */
export async function readOne(f: IntakeFile, opts: Pick<IntakeOptions, "store" | "keep">): Promise<{ items: AuditItemInput[]; line: IntakeLine }> {
  const { file } = f;
  const kind = kindOfName(file.name);
  const base: AuditItemInput = {
    name: file.name,
    path: f.path,
    size: file.size,
    mtime: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    origin: "file",
    fingerprint: null,
    thumb: null,
    info: { kind },
  };
  const extra: AuditItemInput[] = [];
  let state: IntakeLine["state"] = "nameOnly";
  try {
    if (kind === "clip") {
      const info = await readClip(blobSource(file));
      if (info) {
        base.info = { kind, canvas: info.canvas, fps: info.fps, frames: info.frames, seconds: info.seconds, folders: info.folders };
        if (info.preview) {
          const t = await imageThumb(new Blob([info.preview.bytes as BlobPart], { type: info.preview.type }), opts.store);
          if (t) base.thumb = t.thumb;
        }
        state = "done";
      }
    } else if (kind === "image") {
      const t = await imageThumb(file, opts.store);
      if (t) {
        base.thumb = t.thumb;
        base.info = { kind, canvas: { width: t.width, height: t.height, dpi: null } };
        state = "done";
        if (opts.keep === "full" && file.size <= FULL_KEEP_MAX) base.originalSha = await opts.store.put(new Uint8Array(await file.arrayBuffer()), file.type || "image/png");
      }
    } else if (kind === "psd") {
      const p = await readPsdThumbnail(blobSource(file));
      if (p) {
        base.info = { kind, canvas: p.canvas.width ? { width: p.canvas.width, height: p.canvas.height, dpi: null } : null };
        if (p.jpeg) {
          const t = await imageThumb(new Blob([p.jpeg as BlobPart], { type: "image/jpeg" }), opts.store);
          if (t) base.thumb = t.thumb;
        }
        state = base.thumb ? "done" : "nameOnly";
      }
    } else if (kind === "video") {
      const v = await videoFrame(file, opts.store);
      if (v) {
        base.thumb = v.thumb;
        base.info = { kind, seconds: v.seconds, canvas: v.width ? { width: v.width, height: v.height, dpi: null } : null };
        state = "done";
      }
    } else if (kind === "zip") {
      const entries = await readZipDirectory(blobSource(file));
      if (entries) {
        const inside = zipItems({ name: file.name, path: f.path }, entries);
        extra.push(...inside);
        base.info = { kind, entries: inside.length };
        state = "zip";
      }
    } else if (kind === "archive") state = "archive";
    else state = "unknown";
  } catch {
    state = "nameOnly";
  }
  base.fingerprint = fingerprintOf(file.size, file.lastModified || null, base.thumb?.sha256 ?? null, f.path ?? file.name);
  return { items: [base, ...extra], line: { name: file.name, size: file.size, state, thumb: base.thumb ?? null, info: base.info ?? null } };
}

/** 读一批：最多同时读 4 个；每读完一个报一次进度；取消了就停（已经读好的照样返回）。 */
export async function readAll(files: IntakeFile[], opts: IntakeOptions): Promise<{ items: AuditItemInput[]; lines: IntakeLine[]; cancelled: boolean }> {
  const items: AuditItemInput[][] = new Array(files.length);
  const lines: IntakeLine[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < files.length && !opts.cancelled()) {
      const i = next++;
      const r = await readOne(files[i], opts);
      items[i] = r.items;
      lines.push(r.line);
      done += 1;
      opts.onProgress(done, files.length, r.line);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  return { items: items.filter(Boolean).flat(), lines, cancelled: opts.cancelled() };
}

/** 拖进来的东西（可以有文件夹）→ 文件和它在文件夹里的路径。 */
export async function filesFromDrop(dt: DataTransfer): Promise<IntakeFile[]> {
  const out: IntakeFile[] = [];
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const e = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (e) entries.push(e);
  }
  if (!entries.length) {
    for (const file of Array.from(dt.files ?? [])) out.push({ file, path: null });
    return out;
  }
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => (entry as FileSystemFileEntry).file(resolve, () => resolve(null)));
      if (file) out.push({ file, path: entry.fullPath.replace(/^\//, "") || null });
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

/** 「选文件夹」/「选文件」的 <input> → 文件和路径（选文件夹时有 webkitRelativePath）。 */
export function filesFromInput(list: FileList | null): IntakeFile[] {
  return Array.from(list ?? []).map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || null }));
}

export { bytesSource };
