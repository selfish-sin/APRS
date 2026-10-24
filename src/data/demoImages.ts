/**
 * 示范图（SPEC §11.6）：不用真实作品，全是代码画的线稿 / 分层色块占位（SVG），左上角标「示范图」。
 * 用户自己把真图拖进来替换。sha256 按 SVG 的 UTF-8 字节算，所以每次都一样。
 */
import { sha256HexSync } from "@/lib/passcode";
import { bytesToBase64 } from "@/lib/files/sha";

export interface DemoImage {
  key: string;
  name: string;
  svg: string;
  width: number;
  height: number;
  sha256: string;
  size: number;
  /** 缩略图：就是这张 SVG 本身（很小）。 */
  thumb: string;
}

const INK = "#1a1a1a";
const PAPER = "#fbfaf7";
const LABEL = "#72634e";

function badge(): string {
  return `<rect x="16" y="16" width="112" height="40" rx="20" fill="#0d0d0d"/><text x="72" y="42" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#fbfbfb">示范图</text>`;
}

function caption(x: number, y: number, text: string): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="20" fill="${LABEL}">${text}</text>`;
}

function wrap(width: number, height: number, body: string, cap: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${PAPER}"/><g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</g>${badge()}${caption(width / 2, height - 20, cap)}</svg>`;
}

/** 一个小女孩的线稿：正面（头 · 刘海 · 皇冠 · 耳饰 · 裙子）。 */
function front(): string {
  return wrap(
    600,
    800,
    [
      `<ellipse cx="300" cy="210" rx="95" ry="108"/>`,
      `<path d="M206 200 C210 96 390 96 394 200 C366 158 330 148 300 168 C270 148 234 158 206 200Z"/>`,
      `<path d="M242 136 L256 190 M290 126 L295 186 M338 132 L334 188"/>`,
      `<path d="M246 52 L262 92 L284 66 L300 44 L316 66 L338 92 L354 52 L346 104 L254 104 Z"/>`,
      `<circle cx="300" cy="78" r="7"/>`,
      `<path d="M250 222 q18 -14 36 0 M314 222 q18 -14 36 0"/>`,
      `<circle cx="268" cy="230" r="8"/><circle cx="332" cy="230" r="8"/>`,
      `<path d="M300 248 l-4 18 h8 M282 286 q18 10 36 0"/>`,
      `<path d="M206 222 q-18 8 -6 34 M394 222 q18 8 6 34"/>`,
      `<circle cx="198" cy="272" r="7"/><circle cx="402" cy="272" r="7"/>`,
      `<path d="M282 314 v30 M318 314 v30"/>`,
      `<path d="M232 352 Q300 330 368 352 L410 624 Q300 656 190 624 Z"/>`,
      `<path d="M234 358 Q190 456 202 548 M366 358 Q410 456 398 548"/>`,
      `<path d="M262 644 v100 M338 644 v100 M246 748 h34 M322 748 h34"/>`,
    ].join(""),
    "人物设定 · 正面"
  );
}

function side(): string {
  return wrap(
    600,
    800,
    [
      `<path d="M330 104 C240 96 206 170 214 230 C220 282 252 316 300 318 C324 318 346 300 352 282 L372 262 L356 250 L366 232 L350 222 C356 170 368 120 330 104Z"/>`,
      `<path d="M222 190 C226 120 300 92 352 130 C318 128 282 140 262 176"/>`,
      `<path d="M266 62 L280 100 L300 74 L320 100 L334 62 L330 112 L270 112 Z"/>`,
      `<path d="M330 222 q10 -8 20 0"/><circle cx="338" cy="230" r="6"/>`,
      `<path d="M262 236 q-14 10 -2 30"/><circle cx="258" cy="282" r="7"/>`,
      `<path d="M290 316 v30 M312 316 v30"/>`,
      `<path d="M250 352 Q306 334 352 352 L378 624 Q300 650 222 624 Z"/>`,
      `<path d="M300 362 Q336 456 330 548"/>`,
      `<path d="M276 642 v102 M322 642 v102 M262 748 h34 M314 748 h40"/>`,
    ].join(""),
    "人物设定 · 侧面"
  );
}

function expressions(): string {
  const head = (cx: number, mouth: string, brows: string) =>
    `<ellipse cx="${cx}" cy="190" rx="90" ry="100"/><path d="M${cx - 88} 180 C${cx - 84} 86 ${cx + 84} 86 ${cx + 88} 180 C${cx + 60} 142 ${cx + 30} 134 ${cx} 152 C${cx - 30} 134 ${cx - 60} 142 ${cx - 88} 180Z"/><circle cx="${cx - 30}" cy="200" r="7"/><circle cx="${cx + 30}" cy="200" r="7"/><path d="${brows}"/><path d="${mouth}"/>`;
  return wrap(
    900,
    420,
    [
      head(160, "M140 250 q20 14 40 0", "M118 176 q14 -8 28 0 M174 176 q14 -8 28 0"),
      head(450, "M430 258 q20 -14 40 0", "M408 170 l30 10 M492 170 l-30 10"),
      head(740, "M724 246 a16 18 0 1 0 32 0 a16 18 0 1 0 -32 0", "M698 168 q14 -12 28 0 M754 168 q14 -12 28 0"),
    ].join(""),
    "人物设定 · 表情（笑 · 生气 · 吃惊）"
  );
}

