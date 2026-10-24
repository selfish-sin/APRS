/**
 * 中文 / English 两种界面（SPEC §16）。
 *   - 第一次打开按浏览器语言：zh* → 中文，别的 → English（这一份不带默认的 arps:lang = zh）。
 *   - English 下每一页都开一遍，扫可见文字：除了用户写的（[data-uc]）和示范数据里的项目名 / 昵称以外，不能有汉字。
 *     「中」那个切换按钮自己标了 lang="zh-CN"，不算。
 *   - 切换以后刷新还是那种；登录以后跟着账号记。
 *   - 被拒的原因两种语言都对。
 *   - 375 宽两种语言都不横着滚（中文那一套在 smoke.spec.ts 里每页都查过；这里再查 English）。
 *   - 控制台 0 报错。
 */
import { expect, test, type Page } from "@playwright/test";
import { HAS_PASS, PASS, expectClean, expectNoPageScrollX, noExternal, open, watch } from "./helpers";

const ORIGIN = new URL(process.env.SMOKE_BASE_URL ?? "http://localhost:4173").origin;
const EMPTY = { cookies: [], origins: [] };
const EN_STATE = { cookies: [], origins: [{ origin: ORIGIN, localStorage: [{ name: "arps:lang", value: "en" }] }] };

test.beforeEach(async ({ page }) => {
  await noExternal(page);
});

/** 看得见的字里有汉字的地方（用户写的、标了 lang=zh 的不算）。 */
async function hanLeaks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // 汉字，加上中文标点（、。「」和全角的 ，：（）……）：English 界面里也不该有。
    const HAN = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;
    const out: string[] = [];
    // 输入框里的字是人写的（示范数据里管理员写的介绍也是）：和 [data-uc] 一样不算。
    const skipped = (el: Element) => !!el.closest('[data-uc], [lang^="zh"], textarea, script, style, noscript, template');
    const shown = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") return false;
      return el.getClientRects().length > 0;
    };
    const where = (el: Element) => {
      const id = el.closest("[data-testid]")?.getAttribute("data-testid");
      return `${el.tagName.toLowerCase()}${id ? `@${id}` : ""}`;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue ?? "";
      if (!HAN.test(text)) continue;
      const el = n.parentElement;
      if (!el || skipped(el) || !shown(el)) continue;
      out.push(`${where(el)}: ${text.trim().slice(0, 80)}`);
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[placeholder]"))) {
      const ph = el.getAttribute("placeholder") ?? "";
      if (HAN.test(ph) && !skipped(el) && shown(el)) out.push(`${where(el)} placeholder: ${ph.slice(0, 80)}`);
    }
    for (const sel of Array.from(document.querySelectorAll("select"))) {
      if (!shown(sel)) continue;
      for (const opt of Array.from(sel.options)) {
        if (HAN.test(opt.text) && !skipped(opt)) out.push(`${where(sel)} option: ${opt.text.slice(0, 80)}`);
      }
    }
    if (HAN.test(document.title)) out.push(`title: ${document.title}`);
    return out;
  });
}

/** 扫过的地方（最后写进测试的说明里，看得出来确实每页都扫了）。 */
const scanned = new Set<string>();

async function expectEnglish(page: Page, where: string) {
  scanned.add(where);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const leaks = await hanLeaks(page);
  expect(leaks, `${where}：English 界面里还有中文`).toEqual([]);
}

