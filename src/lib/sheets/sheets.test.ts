import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildDemoWorld } from "@/data/demo";
import { REPORT_KEYS, buildReport, memberFileName, memberRecord, reportFileName } from "@/domain/report";
import * as q from "@/domain/queries";
import { checkWorkbook, colName, parseRef, rangeRef } from "./model";
import { readWorkbook } from "./read";
import { tableToCsv, tablesToXlsx } from "./write";

/** 测试用的表：带公式、合并单元格、一个空着的必填列、一个 #DIV/0!、日期和数字写成了文字。 */
export function sampleWorkbook(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["卡", "负责人", "张数", "工时", "开始", "备注"],
    ["C001", "木星", 12, null, "2026/10/01", "18"],
    ["C002", "", 8, null, "2026-10-02", ""],
    ["C003", "北窗", 0, null, null, "合并的说明"],
  ]);
  ws["D2"] = { t: "n", f: "C2*1.5", v: 18, w: "18" };
  ws["D3"] = { t: "n", f: "C3*1.5", v: 12, w: "12" };
  ws["D4"] = { t: "e", f: "C2/C4", v: 7, w: "#DIV/0!" };
  ws["!merges"] = [{ s: { r: 3, c: 5 }, e: { r: 3, c: 6 } }];
  ws["!cols"] = [{ wch: 8 }, { wch: 12 }];
  ws["!ref"] = "A1:G4";
  XLSX.utils.book_append_sheet(wb, ws, "进度");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["说明"], ["第二张表"]]), "说明");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("格子位置", () => {
  it("列号、A1 写法来回", () => {
    expect([0, 25, 26, 701].map(colName)).toEqual(["A", "Z", "AA", "ZZ"]);
    expect(parseRef("b3:d5")).toEqual({ r0: 2, c0: 1, r1: 4, c1: 3 });
    expect(parseRef("C5")).toEqual({ r0: 4, c0: 2, r1: 4, c1: 2 });
    expect(parseRef("5C")).toBeNull();
    expect(rangeRef({ r: 4, c: 3 }, { r: 2, c: 1 })).toBe("B3:D5");
    expect(rangeRef({ r: 0, c: 0 }, { r: 0, c: 0 })).toBe("A1");
  });
});

describe("读表 · 检查这张表", () => {
  it("工作表、公式算出来的值、合并单元格、列宽都读得出来", async () => {
    const wb = await readWorkbook(sampleWorkbook());
    expect(wb.sheets.map((s) => s.name)).toEqual(["进度", "说明"]);
    const s = wb.sheets[0];
    expect(s.rows[1][3]).toEqual({ v: "18", t: "n", f: "C2*1.5" });
    expect(s.rows[3][3]).toMatchObject({ v: "#DIV/0!", t: "e" });
    expect(s.merges).toEqual([{ r0: 3, c0: 5, r1: 3, c1: 6 }]);
    expect(s.totalRows).toBe(4);
    expect(s.colWidths[0]).toBeGreaterThan(50);
    expect(s.colWidths[0]).toBeLessThan(s.colWidths[1]);
  });

  it("列出空着的必填列、日期 / 数字写成文字、公式报错", async () => {
    const issues = checkWorkbook(await readWorkbook(sampleWorkbook()));
    const brief = issues.map((i) => `${i.ref}:${i.kind}`);
    expect(brief).toContain("B3:empty_required");
    expect(brief).toContain("D4:formula_error");
    expect(brief).toContain("E2:date_as_text");
    expect(brief).toContain("F2:number_as_text");
    expect(brief).toContain("E4:empty_required");
    // 合并掉的格子不算空；有公式的工时列不算空
    expect(brief.some((b) => b.startsWith("G4"))).toBe(false);
    expect(brief.some((b) => b.startsWith("D2") || b.startsWith("D3"))).toBe(false);
  });
});

