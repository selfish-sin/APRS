/**
 * 冒烟 + 端到端（tests/smoke）。对着 `pnpm build` 出来的 dist（`pnpm preview`，端口 4173）跑；
 * 给了 SMOKE_BASE_URL 就对着那个站（例如部署好的 Vercel 地址）。
 * 三套：中文 + 上海时区、英文 + UTC（桌面 1440），再加一套手机 375 × 812。
 *
 * 口令从环境变量 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER 读，没设时跳过要登录示范工会的那几项。
 * 机器上已经装好 Chromium：@playwright/test 找不到时，用 SMOKE_CHROMIUM_PATH 或者
 * require("playwright").chromium.executablePath() 的那一个（不要跑 playwright install）。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL ?? "http://localhost:4173";
const ci = !!process.env.CI;

function chromiumPath(): string | undefined {
  if (process.env.SMOKE_CHROMIUM_PATH) return process.env.SMOKE_CHROMIUM_PATH;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    /* 落到下面 */
  }
  try {
    const require = createRequire(import.meta.url);
    const pw = require("playwright") as { chromium: { executablePath(): string } };
    const p = pw.chromium.executablePath();
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

const executablePath = chromiumPath();

export default defineConfig({
  testDir: "tests/smoke",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  outputDir: "artifacts/smoke/results",
  reporter: ci ? [["list"], ["github"], ["html", { open: "never", outputFolder: "artifacts/smoke/report" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // 离线那一项自己打开 service worker；其余的不要它（免得缓存跨测试）。
    serviceWorkers: "block",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "zh-CN Asia/Shanghai", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" } },
    { name: "en-US UTC", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, locale: "en-US", timezoneId: "UTC" } },
    { name: "mobile 375", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, locale: "zh-CN", timezoneId: "Asia/Shanghai" } },
  ],
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : {
        command: "pnpm preview",
        url: "http://localhost:4173/",
        reuseExistingServer: !ci,
        timeout: 60_000,
      },
});
