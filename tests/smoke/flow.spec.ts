/**
 * 端到端主流程：
 * admin 登录 → 建一个动画项目 → 枢纽派发 → 换 member01 登录、报到「中割」自动拿到任务单 →
 * 交（附链接）→ 换回 admin 审核退回（带意见）→ member01 再交 → admin 通过（质量 1.2）→
 * 活力点变了 → 下游解锁（中割检修自动解锁；上色由「中割检修」枢纽派发放出）→
 * 刷新还在 → 导出再导入一样。口令从环境变量读，没设时跳过。
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { HAS_PASS, enterDemo, expectClean, login, logout, noExternal, open, watch } from "./helpers";

test.skip(!HAS_PASS, "没有设 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER，跳过端到端");

const NAME = "端到端测试片";
const CODE = "ETOE";
const LABEL = "C001 · 中割 · A 层";

async function points(page: Page): Promise<number> {
  await open(page, "/me");
  const text = (await page.getByTestId("points").textContent()) ?? "";
  return Number(text.replace("−", "-"));
}

async function cellOf(page: Page, projectPath: string, stageName: string): Promise<string> {
  await open(page, projectPath);
  const header = page.locator("table.board thead th");
  const names = await header.allTextContents();
  const col = names.findIndex((n) => n.trim() === stageName);
  expect(col, `网格里没有「${stageName}」这一列`).toBeGreaterThan(0);
  const cell = page.locator("table.board tbody tr").first().locator("td").nth(col - 1);
  return (await cell.locator(".cell-part").first().getAttribute("data-status")) ?? "";
}

test("主流程：开项目 → 派发 → 报到拿任务单 → 交 → 退回 → 再交 → 通过 → 活力点 → 下游解锁 → 刷新 → 导出导入", async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await noExternal(page);
  const errors = watch(page);

  // —— admin：开项目 ——
  await enterDemo(page);
  await login(page, "admin");
  await open(page, "/admin?tab=new");
  await page.getByTestId("new-name").fill(NAME);
  await page.getByTestId("new-code").fill(CODE);
  await page.getByTestId("new-count").fill("1");
  await page.getByTestId("new-layers").fill("A");
  await page.getByTestId("new-sheets").fill("6");
  await page.getByTestId("new-create").click();
  await expect(page).toHaveURL(/#\/project\//);
  const projectPath = new URL(page.url()).hash.slice(1);
  const projectId = projectPath.split("/")[2];
  expect(await cellOf(page, projectPath, "中割")).toBe("locked");

  // —— admin：在「原画监督」枢纽派发清线 + 中割，全部马上放出来 ——
  await open(page, `/admin?tab=dispatch&project=${projectId}`);
  await page.getByTestId("dispatch-hub").selectOption({ label: "原画监督" });
  await page.getByTestId("dispatch-include-inbetween").check();
  await page.getByTestId("dispatch-release-all").check();
  await page.getByTestId("dispatch-submit").click();
  await expect(page.getByText(/派发了 2 张任务/)).toBeVisible();
  expect(await cellOf(page, projectPath, "中割")).toBe("open");

  // —— member01：报到「中割」→ 自动拿到任务单 ——
  await logout(page);
  await login(page, "member01");
  const before = await points(page);
  await open(page, "/enroll");
  await page.getByTestId("role-inbetween").click();
  await page.getByRole("radio", { name: /上手 \+0.2/ }).click();
  await page.getByTestId("enroll-submit").click();
  const dialog = page.getByRole("dialog", { name: "拿到一张任务单" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("quest-card")).toContainText(NAME);
  await expect(dialog.getByTestId("quest-card")).toContainText(LABEL);
  await expect(dialog.getByTestId("quest-card")).toContainText(`${CODE}_EP01_SC001_CUT001_A_ANI_v01`);
  await page.getByTestId("goto-hall").click();

  // —— 交（附链接）——
  const quest = page.getByTestId("quest-card");
  await expect(quest).toContainText(NAME);
  await quest.getByRole("button", { name: "交", exact: true }).click();
  await page.getByLabel("飞书链接").fill("https://feishu.example.com/drive/etoe/c001/a/v01");
  await page.getByLabel("说明").fill("第一版");
  await page.getByTestId("submit-confirm").click();
  await expect(page.getByText(/交了 C001 · 中割 · A 层 v01/)).toBeVisible();

  // —— admin：退回（带意见）——
  await logout(page);
  await login(page, "admin");
  await open(page, "/review");
  await page.locator(".queue-item", { hasText: NAME }).click();
  await expect(page.getByRole("heading", { name: LABEL })).toBeVisible();
  await page.getByRole("tab", { name: "退回" }).click();
  await page.getByTestId("comment-text-0").fill("第 3 张漏了轨目，2、3 之间有中割标记");
  await page.getByTestId("review-submit").click();
  await expect(page.getByText(/退回了 C001 · 中割 · A 层/)).toBeVisible();

  // —— member01：看到退回意见，再交 ——
  await logout(page);
  await login(page, "member01");
  await page.getByTestId("mini-quest").filter({ hasText: LABEL }).filter({ hasText: NAME }).click();
  await expect(quest).toContainText(NAME);
  await expect(quest).toContainText("第 3 张漏了轨目");
  await quest.getByRole("button", { name: "改好了，再交" }).click();
  await page.getByLabel("飞书链接").fill("https://feishu.example.com/drive/etoe/c001/a/v02");
  await page.getByTestId("submit-confirm").click();
  await expect(page.getByText(/交了 C001 · 中割 · A 层 v02/)).toBeVisible();

  // —— admin：通过（质量 1.2）——
  await logout(page);
  await login(page, "admin");
  await open(page, "/review");
  await page.locator(".queue-item", { hasText: NAME }).click();
  await page.getByTestId("quality-1.2").click();
  await page.getByTestId("review-submit").click();
  // 1.5 小时 × 6 张 ×（1 + 0.2）× 1.2 = 12.96 → +13.0
  await expect(page.getByText(/通过了 C001 · 中割 · A 层 · 木星 \+13\.0 活力点/)).toBeVisible();

  // —— 下游：中割检修自动解锁；上色由「中割检修」枢纽派发放出 ——
  expect(await cellOf(page, projectPath, "中割检修")).toBe("open");
  expect(await cellOf(page, projectPath, "上色")).toBe("locked");
  await open(page, `/admin?tab=dispatch&project=${projectId}`);
  await page.getByTestId("dispatch-hub").selectOption({ label: "中割检修" });
  await page.getByTestId("dispatch-include-color_out").uncheck();
  await page.getByTestId("dispatch-include-paint").check();
  await page.getByTestId("dispatch-release-all").check();
  await page.getByTestId("dispatch-submit").click();
  await expect(page.getByText(/派发了 1 张任务/)).toBeVisible();
  expect(await cellOf(page, projectPath, "上色")).toBe("open");

  // —— member01：活力点变了；刷新还在 ——
  await logout(page);
  await login(page, "member01");
  const after = await points(page);
  expect(Math.round((after - before) * 10) / 10).toBe(13);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByTestId("points")).toHaveText(after.toFixed(1));

  // —— 导出再导入一样（换一个全新的浏览器环境导入）——
  await open(page, "/backup");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const download = await downloadPromise;
  const file = await download.path();
  const text = readFileSync(file, "utf8");
  expect(JSON.parse(text)).toMatchObject({ format: "arps-guild-world", formatVersion: 1, base: "demo" });
  expect(text).not.toContain(process.env.ARPS_PASS_ADMIN!);
  expect(text).not.toContain(process.env.ARPS_PASS_MEMBER!);
  expectClean(errors, "主流程");

  const fresh = await browser.newContext({ baseURL: info.project.use.baseURL, locale: info.project.use.locale, timezoneId: info.project.use.timezoneId, serviceWorkers: "block" });
  const page2 = await fresh.newPage();
  await noExternal(page2);
  const errors2 = watch(page2);
  await open(page2, "/");
  await page2.getByTestId("storage-import-file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page2.getByText(/0 步没能恢复/)).toBeVisible();
  await page2.getByTestId("storage-import-done").click();
  // 备份里记着 member01 登录着，直接进大厅
  await expect(page2).toHaveURL(/#\/hall/);
  await open(page2, "/me");
  await expect(page2.getByTestId("points")).toHaveText(after.toFixed(1));
  expect(await cellOf(page2, projectPath, "上色")).toBe("open");
  expect(await cellOf(page2, projectPath, "中割")).toBe("passed");
  expectClean(errors2, "导入以后");
  await fresh.close();
});
