/**
 * 世界时间。示范工会把时钟冻结在 2026-10-23（`rules.clock.fixedNow`），每次打开都一样；
 * 自己建的工会跟着真实时间走。日期按北京时间（UTC+8，没有夏令时）算。
 * 页面和命令都不要自己写 +8 小时，用这里的函数。
 */
import type { IsoDate, IsoDateTime, WorldRow } from "./model";

const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function worldNow(world: WorldRow | undefined, realNow: IsoDateTime = new Date().toISOString()): IsoDateTime {
  const fixed = world?.rules?.clock?.fixedNow;
  return typeof fixed === "string" && !Number.isNaN(Date.parse(fixed)) ? new Date(fixed).toISOString() : realNow;
}

/** Local (UTC+8) calendar date of an instant. */
export function localDate(iso: IsoDateTime): IsoDate {
  return new Date(Date.parse(iso) + OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** 刚刚 · 3分钟前 · 2小时前 · 昨天 · 3天前 · 上周 · 9月2日 */
export function relativeZh(then: IsoDateTime, now: IsoDateTime): string {
  const diff = Date.parse(now) - Date.parse(then);
  const days = daysBetween(localDate(then), localDate(now));
  if (days <= 0) {
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
    return `${Math.floor(diff / 3_600_000)}小时前`;
  }
  if (days === 1) return "昨天";
  if (days < 7) return `${days}天前`;
  if (days < 14) return "上周";
  const d = localDate(then);
  return `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
}

/**
 * Same day `months` calendar months later (or earlier); a day past the end of
 * the target month is clamped to its last day (1/31 + 1 → 2/28, 2028-01-31 + 1 → 2028-02-29).
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12; // 0–11
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${String(ty).padStart(4, "0")}-${String(tm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Monday of the week `date` falls in (weeks start on Monday).
 */
export function weekStartOf(date: IsoDate): IsoDate {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

/**
 * The instant of a local (UTC+8) calendar date and clock time, as ISO UTC.
 * `atWorldClock("2026-10-23", "10:00")` → "2026-10-23T02:00:00.000Z".
 */
export function atWorldClock(date: IsoDate, hhmm: string): IsoDateTime {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`atWorldClock: bad time "${hhmm}"`);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return new Date(Date.parse(`${date}T00:00:00Z`) + minutes * 60_000 - OFFSET_MS).toISOString();
}

/** Local (UTC+8) clock time "HH:MM" of an instant. */
export function worldClockOf(iso: IsoDateTime): string {
  return new Date(Date.parse(iso) + OFFSET_MS).toISOString().slice(11, 16);
}

const HOUR_MS = 60 * 60 * 1000;

/** `iso` 往后 `hours` 小时（可以是小数）。 */
export function addHours(iso: IsoDateTime, hours: number): IsoDateTime {
  return new Date(Date.parse(iso) + Math.round(hours * HOUR_MS)).toISOString();
}

/** 两个时刻之间差几毫秒（to − from）。 */
export function msBetween(from: IsoDateTime, to: IsoDateTime): number {
  return Date.parse(to) - Date.parse(from);
}

/**
 * 倒计时的字：「2 天 5 小时」「5 小时 12 分」「12 分」；过了时限是「超时 3 小时」。
 * `big` 是任务单上的大数字（「05:12」或「2 天」），`unit` 是它旁边的小字。
 */
export function countdownZh(ms: number): { text: string; big: string; unit: string; overdue: boolean } {
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const days = Math.floor(abs / (24 * HOUR_MS));
  const hours = Math.floor((abs % (24 * HOUR_MS)) / HOUR_MS);
  const minutes = Math.floor((abs % HOUR_MS) / 60_000);
  let text: string;
  if (days > 0) text = `${days} 天 ${hours} 小时`;
  else if (hours > 0) text = `${hours} 小时 ${minutes} 分`;
  else text = `${minutes} 分`;
  const big = days > 0 ? String(days) : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const unit = days > 0 ? (overdue ? "天前就到时限了" : `天 ${hours} 小时`) : overdue ? "超时" : "小时:分";
  return { text: overdue ? `超时 ${text}` : `还剩 ${text}`, big, unit, overdue };
}

/** 「10月23日 14:00」（北京时间）。 */
export function dateTimeZh(iso: IsoDateTime): string {
  const d = localDate(iso);
  return `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日 ${worldClockOf(iso)}`;
}

/** 「2026年3月1日」。 */
export function dateZh(date: IsoDate): string {
  return `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}
