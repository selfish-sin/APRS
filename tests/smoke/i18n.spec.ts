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

/** 扫一遍环节页：页面本身 · 改这个环节（展开）· 一行的动作 · 指派一个人 · 验收（有的话）。 */
async function tourStage(page: Page, path: string, label: string) {
  await visit(page, path, label);
  const where = `${label} ${path}`;
  const edit = page.getByTestId("stage-edit-open");
  if (await edit.isVisible()) {
    await edit.click();
    await expectNoPageScrollX(page, `${where} 设置`);
    await expectEnglish(page, `${where} 设置`);
  }
  const expand = page.getByTestId("dispatch-expand");
  if (await expand.isVisible()) await expand.click();
  const menu = page.getByTestId("dispatch-menu").first();
  if (await menu.isVisible()) {
    await menu.click();
    await expectEnglish(page, `${where} 一行的动作`);
    await page.keyboard.press("Escape");
  }
  const assign = page.getByTestId("assign-person-open");
  if (await assign.isVisible()) {
    await assign.click();
    await expectEnglish(page, `${where} 指派一个人`);
    await page.keyboard.press("Escape");
  }
  const hub = page.getByTestId("hub-open");
  if (await hub.isVisible()) {
    await hub.click();
    await expectEnglish(page, `${where} 派发下游`);
  }
  const accept = page.getByTestId("stage-accept-open");
  if ((await accept.isVisible()) && (await accept.isEnabled())) {
    await accept.click();
    await expectEnglish(page, `${where} 验收`);
    await page.keyboard.press("Escape");
  }
}

