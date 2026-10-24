/**
 * 测试用的内存版 IndexedDB（只实现 IdbFileStore 用到的那几样：open · 建表 · put · get · getAllKeys · delete）。
 * 不加依赖（fake-indexeddb），够用就行。请求和浏览器一样是异步回调。
 */
type Value = Record<string, unknown>;

class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
  succeed(v: T) {
    this.result = v;
    queueMicrotask(() => this.onsuccess?.());
  }
  fail(e: Error) {
    this.error = e;
    queueMicrotask(() => this.onerror?.());
  }
}

class FakeStore {
  constructor(private rows: Map<string, Value>, private keyPath: string) {}
  put(v: Value) {
    const r = new FakeRequest<string>();
    const key = String(v[this.keyPath]);
    this.rows.set(key, structuredClone(v));
    r.succeed(key);
    return r;
  }
  get(key: string) {
    const r = new FakeRequest<Value | undefined>();
    const v = this.rows.get(String(key));
    r.succeed(v ? structuredClone(v) : undefined);
    return r;
  }
  getAllKeys() {
    const r = new FakeRequest<string[]>();
    r.succeed(Array.from(this.rows.keys()));
    return r;
  }
  delete(key: string) {
    const r = new FakeRequest<undefined>();
    this.rows.delete(String(key));
    r.succeed(undefined);
    return r;
  }
}

class FakeDb {
  stores = new Map<string, { rows: Map<string, Value>; keyPath: string }>();
  get objectStoreNames() {
    const names = this.stores;
    return { contains: (n: string) => names.has(n) };
  }
  createObjectStore(name: string, opts: { keyPath: string }) {
    this.stores.set(name, { rows: new Map(), keyPath: opts.keyPath });
  }
  transaction(name: string) {
    const s = this.stores.get(name);
    if (!s) throw new Error(`no store ${name}`);
    return { objectStore: () => new FakeStore(s.rows, s.keyPath) };
  }
}

/** 一个假的 indexedDB 工厂；`broken = true` 时 open 直接失败（模拟不让存的环境）。 */
export function fakeIndexedDB(broken = false): IDBFactory {
  const dbs = new Map<string, FakeDb>();
  return {
    open(name: string) {
      const r = new FakeRequest<FakeDb>();
      if (broken) {
        r.fail(new Error("SecurityError"));
        return r as unknown as IDBOpenDBRequest;
      }
      let db = dbs.get(name);
      const fresh = !db;
      if (!db) {
        db = new FakeDb();
        dbs.set(name, db);
      }
      r.result = db;
      queueMicrotask(() => {
        if (fresh) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}
