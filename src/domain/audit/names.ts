/**
 * 读名字（SPEC §18.4，命名规范 v1.0：`[项目]_[集数]_[场景]_[镜头]_[层级]_[流程]_[版本]`）。纯函数。
 *   先整理：去扩展名（认 `.clip.rar` 这种双扩展名）· 全角转半角 · 去前后空格；
 *   再按 `_` 切开、按样子认每一段（不死套一个正则，这样才能说清楚哪里错）；
 *   版本号后面多出来的字（「第一次修改后」「_final」「改」）收下来，算这一版的「备注」。
 * 每条问题是 code + 参数（界面按语言拼，SPEC §16）。
 */

export type NameIssueCode =
  | "project_typo"
  | "not_project"
  | "no_pad"
  | "case"
  | "unknown_code"
  | "unknown_layer"
  | "order"
  | "missing"
  | "version_note"
  | "extra_segment";

export interface NameIssue {
  code: NameIssueCode;
  params: Record<string, string | number>;
}

export type NamePart = "project" | "episode" | "scene" | "cut" | "layer" | "code" | "version";

export interface ParsedName {
  /** 原来的名字（不带路径）。 */
  raw: string;
  /** 整理过、去掉扩展名的名字。 */
  base: string;
  /** 扩展名（小写，不带点；双扩展名 = 两个都在，例 ["clip", "rar"]）。 */
  exts: string[];
  /** 认出来了没有：cut = 某一卡的 · project = 项目级（没有场景 / 镜头）· none = 认不出。 */
  kind: "cut" | "project" | "none";
  project: string | null;
  episode: string | null;
  scene: string | null;
  /** 卡号（数字）和后缀（插进去的卡 CUT005a 的 a）。 */
  cut: { number: number; suffix: string } | null;
  layer: string | null;
  code: string | null;
  version: number | null;
  /** 版本号后面多出来的字。 */
  note: string | null;
  /** 规范写法（用来对「同一版」和系统里的文件名）：没有备注、补好零、大小写对。 */
  canonical: string | null;
  /** 切开的每一段：原样 · 认成什么 · 这一段有没有问题（标出来用）。 */
  parts: { text: string; as: NamePart | "note" | "unknown"; bad?: boolean }[];
  issues: NameIssue[];
  /** 不是这个项目的（项目代号完全不一样）。 */
  foreign: boolean;
}

export interface NameContext {
  /** 这个项目的代号，例 ANDLC。 */
  projectCode: string;
  /** 这个项目各环节的文件代码（PLAN · SCR · STB · ART · COL · LO · H · CLN · ANI · CMP · BG · SND · FIN …）。 */
  stageCodes: string[];
  /** 认得的层（A B C … · BG · PROP · FX）；不给就用默认。 */
  layers?: string[];
}

/** 认得的扩展名（去掉时用）。 */
export const KNOWN_EXTS = new Set([
  "clip", "rar", "zip", "7z", "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "psd", "psb", "pdf", "mp4", "webm", "mov", "m4v", "avi",
  "txt", "csv", "xlsx", "xls", "doc", "docx", "ai", "sai", "sai2", "kra", "aep", "tga", "svg", "wav", "mp3",
]);

export const DEFAULT_LAYERS = ["BG", "PROP", "FX"];

/** 全角字母数字和符号 → 半角；全角空格 → 半角空格。 */
export function toHalfWidth(s: string): string {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
}

/** 去扩展名：最后一个认得的扩展名去掉；它前面也是认得的（.clip.rar）就再去一个。 */
export function splitExt(name: string): { base: string; exts: string[] } {
  let base = name;
  const exts: string[] = [];
  for (let i = 0; i < 2; i++) {
    const dot = base.lastIndexOf(".");
    if (dot <= 0) break;
    const ext = base.slice(dot + 1).toLowerCase();
    if (!KNOWN_EXTS.has(ext)) {
      if (i === 0 && /^[a-z0-9]{1,5}$/i.test(ext)) {
        exts.unshift(ext);
        base = base.slice(0, dot);
      }
      break;
    }
    exts.unshift(ext);
    base = base.slice(0, dot);
  }
  return { base, exts };
}

