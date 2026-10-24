/**
 * SPEC §15.4 验收：
 *   交一版挂 5 条链接（飞书表格 · QQ 闪传 · Google Sheets · Dropbox 文件夹 · Discord 附件）+ 1 条乱写的 →
 *   平台和类型都认对、闪传和 Discord 附件有过期提示、Google / Dropbox 有权限提示、乱写的被拒 →
 *   审核员标一条「打不开」→ 交的人看到 → 换链接后清掉 →
 *   放一个 .xlsx（测试里用代码生成，带公式、合并单元格、一个空的必填列、一个 #DIV/0!）→
 *   预览里工作表切换、公式值对、合并对 →「检查这张表」列出空列和公式错 → 点格子留意见、回复、解决 →
 *   导出汇报 5 张表 → 用同一个库读回来，表名、表头、行数对 → 375 宽能用 → 控制台 0 报错。
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { HAS_PASS, enterDemo, expectNoPageScrollX, login, logout, noExternal, open, watch } from "./helpers";

test.skip(!HAS_PASS, "没有设 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER，跳过");

const LINKS = [
  { url: "https://abc123.feishu.cn/sheets/ShtFake0001", badge: "飞书", type: "表格", hints: ["access"] },
  { url: "https://qfile.qq.com/q/FakeCode01", badge: "QQ 闪传", type: "文件", hints: ["expires"] },
  { url: "https://docs.google.com/spreadsheets/d/1FakeSheetId/edit#gid=0", badge: "Google", type: "Sheets 表格", hints: ["access"] },
  { url: "https://www.dropbox.com/scl/fo/fakefolder01/AAfake?rlkey=fake&dl=0", badge: "Dropbox", type: "文件夹", hints: ["access"] },
  { url: "https://cdn.discordapp.com/attachments/111/222/C011.png?ex=6700aaaa&is=66ff0000&hm=fake", badge: "Discord", type: "附件", hints: ["expires"] },
];

/** 测试用的表：带公式、合并单元格、一个空着的必填列（负责人）、一个 #DIV/0!。 */
function sampleXlsx(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["卡", "负责人", "张数", "工时", "备注", ""],
    ["C001", "木星", 12, null, "第一卡", ""],
    ["C002", "", 8, null, "", ""],
    ["C003", "北窗", 0, null, "合并的说明", ""],
  ]);
  ws["D2"] = { t: "n", f: "C2*1.5", v: 18, w: "18" };
  ws["D3"] = { t: "n", f: "C3*1.5", v: 12, w: "12" };
  ws["D4"] = { t: "e", f: "C2/C4", v: 7, w: "#DIV/0!" };
  ws["!merges"] = [{ s: { r: 3, c: 4 }, e: { r: 3, c: 5 } }];
  XLSX.utils.book_append_sheet(wb, ws, "进度");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["说明"], ["第二张表"]]), "说明");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}

async function openSubmit(page: Page) {
  await open(page, "/hall");
  const quest = page.getByTestId("quest-card").first();
  await quest.getByRole("button", { name: /^(交|改好了，再交)$/ }).click();
  await expect(page.getByTestId("links-editor")).toBeVisible();
  // 上一版的链接带过来了：先清成一条空的
  while ((await page.locator('[data-testid^="link-row-"]').count()) > 1) await page.getByTestId("link-row-1").getByRole("button", { name: "去掉" }).click();
  await page.getByTestId("link-url-0").fill("");
  await page.getByTestId("link-name-0").fill("");
  await page.getByTestId("link-kind-0").selectOption("");
}