/** 上色的分层示意：几块平涂色 + 主线；下巴那里留了一块没涂（漏色）。 */
function colorLayers(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="${PAPER}"/>`
    + `<path d="M300 120 C300 40 500 40 500 120 C470 92 430 86 400 104 C370 86 330 92 300 120Z" fill="#c9a27a"/>`
    + `<path d="M310 130 C300 230 330 300 400 318 C470 300 500 230 490 130 Z" fill="#f6dcc8"/>`
    + `<path d="M380 300 Q400 336 420 300 Z" fill="${PAPER}"/>`
    + `<path d="M320 340 Q400 320 480 340 L520 560 L280 560 Z" fill="#9fb7d6"/>`
    + `<g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M300 120 C300 40 500 40 500 120 C470 92 430 86 400 104 C370 86 330 92 300 120Z"/><path d="M310 130 C300 230 330 300 400 318 C470 300 500 230 490 130"/><circle cx="360" cy="200" r="8"/><circle cx="440" cy="200" r="8"/><path d="M380 260 q20 10 40 0"/><path d="M320 340 Q400 320 480 340 L520 560 L280 560 Z"/></g>`
    + `<g font-family="sans-serif" font-size="18" fill="${LABEL}"><rect x="590" y="150" width="170" height="44" rx="10" fill="#c9a27a"/><text x="675" y="178" text-anchor="middle" fill="#0d0d0d">头发 · 单独一层</text><rect x="590" y="214" width="170" height="44" rx="10" fill="#f6dcc8"/><text x="675" y="242" text-anchor="middle" fill="#0d0d0d">皮肤 · 单独一层</text><rect x="590" y="278" width="170" height="44" rx="10" fill="#9fb7d6"/><text x="675" y="306" text-anchor="middle" fill="#0d0d0d">衣服 · 单独一层</text></g>`
    + badge()
    + caption(400, 590, "上色分层示意 · A 层 · 第 18 张")
    + `</svg>`;
}

/** 中割：一个转头的线稿。v04 下巴的线断了，v05 补上。 */
function inbetween(version: 4 | 5): string {
  const chin = version === 4 ? `<path d="M330 300 Q360 330 384 334 M416 334 Q446 326 470 296"/>` : `<path d="M330 300 Q400 350 470 296"/>`;
  return wrap(
    800,
    600,
    [
      `<path d="M320 160 C320 80 480 80 486 160"/>`,
      `<path d="M320 160 C306 220 316 274 330 300"/>`,
      `<path d="M486 160 C492 220 484 268 470 296"/>`,
      chin,
      `<path d="M330 140 C360 120 420 116 470 140"/>`,
      `<circle cx="370" cy="210" r="8"/><circle cx="436" cy="214" r="8"/>`,
      `<path d="M386 262 q18 8 34 0"/>`,
      `<path d="M120 420 h560" stroke-dasharray="6 10" stroke-width="2"/>`,
    ].join(""),
    `中割 · C010 · B 层 · 第 18 张 · v0${version}`
  );
}

function make(key: string, name: string, svg: string, width: number, height: number): DemoImage {
  const bytes = new TextEncoder().encode(svg);
  return { key, name, svg, width, height, sha256: sha256HexSync(svg), size: bytes.length, thumb: `data:image/svg+xml;base64,${bytesToBase64(bytes)}` };
}

let cached: DemoImage[] | null = null;

export function demoImages(): DemoImage[] {
  if (cached) return cached;
  cached = [
    make("front", "人物设定-正面（示范图）.svg", front(), 600, 800),
    make("side", "人物设定-侧面（示范图）.svg", side(), 600, 800),
    make("faces", "人物设定-表情（示范图）.svg", expressions(), 900, 420),
    make("colors", "ANDLC_EP01_SC001_CUT005_A_ANI_v04-截图（示范图）.svg", colorLayers(), 800, 600),
    make("ib4", "ANDLC_EP01_SC001_CUT010_B_ANI_v04（示范图）.svg", inbetween(4), 800, 600),
    make("ib5", "ANDLC_EP01_SC001_CUT010_B_ANI_v05（示范图）.svg", inbetween(5), 800, 600),
  ];
  return cached;
}

export function demoImage(key: string): DemoImage {
  const d = demoImages().find((x) => x.key === key);
  if (!d) throw new Error(`no demo image ${key}`);
  return d;
}
