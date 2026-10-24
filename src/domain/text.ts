/**
 * 中英两种说法（SPEC §16）。数据层里要给人看的字（模板里的环节名、职位名、命令被拒的原因）都带两种；
 * 用户自己写的（项目名、昵称、意见）只有一种，照原样显示。
 */
export type Lang = "zh" | "en";

export interface Text2 {
  zh: string;
  en: string;
}

export const t2 = (zh: string, en: string): Text2 => ({ zh, en });

/** 参数：数字、字（用户写的，两种语言一样）、或者两种说法。 */
export type TextParam = string | number | Text2 | null | undefined;

export function isText2(v: unknown): v is Text2 {
  return !!v && typeof v === "object" && typeof (v as Text2).zh === "string" && typeof (v as Text2).en === "string";
}

/**
 * 「{label}现在不能交」+ { label } → 拼好的句子。
 * 英文的单复数：`{n|task|tasks}` 按参数 n 选（n = 1 用前一个）。
 */
export function fill(template: string, params: Record<string, TextParam> | undefined, lang: Lang): string {
  if (!params) return template;
  const plural = template.replace(/\{(\w+)\|([^|{}]*)\|([^{}]*)\}/g, (m, k: string, one: string, other: string) => {
    if (!(k in params)) return m;
    return Number(params[k]) === 1 ? one : other;
  });
  return plural.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (!(k in params)) return m;
    const v = params[k];
    if (v === null || v === undefined) return "";
    if (isText2(v)) return v[lang];
    return String(v);
  });
}