/** 打开一页：主区不空、没有「找不到」、不横着滚、扫一遍。 */
async function visit(page: Page, path: string, label: string) {
  const errors = watch(page);
  await open(page, path);
  await expect(page.locator("main"), `${label} ${path} 主区是空的`).not.toBeEmpty();
  await expect(page.getByText(/can't be found/)).toHaveCount(0);
  await expectNoPageScrollX(page, `${label} ${path}`);
  await expectEnglish(page, `${label} ${path}`);
  expectClean(errors, `${label} ${path}`);
}

const PAGES = [
  "/hall",
  "/enroll",
  "/enroll?group=animation&stage=inbetween",
  "/enroll?group=video",
  "/projects",
  "/projects?group=video",
  "/review",
  "/admin?tab=new",
  "/admin?tab=new&group=video",
  "/admin?tab=dispatch",
  "/admin?tab=ruling",
  "/admin?tab=members",
  "/admin?tab=rates",
  "/members",
  "/me",
  "/backup",
  "/library",
];

/** 项目列表里每个项目：总览（或零日页）· 设置的每个标签 · 第一卡 · 资料库 · 资料页 · 看图器。 */
async function tourProjects(page: Page, label: string) {
  for (const group of ["", "?group=video"]) {
    await open(page, `/projects${group}`);
    const hrefs = await page.locator("a.project-card").evaluateAll((as) => as.map((a) => (a.getAttribute("href") ?? "").replace(/^#/, "")));
    for (const href of hrefs) {
      await visit(page, href, label);
      const id = href.split("/")[2];
      const board = page.getByTestId("board");
      if (await board.isVisible()) {
        await page.getByTestId("view-schedule").click();
        await expectNoPageScrollX(page, `${label} ${href} 排期`);
        await expectEnglish(page, `${label} ${href} 排期`);
        await page.getByTestId("view-flow").click();
        await page.getByTestId("report-open").click();
        await expect(page.getByTestId("report-dialog")).toBeVisible();
        await expectEnglish(page, `${label} ${href} 导出汇报`);
        await page.keyboard.press("Escape");
        const node = page.locator(".map-node").first();
        if (await node.isVisible()) {
          await node.click();
          await expectEnglish(page, `${label} ${href} 环节抽屉`);
          const accept = page.getByTestId("stage-accept-open");
          if (await accept.isVisible()) {
            await accept.click();
            await expectEnglish(page, `${label} ${href} 验收`);
          }
          await page.keyboard.press("Escape");
        }
        const cut = page.locator("table.board tbody th a").first();
        if (await cut.count()) {
          const cutHref = ((await cut.getAttribute("href")) ?? "").replace(/^#/, "");
          await visit(page, cutHref, label);
        }
      }
      for (const tab of ["cover", "dates", "structure", "staff", "stages"]) await visit(page, `/project/${id}/settings?tab=${tab}`, label);
      await visit(page, `/library/${id}`, label);
      const tile = page.getByTestId("file-tile").first();
      if (await tile.count()) {
        await tile.locator(".file-tile-open").click();
        await expect(page.getByTestId("viewer")).toBeVisible();
        await expectEnglish(page, `${label} ${href} 看图器`);
        await page.getByTestId("viewer-info").click();
        await expectEnglish(page, `${label} ${href} 看图器 · 信息`);
        await page.getByTestId("viewer-close").click();
      }
      const doc = page.getByTestId("page-link").first();
      if (await doc.count()) {
        const docHref = ((await doc.getAttribute("href")) ?? "").replace(/^#/, "");
        await visit(page, docHref, label);
      }
    }
  }
}

test.afterEach(async ({}, info) => {
  if (scanned.size) info.annotations.push({ type: "scanned", description: `${scanned.size} 处：${[...scanned].join(" | ").slice(0, 4000)}` });
  scanned.clear();
});

test.describe("按浏览器语言打开", () => {
  test.use({ storageState: EMPTY });

  test("第一次打开：zh* → 中文，别的 → English", async ({ page }, info) => {
    const errors = watch(page);
    await open(page, "/");
    const zh = info.project.use.locale?.startsWith("zh");
    await expect(page.locator("html")).toHaveAttribute("lang", zh ? "zh-CN" : "en");
    await expect(page.getByRole("heading", { name: zh ? "建自己的工会" : "Create your own guild" })).toBeVisible();
    if (!zh) await expectEnglish(page, "进门");
    await expectNoPageScrollX(page, "进门");
    expectClean(errors, "进门");
  });

  test("切换以后刷新还是那种", async ({ page }) => {
    const errors = watch(page);
    await open(page, "/");
    await page.locator('[data-testid="lang-en"]:visible').click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Create your own guild" })).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Create your own guild" })).toBeVisible();
    await page.locator('[data-testid="lang-zh"]:visible').click();
    await expect(page.getByRole("heading", { name: "建自己的工会" })).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("heading", { name: "建自己的工会" })).toBeVisible();
    expectClean(errors, "切换");
  });
});

test.describe("English", () => {
  test.use({ storageState: EN_STATE });

  test("自己的工会：建好、零日页、开工、每页都扫；被拒的原因两种语言；语言跟着账号记", async ({ page }, info) => {
    test.skip(info.project.name === "zh-CN Asia/Shanghai", "English 用 en-US 和手机 375 两套跑");
    const errors = watch(page);
    await open(page, "/");
    await expectEnglish(page, "进门");
    await page.getByLabel("Guild name").fill("Smoke crew");
    await page.getByLabel("Your nickname").fill("Tester");
    await page.getByLabel("Passcode", { exact: true }).fill("smoke-pass-1");
    await page.getByLabel("Enter it again").fill("smoke-pass-1");
    await page.getByRole("button", { name: "Create and enter" }).click();
    await expect(page).toHaveURL(/#\/hall/);
    expectClean(errors, "建工会");
    await expectEnglish(page, "大厅（空的）");

    // 零日页（还没开工）
    await open(page, "/admin?tab=new");
    await page.getByTestId("new-name").fill("Smoke project");
    await page.getByTestId("new-code").fill("SMK");
    await page.getByTestId("new-create").click();
    await expect(page).toHaveURL(/#\/project\//);
    await expect(page.getByTestId("structure-card")).toBeVisible();
    await expectNoPageScrollX(page, "零日页");
    await expectEnglish(page, "零日页");
    await page.getByTestId("zero-episodes").fill("1");
    await page.getByTestId("zero-scenes").fill("1");
    await page.getByTestId("zero-cuts").fill("3");
    await page.getByTestId("zero-structure-save").click();
    await expect(page.getByTestId("structure-card")).toContainText(/3 cuts/);
    await page.getByTestId("zero-start").click();
    await expectEnglish(page, "零日页 · 开工确认");
    await page.getByTestId("zero-start-confirm").click();
    await expect(page.getByTestId("board")).toBeVisible();
    const projectPath = new URL(page.url()).hash.slice(1);
    const projectId = projectPath.split("/")[2];

    for (const p of PAGES) await visit(page, p, "自己的工会");
    await tourProjects(page, "自己的工会");
    await open(page, "/nope-not-a-page");
    await expect(page.getByText("This page can't be found")).toBeVisible();
    await expectEnglish(page, "404");

    // 被拒的原因：空标题建资料页
    await open(page, `/library/${projectId}`);
    await page.getByTestId("page-new").click();
    await expect(page.getByText("Page title can't be empty.")).toBeVisible();
    // 切到中文：同一个原因是中文
    await page.locator('[data-testid="lang-zh"]:visible').click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await page.getByTestId("page-new").click();
    await expect(page.getByText("页面标题不能为空")).toBeVisible();

    // 语言跟着账号：清掉这台设备上记的，刷新以后还是中文（账号上记着）
    await page.evaluate(() => localStorage.removeItem("arps:lang"));
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await page.locator('[data-testid="lang-en"]:visible').click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.evaluate(() => localStorage.removeItem("arps:lang"));
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expectClean(errors, "自己的工会");
  });

  test.describe("示范工会", () => {
    test.skip(!HAS_PASS, "没有设 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER，跳过登录示范工会");

    test("admin：每页、每个项目（含零日页）、设置、卡、资料库、看图器、审核台都扫", async ({ page }, info) => {
      test.skip(info.project.name === "zh-CN Asia/Shanghai", "English 用 en-US 和手机 375 两套跑");
      test.setTimeout(240_000);
      const errors = watch(page);
      await open(page, "/");
      await expectEnglish(page, "进门");
      await page.getByTestId("open-demo").click();
      await expect(page.getByRole("heading", { name: "Choose an account" })).toBeVisible();
      await expectEnglish(page, "登录");
      // 口令错：English 提示
      await page.getByTestId("account-admin").click();
      await page.getByTestId("passcode").fill("not-the-passcode");
      await page.getByTestId("login-submit").click();
      await expect(page.getByText("Wrong passcode. Try again")).toBeVisible();
      await page.getByTestId("passcode").fill(PASS.admin);
      await page.getByTestId("login-submit").click();
      await expect(page).toHaveURL(/#\/hall/);
      expectClean(errors, "登录");

      for (const p of PAGES) await visit(page, p, "示范 admin");
      await tourProjects(page, "示范 admin");

      // 成员页
      await open(page, "/members");
      const memberHref = ((await page.locator("a.project-card").first().getAttribute("href")) ?? "").replace(/^#/, "");
      await visit(page, memberHref, "示范 admin");

      // 审核台：每一张、每个标签
      const e2 = watch(page);
      await open(page, "/review");
      const items = page.locator(".queue-item");
      const n = await items.count();
      for (let i = 0; i < n; i++) {
        await items.nth(i).click();
        for (const tab of await page.getByRole("tab").all()) {
          await tab.click();
          await expectEnglish(page, `审核台第 ${i + 1} 张`);
        }
      }
      await expectNoPageScrollX(page, "审核台");
      expectClean(e2, "审核台");
    });

    test("member01：大厅（任务单 · 退回意见 · 要补）也是 English", async ({ page }, info) => {
      test.skip(info.project.name === "zh-CN Asia/Shanghai", "English 用 en-US 和手机 375 两套跑");
      const errors = watch(page);
      await open(page, "/");
      await page.getByTestId("open-demo").click();
      await page.getByTestId("account-member01").click();
      await page.getByTestId("passcode").fill(PASS.member01);
      await page.getByTestId("login-submit").click();
      await expect(page).toHaveURL(/#\/hall/);
      const quest = page.getByTestId("quest-card");
      await expect(quest).toContainText("In-between");
      await expect(quest).toContainText(/left/i);
      await expectEnglish(page, "member01 大厅");
      await expectNoPageScrollX(page, "member01 大厅");
      for (const p of ["/enroll", "/me", "/projects"]) await visit(page, p, "示范 member01");
      expectClean(errors, "member01");
    });
  });
});
