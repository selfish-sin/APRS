/**
 * 只读的小 SQLite 读取器（SPEC §18.9）：只够读 .clip 里那个数据库的几张表。
 * 读：文件头（页大小 · 每页保留字节 · 文字编码）· sqlite_master · 表的 B 树（内部页 / 叶子页）· 溢出页 · 记录解码。
 * 不读索引、不支持 WITHOUT ROWID 表、不写。不用 sql.js（约 1 MB，单文件版会大很多）。
 * 坏文件 / 认不出的结构一律抛 SqliteError，调用的人当「读不出来」处理。
 */

export class SqliteError extends Error {}

export type SqlValue = null | number | bigint | string | Uint8Array;
export type SqlRow = Record<string, SqlValue> & { rowid: number };

const MAGIC = "SQLite format 3\u0000";

export interface SqliteDb {
  pageSize: number;
  /** 表名 → 根页号。 */
  tables(): string[];
  columns(table: string): string[];
  /** 一张表的全部行（按 rowid 从小到大）。 */
  rows(table: string, limit?: number): SqlRow[];
}

function fail(message: string): never {
  throw new SqliteError(message);
}

/** 读一个 varint（1–9 字节，大端，高位是「还有」）。 */
export function readVarint(b: Uint8Array, pos: number): [value: number, next: number] {
  let v = 0;
  for (let i = 0; i < 8; i++) {
    if (pos + i >= b.length) fail("varint 越界");
    const c = b[pos + i];
    v = v * 128 + (c & 0x7f);
    if (!(c & 0x80)) return [v, pos + i + 1];
  }
  if (pos + 8 >= b.length) fail("varint 越界");
  return [v * 256 + b[pos + 8], pos + 9];
}

function u16(b: Uint8Array, p: number): number {
  return (b[p] << 8) | b[p + 1];
}

function u32(b: Uint8Array, p: number): number {
  return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
}

interface Column {
  name: string;
  /** INTEGER PRIMARY KEY：记录里存的是 NULL，值就是 rowid。 */
  rowidAlias: boolean;
}

