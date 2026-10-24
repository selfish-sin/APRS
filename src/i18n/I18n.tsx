/**
 * 界面语言（SPEC §16）：中文（默认）· English。第一次打开按浏览器语言选，切换记在这台设备上（arps:lang），
 * 登录以后也跟着账号记（account.set_lang）。
 */
import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ERRORS, type ErrorKey } from "@/domain/errors";
import type { DomainError } from "@/domain/commands";
import type { Group, IsoDate, IsoDateTime, Unit } from "@/domain/model";
import { tagText } from "@/domain/rules";
import { stageText } from "@/domain/templates";
import { cutCode } from "@/domain/naming";
import { choosePlurals, fill, isPhrase, isText2, isUC, phraseText, type Phrase, type Text2, type TextParam } from "@/domain/text";
import { useStore } from "@/lib/store";
import { LANG_KEY, detectLang, fmt, msgPhrase, type Lang, type Msg } from "./core";
import { en } from "./en";
import { fmtCountdown, fmtDate, fmtDateTime, fmtDay, fmtDuration, fmtMonthDay, fmtNumber, fmtRelative, fmtWaited } from "./format";
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

/** 拼一句，参数里用户写的（uc）放进 <U>，一句话套一句话也行。 */
function renderTemplate(template: string, params: Record<string, RichParam> | undefined, lang: Lang, keyBase = "p"): ReactNode {
  if (!params) return template;
  const tpl = choosePlurals(template, params as Record<string, TextParam>);
  const out: ReactNode[] = [];
  let last = 0;
  tpl.replace(/\{(\^?)(\w+)\}/g, (m, cap: string, k: string, at: number) => {
    if (!(k in params)) return m;
    out.push(tpl.slice(last, at));
    out.push(<Fragment key={`${keyBase}-${k}-${at}`}>{renderParam(params[k], lang, !!cap, `${keyBase}-${k}`)}</Fragment>);
    last = at + m.length;
    return m;
  });
  out.push(tpl.slice(last));
  return out.length === 1 ? out[0] : <>{out}</>;
}

function renderParam(v: RichParam, lang: Lang, cap: boolean, keyBase: string): ReactNode {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (isUC(v)) return <U>{v.uc}</U>;
  if (isPhrase(v)) return renderTemplate(v.t[lang], v.p, lang, keyBase);
  if (isText2(v)) {
    const s = v[lang];
    return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  if (typeof v === "string") return cap ? v.charAt(0).toUpperCase() + v.slice(1) : v;
  if (typeof v === "number") return String(v);
  return v as ReactNode;
}

/** 几段用「 · 」连起来（空的跳过）；段里可以有 <U>。都空时显示 fallback。 */
export function Joined({ parts, sep = " · ", fallback = null }: { parts: ReactNode[]; sep?: string; fallback?: ReactNode }) {
  const list = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  if (!list.length) return <>{fallback}</>;
  return (
    <>
      {list.map((p, i) => (
        <Fragment key={i}>
          {i ? sep : null}
          {p}
        </Fragment>
      ))}
    </>
  );
}

/** 一句话 → 元素（用户写的放进 <U>）。 */
export function PhraseView({ p }: { p: Phrase | Text2 | string | null | undefined }) {
  const { lang } = useI18n();
  if (!p) return null;
  if (typeof p === "string") return <>{p}</>;
  if (isPhrase(p)) return <>{renderTemplate(p.t[lang], p.p, lang)}</>;
  return <>{p[lang]}</>;
}

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  L: Dict;
  /** 拼一句（字）。 */
  f: (msg: Msg, params?: Record<string, TextParam>) => string;
  /** 拼一句（参数可以是元素、用户写的 uc()、一句话）。 */
  r: (msg: Msg, params: Record<string, RichParam>) => ReactNode;
  /** 两种说法选一种。 */
  t2: (text: { zh: string; en: string }) => string;
  /** 数据层的一句话 → 字（aria-label、提示用）。 */
  pt: (p: Phrase | Text2 | string | null | undefined) => string;
  /** 数据层的一句话 → 元素（用户写的放进 <U>）。 */
  ph: (p: Phrase | Text2 | string | null | undefined) => ReactNode;
  /** 命令被拒的原因。 */
  err: (e: Pick<DomainError, "message" | "key" | "params"> | null | undefined) => string;
  date: (d: IsoDate) => string;
  day: (d: IsoDate) => string;
  monthDay: (d: IsoDate) => string;
  dateTime: (iso: IsoDateTime) => string;
  relative: (then: IsoDateTime, now: IsoDateTime) => string;
  countdown: (ms: number) => ReturnType<typeof fmtCountdown>;
  /** 「等了 1 天 3 小时」/「waiting 1 d 3 h」。 */
  waited: (ms: number) => string;
  duration: (ms: number) => string;
  num: (n: number) => string;
  /** 环节名（模板里的两种说法；管理员自己起的照原样）。 */
  stageName: (group: Group, stage: StageLike) => string;
  /** 环节名的元素（自己起的放进 <U>）。 */
  stage: (group: Group, stage: StageLike) => ReactNode;
  /** 单位：「张」/「drawing(s)」。 */
  unit: (unit: Unit, group?: Group, n?: number) => string;
  /** 「1.5 小时 / 张」/「1.5 h / drawing」。 */
  rate: (stage: { tn: number; per: number; unit: Unit }, group?: Group) => string;
  /** 退回原因标签。 */
  tag: (tag: string | null | undefined) => string;
  /** 卡名：C005 /「第 5 期」/「Ep. 5」。 */
  cut: (cut: { number: number; suffix?: string | null }, group?: Group) => string;
  /** 词典里的一句 → 两种语言的一句话（参数可以带用户写的 uc()、数据层的一句话）。给 notify 这种存起来以后再显示的用。 */
  say: (pick: (d: Dict) => Msg, params?: Record<string, TextParam>) => Phrase;
}

