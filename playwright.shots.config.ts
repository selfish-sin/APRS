/**
 * 截图（不进仓库）：主要页面桌面 1440 和手机 375 各一张，存到 artifacts/shots/。
 *   pnpm build && pnpm shots
 * 要登录示范工会，口令从环境变量 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER 读。
 */
import base from "./playwright.config";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  ...base,
  testDir: "tests/shots",
  outputDir: "artifacts/shots/results",
  reporter: [["list"]],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, locale: "zh-CN", timezoneId: "Asia/Shanghai" } },
  ],
});