test("链接检查 · 表格预览和检查 · 格子上的意见 · 导出汇报", async ({ page }, info) => {
  test.setTimeout(240_000);
  await noExternal(page);
  const errors = watch(page);
  const mobile = info.project.name.startsWith("mobile");

  // —— 1. 木星交一版：5 条真实形状的链接 + 1 条乱写的 ——
  await enterDemo(page);
  await login(page, "member01");
  await openSubmit(page);
  for (let i = 0; i < LINKS.length + 1; i++) {
    if (i > 0) await page.getByTestId("link-add").click();
    await page.getByTestId(`link-url-${i}`).fill(i < LINKS.length ? LINKS[i].url : "随便写的一个链接");
  }
  for (const [i, l] of LINKS.entries()) {
    const info = page.getByTestId(`link-info-${i}`);
    await expect(info.getByTestId("link-badge")).toHaveText(l.badge);
    await expect(info).toContainText(l.type);
    const hints = await page.getByTestId(`link-row-${i}`).locator(".link-hint").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    expect(hints, `第 ${i + 1} 条的提示`).toEqual(l.hints);
  }
  await expect(page.getByTestId(`link-row-1`)).toContainText("这个链接会过期");
  await expect(page.getByTestId(`link-row-2`)).toContainText("对方要有权限才打开得了");
  await expect(page.getByTestId(`link-row-5`)).toContainText("这不像一个链接");
  await page.getByLabel("说明").fill("链接都挂上了");
  await page.getByTestId("submit-confirm").click();
  await expect(page.getByRole("alert").filter({ hasText: "第 6 条链接：这不像一个链接" })).toBeVisible();
  await page.getByTestId("link-row-5").getByRole("button", { name: "去掉" }).click();
  await page.getByTestId("submit-confirm").click();
  await expect(page.getByText(/等审核/).first()).toBeVisible();
  await logout(page);

  // —— 2. 审核员标 QQ 闪传那条「打不开」——
  await login(page, "admin");
  await open(page, "/review");
  await page.locator(".queue-item").filter({ hasText: "木星" }).filter({ hasText: "C011" }).first().click();
  const list = page.getByTestId("link-list").first();
  await expect(list.getByTestId("link-item")).toHaveCount(5);
  await list.getByTestId("link-item").filter({ hasText: "QQ 闪传" }).getByTestId("link-mark-broken").click();
  await expect(list.getByTestId("link-item").filter({ hasText: "QQ 闪传" }).getByTestId("link-broken")).toBeVisible();
  // 链接在新标签页打开
  expect(await list.getByTestId("link-open").first().getAttribute("target")).toBe("_blank");
  await logout(page);

  // —— 3. 交的人在「等我处理」里看到，换一条就清掉 ——
  await login(page, "member01");
  const broken = page.getByTestId("inbox-broken-link");
  await expect(broken).toHaveCount(1);
  await broken.getByTestId("link-replace-open").click();
  await broken.getByTestId("link-replace-url").fill("https://abc123.feishu.cn/file/BoxFake0002");
  await broken.getByTestId("link-replace-go").click();
  await expect(page.getByTestId("inbox-broken-link")).toHaveCount(0);
  await expectNoPageScrollX(page, "大厅");
  await logout(page);

  // —— 4. 放一个 .xlsx，预览、检查、在格子上留意见 ——
  await login(page, "admin");
  await open(page, "/library");
  await page.getByTestId("library-project").first().click();
  await page.getByTestId("library-drop-pick-input").setInputFiles({ name: "冒烟进度表.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: sampleXlsx() });
  const tile = page.getByTestId("file-tile").filter({ hasText: "冒烟进度表.xlsx" });
  await expect(tile).toContainText("表格");
  await tile.getByRole("button", { name: /^打开/ }).click();
  await expect(page.getByTestId("sheet-grid")).toBeVisible();
  const tabs = page.getByTestId("sheet-tab");
  await expect(tabs).toHaveText(["进度", "说明"]);
  await tabs.nth(1).click();
  await expect(page.getByTestId("sheet-grid")).toContainText("第二张表");
  await tabs.nth(0).click();
  const cell = (ref: string) => page.locator(`[data-testid="sheet-cell"][data-ref="${ref}"]`);
  await expect(cell("D2")).toHaveText("18");
  await expect(cell("D2")).toHaveAttribute("title", "=C2*1.5");
  await expect(cell("D2").getByTestId("sheet-formula")).toHaveCount(1);
  await expect(cell("D4")).toHaveText("#DIV/0!");
  await expect(cell("E4")).toHaveAttribute("colspan", "2");
  await expect(cell("F4")).toHaveCount(0);
  // 检查这张表
  await page.getByTestId("sheet-check").click();
  const issues = page.getByTestId("sheet-issue");
  await expect(issues.filter({ hasText: "B3" })).toContainText("必填的列空着");
  await expect(issues.filter({ hasText: "D4" })).toContainText("公式报错");
  await issues.filter({ hasText: "B3" }).locator("button").click();
  await expect(cell("B3")).toHaveAttribute("data-selected", "yes");
  // 点格子留意见 → 回复 → 解决
  await cell("C3").click();
  await page.getByTestId("sheet-comment").click();
  await page.getByTestId("pin-text").fill("C002 的负责人没填");
  await page.getByTestId("pin-submit").click();
  const item = page.getByTestId("pin-item").filter({ hasText: "C002 的负责人没填" });
  await expect(item).toContainText("进度 · C3");
  await expect(cell("C3")).toHaveAttribute("data-pinned", "yes");
  await item.getByTestId("pin-jump").click();
  await item.getByTestId("pin-reply").fill("填上了：北窗");
  await item.getByTestId("pin-reply-send").click();
  await expect(item).toContainText("填上了：北窗");
  await item.getByTestId("pin-resolve").click();
  await expect(item).toHaveAttribute("data-status", "resolved");
  await expect(cell("C3")).toHaveAttribute("data-pinned", "resolved");
  await expectNoPageScrollX(page, "表格预览");
  await page.getByTestId("viewer-close").click();

  // —— 5. 导出汇报 5 张表，用同一个库读回来 ——
  await open(page, "/projects");
  await page.locator("a.project-card").filter({ hasText: "安娜的旅程" }).click();
  await page.getByTestId("ptab-grid").click();
  // 「卡 × 环节」默认是交付物墙（§18）；切回文字网格
  await expect(page.getByTestId("project-wall")).toBeVisible();
  await page.getByTestId("grid-text").click();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.locator("table.board tbody tr").first()).toBeVisible();
  const cutRows = await page.locator("table.board tbody tr").count();
  await page.getByTestId("ptab-schedule").click();
  const stageCount = await page.getByTestId("schedule-row").count();
  expect(stageCount).toBeGreaterThan(10);
  await page.getByTestId("report-open").click();
  await expect(page.getByTestId("report-dialog")).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByTestId("report-go").click();
  const download = await dl;
  // 文件名跟着界面语言（中文）。测试机的系统编码不是 UTF-8 时，Chromium 会把中文文件名换成 download，所以看页面上的提示。
  await expect(page.getByText("导出好了：ANDLC-汇报-2026-10-23.xlsx（7 张表）")).toBeVisible();
  expect(download.suggestedFilename()).toMatch(/^(ANDLC-汇报-2026-10-23\.xlsx|download)$/);
  const wb = XLSX.read(readFileSync((await download.path())!), { type: "buffer" });
  expect(wb.SheetNames).toEqual(["进度总表", "项目规划表", "卡 × 环节", "必要劳动时间统计表", "审核记录", "交付物盘点", "还差多少"]);
  const rows = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: true, defval: null });
  expect(rows("进度总表")[0]).toEqual(["序号", "项目", "类型", "预计开始", "预计结束", "计划天数", "进度", "剩余天数", "状态", "实际结束"]);
  expect(rows("进度总表").length - 1).toBe(stageCount);
  expect((rows("项目规划表")[0] as string[]).slice(0, 8)).toEqual(["环节", "阶段", "负责人", "计划开始", "计划工期（周）", "实际开始", "实际工期（周）", "完成"]);
  expect(rows("项目规划表").length - 1).toBe(stageCount);
  expect(rows("卡 × 环节").length - 1).toBe(cutRows);
  expect(rows("必要劳动时间统计表")[0]).toEqual(["人员", "导演 / 监制", "剧本 / 分镜", "LO", "原画", "中割 / 清线", "填色", "后期", "其他", "总计工时", "活力点"]);
  const hours = rows("必要劳动时间统计表");
  expect((hours[hours.length - 1] as unknown[])[0]).toBe("合计");
  expect(rows("审核记录")[0]).toEqual(["时间", "卡", "环节", "版本", "交的人", "谁审", "结论", "质量系数", "意见"]);
  expect(rows("审核记录").length).toBeGreaterThan(10);
  // 成员页：导出我的记录
  await open(page, "/me");
  const dl2 = page.waitForEvent("download");
  await page.getByTestId("export-my-record").click();
  const mine = XLSX.read(readFileSync((await (await dl2).path())!), { type: "buffer" });
  expect(mine.SheetNames).toEqual(["我的任务", "工时", "活力点流水"]);
  await expectNoPageScrollX(page, "成员页");
  void mobile;

  expect(errors.page).toEqual([]);
  expect(errors.console).toEqual([]);
  expect(errors.failed).toEqual([]);
  expect(errors.external).toEqual([]);
});