/** 编辑距离（项目代号 · 流程代码「是不是 xx」用）。 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      // 相邻两个字母换了位置（ANLDC ↔ ANDLC）算一步
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[j] = Math.min(d[j], prev);
      prev = tmp;
    }
  }
  return d[n];
}

function nearest(got: string, options: string[], max = 1): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const o of options) {
    const dd = editDistance(got.toUpperCase(), o.toUpperCase());
    if (dd < bestD) {
      bestD = dd;
      best = o;
    }
  }
  return bestD <= max ? best : null;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

type Seg = { text: string; as: NamePart | "note" | "unknown"; value?: unknown; bad?: boolean };

/** 读一个名字（可以带路径：取最后一段）。 */
export function parseName(input: string, ctx: NameContext): ParsedName {
  const raw = input.split(/[\\/]/).pop() ?? input;
  const cleaned = toHalfWidth(raw).trim();
  const { base, exts } = splitExt(cleaned);
  const issues: NameIssue[] = [];
  const out: ParsedName = { raw, base, exts, kind: "none", project: null, episode: null, scene: null, cut: null, layer: null, code: null, version: null, note: null, canonical: null, parts: [], issues, foreign: false };
  const segsRaw = base.split("_").map((s) => s.trim()).filter((s) => s.length);
  if (segsRaw.length < 2) {
    out.parts = segsRaw.map((t) => ({ text: t, as: "unknown" }));
    return out;
  }
  const projectCode = ctx.projectCode.toUpperCase();
  const codes = ctx.stageCodes.map((c) => c.toUpperCase());
  const layers = new Set([...(ctx.layers ?? []), ...DEFAULT_LAYERS].map((l) => l.toUpperCase()));
  const segs: Seg[] = [];

  segsRaw.forEach((text, i) => {
    const up = text.toUpperCase();
    let m: RegExpMatchArray | null;
    if ((m = text.match(/^(EP?)(\d{1,3})$/i))) {
      const want = `EP${pad(Number(m[2]), 2)}`;
      segs.push({ text, as: "episode", value: want, bad: text !== want });
      if (m[2].length < 2) issues.push({ code: "no_pad", params: { got: text, want } });
      else if (text !== want) issues.push({ code: "case", params: { got: text, want } });
      return;
    }
    if ((m = text.match(/^SC(\d{1,4})$/i))) {
      const want = `SC${pad(Number(m[1]), 3)}`;
      segs.push({ text, as: "scene", value: want, bad: text !== want });
      if (m[1].length < 3) issues.push({ code: "no_pad", params: { got: text, want } });
      else if (text !== want) issues.push({ code: "case", params: { got: text, want } });
      return;
    }
    if ((m = text.match(/^CUT(\d{1,4})([a-zA-Z]?)$/i))) {
      const suffix = m[2].toLowerCase();
      const want = `CUT${pad(Number(m[1]), 3)}${suffix}`;
      segs.push({ text, as: "cut", value: { number: Number(m[1]), suffix }, bad: text !== want });
      if (m[1].length < 3) issues.push({ code: "no_pad", params: { got: text, want } });
      else if (text !== want) issues.push({ code: "case", params: { got: text, want } });
      return;
    }
    if ((m = text.match(/^[vV](\d{1,3})(.*)$/)) && !codes.includes(up)) {
      const want = `v${pad(Number(m[1]), 2)}`;
      const note = m[2].replace(/^[\s\-_.()（）]+|[\s\-_.()（）]+$/g, "");
      segs.push({ text, as: "version", value: { version: Number(m[1]), note }, bad: !text.startsWith(want) });
      if (m[1].length < 2) issues.push({ code: "no_pad", params: { got: `${text[0]}${m[1]}`, want } });
      else if (text[0] === "V") issues.push({ code: "case", params: { got: `V${m[1]}`, want } });
      return;
    }
    if (i === 0 && /^[A-Za-z][A-Za-z0-9]{1,7}$/.test(text)) {
      segs.push({ text, as: "project", value: up });
      return;
    }
    segs.push({ text, as: "unknown" });
  });

  // 版本号后面的段 = 备注（_final、_改）
  const vi = segs.findIndex((s) => s.as === "version");
  const notes: string[] = [];
  if (vi >= 0) {
    const v = segs[vi].value as { version: number; note: string };
    if (v.note) notes.push(v.note);
    for (let j = vi + 1; j < segs.length; j++) {
      notes.push(segs[j].text);
      segs[j] = { ...segs[j], as: "note" };
    }
  }

  // 没认出来的段：在卡后面、版本前面的，按位置认成 层 / 流程
  const cutAt = segs.findIndex((s) => s.as === "cut");
  const epAt = segs.findIndex((s) => s.as === "episode");
  const end = vi >= 0 ? vi : segs.length;
  const from = cutAt >= 0 ? cutAt + 1 : epAt >= 0 ? epAt + 1 : 1;
  const middle: number[] = [];
  for (let j = from; j < end; j++) if (segs[j].as === "unknown") middle.push(j);
  const asCode = (j: number) => {
    const up = segs[j].text.toUpperCase();
    if (codes.includes(up)) {
      segs[j] = { ...segs[j], as: "code", value: up, bad: segs[j].text !== up };
      if (segs[j].text !== up) issues.push({ code: "case", params: { got: segs[j].text, want: up } });
    } else {
      const sug = nearest(up, codes);
      segs[j] = { ...segs[j], as: "code", value: sug ?? up, bad: true };
      issues.push({ code: "unknown_code", params: sug ? { got: segs[j].text, want: sug } : { got: segs[j].text, want: "" } });
    }
  };
  const asLayer = (j: number) => {
    const up = segs[j].text.toUpperCase();
    const ok = /^[A-Z]$/.test(up) || layers.has(up);
    segs[j] = { ...segs[j], as: "layer", value: up, bad: !ok || segs[j].text !== up };
    if (!ok) issues.push({ code: "unknown_layer", params: { got: segs[j].text } });
    else if (segs[j].text !== up && !/^[a-z]$/.test(segs[j].text)) issues.push({ code: "case", params: { got: segs[j].text, want: up } });
    else if (segs[j].text !== up) issues.push({ code: "case", params: { got: segs[j].text, want: up } });
  };
  if (middle.length === 1) {
    const j = middle[0];
    const up = segs[j].text.toUpperCase();
    // 只有一段：是流程代码就当流程（项目级文件 · 不分层的环节）；像层就当层（少了流程）
    if (codes.includes(up) || cutAt < 0 || !(/^[A-Z]$/.test(up) || layers.has(up))) asCode(j);
    else asLayer(j);
  } else if (middle.length >= 2) {
    asLayer(middle[0]);
    asCode(middle[1]);
    for (const j of middle.slice(2)) {
      issues.push({ code: "extra_segment", params: { got: segs[j].text } });
    }
  }

  // 项目代号
  const p = segs[0];
  if (p.as === "project") {
    const got = String(p.value);
    if (got !== projectCode) {
      if (editDistance(got, projectCode) <= 2) {
        issues.push({ code: "project_typo", params: { got: p.text, want: ctx.projectCode } });
        p.bad = true;
      } else out.foreign = true;
    } else if (p.text !== projectCode) {
      issues.push({ code: "case", params: { got: p.text, want: ctx.projectCode } });
      p.bad = true;
    }
  }

  // 每一段收下来
  for (const s of segs) {
    if (s.as === "project") out.project = String(s.value);
    if (s.as === "episode") out.episode = String(s.value);
    if (s.as === "scene") out.scene = String(s.value);
    if (s.as === "cut") out.cut = s.value as { number: number; suffix: string };
    if (s.as === "layer") out.layer = String(s.value);
    if (s.as === "code") out.code = String(s.value);
    if (s.as === "version") out.version = (s.value as { version: number }).version;
  }
  out.note = notes.join("_") || null;
  if (out.note && out.version !== null) issues.push({ code: "version_note", params: { note: out.note, want: `v${pad(out.version + 1, 2)}` } });

  // 顺序：项目 · 集 · 场 · 卡 · 层 · 流程 · 版本
  const ORDER: NamePart[] = ["project", "episode", "scene", "cut", "layer", "code", "version"];
  const seen = segs.filter((s) => (ORDER as string[]).includes(s.as)).map((s) => s.as as NamePart);
  const sorted = [...seen].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  if (seen.join() !== sorted.join()) {
    issues.push({ code: "order", params: { got: seen.map((x) => x).join(" · "), want: sorted.join(" · ") } });
    for (const s of segs) if ((ORDER as string[]).includes(s.as)) s.bad = s.bad || seen.indexOf(s.as as NamePart) !== sorted.indexOf(s.as as NamePart);
  }

  // 认没认出来：集 / 场 / 卡 / 版本至少认出一样，而且有流程或卡
  const hasCut = !!out.cut;
  const shaped = !!(out.episode || out.scene || hasCut || out.version !== null);
  if (!shaped || (!out.code && !hasCut) || segs.filter((s) => s.as === "unknown").length > 1) {
    out.kind = "none";
    out.parts = segs.map(({ text, as, bad }) => ({ text, as, bad }));
    return out;
  }
  out.kind = hasCut || out.scene ? "cut" : "project";
  if (!out.project) issues.push({ code: "missing", params: { what: "project" } });
  if (out.kind === "cut") {
    if (!out.episode) issues.push({ code: "missing", params: { what: "episode" } });
    if (!out.scene) issues.push({ code: "missing", params: { what: "scene" } });
    if (!hasCut) issues.push({ code: "missing", params: { what: "cut" } });
  }
  if (!out.code) issues.push({ code: "missing", params: { what: "code" } });
  if (out.version === null) issues.push({ code: "missing", params: { what: "version" } });
  for (const s of segs) if (s.as === "unknown") issues.push({ code: "extra_segment", params: { got: s.text } });

  out.canonical =
    out.code && out.version !== null
      ? [
          ctx.projectCode,
          out.episode ?? "EP01",
          ...(out.kind === "cut" ? [out.scene ?? "SC001", out.cut ? `CUT${pad(out.cut.number, 3)}${out.cut.suffix}` : "CUT000"] : []),
          ...(out.layer ? [out.layer] : []),
          out.code,
          `v${pad(out.version, 2)}`,
        ].join("_")
      : null;
  out.parts = segs.map(({ text, as, bad }) => ({ text, as, bad }));
  return out;
}

