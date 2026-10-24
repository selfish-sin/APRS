/**
 * 资料库的文件仓（SPEC §11）：文件本身在 IndexedDB（`arps-files`，按 SHA-256），信息走命令。
 *
 *   - 打开时试 IndexedDB；不行（有的预览框、无痕窗口）就只在内存里，页面顶上说一句。
 *   - 示范工会的示范图（代码画的 SVG）打开时放进仓里。
 *   - addFiles：算 SHA-256 → 存进仓 → 跑 file.add。同一个文件只存一份；
 *     记录里已经有、但这台设备上没有的文件（导入时没带文件）→ 放进来就「对上了」，不再多记一条。
 *   - 导出「连文件一起」/ 导入时放回去。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { demoImages } from "@/data/demoImages";
import type { FileSubject, Id } from "@/domain/model";
import { usedShas } from "@/domain/queries";
import { errorSay } from "@/domain/errors";
import { phrase, t2, uc, type Say } from "@/domain/text";
import type { EmbeddedFile } from "@/lib/migrations";
import { useStore } from "@/lib/store";
import { base64ToBytes, bytesToBase64, sha256OfBytes } from "./sha";
import { imageInfo } from "./image";
import { openFileStore, type FileStore } from "./store";

export interface AddTarget {
  subjectType: FileSubject;
  subjectId: Id;
  tags?: string[];
  stageKey?: string | null;
}

export interface AddReport {
  fileIds: Id[];
  /** 记录里本来就有、这次放回这台设备的。 */
  matched: number;
  /** 同一处已经有同一个文件，没再记。 */
  duplicates: number;
  /** 本来就有的那条记录（对上了的、重复的）。 */
  existing: Id[];
  errors: Say[];
}

export interface FilesApi {
  ready: boolean;
  /** false = 只在内存里（关掉页面就没了）。 */
  persistent: boolean;
  /** 这台设备上有的文件（sha256）。 */
  present: ReadonlySet<string>;
  /** 有就返回 object URL（同步；没准备好时返回 null 并开始准备）。 */
  urlOf: (sha256: string) => string | null;
  getBlob: (sha256: string) => Promise<Blob | null>;
  addFiles: (files: File[], target: AddTarget) => Promise<AddReport>;
  /** 导出「连文件一起」：这些文件的 base64；缺的不放。 */
  embed: () => Promise<{ files: Record<string, EmbeddedFile>; bytes: number; missing: number }>;
  /** 导入时把备份里的文件放回仓里。返回放了几个。 */
  importEmbedded: (files: Record<string, EmbeddedFile> | undefined) => Promise<number>;
  /** 存了多少字节（仓里的）+ 浏览器给的估算（IndexedDB 那部分）。 */
  usage: { storedBytes: number; storedFiles: number; estimate: { usage: number; quota: number } | null };
  refreshUsage: () => void;
}

const FilesContext = createContext<FilesApi | null>(null);

function pageLang(): "zh" | "en" {
  return typeof document !== "undefined" && document.documentElement.lang && !document.documentElement.lang.startsWith("zh") ? "en" : "zh";
}

