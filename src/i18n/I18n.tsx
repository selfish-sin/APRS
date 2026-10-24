/**
 * 界面语言（SPEC §16）：中文（默认）· English。第一次打开按浏览器语言选，切换记在这台设备上（arps:lang），
 * 登录以后也跟着账号记（account.set_lang）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ERRORS, type ErrorKey } from "@/domain/errors";
import type { DomainError } from "@/domain/commands";
import type { IsoDate, IsoDateTime } from "@/domain/model";
import { fill, isText2, type TextParam } from "@/domain/text";
import { useStore } from "@/lib/store";
import { LANG_KEY, detectLang, fmt, type Lang, type Msg } from "./core";
import { en } from "./en";
import { fmtCountdown, fmtDate, fmtDateTime, fmtDay, fmtMonthDay, fmtNumber, fmtRelative } from "./format";
import { zh } from "./zh";

export type Dict = typeof zh;

export const DICTS: Record<Lang, Dict> = { zh, en: en as unknown as Dict };

/** 用户写的内容（项目名、昵称、意见……）：不翻译，照原样；冒烟扫英文界面的汉字时跳过它。 */
export function U({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span data-uc="" className={className}>
      {children}
    </span>
  );
}

type RichParam = TextParam | ReactNode;

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  L: Dict;
  /** 拼一句（字）。 */
  f: (msg: Msg, params?: Record<string, TextParam>) => string;
  /** 拼一句（参数可以是元素，例如 <U>{昵称}</U>）。 */
  r: (msg: Msg, params: Record<string, RichParam>) => ReactNode;
  /** 两种说法选一种。 */
  t2: (text: { zh: string; en: string }) => string;
  /** 命令被拒的原因。 */
  err: (e: Pick<DomainError, "message" | "key" | "params"> | null | undefined) => string;
  date: (d: IsoDate) => string;
  day: (d: IsoDate) => string;
  monthDay: (d: IsoDate) => string;
  dateTime: (iso: IsoDateTime) => string;
  relative: (then: IsoDateTime, now: IsoDateTime) => string;
  countdown: (ms: number) => ReturnType<typeof fmtCountdown>;
  num: (n: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

function readSaved(): Lang | null {
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    return v === "zh" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

function save(lang: Lang) {
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* 存不了也照样切 */
  }
}

export function errorText(e: Pick<DomainError, "message" | "key" | "params"> | null | undefined, lang: Lang): string {
  if (!e) return "";
  const entry = e.key ? ERRORS[e.key as ErrorKey] : undefined;
  return entry ? fill(entry[lang], e.params, lang) : e.message;
}

export function makeI18n(lang: Lang, setLang: (l: Lang) => void = () => undefined): I18n {
  const L = DICTS[lang];
  return {
    lang,
    setLang,
    L,
    f: (msg, params) => fmt(msg, params, lang),
    r: (msg, params) => {
      const text = fmt(msg, Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === "string" || typeof v === "number" || isText2(v))) as Record<string, TextParam>, lang);
      // 把还没填的 {key} 换成元素。
      const out: ReactNode[] = [];
      let last = 0;
      text.replace(/\{(\w+)\}/g, (m, k: string, at: number) => {
        if (!(k in params)) return m;
        out.push(text.slice(last, at));
        out.push(<span key={`${k}${at}`}>{params[k] as ReactNode}</span>);
        last = at + m.length;
        return m;
      });
      out.push(text.slice(last));
      return out.length === 1 ? out[0] : <>{out}</>;
    },
    t2: (t) => t[lang],
    err: (e) => errorText(e, lang),
    date: (d) => fmtDate(d, lang),
    day: (d) => fmtDay(d, lang),
    monthDay: (d) => fmtMonthDay(d, lang),
    dateTime: (iso) => fmtDateTime(iso, lang),
    relative: (then, now) => fmtRelative(then, now, lang),
    countdown: (ms) => fmtCountdown(ms, lang),
    num: (n) => fmtNumber(n, lang),
  };
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { account, dispatch } = useStore();
  const [lang, setLangState] = useState<Lang>(() => readSaved() ?? detectLang(typeof navigator === "undefined" ? undefined : navigator.languages ?? [navigator.language]));

  // 登录以后跟着账号：账号上记过语言就用它。
  const accountLang = account?.lang ?? null;
  useEffect(() => {
    if (accountLang && accountLang !== lang) {
      setLangState(accountLang);
      save(accountLang);
    }
    // 只在换账号 / 账号上的语言变了的时候
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, accountLang]);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      save(next);
      if (account && account.lang !== next) dispatch("account.set_lang", { lang: next }, { quiet: true });
    },
    [account, dispatch]
  );

  const api = useMemo(() => makeI18n(lang, setLang), [lang, setLang]);
  return <I18nContext.Provider value={api}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/** 「中 / EN」切换。 */
export function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang, L } = useI18n();
  return (
    <div className={`lang-switch ${className ?? ""}`} role="group" aria-label={L.common.language}>
      <button type="button" aria-pressed={lang === "zh"} onClick={() => setLang("zh")} data-testid="lang-zh" lang="zh-CN">
        中
      </button>
      <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} data-testid="lang-en" lang="en">
        EN
      </button>
    </div>
  );
}
