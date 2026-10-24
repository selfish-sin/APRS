/**
 * 文件本身存在哪（SPEC §11.1）：浏览器的 IndexedDB，库名 `arps-files`，按内容的 SHA-256 存，同一个文件只存一份。
 * 不让用 IndexedDB 的地方（有的预览框、无痕窗口）降级成只在内存里（页面顶上会说）。
 */
export const FILES_DB = "arps-files";
export const FILES_STORE = "blobs";
const VERSION = 1;

export interface StoredFile {
  sha256: string;
  mime: string;
  size: number;
  data: ArrayBuffer;
}

export interface FileStore {
  /** false = 只在内存里，关掉就没了。 */
  readonly persistent: boolean;
  put(file: StoredFile): Promise<void>;
  get(sha256: string): Promise<StoredFile | null>;
  keys(): Promise<string[]>;
  remove(sha256: string): Promise<void>;
}

export class MemoryFileStore implements FileStore {
  readonly persistent = false;
  private map = new Map<string, StoredFile>();
  async put(file: StoredFile) {
    this.map.set(file.sha256, { ...file, data: file.data.slice(0) });
  }
  async get(sha256: string) {
    const f = this.map.get(sha256);
    return f ? { ...f, data: f.data.slice(0) } : null;
  }
  async keys() {
    return Array.from(this.map.keys());
  }
  async remove(sha256: string) {
    this.map.delete(sha256);
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

export class IdbFileStore implements FileStore {
  readonly persistent = true;
  constructor(private db: IDBDatabase) {}

  /** 打开（或建）库；打不开、或者 `timeoutMs` 里没回音就失败。 */
  static open(factory: IDBFactory, timeoutMs = 5000): Promise<IdbFileStore> {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error("IndexedDB did not answer"));
        }
      }, timeoutMs);
      let r: IDBOpenDBRequest;
      try {
        r = factory.open(FILES_DB, VERSION);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
        return;
      }
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE, { keyPath: "sha256" });
      };
      r.onsuccess = () => {
        clearTimeout(timer);
        if (done) return;
        done = true;
        resolve(new IdbFileStore(r.result));
      };
      r.onerror = () => {
        clearTimeout(timer);
        if (done) return;
        done = true;
        reject(r.error ?? new Error("IndexedDB open failed"));
      };
      r.onblocked = () => undefined;
    });
  }

  private store(mode: IDBTransactionMode) {
    return this.db.transaction(FILES_STORE, mode).objectStore(FILES_STORE);
  }

  async put(file: StoredFile) {
    await req(this.store("readwrite").put({ sha256: file.sha256, mime: file.mime, size: file.size, data: file.data }));
  }

  async get(sha256: string) {
    const v = (await req(this.store("readonly").get(sha256))) as StoredFile | undefined;
    return v ? { sha256: v.sha256, mime: v.mime, size: v.size, data: v.data } : null;
  }

  async keys() {
    return ((await req(this.store("readonly").getAllKeys())) as IDBValidKey[]).map(String);
  }

  async remove(sha256: string) {
    await req(this.store("readwrite").delete(sha256));
  }
}

/** 先试 IndexedDB；不行就内存。 */
export async function openFileStore(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): Promise<FileStore> {
  if (!factory) return new MemoryFileStore();
  try {
    const store = await IdbFileStore.open(factory);
    // 有的浏览器能打开、一写就报错（无痕）：试写一下。
    const probe = new Uint8Array([1]).buffer;
    await store.put({ sha256: "probe", mime: "", size: 1, data: probe });
    await store.remove("probe");
    return store;
  } catch {
    return new MemoryFileStore();
  }
}
