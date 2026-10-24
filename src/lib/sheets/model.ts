/**
 * 表格预览和检查（SPEC §15.2）用的数据形状：和读表的库无关（read.ts 负责把 xlsx / xls / csv 读成这个样子），
 * 这样「检查这张表」是纯函数，能直接测。
 */

export type CellType = "s" | "n" | "b" | "d" | "e" | "z";

export interface SheetCell {
  /** 显示出来的字（公式就是算出来的值）。 */
  v: string;
  t: CellType;
  /** 公式（没有 = 不是公式）。 */
  f?: string;
}

export interface Merge {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export interface SheetData {
  name: string;
  /** 只放前 MAX_ROWS 行（很大的表先显示这么多）。 */
  rows: (SheetCell | null)[][];
  /** 一共几行、几列（整张表的）。 */
  totalRows: number;
  totalCols: number;
  merges: Merge[];
  /** 每一列大概多宽（像素）。 */
  colWidths: number[];
}

export interface WorkbookData {
  sheets: SheetData[];
}

export const MAX_ROWS = 2000;

/** 0 起的列号 → A、B … Z、AA。 */
export function colName(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function cellRef(r: number, c: number): string {
  return `${colName(c)}${r + 1}`;
}

/** 「B3」「B3:D5」→ 行列（0 起）。 */
export function parseRef(ref: string): Merge | null {
  const m = ref.toUpperCase().match(/^([A-Z]{1,3})(\d{1,7})(?::([A-Z]{1,3})(\d{1,7}))?$/);
  if (!m) return null;
  const col = (s: string) => s.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const r0 = Number(m[2]) - 1;
  const c0 = col(m[1]);
  const r1 = m[3] ? Number(m[4]) - 1 : r0;
  const c1 = m[3] ? col(m[3]) : c0;
  return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
}

export function rangeRef(a: { r: number; c: number }, b: { r: number; c: number }): string {
  const r0 = Math.min(a.r, b.r);
  const r1 = Math.max(a.r, b.r);
  const c0 = Math.min(a.c, b.c);
  const c1 = Math.max(a.c, b.c);
  return r0 === r1 && c0 === c1 ? cellRef(r0, c0) : `${cellRef(r0, c0)}:${cellRef(r1, c1)}`;
}

// ---------------------------------------------------------------------------
// 检查这张表（只提醒，不改原表）
// ---------------------------------------------------------------------------

export type IssueKind = "empty_required" | "date_as_text" | "number_as_text" | "formula_error";

export interface SheetIssue {
  sheet: string;
  r: number;
  c: number;
  ref: string;
  kind: IssueKind;
  /** 哪一列（表头的字），空列的时候有。 */
  column?: string;
  /** 那一格的字（公式错的时候是错误码）。 */
  value?: string;
}

export const ISSUE_LABEL: Record<IssueKind, { zh: string; en: string }> = {
  empty_required: { zh: "必填的列空着", en: "Required column is empty" },
  date_as_text: { zh: "日期写成了文字", en: "Date typed as text" },
  number_as_text: { zh: "数字写成了文字", en: "Number typed as text" },
  formula_error: { zh: "公式报错", en: "Formula error" },
};

/** 表头里出现这些字的列算「必填」。 */
export const REQUIRED_HEADER = /负责人|责任人|工时|状态|进度|日期|开始|结束|截止|姓名|人员|owner|assignee|status|hours|due|date/i;
const FORMULA_ERRORS = new Set(["#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!", "#SPILL!", "#CALC!"]);
const DATE_TEXT = [/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?$/, /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/, /^\d{1,2}月\d{1,2}日$/];
const NUMBER_TEXT = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?$/;

function covered(merges: Merge[], r: number, c: number): boolean {
  return merges.some((m) => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1 && !(r === m.r0 && c === m.c0));
}

function filled(cell: SheetCell | null | undefined): boolean {
  return !!cell && cell.t !== "z" && cell.v.trim() !== "";
}

/** 表头在哪一行：前 5 行里第一行有两格以上字的。 */
export function headerRow(sheet: SheetData): number {
  for (let r = 0; r < Math.min(5, sheet.rows.length); r++) {
    const row = sheet.rows[r] ?? [];
    if (row.filter((c) => filled(c) && c!.t === "s").length >= 2) return r;
  }
  return 0;
}

export function checkSheet(sheet: SheetData, limit = 300): SheetIssue[] {
  const out: SheetIssue[] = [];
  const push = (i: SheetIssue) => {
    if (out.length < limit) out.push(i);
  };
  const h = headerRow(sheet);
  const header = sheet.rows[h] ?? [];
  let last = h;
  sheet.rows.forEach((row, r) => {
    if (row?.some((c) => filled(c))) last = Math.max(last, r);
  });
  const required = header.map((c, i) => (filled(c) && REQUIRED_HEADER.test(c!.v) ? i : -1)).filter((i) => i >= 0);
  for (let r = 0; r <= last; r++) {
    const row = sheet.rows[r] ?? [];
    const width = Math.max(row.length, header.length);
    for (let c = 0; c < width; c++) {
      const cell = row[c];
      if (covered(sheet.merges, r, c)) continue;
      const ref = cellRef(r, c);
      if (cell && (cell.t === "e" || FORMULA_ERRORS.has(cell.v.trim()))) {
        push({ sheet: sheet.name, r, c, ref, kind: "formula_error", value: cell.v.trim() || "#ERROR" });
        continue;
      }
      if (r > h && required.includes(c) && !filled(cell)) {
        push({ sheet: sheet.name, r, c, ref, kind: "empty_required", column: header[c]!.v.trim() });
        continue;
      }
      if (r === h || !cell || cell.t !== "s") continue;
      const text = cell.v.trim();
      if (DATE_TEXT.some((re) => re.test(text))) push({ sheet: sheet.name, r, c, ref, kind: "date_as_text", value: text });
      else if (NUMBER_TEXT.test(text)) push({ sheet: sheet.name, r, c, ref, kind: "number_as_text", value: text });
    }
  }
  return out;
}

export function checkWorkbook(wb: WorkbookData, limit = 300): SheetIssue[] {
  const out: SheetIssue[] = [];
  for (const s of wb.sheets) out.push(...checkSheet(s, limit - out.length));
  return out;
}
