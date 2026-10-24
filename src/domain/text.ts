/**
 * 中英两种说法（SPEC §16）。数据层里要给人看的字（模板里的环节名、职位名、命令被拒的原因、动态）都带两种；
 * 用户自己写的（项目名、昵称、意见）只有一种，照原样显示——用 `uc()` 包起来，界面上放进 <U>（冒烟扫英文界面的汉字时跳过）。
 */
export type Lang = "zh" | "en";

export interface Text2 {
  zh: string;
  en: string;
}

export const t2 = (zh: string, en: string): Text2 => ({ zh, en });

/** 用户写的内容：两种语言都照原样。 */
export interface UC {
  uc: string;
}

export const uc = (s: string | null | undefined): UC => ({ uc: s ?? "" });

/** 一句话：两种说法的模板 + 参数（参数也可以是一句话）。 */
export interface Phrase {
  t: Text2;
  p?: Record<string, TextParam>;
}

export const phrase = (zh: string, en: string, p?: Record<string, TextParam>): Phrase => ({ t: t2(zh, en), p });

/** 参数：数字、字（代码、卡号这种两种语言一样的）、两种说法、用户写的、或者一句话。 */
export type TextParam = string | number | Text2 | UC | Phrase | null | undefined;

export function isText2(v: unknown): v is Text2 {
  return !!v && typeof v === "object" && typeof (v as Text2).zh === "string" && typeof (v as Text2).en === "string";
}

export function isUC(v: unknown): v is UC {
  return !!v && typeof v === "object" && typeof (v as UC).uc === "string";
}

export function isPhrase(v: unknown): v is Phrase {
  return !!v && typeof v === "object" && isText2((v as Phrase).t);
}

/** 一个参数在这种语言下的字。 */
export function paramText(v: TextParam, lang: Lang): string {
  if (v === null || v === undefined) return "";
  if (isUC(v)) return v.uc;
  if (isPhrase(v)) return fill(v.t[lang], v.p, lang);
  if (isText2(v)) return v[lang];
  return String(v);
}

/** 英文的单复数：`{n|task|tasks}` 按参数 n 选（n = 1 用前一个）。 */
export function choosePlurals(template: string, params: Record<string, TextParam> | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\|([^|{}]*)\|([^{}]*)\}/g, (m, k: string, one: string, other: string) => {
    if (!(k in params)) return m;
    return Number(params[k]) === 1 ? one : other;
  });
}

/** 「{label}现在不能交」+ { label } → 拼好的句子。`{^name}` = 句首大写（英文）。 */
export function fill(template: string, params: Record<string, TextParam> | undefined, lang: Lang): string {
  if (!params) return template;
  return choosePlurals(template, params).replace(/\{(\^?)(\w+)\}/g, (m, cap: string, k: string) => {
    if (!(k in params)) return m;
    const s = paramText(params[k], lang);
    return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  });
}

/** 一句话在这种语言下的字（给 aria-label、文件名、测试用）。 */
export function phraseText(p: Phrase | Text2 | string | null | undefined, lang: Lang): string {
  if (!p) return "";
  if (typeof p === "string") return p;
  if (isPhrase(p)) return fill(p.t[lang], p.p, lang);
  return p[lang];
}

/** 给人看的一句：字（照原样）、两种说法、或者一句话。 */
export type Say = string | Text2 | Phrase;
