/**
 * v1.1 §18.10 验收：交付物盘点（用 tests/fixtures/audit 的假文件夹，全是脚本生成的色块图 + 「TEST」）。
 *   拖进「安娜的旅程」的盘点 → 总结行每个数字对（每种问题都出现）→ 墙上假 .clip 的缩略图显示出来、画布 / 帧率 / 时长读对 →
 *   粘贴 10 行的文件名列表 → 认出 9 条 → 复查：确认 3 条（一条用键盘 1）· 不对 1 · 改归属 1 · 「对上了」一次全确认 · 「确实没交」1 · 加一卡 →
 *   写回清单数字对 → 写回 → 补录的任务通过 · 下游解锁 · 时间线标「补录」· 活力点没记 → 路线上的缩略图条和「缺 N 卡」→ 环节页的墙 →
 *   「还差多少」→ 导出汇报两张表读回来对 → 撤销 → 回到写回前 → 再盘点一次，对比上一次。
 * 中文 / English 另在 i18n.spec 里扫；375 宽这一项照样跑（复查在手机上也能做）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { HAS_PASS, enterDemo, expandDispatch, expectClean, expectNoPageScrollX, login, open, routeRow, watch } from "./helpers";

test.skip(!HAS_PASS, "没有设 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER，跳过");

const FIXTURES = join(process.cwd(), "tests", "fixtures");

async function projectPath(page: Page, name: string): Promise<string> {
  await open(page, "/projects");
  const href = (await page.locator("a.project-card").filter({ hasText: name }).first().getAttribute("href")) ?? "";
  return href.replace(/^#/, "");
}

/** 本地存的日志（这台设备上的工会）：看写回那一条改了哪些表。 */
async function journalOf(page: Page): Promise<{ command: string; changes: { table: string; op: string }[] }[]> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      if (!k.startsWith("arps:w:")) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k) ?? "{}");
        if (Array.isArray(v.journal)) return v.journal;
      } catch {
        /* 下一个 */
      }
    }
    return [];
  });
}

async function remainingTotal(page: Page): Promise<string[]> {
  return (await page.getByTestId("remaining-total").locator("td").allTextContents()).slice(0, 6).map((x) => x.trim());
}

