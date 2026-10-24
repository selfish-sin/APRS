/** 文件内容的 SHA-256（同一个文件只存一份，导入以后靠它对上）。WebCrypto 优先，没有就用纯 JS 的。 */
import { sha256BytesSync } from "@/lib/passcode";

export async function sha256OfBytes(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.subtle?.digest) {
    try {
      const buf = await c.subtle.digest("SHA-256", new Uint8Array(bytes));
      return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
    } catch {
      /* 落到纯 JS */
    }
  }
  return sha256BytesSync(bytes);
}

/** 字节 ↔ base64（导出「连文件一起」用）。 */
export function bytesToBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
  return btoa(out);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
