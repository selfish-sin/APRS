/**
 * 读写表格用的库：SheetJS CE 0.20.3（SPEC §15.2）。
 *
 * 为什么是它：维护中、能在浏览器里读 .xlsx / .xls / .csv（公式、合并单元格、列宽都读得出来）也能写 .xlsx；
 * 从官方发布的 tarball 打进程序（vendor/xlsx-0.20.3.tgz，不从 CDN 加载）。
 * npm 上的 xlsx@0.18.5 有已知漏洞（CVE-2023-30533 原型污染、CVE-2024-22363 ReDoS），官方已不在 npm 发新版，所以不用它。
 *
 * 普通构建里按需加载（打开表格 / 导出汇报时才下载这一块）；单文件版里内联。
 * 社区版写文件时不写单元格样式，所以导出汇报的颜色由 style.ts 在写好的 xlsx 里补上。
 */
export type XLSXModule = typeof import("xlsx");

let loading: Promise<XLSXModule> | null = null;

export function loadXlsx(): Promise<XLSXModule> {
  if (!loading) loading = import("xlsx");
  return loading;
}