test("交付物盘点：放进来 → 自动查 → 人工复查 → 写回 → 撤销 → 再盘点一次（SPEC §18.10）", async ({ page }, info) => {
  test.setTimeout(240_000);
  const mobile = info.project.name.includes("375");
  const errors = watch(page);
  await enterDemo(page);
  await login(page, "admin");
  const andlc = await projectPath(page, "安娜的旅程");

  // —— 盘点页：还差多少 · 历次盘点（示范里有一次没复查完、一次写回过）· 开始一次盘点 ——
  await open(page, andlc);
  await page.getByTestId("ptab-audit").click();
  await expect(page).toHaveURL(/\/audit$/);
  await expect(page.getByTestId("remaining")).toBeVisible();
  expect(await remainingTotal(page)).toEqual(["231", "30", "80", "4", "4", "113"]);
  await expect(page.getByTestId("audit-history-item")).toHaveCount(2);
  await expectNoPageScrollX(page, "盘点页");
  await page.getByTestId("audit-start").click();
  await expect(page.getByTestId("audit-run")).toHaveAttribute("data-step", "1");
  const runPath = new URL(page.url()).hash.slice(1).split("?")[0];

  // —— ① 放进来：选一个文件夹（假的 EP01）· 粘贴 10 行 ——
  await page.getByTestId("intake-folder").setInputFiles(join(FIXTURES, "audit"));
  await expect(page.getByTestId("intake-progress")).toHaveAttribute("data-reading", "no", { timeout: 30_000 });
  await expect(page.getByText("放进来 30 个").first()).toBeVisible();
  await expect(page.getByTestId("audit-batch")).toContainText(["文件夹 audit · 30 个文件"]);
  await page.getByTestId("paste-text").fill(readFileSync(join(FIXTURES, "audit-paste.txt"), "utf8"));
  await expect(page.getByTestId("paste-count")).toContainText("认出 9 / 10 行");
  await page.getByTestId("paste-add").click();
  await expect(page.getByText("放进来 9 个").first()).toBeVisible();
  // 同一批再放一次：不重复
  await page.getByTestId("paste-text").fill(readFileSync(join(FIXTURES, "audit-paste.txt"), "utf8"));
  await page.getByTestId("paste-add").click();
  await expect(page.getByText(/放进来 0 个 · 9 个这次已经有了/).first()).toBeVisible();
  await expectNoPageScrollX(page, "盘点 ① 放进来");

  // —— ② 自动查：总结行 · 每种问题都出现 · 墙上假 .clip 的缩略图 · 画布 / 帧率 / 时长 ——
  await page.getByTestId("audit-next").click();
  await expect(page.getByTestId("audit-run")).toHaveAttribute("data-step", "2");
  await expect(page.getByTestId("audit-sum-line")).toHaveText("读了 39 个 · 认出 35 · 对上 22 · 有文件系统没记 4 · 系统说交了没找到 61 · 文件比系统新 1 · 有问题 13 · 不是这个项目的 1 · 认不出 3");
  const codes = await page.getByTestId("issue-group").evaluateAll((els) => els.map((e) => e.getAttribute("data-code")).sort());
  expect(codes).toEqual(["case", "duplicate", "missing", "no_cut", "no_layer", "no_pad", "order", "project_typo", "unknown_code", "unknown_layer", "version_note", "wrong_folder"]);
  const loTile = page.getByTestId("check-wall").locator('[data-testid="wall-cell"][data-stage="layout"][data-cut="1"]');
  await expect(loTile.locator("img")).toBeVisible();
  expect(await loTile.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
  await loTile.click();
  const viewer = page.getByTestId("wall-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId("viewer-info")).toHaveText("画布 1920 × 1080 · 24 帧 / 秒 · 6.0 秒");
  // ← → 同一卡前后环节
  await page.keyboard.press("ArrowRight");
  await expect(viewer).toHaveAttribute("aria-label", /C001 · 原画/);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await page.getByTestId("sum-issues").click();
  await expect(page.getByTestId("sum-list")).toHaveAttribute("data-kind", "issues");
  await expectNoPageScrollX(page, "盘点 ② 自动查");

  // —— ③ 人工复查 ——
  await page.getByTestId("to-review").click();
  await expect(page.getByTestId("audit-run")).toHaveAttribute("data-step", "3");
  const item = page.getByTestId("review-item");
  // 确认 3 条：有文件系统没记的两条（第二条用键盘 1）· 文件比系统新的一条
  await page.getByTestId("bucket-unrecorded").click();
  await expect(item.getByTestId("review-name")).toContainText("ANDLC_EP01_SC001_CUT011_B_ANI_v01.clip");
  await item.getByTestId("review-ok").click();
  await expect(item.getByTestId("review-name")).toContainText("ANDLC_EP01_SC001_CUT001_BG_v01.png");
  // 并排对照：同一卡上一个有图的环节（往前找，写明是哪个环节）
  await expect(item.getByTestId("review-prev")).toContainText("同一卡上一个有图的环节 · 中割");
  if (mobile) await item.getByTestId("review-ok").click();
  else await page.keyboard.press("1");
  if (!mobile) {
    // 键盘：2 打开「不对」· 3 打开「改归属」· → 跳过 · ← 回到上一条（跳过的再清掉，后面的数字不变）
    await page.getByTestId("bucket-newer").click();
    await expect(item.getByTestId("review-name")).toContainText("ANDLC_EP01_SC001_CUT009_B_ANI_v04.png");
    await page.keyboard.press("2");
    await expect(item.getByTestId("wrong-form")).toBeVisible();
    await item.getByTestId("wrong-form").getByRole("button", { name: "取消" }).click();
    await page.keyboard.press("3");
    await expect(item.getByTestId("reassign-form")).toBeVisible();
    await item.getByTestId("reassign-form").getByRole("button", { name: "取消" }).click();
    await page.keyboard.press("ArrowRight");
    await expect(item.getByTestId("review-name")).not.toContainText("CUT009_B_ANI_v04");
    await page.keyboard.press("ArrowLeft");
    await expect(item.getByTestId("review-name")).toContainText("ANDLC_EP01_SC001_CUT009_B_ANI_v04.png");
    await item.getByTestId("review-clear").click();
    await expect(item.getByTestId("review-result")).toHaveCount(0);
  }
  await page.getByTestId("bucket-newer").click();
  await expect(item.getByTestId("review-name")).toContainText("ANDLC_EP01_SC001_CUT009_B_ANI_v04.png");
  await expect(item.getByTestId("review-sys")).toContainText("待审");
  await item.getByTestId("review-ok").click();
  // 不对 1 条（不认识的流程代码 ANM：不是这个环节）
  await open(page, `${runPath}?step=3&item=${encodeURIComponent("b:ANDLC_EP01_SC001_CUT010_A_ANM_v01")}`);
  await expect(item.getByTestId("review-issues")).toContainText("ANM 是不是 ANI？");
  await item.getByTestId("review-wrong").click();
  await item.getByTestId("wrong-not_stage").click();
  await item.getByTestId("wrong-go").click();
  // 改归属 1 条（少了版本号的 C004 B → 中割 B 层 v02）
  await open(page, `${runPath}?step=3&item=${encodeURIComponent("b:ANDLC_EP01_SC001_CUT004_B_ANI")}`);
  await expect(item.getByTestId("review-issues")).toContainText("没有版本号");
  await item.getByTestId("review-reassign").click();
  await item.getByTestId("reassign-stage").selectOption("inbetween");
  await item.getByTestId("reassign-layer").selectOption("B");
  await item.getByTestId("reassign-version").fill("2");
  await item.getByTestId("reassign-go").click();
  // 卡不在卡表里：加这一卡
  await open(page, `${runPath}?step=3&item=${encodeURIComponent("b:ANDLC_EP01_SC001_CUT021_A_ANI_v01")}`);
  await expect(item.getByTestId("review-issues")).toContainText("CUT021 不在卡表里，这个项目一共 14 卡");
  await item.getByTestId("review-addcut").click();
  // 「对上了」一次全确认
  await page.getByTestId("bulk-open").click();
  await expect(page.getByTestId("bulk-cell")).toHaveCount(14);
  await page.getByTestId("bulk-go").click();
  // 「系统说交了没找到」：确实没交 1 条（C004 Layout）
  await page.getByTestId("bucket-nofile").click();
  await expect(item).toContainText("系统说交了、没找到文件");
  await expect(item.getByTestId("review-sys")).toContainText("C004 · Layout：通过");
  await item.getByTestId("review-missing").click();
  await item.getByTestId("missing-go").click();
  await expect(page.getByTestId("review-buckets")).toContainText("复查了 21 / 95");
  await expectNoPageScrollX(page, "盘点 ③ 人工复查");

  // —— ④ 写回清单 → 写回 ——
  await page.getByTestId("to-write").click();
  await expect(page.getByTestId("audit-run")).toHaveAttribute("data-step", "4");
  for (const [id, n] of [["tile-verify", "10"], ["tile-backfill", "3"], ["tile-redo", "1"], ["tile-addcut", "1"], ["tile-untouched", "76"]] as const) await expect(page.getByTestId(`${id}-n`), id).toHaveText(n);
  await expect(page.getByTestId("tile-addcut")).toContainText("CUT021 → 加成 C015");
  await expect(page.getByTestId("backfill-group")).toHaveCount(2);
  await expect(page.getByTestId("write-newer")).toContainText("文件比系统新 · 1 条");
  await expectNoPageScrollX(page, "盘点 ④ 写回清单");
  await page.getByTestId("write-go").click();
  await expect(page.getByText("写回了：核实 10 · 补录 3 · 打回 1").first()).toBeVisible();
  await expect(page.getByTestId("written-line")).toHaveText("核实 10 · 补录 3 · 打回 1 · 加卡 1");
  // 一条日志；活力点没记
  const journal = await journalOf(page);
  const write = journal.filter((e) => e.command === "audit.write").pop()!;
  expect(write).toBeTruthy();
  expect(write.changes.some((c) => c.table === "ledger")).toBe(false);
  expect(write.changes.filter((c) => c.table === "submissions" && c.op === "insert")).toHaveLength(3);

  // —— 补录的任务通过 · 下游解锁 · 时间线标「补录」——
  await open(page, andlc);
  const inbetween = await routeRow(page, "中割");
  await expect(inbetween.getByTestId("route-thumbs")).not.toHaveAttribute("data-count", "0");
  await expect(inbetween.getByTestId("route-missing")).toHaveText("缺 1 卡");
  await expect(await routeRow(page, "Layout")).toContainText("缺 2 卡");
  await (await routeRow(page, "中割检修")).click();
  await expandDispatch(page);
  await expect(page.getByTestId("dispatch-row").filter({ hasText: "C009" }).first()).toHaveAttribute("data-status", "open");
  await open(page, andlc);
  await (await routeRow(page, "中割")).click();
  await expandDispatch(page);
  // 环节页的墙：一卡一格
  await expect(page.getByTestId("stage-wall-cell")).toHaveCount(15);
  await page.getByTestId("stage-wall-verified").click();
  await expect(page.getByTestId("stage-wall-cell").first()).toHaveAttribute("data-mark", "verified");
  await page.getByTestId("stage-wall-all").click();
  await expectNoPageScrollX(page, "环节页 · 交付物墙");
  // C011 卡详情：胶片条 · 时间线里「补录」
  await open(page, `${andlc}?tab=grid&grid=text`);
  await page.locator("table.board tbody th a").filter({ hasText: "C011" }).click();
  await expect(page.getByTestId("cut-filmstrip")).toBeVisible();
  await page.getByTestId("film-layer").filter({ hasText: "B" }).click();
  await expect(page.locator('[data-testid="film-cell"][data-stage="inbetween"]')).toHaveAttribute("data-mark", "verified");
  await expect(page.getByText(/补录：/).first()).toBeVisible();

  // —— 还差多少 ——
  await open(page, `${andlc.replace(/\?.*$/, "")}/audit`);
  expect(await remainingTotal(page)).toEqual(["247", "42", "29", "40", "3", "133"]);

  // —— 导出汇报：「交付物盘点」「还差多少」两张，用同一个库读回来对 ——
  await page.getByTestId("report-open").click();
  await expect(page.getByTestId("report-dialog")).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByTestId("report-go").click();
  const wb = XLSX.read(readFileSync((await (await dl).path())!), { type: "buffer" });
  expect(wb.SheetNames.slice(-2)).toEqual(["交付物盘点", "还差多少"]);
  const rows = (name: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: null });
  expect(rows("还差多少")[0]).toEqual(["环节", "应交", "已核实", "待复查", "没文件", "有问题", "缺"]);
  expect(rows("还差多少")[1]).toEqual(["全项目合计", 247, 42, 29, 40, 3, 133]);
  expect(rows("交付物盘点")[0]).toEqual(["卡", "环节", "层", "结果", "文件名", "版本", "问题", "复查人", "结论"]);
  expect(rows("交付物盘点").some((r) => (r as unknown[]).includes("ANDLC_EP01_SC001_CUT011_B_ANI_v01.clip") && (r as unknown[]).includes("确认"))).toBe(true);
  await page.keyboard.press("Escape");

  // —— 撤销这次盘点 → 回到写回前 ——
  await open(page, `${runPath}?step=4`);
  await expect(page.getByTestId("undo-card")).toContainText("能退回");
  await page.getByTestId("undo-go").click();
  await expect(page.getByText(/撤销了：退回 \d+ 条，留着 0 条/).first()).toBeVisible();
  await open(page, `${andlc.replace(/\?.*$/, "")}/audit`);
  expect(await remainingTotal(page)).toEqual(["231", "30", "42", "40", "3", "116"]);
  await open(page, andlc);
  await (await routeRow(page, "中割检修")).click();
  await expandDispatch(page);
  await expect(page.getByTestId("dispatch-row").filter({ hasText: "C009" }).first()).toHaveAttribute("data-status", "locked");

  // —— 再盘点一次：对比上一次 ——
  await open(page, `${andlc.replace(/\?.*$/, "")}/audit`);
  await page.getByTestId("audit-start").click();
  await page.getByTestId("intake-folder").setInputFiles(join(FIXTURES, "audit"));
  await expect(page.getByTestId("intake-progress")).toHaveAttribute("data-reading", "no", { timeout: 30_000 });
  await page.getByTestId("audit-step-4").click();
  await expect(page.getByTestId("audit-compare-line")).toContainText("多了 0 个文件 · 9 个文件不见了 · 0 个版本更新了");
  await expectNoPageScrollX(page, "再盘点一次");
  expectClean(errors, "交付物盘点");
});
