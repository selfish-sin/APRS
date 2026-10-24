/** 日期、数字按语言显示（SPEC §16）。时间照旧走数据层的世界时钟（localDate / worldClockOf）。 */
import { daysBetween, localDate, worldClockOf } from "@/domain/clock";
import type { IsoDate, IsoDateTime } from "@/domain/model";
import type { Lang } from "./core";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function parts(date: IsoDate) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, w };
}

/** 「2026年3月1日」/「Mar 1, 2026」 */
export function fmtDate(date: IsoDate, lang: Lang): string {
  const { y, m, d } = parts(date);
  return lang === "en" ? `${MONTHS[m - 1]} ${d}, ${y}` : `${y}年${m}月${d}日`;
}

/** 「10月23日 周五」/「Fri, Oct 23」 */
export function fmtDay(date: IsoDate, lang: Lang): string {
  const { m, d, w } = parts(date);
  return lang === "en" ? `${WEEK_EN[w]}, ${MONTHS[m - 1]} ${d}` : `${m}月${d}日 ${WEEK_ZH[w]}`;
}

/** 「10月23日」/「Oct 23」 */
export function fmtMonthDay(date: IsoDate, lang: Lang): string {
  const { m, d } = parts(date);
  return lang === "en" ? `${MONTHS[m - 1]} ${d}` : `${m}月${d}日`;
}

/** 「10月23日 14:00」/「Oct 23, 14:00」（世界时钟） */
export function fmtDateTime(iso: IsoDateTime, lang: Lang): string {
  const d = localDate(iso);
  return lang === "en" ? `${fmtMonthDay(d, lang)}, ${worldClockOf(iso)}` : `${fmtMonthDay(d, lang)} ${worldClockOf(iso)}`;
}

/** 刚刚 · 3分钟前 · 2小时前 · 昨天 · 3天前 · 上周 · 9月2日 / just now · 3 min ago … */
export function fmtRelative(then: IsoDateTime, now: IsoDateTime, lang: Lang): string {
  const diff = Date.parse(now) - Date.parse(then);
  const days = daysBetween(localDate(then), localDate(now));
  if (days <= 0) {
    if (diff < 60_000) return lang === "en" ? "just now" : "刚刚";
    if (diff < 3_600_000) {
      const n = Math.floor(diff / 60_000);
      return lang === "en" ? `${n} min ago` : `${n}分钟前`;
    }
    const h = Math.floor(diff / 3_600_000);
    return lang === "en" ? `${h} h ago` : `${h}小时前`;
  }
  if (days === 1) return lang === "en" ? "yesterday" : "昨天";
  if (days < 7) return lang === "en" ? `${days} days ago` : `${days}天前`;
  if (days < 14) return lang === "en" ? "last week" : "上周";
  return fmtMonthDay(localDate(then), lang);
}

const HOUR_MS = 3_600_000;

/** 倒计时：任务单上的大数字和旁边的小字。 */
export function fmtCountdown(ms: number, lang: Lang): { text: string; big: string; unit: string; overdue: boolean } {
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const days = Math.floor(abs / (24 * HOUR_MS));
  const hours = Math.floor((abs % (24 * HOUR_MS)) / HOUR_MS);
  const minutes = Math.floor((abs % HOUR_MS) / 60_000);
  const big = days > 0 ? String(days) : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  if (lang === "en") {
    const text = days > 0 ? `${days} d ${hours} h` : hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
    const unit = days > 0 ? (overdue ? "days overdue" : `d ${hours} h`) : overdue ? "overdue" : "h:min";
    return { text: overdue ? `${text} overdue` : `${text} left`, big, unit, overdue };
  }
  const text = days > 0 ? `${days} 天 ${hours} 小时` : hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`;
  const unit = days > 0 ? (overdue ? "天前就到时限了" : `天 ${hours} 小时`) : overdue ? "超时" : "小时:分";
  return { text: overdue ? `超时 ${text}` : `还剩 ${text}`, big, unit, overdue };
}

/** 等了多久：「等了 1 天 3 小时」「等了 3 小时」「等了 14 分钟」/「waiting 1 d 3 h」。 */
export function fmtWaited(ms: number, lang: Lang): string {
  const abs = Math.max(0, ms);
  const days = Math.floor(abs / (24 * HOUR_MS));
  const hours = Math.floor((abs % (24 * HOUR_MS)) / HOUR_MS);
  const minutes = Math.floor((abs % HOUR_MS) / 60_000);
  if (lang === "en") {
    const t = days > 0 ? `${days} d${hours ? ` ${hours} h` : ""}` : hours > 0 ? `${hours} h` : minutes > 0 ? `${minutes} min` : "";
    return t ? `waiting ${t}` : "just now";
  }
  const t = days > 0 ? `${days} 天${hours ? ` ${hours} 小时` : ""}` : hours > 0 ? `${hours} 小时` : minutes > 0 ? `${minutes} 分钟` : "";
  return t ? `等了 ${t}` : "刚刚";
}

/** 数字：整数不带小数点，其余一位小数；英文千位加逗号。 */
export function fmtNumber(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 10) / 10;
  const s = Number.isInteger(r) ? String(r) : r.toFixed(1);
  if (lang !== "en" || Math.abs(r) < 1000) return s;
  const [i, f] = s.split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : "");
}
