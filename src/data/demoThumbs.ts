/**
 * 示范盘点的缩略图（SPEC §18.9）：代码画的占位图（色块和线条，照设计稿 v7-11 的 Thumb），左上角标「示范」。
 * 不是任何人的作品，也不是从真实文件读出来的。sha256 按 SVG 的 UTF-8 字节算，打开示范工会时放进这台设备的文件仓。
 */
import { sha256HexSync } from "@/lib/passcode";

export type DemoThumbKind = "lo" | "key" | "clean" | "ib" | "paint" | "bg" | "doc";

export interface DemoThumb {
  key: string;
  svg: string;
  sha256: string;
  size: number;
  width: number;
  height: number;
}

const W = 320;
const H = 180;
const INK = "#1a1a1a";
const PAPER = "#ffffff";

function figure(x: number, dashed: boolean, fill: string | null, faint = false): string {
  const dash = dashed ? ` stroke-dasharray="5 5"` : "";
  const op = faint ? ` opacity="0.45"` : "";
  return `<g fill="${fill ?? "none"}" stroke="${INK}" stroke-width="3" stroke-linecap="round"${dash}${op}><circle cx="${x}" cy="50" r="16"/><path d="M${x - 10} 70 h20 v38 h-20 z"/><path d="M${x - 10} 78 l-26 22 M${x + 10} 78 l30 -18 M${x - 6} 108 l-8 38 M${x + 6} 108 l8 38" fill="none"/></g>`;
}

function body(kind: DemoThumbKind): string {
  switch (kind) {
    case "lo":
      return `<rect x="24" y="16" width="272" height="140" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="6 6"/>${figure(160, true, null)}<path d="M40 150 h240" stroke="${INK}" stroke-width="2" stroke-dasharray="6 6"/>`;
    case "key":
      return `${figure(160, false, null)}<path d="M40 150 h240" stroke="${INK}" stroke-width="2"/>`;
    case "clean":
      return `${figure(160, false, null)}<path d="M60 150 h200" stroke="${INK}" stroke-width="1.5"/>`;
    case "ib":
      return `${figure(146, false, null)}${figure(178, false, null, true)}<path d="M40 150 h240" stroke="${INK}" stroke-width="2"/>`;
    case "paint":
      return `${figure(160, false, "#f6dcc8")}<path d="M40 150 h240" stroke="${INK}" stroke-width="2"/>`;
    case "bg":
      return `<rect width="${W}" height="${H}" fill="#e3edf2"/><circle cx="250" cy="44" r="16" fill="#f5d77a"/><path d="M0 150 Q80 96 170 150 Z" fill="#8fa58a"/><path d="M120 180 Q220 110 320 150 V180 Z" fill="#cfe9c8"/>`;
    case "doc":
      return `<rect x="56" y="30" width="120" height="12" fill="#555"/>${[60, 80, 100, 120].map((y, i) => `<rect x="56" y="${y}" width="${[208, 180, 196, 120][i]}" height="6" fill="#bbb"/>`).join("")}`;
  }
}

function svgOf(kind: DemoThumbKind, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/>${body(kind)}<rect x="8" y="8" width="44" height="20" rx="10" fill="#0d0d0d"/><text x="30" y="22" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#fbfbfb">示范</text><text x="${W - 10}" y="${H - 6}" text-anchor="end" font-family="sans-serif" font-size="11" fill="#72634e">${label}</text></svg>`;
}

const cache = new Map<string, DemoThumb>();

/** 一张占位缩略图（同样的 kind + 标签永远是同一张）。 */
export function demoThumb(kind: DemoThumbKind, label: string): DemoThumb {
  const key = `${kind}|${label}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const svg = svgOf(kind, label);
  const t: DemoThumb = { key, svg, sha256: sha256HexSync(svg), size: new TextEncoder().encode(svg).length, width: W, height: H };
  cache.set(key, t);
  return t;
}

/** 示范数据里用到的全部占位缩略图（打开示范工会时放进文件仓）。 */
export function demoThumbs(): DemoThumb[] {
  return Array.from(cache.values());
}
