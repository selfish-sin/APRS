/**
 * 合并前和部署后的冒烟。同一份脚本（tests/smoke），三个地址：
 *   第一层  CI 自己 build + preview（这里的 webServer）
 *   第二层  正式网址：SMOKE_BASE_URL=<部署后的网址>
 *   第三层  受保护的预览网址（等 ARCH-03 有服务器以后，用 Vercel Trusted Sources，不加长期密钥）
 * 两种浏览器各跑一遍：中文 + 上海时区、英文 + UTC（有的问题只在其中一种下出现）。
 */
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "tests/smoke",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  outputDir: "artifacts/smoke/results",
  reporter: ci
    ? [["list"], ["github"], ["html", { open: "never", outputFolder: "artifacts/smoke/report" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
    // 机器上已经有一份 Chromium、不想再下载时（云端副本）：SMOKE_CHROMIUM_PATH=/path/to/chrome
    launchOptions: process.env.SMOKE_CHROMIUM_PATH ? { executablePath: process.env.SMOKE_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "zh-CN Asia/Shanghai", use: { ...devices["Desktop Chrome"], locale: "zh-CN", timezoneId: "Asia/Shanghai" } },
    { name: "en-US UTC", use: { ...devices["Desktop Chrome"], locale: "en-US", timezoneId: "UTC" } },
  ],
  // 没给地址就自己起一份构建好的站（先 pnpm build）。
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : {
        command: "pnpm start -p 3000",
        url: "http://localhost:3000/home",
        reuseExistingServer: !ci,
        timeout: 90_000,
      },
});
