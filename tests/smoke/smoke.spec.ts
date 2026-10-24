/**
 * 冒烟：每页都打开，控制台 0 报错，手机上页面不横着滚。三套浏览器设置都跑（见 playwright.config.ts）。
 * 不写死示范 id：项目、卡、成员都从页面里点进去。
 */
import { expect, test } from "@playwright/test";
import { HAS_PASS, createGuild, createProject, enterDemo, expectClean, expectNoPageScrollX, login, offlineFonts, open, watch } from "./helpers";

test.beforeEach(async ({ page }) => {
  await offlineFonts(page);
});

const PAGES = ["/hall", "/enroll", "/projects", "/review", "/admin?tab=new", "/admin?tab=dispatch", "/admin?tab=ruling", "/admin?tab=members", "/admin?tab=rates", "/members", "/me", "/backup"];

async function visitAll(page: import("@playwright/test").Page, label: string) {
  for (const path of PAGES) {
    const errors = watch(page);
    await open(page, path);
    await expect(page.locator("main"), `${label} ${path} 主区是空的`).not.toBeEmpty();
    await expect(page.getByText("找不到了")).toHaveCount(0);
    await expectNoPageScrollX(page, `${label} ${path}`);
    expectClean(errors, `${label} ${path}`);
  }
}

test("进门页：没打开工会时显示进门，版本号在页面里", async ({ page }) => {
  const errors = watch(page);
  await open(page, "/");
  await expect(page.getByTestId("open-demo")).toBeVisible();
  await expect(page.getByRole("heading", { name: "建自己的工会" })).toBeVisible();
  expect(await page.locator('meta[name="build"]').getAttribute("content")).toBeTruthy();
  await expectNoPageScrollX(page, "进门");
  expectClean(errors, "进门");
});

test("口令错时有中文提示", async ({ page }) => {
  const errors = watch(page);
  await enterDemo(page);
  await page.getByTestId("account-admin").click();
  await page.getByTestId("passcode").fill("not-the-passcode");
  await page.getByTestId("login-submit").click();
  await expect(page.getByText("口令不对，再试一次")).toBeVisible();
  await page.getByTestId("passcode").fill("");
  await page.getByTestId("login-submit").click();
  await expect(page.getByText("请输口令")).toBeVisible();
  await expectNoPageScrollX(page, "登录");
  expectClean(errors, "登录");
});

test("自己的工会：建好（建的人是管理员），开个项目，每页都打开", async ({ page }) => {
  const errors = watch(page);
  await createGuild(page, "smoke-pass-1");
  expectClean(errors, "建工会");
  // 刚建好什么都没有：空状态
  await open(page, "/projects");
  await expect(page.getByText("还没有项目。")).toBeVisible();
  await open(page, "/projects?group=video");
  await expect(page.getByText("视频组还没有项目。")).toBeVisible();
  const projectPath = await createProject(page, { name: "冒烟项目", code: "SMK", count: 3, layers: "A,B", sheets: 8 });
  await visitAll(page, "自己的工会");
  const e2 = watch(page);
  await open(page, projectPath);
  await expect(page.getByRole("heading", { name: "冒烟项目" })).toBeVisible();
  await page.locator("table.board tbody th a").first().click();
  await expect(page).toHaveURL(/#\/cut\//);
  await expect(page.getByRole("heading", { name: /SMK · C001/ })).toBeVisible();
  await expectNoPageScrollX(page, "卡详情");
  await open(page, "/nope");
  await expect(page.getByText("找不到了")).toBeVisible();
  expectClean(e2, "项目和卡");
});

test.describe("示范工会", () => {
  test.skip(!HAS_PASS, "没有设 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER，跳过登录示范工会");

  test("admin 登录，每页都打开；项目、卡、成员都从页面里点进去", async ({ page }) => {
    const errors = watch(page);
    await enterDemo(page);
    await login(page, "admin");
    expectClean(errors, "登录");
    await visitAll(page, "示范 admin");
    // 项目列表 → 第一个项目 → 网格里的第一卡
    for (let i = 0; i < 2; i++) {
      const e = watch(page);
      await open(page, "/projects");
      await page.locator("a.project-card").nth(i).click();
      await expect(page).toHaveURL(/#\/project\//);
      await expect(page.getByTestId("board")).toBeVisible();
      for (const f of ["只看我", "只看待审", "只看卡住的", "全部"]) await page.getByRole("button", { name: f, exact: true }).click();
      await page.locator(".map-node").first().click();
      await expect(page.getByRole("link", { name: "申报这个环节" })).toBeVisible();
      await page.getByRole("button", { name: "关上" }).click();
      await expectNoPageScrollX(page, "项目总览");
      await page.locator("table.board tbody th a").first().click();
      await expect(page).toHaveURL(/#\/cut\//);
      await expectNoPageScrollX(page, "卡详情");
      expectClean(e, `第 ${i + 1} 个项目`);
    }
    // 成员 → 第一个人
    const e3 = watch(page);
    await open(page, "/members");
    await page.locator("a.project-card").first().click();
    await expect(page).toHaveURL(/#\/member\//);
    await expect(page.getByText("活力点流水")).toBeVisible();
    // 审核台有两张等着
    await open(page, "/review");
    await expect(page.locator(".queue-item")).toHaveCount(2);
    await page.locator(".queue-item").nth(1).click();
    await page.getByRole("tab", { name: "退回" }).click();
    await page.getByRole("tab", { name: "自修后通过" }).click();
    await expectNoPageScrollX(page, "审核台");
    expectClean(e3, "成员和审核台");
  });

  test("member01（木星）的大厅：快超时的中割任务单、退回意见、要补", async ({ page }) => {
    const errors = watch(page);
    await enterDemo(page);
    await login(page, "member01");
    const quest = page.getByTestId("quest-card");
    await expect(quest).toContainText("C011 · 中割 · A 层");
    await expect(quest).toContainText("还剩");
    await expect(quest).toContainText("照原画的动画轨目重做");
    await expect(page.getByText("要补的").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "审核台" })).toHaveCount(0);
    await visitAll(page, "示范 member01");
    expectClean(errors, "member01");
  });
});

test("装到桌面以后断网也能打开（service worker）", async ({ browser, browserName }, info) => {
  test.skip(info.project.name !== "zh-CN Asia/Shanghai", "只在一套设置里跑");
  test.skip(!!process.env.SMOKE_BASE_URL && !process.env.SMOKE_BASE_URL.startsWith("http"), "只对 http 站点");
  void browserName;
  const context = await browser.newContext({ serviceWorkers: "allow", baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: "networkidle" });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("open-demo")).toBeVisible();
  await context.close();
});
