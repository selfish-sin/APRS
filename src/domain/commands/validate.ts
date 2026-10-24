/** 几样常用的输入检查（名字、登录名、口令的哈希、链接、文件名）。 */
import type { ReadModel } from "../readmodel";
import { mustText, rejectT, type Ctx } from "./core";
import type { Text2 } from "../text";
import { whatText } from "../what";

export function mustNickname(value: unknown): string {
  const s = mustText(value, "昵称", 16);
  if (/[\n\r\t]/.test(s)) rejectT("invalid", "nickname_newline");
  return s;
}

/** 登录名：2–24 位，字母、数字、点、横线、下划线。 */
export function mustLogin(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9_.-]{2,24}$/.test(s)) rejectT("invalid", "login_bad");
  return s.toLowerCase();
}

export function mustSalt(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{16,64}$/.test(value)) rejectT("invalid", "passcode_bad");
  return value;
}

export function mustHash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) rejectT("invalid", "passcode_bad");
  return value;
}

/** 飞书链接：只收 http / https。 */
export function optLink(value: unknown, what: string | Text2 = "链接"): string | null {
  if (value === undefined || value === null) return null;
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  if (!/^https?:\/\/[^\s/?#]+\.[^\s/?#]+/i.test(s)) rejectT("invalid", "url_scheme_example", { what: whatText(what) });
  if (s.length > 500) rejectT("invalid", "too_long", { what: whatText(what), max: 500 });
  return s;
}

/** 文件名：不能有斜杠和换行，最多 120 字。 */
export function optFileName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  if (/[\\/\n\r]/.test(s)) rejectT("invalid", "filename_bad");
  if (s.length > 120) rejectT("invalid", "filename_long");
  return s;
}

export function loginTaken(rm: ReadModel, login: string, exceptId?: string): boolean {
  return rm.where("accounts").some((a) => a.login === login && a.id !== exceptId);
}

export function nicknameTaken(rm: ReadModel, ctx: Ctx, nickname: string, exceptId?: string): boolean {
  return rm.where("members").some((m) => m.worldId === ctx.worldId && m.nickname === nickname && m.id !== exceptId);
}
