/**
 * 界面文字（SPEC §16）：zh / en 两份词典，键名一样（少一个键 i18n.test.ts 就报错）。
 *   - 句子里的参数写 {name}；英文要分单复数的写 { one, other }（参数 n 决定用哪个）。
 *   - 用户写的内容（项目名、昵称、意见……）不翻译，照原样塞进参数。
 */
import { fill, type Lang, type Text2, type TextParam } from "@/domain/text";

export type { Lang, Text2 };

export interface Plural {
  one: string;
  other: string;
}

export type Msg = string | Plural;

/** 英文词典的形状 = 中文词典的形状（值可以是复数形式）。 */
export type Shape<T> = { [K in keyof T]: T[K] extends string ? Msg : Shape<T[K]> };

export function isPlural(m: Msg): m is Plural {
  return typeof m === "object" && m !== null && "other" in m;
}

/** 拼句子：选单复数，填参数。 */
export function fmt(msg: Msg, params: Record<string, TextParam> | undefined, lang: Lang): string {
  const n = params && typeof params.n === "number" ? params.n : 1;
  const text = isPlural(msg) ? (n === 1 ? msg.one : msg.other) : msg;
  return fill(text, params, lang);
}

/** 第一次打开：浏览器语言 zh* → 中文，其他 → English。 */
export function detectLang(languages: readonly string[] | undefined): Lang {
  const first = (languages && languages[0]) || "zh";
  return /^zh/i.test(first) ? "zh" : "en";
}

export const LANG_KEY = "arps:lang";
