/**
 * IDs：`<前缀>_<UUIDv7>`。
 *
 * 由命令层生成（ctx.newId），所以浏览器里离线建的东西，以后存到服务器上 id 不变。
 * 示范数据用 `seededIds()`：同样的种子永远生成同样的 id（也是合法的 UUIDv7）。
 */

export const ID_PREFIX = {
  worlds: "wld",
  members: "mem",
  accounts: "acc",
  enrollments: "enr",
  projects: "prj",
  stages: "stg",
  cuts: "cut",
  tasks: "tsk",
  submissions: "sub",
  reviews: "rev",
  threads: "thr",
  rulings: "rul",
  ledger: "led",
  files: "fil",
  pins: "pin",
  pages: "pag",
  blocks: "blk",
  audits: "aud",
  auditItems: "aui",
  journal: "jnl",
} as const;

export type IdTable = keyof typeof ID_PREFIX;
export type Prefix = (typeof ID_PREFIX)[IdTable];

const PREFIXES = new Set<string>(Object.values(ID_PREFIX));

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(out);
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

let lastMs = -1;
let seq = 0;

/**
 * UUIDv7 (RFC 9562): 48-bit unix ms · version 7 · 12-bit sequence · variant · 62 random bits.
 * The 12-bit field is a per-millisecond counter so ids created in the same
 * millisecond by this process still sort in creation order.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  if (nowMs === lastMs) {
    seq = (seq + 1) & 0xfff;
  } else {
    lastMs = nowMs;
    seq = randomBytes(2)[0] & 0x7f; // start low so the counter rarely wraps
  }
  const b = randomBytes(16);
  const ms = BigInt(nowMs);
  for (let i = 0; i < 6; i++) {
    b[i] = Number((ms >> BigInt(8 * (5 - i))) & BigInt(0xff));
  }
  b[6] = 0x70 | ((seq >> 8) & 0x0f);
  b[7] = seq & 0xff;
  b[8] = 0x80 | (b[8] & 0x3f);
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newId(prefix: Prefix, nowMs?: number): string {
  return `${prefix}_${uuidv7(nowMs)}`;
}

export function prefixOf(id: string): string | null {
  const i = id.indexOf("_");
  if (i <= 0) return null;
  const p = id.slice(0, i);
  return PREFIXES.has(p) ? p : null;
}

/** True when `id` carries the prefix that belongs to `table`. */
export function isIdOf(table: IdTable, id: string): boolean {
  return prefixOf(id) === ID_PREFIX[table];
}

/** mulberry32：小而确定的伪随机数（只给示范数据用）。 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 确定的 id 生成器：给同样的种子、同样的调用顺序和时间，永远给出同样的 id。
 * 示范工会的底就是用它一步一步跑命令建出来的（换版本不会变成另一批 id）。
 */
export function seededIds(seed: number) {
  const rand = mulberry32(seed);
  let counter = 0;
  return (table: IdTable, nowMs: number): string => {
    counter += 1;
    const b = new Uint8Array(16);
    for (let i = 0; i < 16; i++) b[i] = Math.floor(rand() * 256);
    const ms = BigInt(Math.max(0, Math.floor(nowMs)));
    for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & BigInt(0xff));
    const c = counter & 0xfff;
    b[6] = 0x70 | ((c >> 8) & 0x0f);
    b[7] = c & 0xff;
    b[8] = 0x80 | (b[8] & 0x3f);
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${ID_PREFIX[table]}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}
