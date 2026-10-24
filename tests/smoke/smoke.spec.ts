/**
 * 冒烟（三层共用）。不写死示范 id：都从页面里点进去。
 *
 * 环境变量：
 *   SMOKE_BASE_URL      对着哪个站跑（没给就是 CI 自己起的 localhost:3000）
 *   SMOKE_EXPECT_LAB    visible（本地 · 预览，默认）| hidden（正式环境 /lab 要 404）
 *   SMOKE_EXPECT_BUILD  给了就核 <meta name="build"> 等于它（第二层：main 最新提交）
 */
import { expect, test, type Page } from "@playwright/test";

const expectLab = process.env.SMOKE_EXPECT_LAB === "hidden" ? "hidden" : "visible";
const expectBuild = process.env.SMOKE_EXPECT_BUILD?.trim() || null;

type Errors = { console: string[]; page: string[]; failed: string[] };

/** 页面报错、控制台报错、同源请求 4xx/5xx 都收起来，最后要求全是 0。 */
function watch(page: Page): Errors {
  const errors: Errors = { console: [], page: [], failed: [] };
  page.on("console", (m) => {
    if (m.type() === "error") errors.console.push(m.text().slice(0, 400));
  });
  page.on("pageerror", (e) => errors.page.push(String(e.message).slice(0, 400)));
  page.on("response", (r) => {
    const url = r.url();
    if (r.status() >= 400 && url.startsWith(new URL(page.url() || "http://x/").origin)) errors.failed.push(`${r.status()} ${url}`);
  });
  return errors;
}

async function open(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "networkidle" });
  expect(response, `${path} 没有响应`).not.toBeNull();
  return response!;
}

function expectClean(errors: Errors, where: string) {
  expect(errors.page, `${where}：页面报错`).toEqual([]);
  expect(errors.console, `${where}：控制台报错`).toEqual([]);
}

test("首页：/ 转到 /home，侧栏在，没有报错", async ({ page }) => {
  const errors = watch(page);
  const r = await open(page, "/");
  // Next 14 把静态页里的 redirect() 预渲染成一个 307（没有 Location，靠页面里的脚本跳），浏览器看到的是 /home。
  expect([200, 307]).toContain(r.status());
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("navigation", { name: "去向" })).toBeVisible();
  expectClean(errors, "/home");
});

test("侧栏每个入口都打得开", async ({ page }) => {
  await open(page, "/home");
  const hrefs = await page.locator('aside[aria-label="主导航"] a[href^="/"]').evaluateAll((as) =>
    Array.from(new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute("href") || "")))
  );
  expect(hrefs.length, "侧栏里没有链接").toBeGreaterThan(3);
  for (const href of hrefs) {
    const errors = watch(page);
    const r = await open(page, href);
    expect(r.status(), `${href} 的状态码`).toBe(200);
    await expect(page.locator("main"), `${href} 主区是空的`).not.toBeEmpty();
    expectClean(errors, href);
  }
});

test("从列表点进第一件作品、第一场展、第一个人", async ({ page }) => {
  // 页面上的第一个链接
  await open(page, "/artwork");
  const artwork = page.locator('main a[href^="/artwork/"]').first();
  await expect(artwork, "页面上没有链接").toBeVisible();
  const artworkHref = await artwork.getAttribute("href");
  let errors = watch(page);
  expect((await open(page, artworkHref!)).status()).toBe(200);
  expectClean(errors, artworkHref!);

  // 展：侧栏「展」下面的第一场
  await open(page, "/home");
  const show = page.locator('aside[aria-label="主导航"] a[href^="/show/"]').first();
  await expect(show, "侧栏没有展").toBeVisible();
  const showHref = await show.getAttribute("href");
  errors = watch(page);
  expect((await open(page, showHref!)).status()).toBe(200);
  expectClean(errors, showHref!);

  // 人：展页或主页上第一个人的链接（没有就跳过这一步）
  const person = page.locator('main a[href^="/person/"]').first();
  if (await person.count()) {
    const personHref = await person.getAttribute("href");
    errors = watch(page);
    expect((await open(page, personHref!)).status()).toBe(200);
    expectClean(errors, personHref!);
  }
});

test("记一笔，刷新还在（存储没坏）", async ({ page }) => {
  const errors = watch(page);
  await open(page, "/jixia");
  const note = `冒烟 ${Date.now()}`;
  await page.locator("textarea").first().fill(note);
  await page.getByRole("button", { name: "保存记录" }).click();
  await expect(page.getByText(/已记下/)).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  const stored = await page.evaluate(
    (needle) => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || "").includes(needle)),
    note
  );
  expect(stored, "刷新以后本机存储里没有刚记的那一笔").toBe(true);
  expectClean(errors, "/jixia");
});

test(`/lab 在这个环境应该${expectLab === "hidden" ? "是 404" : "打得开"}`, async ({ page }) => {
  const r = await open(page, "/lab");
  expect(r.status()).toBe(expectLab === "hidden" ? 404 : 200);
});

test("页面里的版本号", async ({ page }) => {
  await open(page, "/home");
  const build = await page.locator('meta[name="build"]').getAttribute("content");
  expect(build, "layout.tsx 没有 <meta name=\"build\">").toBeTruthy();
  test.skip(!expectBuild, "没给 SMOKE_EXPECT_BUILD，只核有没有这一行");
  expect(build, "部署上去的不是预期的那一版").toBe(expectBuild);
});
