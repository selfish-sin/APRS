/**
 * 排序：只比 ASCII 的东西——数字、日期、时刻、id，
 * 最后总是按 id 定下来，所以同样的数据在哪台设备、哪种语言的浏览器上顺序都一样。
 * 不用 localeCompare 比显示文字：不同浏览器的中文排序不一样（还会让页面水合失败）。
 * 页面不要自己写排序，用这里的比较函数。
 */
import type { Id } from "./model";

export function cmp(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 按若干个键依次比（每个键返回 ASCII 字符串或数字），最后按 id。 */
export function compareBy<T extends { id: Id }>(...keys: ((x: T) => string | number)[]) {
  return (a: T, b: T): number => {
    for (const k of keys) {
      const r = cmp(k(a), k(b));
      if (r !== 0) return r;
    }
    return cmp(a.id, b.id);
  };
}

/** 时刻（ISO）早的在前；没有时刻的排最后。 */
export function timeKey(iso: string | null | undefined): number {
  if (!iso) return Number.MAX_SAFE_INTEGER;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

/** 层名（A、B …）当成排序键；没有层（项目级 / 每卡一份）排在前面。 */
export function layerKey(layer: string | null | undefined): string {
  return layer ?? "";
}

/** 卡号补零当排序键：3 → "000003"。 */
export function numberKey(n: number | null | undefined): string {
  return n === null || n === undefined ? "999999" : String(Math.max(0, Math.floor(n))).padStart(6, "0");
}
