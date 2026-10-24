/** 导出汇报 · 导出我的记录。 */
import type { Shape } from "../core";

export const zh = {
  pickOne: "至少选一张表",
  exportedXlsx: "导出好了：{name}（{n} 张表）",
  exportedCsv: "导出好了：{n} 个 .csv",
  failed: "没能导出",
  title: "导出汇报",
  body: "照工会已有的表的列，导进同一个 Excel 文件（.csv 一张表一个文件）。",
  cancel: "取消",
  exporting: "正在导出…",
  go: "导出",
  hoursBy: "必要劳动时间统计表按",
  wholeProject: "整个项目",
  format: "格式",
  xlsx: ".xlsx（一个文件）",
  csv: ".csv（一张表一个）",
  myRecord: "导出我的记录",
  exported: "导出好了：{name}",
};

export const en: Shape<typeof zh> = {
  pickOne: "Pick at least one table",
  exportedXlsx: { one: "Exported: {name} ({n} sheet)", other: "Exported: {name} ({n} sheets)" },
  exportedCsv: { one: "Exported: {n} .csv file", other: "Exported: {n} .csv files" },
  failed: "Couldn't export",
  title: "Export report",
  body: "Uses the columns of the guild's existing sheets, all in one Excel file (.csv: one file per table).",
  cancel: "Cancel",
  exporting: "Exporting…",
  go: "Export",
  hoursBy: "Labor hours table covers",
  wholeProject: "The whole project",
  format: "Format",
  xlsx: ".xlsx (one file)",
  csv: ".csv (one per table)",
  myRecord: "Export my records",
  exported: "Exported: {name}",
};
