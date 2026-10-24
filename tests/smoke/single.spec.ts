/**
 * 单文件预览（pnpm build:single → dist-single/index.html）：直接用 file:// 打开也能用。
 * 没构建单文件时跳过。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { HAS_PASS, PASS, expectClean, noExternal, watch } from "./helpers";

const FILE = resolve(process.cwd(), "dist-single/index.html");

test("单文件：直接打开，进示范工会，口令错有提示，对的能进", async ({ page }, info) => {
  test.skip(!existsSync(FILE), "没有 dist-single/index.html（先 pnpm build:single）");
  test.skip(info.project.name !== "zh-CN Asia/Shanghai", "只在一套设置里跑");
  await noExternal(page);
  const errors = watch(page);
  await page.goto(`file://${FILE}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("open-demo")).toBeVisible();
  expect(await page.locator('link[rel="manifest"]').count()).toBe(0);
  await page.getByTestId("open-demo").click();
  await page.getByTestId("account-admin").click();
  await page.getByTestId("passcode").fill("wrong-passcode");
  await page.getByTestId("login-submit").click();
  await expect(page.getByText("口令不对，再试一次")).toBeVisible();
  if (HAS_PASS) {
    await page.getByTestId("passcode").fill(PASS.admin);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/#\/hall/);
    await page.goto(`file://${FILE}#/projects`, { waitUntil: "networkidle" });
    await page.locator("a.project-card:not([data-zero])").first().click();
    await expect(page.getByTestId("stage-route")).toBeVisible();
    await page.getByTestId("ptab-grid").click();
    await expect(page.getByTestId("board")).toBeVisible();
    // 资料库在单文件版里也能用（IndexedDB 不让用时退回内存，顶上有一条说明）
    await page.goto(`file://${FILE}#/library`, { waitUntil: "networkidle" });
    await page.getByTestId("library-project").first().click();
    await page.getByTestId("library-drop-pick-input").setInputFiles({ name: "单文件里放的.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64") });
    await expect(page.getByTestId("file-tile").filter({ hasText: "单文件里放的.png" })).toBeVisible();
    const memory = await page.getByTestId("files-memory-banner").count();
    console.log(`单文件版的文件仓：${memory ? "内存（有提示条）" : "IndexedDB"}`);
  }
  expectClean(errors, "单文件");
});

test("单文件：不连外网，数字字体内联在文件里", async ({ page }, info) => {
  test.skip(!existsSync(FILE), "没有 dist-single/index.html（先 pnpm build:single）");
  test.skip(info.project.name !== "zh-CN Asia/Shanghai", "只在一套设置里跑");
  const html = readFileSync(FILE, "utf8");
  expect(html).not.toMatch(/<link[^>]+href="https?:/);
  expect(html).not.toMatch(/<script[^>]+src="https?:/);
  expect(html).not.toMatch(/@import\s+url\(["']?https?:/);
  expect(html).not.toContain("fonts.googleapis.com");
  expect(html).toMatch(/font-family:\s*"?Outfit"?;[^}]*src:\s*url\(["']?data:font\/woff2/);
  await noExternal(page);
  const errors = watch(page);
  await page.goto(`file://${FILE}`, { waitUntil: "networkidle" });
  await expect(page.getByTestId("open-demo")).toBeVisible();
  expect(await page.evaluate(async () => { await document.fonts.load("600 16px Outfit", "0123"); return document.fonts.check("600 16px Outfit"); })).toBe(true);
  expectClean(errors, "单文件不连外网");
});

test("单文件：English 浏览器打开是 English，切到中文刷新还是中文", async ({ page }, info) => {
  test.skip(!existsSync(FILE), "没有 dist-single/index.html（先 pnpm build:single）");
  test.skip(info.project.name !== "en-US UTC", "只在 English 那一套里跑");
  await noExternal(page);
  const errors = watch(page);
  await page.goto(`file://${FILE}`, { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Create your own guild" })).toBeVisible();
  await page.locator('[data-testid="lang-zh"]:visible').click();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: "建自己的工会" })).toBeVisible();
  expectClean(errors, "单文件 English");
});