/** 粘贴的截图没有像样的名字：「截图-20261023-0950.png」（English 界面下是 Screenshot-…）。 */
export function pastedName(mime: string, at = new Date(), lang: "zh" | "en" = pageLang()): string {
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "png";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${lang === "en" ? "Screenshot" : "截图"}-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.${ext}`;
}

function guessMime(name: string, given: string): string {
  if (given) return given;
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", txt: "text/plain", md: "text/markdown", zip: "application/zip", mp4: "video/mp4", webm: "video/webm" };
  return map[ext] ?? "";
}

export function FilesProvider({ children }: { children: ReactNode }) {
  const { world, base, dispatch } = useStore();
  const [store, setStore] = useState<FileStore | null>(null);
  const [present, setPresent] = useState<ReadonlySet<string>>(new Set());
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const [usage, setUsage] = useState<FilesApi["usage"]>({ storedBytes: 0, storedFiles: 0, estimate: null });
  const pending = useRef(new Set<string>());
  /** 仓打开以前来的导入 / 放文件，等它打开再做。 */
  const storeReady = useRef<{ promise: Promise<FileStore>; resolve: (s: FileStore) => void } | null>(null);
  if (!storeReady.current) {
    let resolve!: (s: FileStore) => void;
    const promise = new Promise<FileStore>((r) => (resolve = r));
    storeReady.current = { promise, resolve };
  }
  const worldRef = useRef(world);
  worldRef.current = world;

  useEffect(() => {
    let alive = true;
    openFileStore().then(async (s) => {
      if (!alive) return;
      let keys: string[] = [];
      try {
        keys = await s.keys();
      } catch {
        /* 空的 */
      }
      setStore(s);
      setPresent(new Set(keys));
      storeReady.current?.resolve(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 示范图放进仓里（示范工会，或者记录里用到了示范图的工会）。
  useEffect(() => {
    if (!store || !world) return;
    const used = new Set(usedShas(world).map((f) => f.sha256));
    const need = demoImages().filter((d) => (base === "demo" || used.has(d.sha256)) && !present.has(d.sha256));
    if (!need.length) return;
    let alive = true;
    (async () => {
      for (const d of need) {
        const bytes = new TextEncoder().encode(d.svg);
        await store.put({ sha256: d.sha256, mime: "image/svg+xml", size: bytes.length, data: bytes.buffer as ArrayBuffer }).catch(() => undefined);
      }
      if (alive) setPresent((prev) => new Set([...Array.from(prev), ...need.map((d) => d.sha256)]));
    })();
    return () => {
      alive = false;
    };
  }, [store, world, base, present]);

  const refreshUsage = useCallback(() => {
    if (!store) return;
    (async () => {
      let storedBytes = 0;
      let storedFiles = 0;
      const w = worldRef.current;
      const sizes = new Map((w ? usedShas(w) : []).map((f) => [f.sha256, f.size]));
      for (const sha of Array.from(present)) {
        storedFiles += 1;
        storedBytes += sizes.get(sha) ?? 0;
      }
      let estimate: { usage: number; quota: number } | null = null;
      try {
        const e = await navigator.storage?.estimate?.();
        if (e && typeof e.usage === "number" && typeof e.quota === "number") estimate = { usage: e.usage, quota: e.quota };
      } catch {
        /* 不支持 */
      }
      setUsage({ storedBytes, storedFiles, estimate });
    })();
  }, [store, present]);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  const getBlob = useCallback(
    async (sha256: string): Promise<Blob | null> => {
      if (!store) return null;
      const f = await store.get(sha256).catch(() => null);
      return f ? new Blob([f.data], { type: f.mime || "application/octet-stream" }) : null;
    },
    [store]
  );

  const urlOf = useCallback(
    (sha256: string): string | null => {
      const hit = urls.get(sha256);
      if (hit) return hit;
      if (!store || !present.has(sha256) || pending.current.has(sha256)) return null;
      pending.current.add(sha256);
      getBlob(sha256).then((blob) => {
        pending.current.delete(sha256);
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        setUrls((prev) => new Map(prev).set(sha256, url));
      });
      return null;
    },
    [urls, store, present, getBlob]
  );

  const addFiles = useCallback<FilesApi["addFiles"]>(
    async (files, target) => {
      const report: AddReport = { fileIds: [], matched: 0, duplicates: 0, existing: [], errors: [] };
      if (!store) {
        report.errors.push(t2("文件仓还没准备好，等一下再放", "The file store isn't ready yet. Try again in a moment"));
        return report;
      }
      const added = new Set<string>();
      for (const file of files) {
        try {
          const name = file.name && file.name !== "image.png" ? file.name : pastedName(file.type);
          const mime = guessMime(name, file.type);
          const bytes = new Uint8Array(await file.arrayBuffer());
          const sha256 = await sha256OfBytes(bytes);
          const wasHere = present.has(sha256) || added.has(sha256);
          await store.put({ sha256, mime, size: bytes.length, data: bytes.buffer as ArrayBuffer });
          added.add(sha256);
          const w = worldRef.current;
          const rows = w ? Object.values(w.files ?? {}).filter((f) => !f.archivedAt && f.sha256 === sha256) : [];
          const same = rows.find((f) => f.subjectType === target.subjectType && f.subjectId === target.subjectId);
          // 放进资料库（项目）时，同一个项目里已经有这个文件 = 对上了，不再记一条。
          const inProject = target.subjectType === "project" ? rows.find((f) => f.projectId === target.subjectId) : undefined;
          const hit = same ?? inProject;
          if (hit) {
            if (!wasHere) report.matched += 1;
            else report.duplicates += 1;
            report.existing.push(hit.id);
            continue;
          }
          const isImage = mime.startsWith("image/");
          const info = isImage ? await imageInfo(new Blob([bytes], { type: mime })) : null;
          const r = dispatch(
            "file.add",
            {
              sha256,
              name,
              mime,
              size: bytes.length,
              width: info?.width ?? null,
              height: info?.height ?? null,
              thumb: info?.thumb ?? null,
              subjectType: target.subjectType,
              subjectId: target.subjectId,
              tags: target.tags ?? [],
              stageKey: target.stageKey ?? null,
            },
            { quiet: true }
          );
          if (r.ok) report.fileIds.push(r.created.fileId);
          else report.errors.push(phrase("{name}：{why}", "{name}: {why}", { name: uc(name), why: errorSay(r.error) }));
        } catch (e) {
          report.errors.push(
            phrase("{name}：没能放进来（{why}）", "{name}: couldn't add it ({why})", {
              name: file.name ? uc(file.name) : t2("文件", "File"),
              why: e instanceof Error ? e.message : t2("读不了", "unreadable"),
            })
          );
        }
      }
      if (added.size) setPresent((prev) => new Set([...Array.from(prev), ...Array.from(added)]));
      return report;
    },
    [store, present, dispatch]
  );

  const embed = useCallback<FilesApi["embed"]>(async () => {
    const out: Record<string, EmbeddedFile> = {};
    let bytes = 0;
    let missing = 0;
    const w = worldRef.current;
    if (!w || !store) return { files: out, bytes, missing };
    for (const f of usedShas(w)) {
      const got = await store.get(f.sha256).catch(() => null);
      if (!got) {
        missing += 1;
        continue;
      }
      out[f.sha256] = { mime: got.mime || f.mime, size: got.size, data: bytesToBase64(new Uint8Array(got.data)) };
      bytes += got.size;
    }
    return { files: out, bytes, missing };
  }, [store]);

  const importEmbedded = useCallback<FilesApi["importEmbedded"]>(
    async (files) => {
      if (!files) return 0;
      const store = await storeReady.current!.promise;
      const put: string[] = [];
      for (const [sha256, f] of Object.entries(files)) {
        try {
          const bytes = base64ToBytes(f.data);
          // 只收对得上的（内容的 SHA-256 = 名字）。
          if ((await sha256OfBytes(bytes)) !== sha256) continue;
          await store.put({ sha256, mime: f.mime, size: bytes.length, data: bytes.buffer as ArrayBuffer });
          put.push(sha256);
        } catch {
          /* 这一个坏了，跳过 */
        }
      }
      if (put.length) setPresent((prev) => new Set([...Array.from(prev), ...put]));
      return put.length;
    },
    []
  );

  const api = useMemo<FilesApi>(
    () => ({ ready: !!store, persistent: store?.persistent ?? true, present, urlOf, getBlob, addFiles, embed, importEmbedded, usage, refreshUsage }),
    [store, present, urlOf, getBlob, addFiles, embed, importEmbedded, usage, refreshUsage]
  );
  return <FilesContext.Provider value={api}>{children}</FilesContext.Provider>;
}

export function useFiles(): FilesApi {
  const ctx = useContext(FilesContext);
  if (!ctx) throw new Error("useFiles must be used within FilesProvider");
  return ctx;
}

/** 一个文件的 object URL（这台设备上没有 = null）。 */
export function useFileUrl(sha256: string | null | undefined): string | null {
  const { urlOf } = useFiles();
  return sha256 ? urlOf(sha256) : null;
}
