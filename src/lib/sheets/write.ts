/**
 * 把汇报（domain/report.ts 排好的表）写成 .xlsx / .csv。
 * SheetJS 社区版不写单元格样式，所以写好以后打开 xlsx（就是个 zip），在 styles.xml 里加几种底色 / 粗体，
 * 再给要上色的格子标上样式号；顺手把表头一行冻结。读回来用的是同一个库。
 */
import type { CellStyle, ReportTable } from "@/domain/report";
import { loadXlsx, type XLSXModule } from "./xlsx";

/** 每种样式：字（粗 / 白）+ 底色（ARGB）。 */
const STYLE_DEF: Record<CellStyle, { font: "bold" | "boldWhite" | null; fill: string }> = {
  header: { font: "bold", fill: "FFE8E4DC" },
  plan: { font: null, fill: "FFD5E0CF" },
  actual: { font: "boldWhite", fill: "FF5E7358" },
  over: { font: "boldWhite", fill: "FFC8553D" },
  today: { font: "bold", fill: "FFF6E3A1" },
  phase: { font: "bold", fill: "FFEFEBE3" },
  total: { font: "bold", fill: "FFF3F0EA" },
};

const STYLE_KEYS = Object.keys(STYLE_DEF) as CellStyle[];

function colLetters(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 在 styles.xml 里加字体、底色和 cellXfs，返回每种样式的编号。 */
function patchStyles(xml: string): { xml: string; index: Record<CellStyle, number> } {
  let fontsCount = 0;
  xml = xml.replace(/<fonts count="(\d+)">([\s\S]*?)<\/fonts>/, (_m, n: string, body: string) => {
    fontsCount = Number(n);
    const bold = `<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>`;
    const white = `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>`;
    return `<fonts count="${fontsCount + 2}">${body}${bold}${white}</fonts>`;
  });
  const fontId = { bold: fontsCount, boldWhite: fontsCount + 1 };
  let fillsCount = 0;
  xml = xml.replace(/<fills count="(\d+)">([\s\S]*?)<\/fills>/, (_m, n: string, body: string) => {
    fillsCount = Number(n);
    const fills = STYLE_KEYS.map((k) => `<fill><patternFill patternType="solid"><fgColor rgb="${STYLE_DEF[k].fill}"/><bgColor indexed="64"/></patternFill></fill>`).join("");
    return `<fills count="${fillsCount + STYLE_KEYS.length}">${body}${fills}</fills>`;
  });
  let xfCount = 0;
  xml = xml.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (_m, n: string, body: string) => {
    xfCount = Number(n);
    const xfs = STYLE_KEYS.map((k, i) => {
      const f = STYLE_DEF[k].font;
      return `<xf numFmtId="0" fontId="${f ? fontId[f] : 0}" fillId="${fillsCount + i}" borderId="0" xfId="0" applyFill="1"${f ? ' applyFont="1"' : ""}/>`;
    }).join("");
    return `<cellXfs count="${xfCount + STYLE_KEYS.length}">${body}${xfs}</cellXfs>`;
  });
  const index = Object.fromEntries(STYLE_KEYS.map((k, i) => [k, xfCount + i])) as Record<CellStyle, number>;
  return { xml, index };
}

function patchSheet(xml: string, table: ReportTable, index: Record<CellStyle, number>): string {
  const marks = new Map<string, number>();
  table.header.forEach((_, c) => marks.set(`${colLetters(c)}1`, index.header));
  for (const h of table.headerStyles ?? []) marks.set(`${colLetters(h.c)}1`, index[h.s]);
  for (const s of table.styles) marks.set(`${colLetters(s.c)}${s.r + 2}`, index[s.s]);
  xml = xml.replace(/<c r="([A-Z]+\d+)"(?![^>]*\ss=")/g, (m, ref: string) => {
    const s = marks.get(ref);
    return s === undefined ? m : `<c r="${ref}" s="${s}"`;
  });
  // 冻结表头（和前几列）。
  const x = table.freezeCols;
  const top = `${colLetters(x)}2`;
  const pane = `<pane${x ? ` xSplit="${x}"` : ""} ySplit="1" topLeftCell="${top}" activePane="${x ? "bottomRight" : "bottomLeft"}" state="frozen"/>`;
  xml = xml.replace(/<sheetView workbookViewId="0"\s*\/>/, `<sheetView workbookViewId="0">${pane}</sheetView>`);
  return xml;
}

function toSheet(XLSX: XLSXModule, t: ReportTable) {
  const ws = XLSX.utils.aoa_to_sheet([t.header, ...t.rows.map((r) => r.map((v) => (v === null ? "" : v)))]);
  ws["!cols"] = t.widths.map((wch) => ({ wch }));
  return ws;
}

/** 几张表写进同一个 .xlsx。 */
export async function tablesToXlsx(tables: ReportTable[]): Promise<Uint8Array> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const t of tables) {
    let name = t.name;
    for (let i = 2; used.has(name); i++) name = `${t.name.slice(0, 28)} ${i}`;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, toSheet(XLSX, t), name);
  }
  const raw = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
  // 补上颜色和冻结：改 zip 里的 styles.xml 和每张表的 xml。
  const CFB = XLSX.CFB;
  const zip = CFB.read(raw, { type: "array" });
  const find = (suffix: string) => zip.FullPaths.findIndex((p: string) => p.endsWith(suffix));
  const read = (i: number) => new TextDecoder().decode(zip.FileIndex[i].content as Uint8Array);
  const enc = (s: string) => new TextEncoder().encode(s);
  const si = find("xl/styles.xml");
  if (si < 0) return raw;
  const { xml: styles, index } = patchStyles(read(si));
  CFB.utils.cfb_add(zip, "/xl/styles.xml", enc(styles));
  tables.forEach((t, i) => {
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    const k = find(path);
    if (k >= 0) CFB.utils.cfb_add(zip, `/${path}`, enc(patchSheet(read(k), t, index)));
  });
  return new Uint8Array(CFB.write(zip, { fileType: "zip", type: "array", compression: true }) as ArrayBuffer);
}

/** 一张表写成 .csv（带 BOM，Excel 打开中文不乱码）。 */
export function tableToCsv(t: ReportTable): string {
  const esc = (v: string | number | null) => {
    if (v === null) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [t.header, ...t.rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
