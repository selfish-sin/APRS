import { createHash } from "node:crypto";

/** 测试里直接用 node 的 sha256（和页面里 WebCrypto 的算法一样）。 */
export function hashPasscodeSync(salt: string, passcode: string): string {
  return createHash("sha256").update(`${salt}:${passcode}`).digest("hex");
}