type StageLike = { templateKey: string; name: string };

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
      const n = typeof params.n === "number" ? params.n : 1;
      const text = typeof msg === "string" ? msg : n === 1 ? msg.one : msg.other;
      return renderTemplate(text, params, lang);
    },
    t2: (t) => t[lang],
    pt: (p) => phraseText(p, lang),
    ph: (p) => (!p ? null : typeof p === "string" ? p : isPhrase(p) ? renderTemplate(p.t[lang], p.p, lang) : p[lang]),
    err: (e) => errorText(e, lang),
    date: (d) => fmtDate(d, lang),
    day: (d) => fmtDay(d, lang),
    monthDay: (d) => fmtMonthDay(d, lang),
    dateTime: (iso) => fmtDateTime(iso, lang),
    relative: (then, now) => fmtRelative(then, now, lang),
    countdown: (ms) => fmtCountdown(ms, lang),
    waited: (ms) => fmtWaited(ms, lang),
    duration: (ms) => fmtDuration(ms, lang),
    num: (n) => fmtNumber(n, lang),
    stageName: (group, st) => stageText(group, st, lang).name,
    stage: (group, st) => {
      const t = stageText(group, st, lang);
      return t.custom ? <U>{t.name}</U> : t.name;
    },
    unit: (unit, group, n = 1) => {
      const many = n !== 1;
      if (group === "video" && unit === "cut") return many ? L.labels.unitVideoCutPlural : L.labels.unitVideoCut;
      return many ? L.labels.unitPlural[unit] : L.labels.unit[unit];
    },
    rate: (st, group) => {
      const u = group === "video" && st.unit === "cut" ? L.labels.unitVideoCut : L.labels.unit[st.unit];
      const us = group === "video" && st.unit === "cut" ? L.labels.unitVideoCutPlural : L.labels.unitPlural[st.unit];
      const per = st.per === 1 ? u : fmt(L.labels.perUnits, { per: st.per, unit: us }, lang);
      return fmt(L.labels.rate, { tn: fmtNumber(st.tn, lang), per }, lang);
    },
    tag: (t) => tagText(t, lang),
    cut: (c, group) => cutCode({ number: c.number, suffix: c.suffix ?? undefined }, group, lang),
    say: (pick, params) => msgPhrase(pick(DICTS.zh), pick(DICTS.en), params),
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
