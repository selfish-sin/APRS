/** 几样常用的输入检查（名字、登录名、口令的哈希、链接、文件名）。 */
import type { ReadModel } from "../readmodel";
import { mustText, reject, type Ctx } from "./core";

export function mustNickname(value: unknown): string {
  const s = mustText(value, "昵称", 16);
  if (/[\n\r\t]/.test(s)) reject("invalid", "昵称里不能有换行");
  return s;
}

/** 登录名：2–24 位，字母、数字、点、横线、下划线。 */
export function mustLogin(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9_.-]{2,24}$/.test(s)) reject("invalid", "登录名要 2–24 位，只能用字母、数字、点、横线和下划线");
  return s.toLowerCase();
}

export function mustSalt(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{16,64}$/.test(value)) reject("invalid", "口令没有处理好，请重新输一次");
  return value;
}

export function mustHash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) reject("invalid", "口令没有处理好，请重新输一次");
  return value;
}

/** 飞书链接：只收 http / https。 */
export function optLink(value: unknown, what = "链接"): string | null {
  if (value === undefined || value === null) return null;
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  if (!/^https?:\/\/[^\s/?#]+\.[^\s/?#]+/i.test(s)) reject("invalid", `${what}要以 http:// 或 https:// 开头（例如飞书文件夹的链接）`);
  if (s.length > 500) reject("invalid", `${what}太长了（最多 500 字）`);
  return s;
}

/** 文件名：不能有斜杠和换行，最多 120 字。 */
export function optFileName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  if (/[\\/\n\r]/.test(s)) reject("invalid", "文件名里不能有斜杠或换行");
  if (s.length > 120) reject("invalid", "文件名太长了（最多 120 字）");
  return s;
}

export function loginTaken(rm: ReadModel, login: string, exceptId?: string): boolean {
  return rm.where("accounts").some((a) => a.login === login && a.id !== exceptId);
}

export function nicknameTaken(rm: ReadModel, ctx: Ctx, nickname: string, exceptId?: string): boolean {
  return rm.where("members").some((m) => m.worldId === ctx.worldId && m.nickname === nickname && m.id !== exceptId);
}