/** 一行粘贴的字里找像规范文件名的那一段（前后的大小、日期、上传人都不要）；能认出整条路径。 */
export function namesFromPaste(text: string): { name: string; path: string | null }[] {
  const out: { name: string; path: string | null }[] = [];
  for (const line0 of text.split(/\r?\n/)) {
    const line = toHalfWidth(line0).trim();
    if (!line) continue;
    // 路径：/EP01/ANI/SC001/CUT005/文件名
    const pathM = line.match(/((?:[\\/][^\\/\s]+)+[\\/])([^\\/\s]+_[^\s\\/]+)/);
    // 名字：至少两个下划线、带扩展名或版本号的一段
    const nameM = line.match(/[A-Za-z][A-Za-z0-9]{1,7}_[^\s\t,，]*?(?:_[vV]\d+[^\s\t,，]*?)?(?:\.[A-Za-z0-9]{1,5}){0,2}(?=$|[\s\t,，])/);
    if (pathM) out.push({ name: pathM[2], path: (pathM[1] + pathM[2]).replace(/\\/g, "/") });
    else if (nameM && nameM[0].split("_").length >= 3) out.push({ name: nameM[0], path: null });
  }
  return out;
}

/** 从文件夹路径认出 卡 · 流程（拿来对「放没放对文件夹」）：/EP01/ANI/SC001/CUT005/。 */
export function folderHints(path: string | null): { cut: number | null; code: string | null; episode: string | null; scene: string | null } {
  if (!path) return { cut: null, code: null, episode: null, scene: null };
  const dirs = path.replace(/\\/g, "/").split("/").slice(0, -1);
  let cut: number | null = null;
  let code: string | null = null;
  let episode: string | null = null;
  let scene: string | null = null;
  for (const d of dirs) {
    const t = toHalfWidth(d).trim();
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^CUT(\d{1,4})[a-z]?$/i))) cut = Number(m[1]);
    else if ((m = t.match(/^EP(\d{1,3})$/i))) episode = `EP${pad(Number(m[1]), 2)}`;
    else if ((m = t.match(/^SC(\d{1,4})$/i))) scene = `SC${pad(Number(m[1]), 3)}`;
    else if (/^[A-Z]{1,4}$/.test(t)) code = t;
  }
  return { cut, code, episode, scene };
}
