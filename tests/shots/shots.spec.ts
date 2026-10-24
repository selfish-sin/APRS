/** 主要页面的截图：artifacts/shots/<页>-<desktop|mobile>.png。页面里的口令框都是空的。 */
import { expect, test, type Page } from "@playwright/test";
import { HAS_PASS, enterDemo, login, logout, noExternal, open } from "../smoke/helpers";

/** v1.1（§17）：路线 · 环节页（含一行的动作、设置展开）· 插一个环节 · 卡 × 环节 · 项目档案（看 / 改）· 开局向导每一步 · 卡详情。 */
async function v11Shots(page: Page, shot: (name: string) => Promise<unknown>) {
  await page.locator("a.project-card").filter({ hasText: /安娜的旅程|Anna/ }).first().click();
  await expect(page.getByTestId("stage-route")).toBeVisible();
  const projectPath = new URL(page.url()).hash.slice(1);
  await shot("p17-route");
  await page.getByTestId("route-row").nth(2).hover();
  await page.getByTestId("route-insert").nth(2).click();
  await expect(page.getByTestId("insert-name")).toBeVisible();
  await shot("p17-route-insert");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="route-row"][data-key="inbetween"]').click();
  await expect(page.getByTestId("stage-title")).toBeVisible();
  await shot("p17-stage");
  await page.getByTestId("dispatch-expand").click();
  await page.getByTestId("dispatch-menu").first().click();
  await expect(page.getByTestId("dispatch-pop")).toBeVisible();
  await page.screenshot({ path: shotPath(page, "p17-stage-menu"), fullPage: false });
  await page.keyboard.press("Escape");
  await page.getByTestId("stage-edit-open").click();
  await page.getByTestId("stage-config").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shotPath(page, "p17-stage-config"), fullPage: false });
  await open(page, projectPath);
  const clean = page.locator('[data-testid="route-row"][data-key="clean"]');
  await clean.click();
  await page.getByTestId("stage-accept-open").click();
  await expect(page.getByTestId("accept-view")).toBeVisible();
  await shot("p17-stage-accept");
  await open(page, `${projectPath}?tab=grid&grid=text`);
  await expect(page.getByTestId("board")).toBeVisible();
  await shot("p5-grid");
  await page.locator("table.board tbody th a").nth(4).click();
  await expect(page).toHaveURL(/#\/cut\//);
  await shot("p6-cut");
  await open(page, `${projectPath}?tab=profile`);
  await shot("p17-profile");
  await page.getByTestId("profile-intro-edit").click();
  await shot("p17-profile-edit");
  await open(page, `${projectPath}?tab=activity`);
  await shot("p17-activity");
  await open(page, "/projects");
  await page.locator("a.project-card").filter({ hasText: /星期三的猫|Wednesday/ }).first().click();
  await expect(page.getByTestId("stage-route")).toBeVisible();
  await shot("p17-route-cat");
  await open(page, "/projects");
  await page.locator("main a.project-card[data-zero]").first().click();
  for (let n = 1; n <= 5; n++) {
    await page.getByTestId(`wizard-step-${n}`).click();
    await expect(page.getByTestId(`wizard-step-${n}`)).toHaveAttribute("aria-current", "step");
    await shot(`p17-wizard-${n}`);
  }
}

/** v1.1（§18）：盘点总览（还差多少 · 历史）· 点一个数下面出墙 · 一次盘点的 4 步（复查时「不对」展开）· 写回过的那次 · 卡 × 环节的墙和看图器 · 环节页的墙 · 卡详情的胶片条。 */
async function auditShots(page: Page, shot: (name: string) => Promise<unknown>) {
  await open(page, "/projects");
  await page.locator("a.project-card").filter({ hasText: /安娜的旅程|Anna/ }).first().click();
  await expect(page.getByTestId("stage-route")).toBeVisible();
  const projectPath = new URL(page.url()).hash.slice(1).split("?")[0];
  await page.getByTestId("ptab-audit").click();
  await expect(page.getByTestId("remaining")).toBeVisible();
  await shot("p18-audit");
  await page.getByTestId("remaining-total").locator("button.remaining-num").nth(1).click();
  await expect(page.getByTestId("overview-wall")).toBeVisible();
  await shot("p18-audit-wall");
  const run = ((await page.getByTestId("history-continue").first().getAttribute("href")) ?? "").replace(/^#/, "");
  const written = ((await page.getByTestId("history-open").first().getAttribute("href")) ?? "").replace(/^#/, "");
  for (let n = 1; n <= 4; n++) {
    await open(page, `${run}?step=${n}`);
    await expect(page.getByTestId("audit-run")).toHaveAttribute("data-step", String(n));
    await shot(`p18-step${n}`);
    if (n === 3) {
      await page.getByTestId("review-wrong").click();
      await expect(page.getByTestId("wrong-go")).toBeVisible();
      await page.getByTestId("wrong-go").scrollIntoViewIfNeeded();
      await page.screenshot({ path: shotPath(page, "p18-review-wrong"), fullPage: false });
    }
  }
  await open(page, written);
  await expect(page.getByTestId("written-card")).toBeVisible();
  await shot("p18-written");
  await open(page, `${projectPath}?tab=grid`);
  await expect(page.getByTestId("project-wall")).toBeVisible();
  await shot("p18-wall");
  // C010 中割 B 层：系统里 v01–v03 没附图（「没有图」的占位）· v04 附了图 · 盘点里找到 v05改（文件里的图）
  await page.getByTestId("project-wall").locator('[data-testid="wall-cell"][data-stage="inbetween"][data-cut="10"]').click();
  await expect(page.getByTestId("wall-viewer")).toBeVisible();
  await page.getByTestId("viewer-layer").filter({ hasText: "B" }).click();
  await page.screenshot({ path: shotPath(page, "p18-viewer"), fullPage: false });
  await page.keyboard.press("Escape");
  await open(page, projectPath);
  await page.locator('[data-testid="route-row"][data-key="inbetween"]').click();
  await page.getByTestId("stage-wall").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shotPath(page, "p18-stage-wall"), fullPage: false });
  await open(page, `${projectPath}?tab=grid&grid=text`);
  await page.locator("table.board tbody th a").first().click();
  await page.getByTestId("cut-filmstrip").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shotPath(page, "p18-filmstrip"), fullPage: false });
}