/** 盘点：总览（还差多少 · 历史 · 墙）· 看图器 · 一次没写回的盘点的 4 步（复查时「不对」「改归属」「一次全确认」也打开看）· 写回过的那次。 */
async function tourAudit(page: Page, href: string, label: string) {
  const base = href.replace(/\?.*$/, "");
  if (!(await page.getByTestId("ptab-audit").count())) return;
  await visit(page, `${base}/audit`, label);
  const where = `${label} ${base}/audit`;
  // 点「还差多少」里的一个数 → 下面出这一类的墙
  const num = page.getByTestId("remaining-total").locator("button.remaining-num").first();
  if (await num.count()) {
    await num.click();
    await expectEnglish(page, `${where} 墙`);
  }
  const cell = page.getByTestId("overview-wall").getByTestId("wall-cell").first();
  if (await cell.count()) {
    await cell.click();
    await expect(page.getByTestId("wall-viewer")).toBeVisible();
    await expectEnglish(page, `${where} 看图器`);
    await page.keyboard.press("Escape");
  }
  const links = async (id: string) => page.getByTestId(id).evaluateAll((as) => as.map((a) => (a.getAttribute("href") ?? "").replace(/^#/, "")));
  for (const run of await links("history-continue")) {
    for (let n = 1; n <= 4; n++) {
      await visit(page, `${run.split("?")[0]}?step=${n}`, label);
      if (n !== 3) continue;
      for (const [btn, what] of [["review-wrong", "不对"], ["review-reassign", "改归属"], ["bulk-open", "一次全确认"]] as const) {
        const b = page.getByTestId(btn).first();
        if (!(await b.isVisible())) continue;
        await b.click();
        await expectNoPageScrollX(page, `${where} 复查 · ${what}`);
        await expectEnglish(page, `${where} 复查 · ${what}`);
        await open(page, `${run.split("?")[0]}?step=3`);
      }
    }
  }
  // 写回过的那次（第 4 步：写回了什么 · 撤销那一块 · 和上一次比）
  for (const run of await links("history-open")) await visit(page, run, label);
}

/** 项目列表里每个项目：环节路线（或开局向导的每一步）· 每个标签 · 每种状态的环节页 · 第一卡 · 资料库 · 资料页 · 看图器。 */
async function tourProjects(page: Page, label: string) {
  for (const group of ["", "?group=video"]) {
    await open(page, `/projects${group}`);
    const hrefs = await page.locator("a.project-card").evaluateAll((as) => as.map((a) => (a.getAttribute("href") ?? "").replace(/^#/, "")));
    for (const href of hrefs) {
      await visit(page, href, label);
      const id = href.split("/")[2];
      if (await page.getByTestId("wizard-steps").isVisible()) {
        // 开局向导：每一步都看（人员那一步把收起的职位也展开）
        for (let n = 1; n <= 5; n++) {
          const step = page.getByTestId(`wizard-step-${n}`);
          if (!(await step.isEnabled())) break;
          await step.click();
          await expect(step).toHaveAttribute("aria-current", "step");
          const rest = page.getByTestId("staff-rest");
          if (await rest.isVisible()) await rest.locator("summary").click();
          await expectNoPageScrollX(page, `${label} ${href} 开局第 ${n} 步`);
          await expectEnglish(page, `${label} ${href} 开局第 ${n} 步`);
        }
        const start = page.getByTestId("zero-start");
        if (await start.isVisible()) {
          await start.click();
          await expectEnglish(page, `${label} ${href} 开工确认`);
          await page.keyboard.press("Escape");
        }
      } else {
        // 环节路线：折起来的段展开、在两个环节之间插一个（弹层）
        for (let i = 0; i < 3 && (await page.locator('[data-testid^="route-expand-"]').count()); i++) await page.locator('[data-testid^="route-expand-"]').first().click();
        await expectEnglish(page, `${label} ${href} 路线（展开）`);
        const insert = page.getByTestId("route-insert").first();
        if (await insert.count()) {
          await page.getByTestId("route-row").first().hover();
          await insert.click();
          await expectEnglish(page, `${label} ${href} 插一个环节`);
          await page.keyboard.press("Escape");
        }
        // 每种状态的环节页各看一个
        const stageHrefs: string[] = [];
        for (const st of ["done", "review", "active", "ready", "locked"]) {
          const row = page.locator(`[data-testid="route-row"][data-status="${st}"]`).first();
          if (await row.count()) stageHrefs.push(((await row.getAttribute("href")) ?? "").replace(/^#/, ""));
        }
        const hub = page.locator('[data-testid="route-row"]', { has: page.locator(".kind-tag", { hasText: /hub/i }) }).first();
        if (await hub.count()) stageHrefs.push(((await hub.getAttribute("href")) ?? "").replace(/^#/, ""));
        for (const sh of Array.from(new Set(stageHrefs))) await tourStage(page, sh, label);
        // 标签
        for (const tab of ["grid", "schedule", "activity", "profile"]) await visit(page, `${href}?tab=${tab}`, label);
        for (const block of ["intro", "dates", "structure", "staff"]) {
          const edit = page.getByTestId(`profile-${block}-edit`);
          if (await edit.isVisible()) {
            await edit.click();
            await expectNoPageScrollX(page, `${label} ${href} 档案 · 改 ${block}`);
            await expectEnglish(page, `${label} ${href} 档案 · 改 ${block}`);
            await page.getByTestId(`profile-${block}`).locator('[data-testid="profile-cancel"], [data-testid="profile-done"]').first().click();
          }
        }
        await open(page, `${href}?tab=grid`);
        await expectEnglish(page, `${label} ${href} 交付物墙`);
        const wcell = page.getByTestId("project-wall").getByTestId("wall-cell").first();
        if (await wcell.count()) {
          await wcell.click();
          await expect(page.getByTestId("wall-viewer")).toBeVisible();
          await expectEnglish(page, `${label} ${href} 交付物墙 · 看图器`);
          await page.keyboard.press("Escape");
        }
        const folded = page.getByTestId("wall-folded");
        if (await folded.isVisible()) {
          await folded.click();
          await expectNoPageScrollX(page, `${label} ${href} 交付物墙（全部环节）`);
          await expectEnglish(page, `${label} ${href} 交付物墙（全部环节）`);
        }
        await tourAudit(page, href, label);
        await open(page, `${href}?tab=grid&grid=text`);
        await page.getByTestId("report-open").click();
        await expect(page.getByTestId("report-dialog")).toBeVisible();
        await expectEnglish(page, `${label} ${href} 导出汇报`);
        await page.keyboard.press("Escape");
        const cut = page.locator("table.board tbody th a").first();
        if (await cut.count()) {
          const cutHref = ((await cut.getAttribute("href")) ?? "").replace(/^#/, "");
          await visit(page, cutHref, label);
        }
      }
      await visit(page, `${href}?tab=library`, label);
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
    test.setTimeout(240_000);
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

    // 开局向导（还没开工）：跳到结构填 3 卡 → 下一步 → 开工
    await open(page, "/admin?tab=new");
    await page.getByTestId("new-name").fill("Smoke project");
    await page.getByTestId("new-code").fill("SMK");
    await page.getByTestId("new-create").click();
    await expect(page).toHaveURL(/#\/project\//);
    await expect(page.getByTestId("wizard-steps")).toBeVisible();
    await expectNoPageScrollX(page, "开局向导");
    await expectEnglish(page, "开局向导 · 介绍");
    await page.getByTestId("wizard-step-3").click();
    await page.getByTestId("zero-episodes").fill("1");
    await page.getByTestId("zero-scenes").fill("1");
    await page.getByTestId("zero-cuts").fill("3");
    await expect(page.getByTestId("cut-preview")).toHaveAttribute("data-count", "3");
    await expectEnglish(page, "开局向导 · 结构");
    await page.getByTestId("wizard-next").click();
    await expect(page.getByTestId("wizard-staff")).toBeVisible();
    await expectEnglish(page, "开局向导 · 人员");
    await page.getByTestId("wizard-next").click();
    await expect(page.getByTestId("start-check")).toContainText(/3 cuts/);
    await expectEnglish(page, "开局向导 · 开工");
    await page.getByTestId("zero-start").click();
    await expectEnglish(page, "开局向导 · 开工确认");
    await page.getByTestId("zero-start-confirm").click();
    await expect(page.getByTestId("stage-route")).toBeVisible();
    await expectEnglish(page, "环节路线");
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

    test("admin：每页、每个项目（路线 · 环节页 · 标签 · 档案 · 开局向导）、卡、资料库、看图器、审核台都扫", async ({ page }, info) => {
      test.skip(info.project.name === "zh-CN Asia/Shanghai", "English 用 en-US 和手机 375 两套跑");
      test.setTimeout(480_000);
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
