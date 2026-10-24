/**
 * 口令（SPEC §10）：只存 salt 和 sha256(salt + ":" + 口令)，校验也这样算。
 * 用 WebCrypto 的 crypto.subtle.digest；有的地方（直接打开的文件、很旧的浏览器）没有它，
 * 就用下面这份纯 JS 的 SHA-256，结果一样（有测试）。
 *
 * 这是这台设备上的软锁（同一台设备上换人要输口令），不是真正的安全：
 * 数据在浏览器里，懂技术的人能绕过。真正的登录等接主服务器。
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 纯 JS 的 SHA-256（只在没有 crypto.subtle 时用）。 */
export function sha256HexSync(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length;
  const withPad = Math.ceil((len + 9) / 64) * 64;
  const msg = new Uint8Array(withPad);
  msg.set(bytes);
  msg[len] = 0x80;
  const bits = len * 8;
  const view = new DataView(msg.buffer);
  view.setUint32(withPad - 4, bits >>> 0);
  view.setUint32(withPad - 8, Math.floor(bits / 0x100000000));
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = Array.from(h);
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

function subtle(): SubtleCrypto | null {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.subtle && typeof c.subtle.digest === "function" ? c.subtle : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const s = subtle();
  if (s) {
    try {
      const buf = await s.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
    } catch {
      /* 落到纯 JS */
    }
  }
  return sha256HexSync(text);
}

export function hashPasscode(salt: string, passcode: string): Promise<string> {
  return sha256Hex(`${salt}:${passcode}`);
}

/** 16 字节随机 salt（hex）。 */
export function newSalt(): string {
  const out = new Uint8Array(16);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(out);
  else for (let i = 0; i < out.length; i++) out[i] = Math.floor(Math.random() * 256);
  return Array.from(out, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** 定长比较（不因为前几位对上就早早返回）。 */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPasscode(account: { salt: string; hash: string }, passcode: string): Promise<boolean> {
  if (!passcode) return false;
  return sameHex(await hashPasscode(account.salt, passcode), account.hash);
}

/** 口令的规矩：至少 6 位，最多 64 位。返回中文的问题，或 null。 */
export function passcodeProblem(passcode: string, again?: string): string | null {
  if (passcode.length < 6) return "口令至少 6 位";
  if (passcode.length > 64) return "口令最多 64 位";
  if (again !== undefined && again !== passcode) return "两次输的口令不一样";
  return null;
}

/** 算好一组 { salt, hash }，交给 account.create / account.set_passcode / guild.create。 */
export async function makePasscode(passcode: string): Promise<{ salt: string; hash: string }> {
  const salt = newSalt();
  return { salt, hash: await hashPasscode(salt, passcode) };
}