/** 从 CREATE TABLE 语句里拿列名（够用就好：按括号外的逗号切）。 */
export function parseColumns(sql: string): Column[] {
  const start = sql.indexOf("(");
  const end = sql.lastIndexOf(")");
  if (start < 0 || end <= start) return [];
  const body = sql.slice(start + 1, end);
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "[") {
      quote = "]";
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const out: Column[] = [];
  for (const raw of parts) {
    const def = raw.trim();
    if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(def)) continue;
    const m = def.match(/^("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|'([^']+)'|(\S+))/);
    if (!m) continue;
    const name = m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? "";
    out.push({ name, rowidAlias: /^\S+\s+INTEGER\s+PRIMARY\s+KEY/i.test(def) });
  }
  return out;
}

export function openSqlite(bytes: Uint8Array): SqliteDb {
  if (bytes.length < 100) fail("太短");
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) fail("不是 SQLite");
  const rawPage = u16(bytes, 16);
  const pageSize = rawPage === 1 ? 65536 : rawPage;
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) fail("页大小不对");
  const reserved = bytes[20];
  const usable = pageSize - reserved;
  const encoding = u32(bytes, 56) || 1;
  const decoder = new TextDecoder(encoding === 2 ? "utf-16le" : encoding === 3 ? "utf-16be" : "utf-8");
  const pageCount = Math.floor(bytes.length / pageSize);

  const page = (n: number): Uint8Array => {
    if (n < 1 || n > pageCount) fail(`页号 ${n} 越界`);
    return bytes.subarray((n - 1) * pageSize, n * pageSize);
  };

  /** 一个叶子单元的完整内容（带溢出页）。 */
  const payloadOf = (pg: Uint8Array, pos: number, size: number): Uint8Array => {
    const maxLocal = usable - 35;
    if (size <= maxLocal) {
      if (pos + size > pg.length) fail("单元越界");
      return pg.subarray(pos, pos + size);
    }
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
    const k = minLocal + ((size - minLocal) % (usable - 4));
    const local = k <= maxLocal ? k : minLocal;
    const out = new Uint8Array(size);
    out.set(pg.subarray(pos, pos + local), 0);
    let filled = local;
    let next = u32(pg, pos + local);
    let guard = 0;
    while (filled < size) {
      if (!next || guard++ > pageCount) fail("溢出页断了");
      const op = page(next);
      const take = Math.min(usable - 4, size - filled);
      out.set(op.subarray(4, 4 + take), filled);
      filled += take;
      next = u32(op, 0);
    }
    return out;
  };

  /** 解码一条记录。 */
  const decodeRecord = (rec: Uint8Array): SqlValue[] => {
    const [headerSize, p0] = readVarint(rec, 0);
    const types: number[] = [];
    let p = p0;
    while (p < headerSize) {
      const [t, n] = readVarint(rec, p);
      types.push(t);
      p = n;
    }
    let off = headerSize;
    const values: SqlValue[] = [];
    const view = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    const int = (len: number): number | bigint => {
      if (off + len > rec.length) fail("记录越界");
      let v = 0n;
      for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(rec[off + i]);
      // 有符号
      const bits = BigInt(len * 8);
      if (v & (1n << (bits - 1n))) v -= 1n << bits;
      off += len;
      return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    };
    for (const t of types) {
      if (t === 0) values.push(null);
      else if (t >= 1 && t <= 4) values.push(int(t));
      else if (t === 5) values.push(int(6));
      else if (t === 6) values.push(int(8));
      else if (t === 7) {
        if (off + 8 > rec.length) fail("记录越界");
        values.push(view.getFloat64(off));
        off += 8;
      } else if (t === 8) values.push(0);
      else if (t === 9) values.push(1);
      else if (t >= 12) {
        const len = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
        if (off + len > rec.length) fail("记录越界");
        const slice = rec.subarray(off, off + len);
        values.push(t % 2 === 0 ? slice : decoder.decode(slice));
        off += len;
      } else fail("不认识的类型");
    }
    return values;
  };

  /** 走一棵表的 B 树，按 rowid 顺序交出每条（rowid, 记录）。 */
  const walk = (root: number, visit: (rowid: number, rec: Uint8Array) => boolean | void): void => {
    const seen = new Set<number>();
    const go = (n: number): boolean => {
      if (seen.has(n)) fail("B 树有环");
      seen.add(n);
      const pg = page(n);
      const h = n === 1 ? 100 : 0;
      const type = pg[h];
      const cells = u16(pg, h + 3);
      if (type === 0x0d) {
        for (let i = 0; i < cells; i++) {
          const cp = u16(pg, h + 8 + i * 2);
          const [size, p1] = readVarint(pg, cp);
          const [rowid, p2] = readVarint(pg, p1);
          if (visit(rowid, payloadOf(pg, p2, size)) === false) return false;
        }
        return true;
      }
      if (type === 0x05) {
        for (let i = 0; i < cells; i++) {
          const cp = u16(pg, h + 12 + i * 2);
          if (!go(u32(pg, cp))) return false;
        }
        return go(u32(pg, h + 8));
      }
      fail(`不是表的页（${type}）`);
    };
    go(root);
  };

  // sqlite_master：type · name · tbl_name · rootpage · sql
  const schema = new Map<string, { root: number; columns: Column[] }>();
  walk(1, (_rowid, rec) => {
    const v = decodeRecord(rec);
    if (v[0] === "table" && typeof v[1] === "string" && typeof v[3] === "number") {
      schema.set(v[1], { root: v[3], columns: typeof v[4] === "string" ? parseColumns(v[4]) : [] });
    }
  });

  return {
    pageSize,
    tables: () => Array.from(schema.keys()),
    columns: (table) => schema.get(table)?.columns.map((c) => c.name) ?? [],
    rows: (table, limit = Infinity) => {
      const t = schema.get(table);
      if (!t) return [];
      const out: SqlRow[] = [];
      walk(t.root, (rowid, rec) => {
        const values = decodeRecord(rec);
        const row = { rowid } as SqlRow;
        t.columns.forEach((c, i) => {
          row[c.name] = c.rowidAlias && (values[i] === null || values[i] === undefined) ? rowid : values[i] ?? null;
        });
        out.push(row);
        return out.length < limit;
      });
      return out;
    },
  };
}
