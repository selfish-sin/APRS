/** 把 .xlsx / .xls / .csv 读成预览用的样子（只读前 MAX_ROWS 行，记下整张表多大）。 */
import { MAX_ROWS, type CellType, type Merge, type SheetCell, type SheetData, type WorkbookData } from "./model";
import { loadXlsx } from "./xlsx";

export async function readWorkbook(bytes: Uint8Array): Promise<WorkbookData> {
  const XLSX = await loadXlsx();
  // sheetRows：只解析前面这么多行（大表不卡），!fullref 里留着整张表的范围。
  const wb = XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: false, cellDates: false, cellStyles: true, sheetRows: MAX_ROWS + 1, dense: false });
  const sheets: SheetData[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = (ws["!fullref"] as string | undefined) ?? (ws["!ref"] as string | undefined);
    const full = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
    const shown = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"] as string) : full;
    const totalRows = full.e.r + 1;
    const totalCols = full.e.c + 1;
    const rowsN = Math.min(MAX_ROWS, shown.e.r + 1);
    const rows: (SheetCell | null)[][] = [];
    for (let r = 0; r < rowsN; r++) {
      const row: (SheetCell | null)[] = [];
      for (let c = 0; c <= shown.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as { t?: string; v?: unknown; w?: string; f?: string } | undefined;
        if (!cell) {
          row.push(null);
          continue;
        }
        const t = (["s", "n", "b", "d", "e", "z"].includes(cell.t ?? "") ? cell.t : "s") as CellType;
        // 显示的字：有格式化好的就用（公式 = 算出来的值；错误 = #DIV/0! 这种），没有就用原值。
        const v = cell.w ?? (cell.v === undefined || cell.v === null ? "" : t === "e" ? "#ERROR" : String(cell.v));
        row.push({ v, t, ...(cell.f ? { f: cell.f } : {}) });
      }
      rows.push(row);
    }
    const merges: Merge[] = ((ws["!merges"] as { s: { r: number; c: number }; e: { r: number; c: number } }[] | undefined) ?? []).map((m) => ({ r0: m.s.r, c0: m.s.c, r1: m.e.r, c1: m.e.c }));
    const cols = (ws["!cols"] as { wpx?: number; wch?: number; width?: number }[] | undefined) ?? [];
    const colWidths = Array.from({ length: Math.max(1, shown.e.c + 1) }, (_, i) => {
      const col = cols[i];
      const px = col?.wpx ?? (col?.wch ? col.wch * 7 + 10 : col?.width ? col.width * 7 : 88);
      return Math.max(44, Math.min(420, Math.round(px)));
    });
    return { name, rows, totalRows, totalCols, merges, colWidths };
  });
  return { sheets };
}
