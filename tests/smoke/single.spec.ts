/**
 * 单文件预览（pnpm build:single → dist-single/index.html）：直接用 file:// 打开也能用。
 * 没构建单文件时跳过。
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { HAS_PASS, PASS, expectClean, offlineFonts, watch } from "./helpers";

const FILE = resolve(process.cwd(), "dist-single/index.html");

test("单文件：直接打开，进示范工会，口令错有提示，对的能进", async ({ page }, info) => {
  test.skip(!existsSync(FILE), "没有 dist-single/index.html（先 pnpm build:single）");
  test.skip(info.project.name !== "zh-CN Asia/Shanghai", "只在一套设置里跑");
  await offlineFonts(page);
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
    await page.locator("a.project-card").first().click();
    await expect(page.getByTestId("board")).toBeVisible();
  }
  expectClean(errors, "单文件");
});
