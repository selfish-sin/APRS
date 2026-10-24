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

test("管理员的其他操作：视频组项目、改项目、指派外包、拍板、改工时、加成员建账号、换人登录", async ({ page }, info) => {
  test.skip(info.project.name === "en-US UTC", "两套设置跑就够");
  const errors = watch(page);
  await createGuild(page, "smoke-pass-2");
  // 视频组项目（不分层，按期）
  await open(page, "/admin?tab=new&group=video");
  await page.getByTestId("new-name").fill("讲座第一季");
  await page.getByTestId("new-code").fill("JZ");
  await page.getByTestId("new-count").fill("3");
  await page.getByTestId("new-create").click();
  await expect(page).toHaveURL(/#\/project\//);
  await expect(page.locator("table.board tbody tr")).toHaveCount(3);
  await expect(page.locator("table.board tbody th").first()).toContainText("第 1 期");
  // 改项目
  await page.getByRole("button", { name: "改项目" }).click();
  await page.getByLabel("飞书根文件夹的链接").fill("https://feishu.example.com/drive/jz");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("link", { name: "飞书根文件夹" })).toBeVisible();
  // 项目级的「选题」：指派给外包，管理员代交
  await page.locator(".strip-item").first().click();
  await page.getByRole("button", { name: "指派" }).click();
  await page.getByLabel("给谁").selectOption("outsource");
  await page.getByLabel("外包的名字").fill("外面的老师");
  await page.getByRole("dialog", { name: /指派/ }).getByRole("button", { name: "指派" }).click();
  await expect(page.getByText(/指派好了/)).toBeVisible();
  await page.getByRole("button", { name: "代交" }).click();
  await page.getByLabel("说明").fill("外包交来的选题表");
  await page.getByTestId("submit-confirm").click();
  await expect(page.getByText(/等审核/).first()).toBeVisible();
  await page.getByRole("button", { name: "关上" }).click();
  // 设定问题 → 拍板（要补第 2 期）
  await page.getByRole("button", { name: "设定问题", exact: true }).click();
  await page.getByLabel("写意见").fill("片头用哪一版？");
  await page.getByRole("button", { name: "留下" }).click();
  await open(page, "/admin?tab=ruling");
  await page.getByLabel("结论").first().fill("用第二版片头");
  await page.getByRole("button", { name: "第 2 期" }).first().click();
  await page.getByRole("button", { name: "拍板", exact: true }).first().click();
  await expect(page.getByText(/拍板了，1 期各留了一条「要补」/)).toBeVisible();
  // 改工时 · 规则
  await open(page, "/admin?tab=rates");
  await page.getByRole("button", { name: "视频组", exact: true }).click();
  await page.getByLabel("文稿撰写 的 Tn").fill("5");
  await page.getByRole("row", { name: /文稿撰写/ }).getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("「文稿撰写」改好了")).toBeVisible();
  await page.getByRole("checkbox", { name: /超时收回时扣活力点/ }).check();
  await expect(page.getByText(/超时收回会扣 2 点活力点/)).toBeVisible();
  // 加成员 + 建账号 → 换成他登录
  await open(page, "/admin?tab=members");
  await page.getByLabel("昵称").fill("新同学");
  await page.getByLabel("登录名（可以不建账号）").fill("newbie");
  await page.getByLabel("口令", { exact: true }).fill("newbie-pass");
  await page.getByRole("button", { name: "加进来" }).click();
  await expect(page.getByText(/加了 新同学/)).toBeVisible();
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByTestId("logout").click();
  await page.getByTestId("account-newbie").click();
  await page.getByTestId("passcode").fill("newbie-pass");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/#\/hall/);
  await expect(page.getByRole("heading", { name: "你好，新同学" })).toBeVisible();
  // 新同学报到视频组「文稿撰写」——上游「选题」还没通过，没有可接的
  await open(page, "/enroll?group=video&stage=draft");
  await page.getByTestId("enroll-submit").click();
  await expect(page.getByText(/现在没有可接的/)).toBeVisible();
  await open(page, "/admin");
  await expect(page.getByText("管理页给管理员用")).toBeVisible();
  await expectNoPageScrollX(page, "管理员的其他操作");
  expectClean(errors, "管理员的其他操作");
});

test("备份页：导出，再导回同一个工会先问一句，替换前留一份", async ({ page }, info) => {
  test.skip(info.project.name !== "zh-CN Asia/Shanghai", "只在一套设置里跑");
  const errors = watch(page);
  await createGuild(page, "smoke-pass-3");
  await createProject(page, { name: "备份项目", code: "BAK", count: 2, layers: "A", sheets: 4 });
  await open(page, "/backup");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const file = await (await downloadPromise).path();
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(file, "utf8");
  await page.getByTestId("storage-import-file").setInputFiles({ name: "b.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.getByRole("dialog", { name: /这台设备上已经有「冒烟小组」/ })).toBeVisible();
  await page.getByTestId("storage-import-confirm").click();
  await expect(page.getByText(/0 步没能恢复/)).toBeVisible();
  await page.getByTestId("storage-import-done").click();
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("arps:")));
  expect(keys.some((k) => k.endsWith(":bak"))).toBe(true);
  expect(keys.every((k) => k.startsWith("arps:"))).toBe(true);
  await page.getByTestId("storage-import-file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(page.getByText("这不是工会导出的备份文件。")).toBeVisible();
  expectClean(errors, "备份页");
});