let shotTag = "";
function shotPath(_page: Page, name: string) {
  return `artifacts/shots/${name}-${shotTag}.png`;
}

test.skip(!HAS_PASS, "没有设 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER");

test("截图", async ({ page }, info) => {
  test.setTimeout(240_000);
  const tag = info.project.name;
  shotTag = tag;
  const shot = (name: string) => page.screenshot({ path: `artifacts/shots/${name}-${tag}.png`, fullPage: true });
  await noExternal(page);
  await open(page, "/");
  await shot("p1-entry");
  await enterDemo(page);
  await shot("login");
  await login(page, "member01");
  await shot("p2-hall-member01");
  await open(page, "/enroll?group=animation&stage=inbetween");
  await shot("p3-enroll");
  await open(page, "/me");
  await shot("p9-member");
  await logout(page);
  await login(page, "admin");
  await shot("p2-hall-admin");
  await open(page, "/projects");
  await shot("p4-projects");
  await v11Shots(page, shot);
  await auditShots(page, shot);
  await open(page, "/review");
  await shot("p7-review");
  await open(page, "/admin?tab=dispatch");
  await page.getByTestId("dispatch-hub").selectOption({ label: "中割检修" });
  await shot("p8-admin-dispatch");
  await open(page, "/admin?tab=new");
  await shot("p8-admin-new");
  await open(page, "/admin?tab=ruling");
  await shot("p8-admin-ruling");
  await open(page, "/backup");
  await shot("p10-backup");
  await open(page, "/review");
  await page.getByRole("tab", { name: "退回" }).click();
  await shot("p7-review-return");
  await open(page, "/library");
  await page.getByTestId("library-project").first().click();
  await shot("p11-library");
  await page.getByTestId("file-tile").first().locator(".file-tile-open").click();
  await expect(page.getByTestId("viewer")).toBeVisible();
  await page.screenshot({ path: `artifacts/shots/p11-viewer-${tag}.png` });
  await page.getByTestId("viewer-close").click();
  // 手机：底部标签栏的「更多」打开其余页面
  const more = page.getByTestId("tab-more");
  if (await more.isVisible()) {
    await more.click();
    await expect(page.getByTestId("logout")).toBeVisible();
    await page.waitForTimeout(400); // 抽屉滑出来的动画
    await page.screenshot({ path: `artifacts/shots/nav-more-${tag}.png` });
  }
});

test.describe("English", () => {
  test.use({ storageState: { cookies: [], origins: [{ origin: new URL(process.env.SMOKE_BASE_URL ?? "http://localhost:4173").origin, localStorage: [{ name: "arps:lang", value: "en" }] }] } });

  test("截图（English）", async ({ page }, info) => {
    test.setTimeout(240_000);
    const tag = `${info.project.name}-en`;
    shotTag = tag;
    const shot = (name: string) => page.screenshot({ path: `artifacts/shots/${name}-${tag}.png`, fullPage: true });
    const signIn = async (who: "admin" | "member01") => {
      await page.getByTestId(`account-${who}`).click();
      await page.getByTestId("passcode").fill(who === "admin" ? process.env.ARPS_PASS_ADMIN! : process.env.ARPS_PASS_MEMBER!);
      await page.getByTestId("login-submit").click();
      await expect(page).toHaveURL(/#\/hall/);
    };
    await noExternal(page);
    await open(page, "/");
    await shot("p1-entry");
    await page.getByTestId("open-demo").click();
    await shot("login");
    await signIn("member01");
    await shot("p2-hall-member01");
    await open(page, "/enroll?group=animation&stage=inbetween");
    await shot("p3-enroll");
    await open(page, "/me");
    await shot("p9-member");
    const menu = page.getByTestId("tab-more");
    if (await menu.isVisible()) await menu.click();
    await page.getByTestId("logout").click();
    await signIn("admin");
    await open(page, "/projects");
    await shot("p4-projects");
    await v11Shots(page, shot);
    await auditShots(page, shot);
    await open(page, "/review");
    await shot("p7-review");
    await open(page, "/admin?tab=dispatch");
    await shot("p8-admin-dispatch");
    await open(page, "/library");
    await page.getByTestId("library-project").first().click();
    await shot("p11-library");
    await page.getByTestId("file-tile").first().locator(".file-tile-open").click();
    await expect(page.getByTestId("viewer")).toBeVisible();
    await page.screenshot({ path: `artifacts/shots/p11-viewer-${tag}.png` });
  });
});