describe("导出汇报", () => {
  const s = buildDemoWorld();
  const andlc = q.projects(s).find((p) => p.code === "ANDLC")!;

  it("五张表：表名、表头照工会的表，行数对得上", () => {
    const tables = buildReport(s, andlc.id, REPORT_KEYS);
    expect(tables.map((t) => t.name)).toEqual(["进度总表", "项目规划表", "卡 × 环节", "必要劳动时间统计表", "审核记录"]);
    const [progress, plan, grid, hours, reviews] = tables;
    const stages = q.stagesOf(s, andlc.id).length;
    expect(progress.header).toEqual(["序号", "项目", "类型", "预计开始", "预计结束", "计划天数", "进度", "剩余天数", "状态", "实际结束"]);
    expect(progress.rows).toHaveLength(stages);
    expect(plan.rows).toHaveLength(stages);
    expect(plan.header.slice(0, 8)).toEqual(["环节", "阶段", "负责人", "计划开始", "计划工期（周）", "实际开始", "实际工期（周）", "完成"]);
    expect(plan.styles.some((x) => x.s === "over")).toBe(true);
    expect(grid.rows).toHaveLength(14);
    expect(hours.header).toEqual(["人员", "导演 / 监制", "剧本 / 分镜", "LO", "原画", "中割 / 清线", "填色", "后期", "其他", "总计工时", "活力点"]);
    expect(hours.rows[hours.rows.length - 1][0]).toBe("合计");
    const ledgerPoints = q.members(s).reduce((n, m) => n + (q.indexOf(s).ledgerByMember.get(m.id) ?? []).filter((l) => l.taskId && s.tasks[l.taskId].projectId === andlc.id).reduce((a, l) => a + l.points, 0), 0);
    expect(hours.rows[hours.rows.length - 1][10]).toBeCloseTo(Math.round(ledgerPoints * 10) / 10, 0);
    const nReviews = Object.values(s.reviews).filter((r) => s.tasks[r.taskId].projectId === andlc.id).length;
    expect(reviews.rows).toHaveLength(nReviews);
    // 按月份
    const oct = buildReport(s, andlc.id, ["hours"], { month: "2026-10" })[0];
    expect(oct.name).toBe("必要劳动时间统计表 2026-10");
    // 英文
    expect(buildReport(s, andlc.id, ["progress"], { lang: "en" })[0].header[0]).toBe("No.");
    const HAN = /[\u3400-\u9fff]/;
    for (const t of buildReport(s, andlc.id, REPORT_KEYS, { lang: "en" })) {
      expect(t.name, "English 表名").not.toMatch(HAN);
      for (const h of t.header) expect(String(h), `English 表头：${t.name}`).not.toMatch(HAN);
    }
    expect(reportFileName(s, andlc.id, "xlsx", "en")).toBe(`ANDLC-report-${q.todayOf(s)}.xlsx`);
    expect(reportFileName(s, andlc.id, "xlsx", "zh")).toBe(`ANDLC-汇报-${q.todayOf(s)}.xlsx`);
    const worker = q.members(s)[0];
    expect(memberFileName(s, worker.id, "en")).toMatch(/-records-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("写成 .xlsx 再用同一个库读回来：表名、表头、行数、颜色、冻结都在", async () => {
    const tables = buildReport(s, andlc.id, REPORT_KEYS);
    const bytes = await tablesToXlsx(tables);
    const back = XLSX.read(bytes, { type: "array", cellStyles: true });
    expect(back.SheetNames).toEqual(tables.map((t) => t.name));
    tables.forEach((t) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(back.Sheets[t.name], { header: 1, blankrows: true, defval: null });
      expect(rows[0]).toEqual(t.header);
      expect(rows.length).toBe(t.rows.length + 1);
    });
    const plan = tables[1];
    const over = plan.styles.find((x) => x.s === "over")!;
    const cell = back.Sheets[plan.name][XLSX.utils.encode_cell({ r: over.r + 1, c: over.c })];
    expect(cell.v).toBe("超");
    expect(cell.s?.fgColor?.rgb).toBe("C8553D");
    expect(back.Sheets[plan.name]["A1"].s?.fgColor?.rgb).toBe("E8E4DC");
  });

  it(".csv 一张表（带 BOM）；我的记录三张表", () => {
    const csv = tableToCsv(buildReport(s, andlc.id, ["reviews"])[0]);
    expect(csv.startsWith("﻿时间,卡,环节,版本")).toBe(true);
    const muxing = q.members(s).find((m) => m.nickname === "木星")!;
    const rec = memberRecord(s, muxing.id);
    expect(rec.map((t) => t.name)).toEqual(["我的任务", "工时", "活力点流水"]);
    expect(rec[2].rows.length).toBe((q.indexOf(s).ledgerByMember.get(muxing.id) ?? []).length);
    // English：表名、表头、环节、任务名、流水种类都是英文（项目名、昵称、人写的备注照原样）
    const recEn = memberRecord(s, muxing.id, "en");
    expect(recEn.map((t) => t.name)).not.toContain("我的任务");
    const HAN = /[\u3400-\u9fff]/;
    for (const t of recEn) for (const h of t.header) expect(String(h)).not.toMatch(HAN);
    for (const row of recEn[1].rows) expect(String(row[0])).not.toMatch(HAN);
    for (const row of recEn[2].rows) expect(String(row[1])).not.toMatch(HAN);
  });
});
