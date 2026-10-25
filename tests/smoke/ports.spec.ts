/**
 * 从设计稿搬过来的 7 处界面（只搬界面和交互，数据还是走命令和查询）：
 *   1 大厅（概要一行 · 去报到 · 黑卡排法 · 交上去等审的 · 等我处理按种类分组带动作）
 *   2 侧栏（项目下面列出每个项目、资料库带件数、当前项目高亮）
 *   3 审核台（活力点算式随质量系数变 · 上一版意见红底 · 要补黄底 · 等了多久 · 归我审的 / 全部待审 · 质量胶囊）
 *   4 报到（选职业的环节卡 · 我报到过的在最上面 · 选中后的详情）
 *   5 零日页（开工检查卡 · 关键日时间轴）
 *   6 看图器（底部缩略图条 · 隐藏已解决 · 加一个钉）
 *   7 手机底栏（大厅 · 项目 · 资料库 · 审核台 / 我的 · 更多）
 * 三套设置都跑；中文界面（English 在 i18n.spec.ts 里扫）。
 */
import { expect, test } from "@playwright/test";
import { HAS_PASS, enterDemo, expectClean, expectNoPageScrollX, login, noExternal, open, watch } from "./helpers";

test.beforeEach(async ({ page }) => {
  await noExternal(page);
});

test.describe("搬过来的界面", () => {
  test.skip(!HAS_PASS, "没有设 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER，跳过登录示范工会");

  test("大厅 · 报到 · 手机底栏（member01）", async ({ page }, info) => {
    const errors = watch(page);
    const mobile = info.project.name === "mobile 375";
    await enterDemo(page);
    await login(page, "member01");

    // 1 大厅
    await expect(page.getByTestId("hall-summary")).toContainText("10月23日 周五");
    await expect(page.getByTestId("hall-summary")).toContainText("手上 1 张任务单");
    await expect(page.getByTestId("hall-summary")).toContainText("1 张交上去等审");
    await expect(page.getByTestId("hall-enroll")).toBeVisible();
    const quest = page.getByTestId("quest-card");
    await expect(quest.getByTestId("quest-clock")).toContainText("02:00");
    for (const label of ["工作量", "必要劳动时间", "奖励（质量 1.0 时）"]) await expect(quest).toContainText(label);
    await expect(page.getByTestId("hall-waiting")).toContainText(/等 青柠 审 · 等了 \d+ 天/);
    const inbox = page.getByTestId("hall-inbox");
    await expect(inbox.getByTestId("inbox-group-pins")).toContainText("图上 @ 我的 · 1");
    await expect(inbox.getByTestId("inbox-group-todos")).toContainText("要补的 · 3");
    await expect(inbox.getByTestId("inbox-group-returned")).toContainText("退回的 · 1");
    // 每行的动作：看图 · 补好了 · 去改
    await inbox.getByTestId("inbox-pin-open").first().click();
    await expect(page.getByTestId("viewer")).toBeVisible();
    await page.getByTestId("viewer-close").click();
    await inbox.getByTestId("inbox-todo-fixed").first().click();
    await expect(inbox.getByTestId("inbox-group-todos")).toContainText("要补的 · 2");
    await inbox.getByTestId("inbox-go-fix").click();
    await expect(quest).toContainText("C011 · 中割 · A 层");
    await expectNoPageScrollX(page, "大厅");

    // 4 报到：我报到过的在最上面 · 选职业的卡 · 选中后的详情（收什么 / 交什么不丢）
    await open(page, "/enroll");
    await expect(page.getByTestId("enroll-mine-chip")).toHaveCount(2);
    const card = page.getByTestId("role-key_check"); // 原画监督
    await expect(page.getByTestId("role-inbetween_check")).toContainText("ANI");
    await expect(card).toContainText("H");
    await expect(card).toContainText("审核 · 枢纽");
    await expect(card).toContainText("只给指派的人");
    await expect(card).toContainText("张可接");
    await expect(page.getByTestId("role-inbetween")).toContainText("已报到");
    await page.getByTestId("role-inbetween").click();
    await expect(page.getByTestId("enroll-picked")).toContainText("已选：中割 · 过渡");
    await expect(page.getByTestId("enroll-picked")).toContainText("收：");
    await expectNoPageScrollX(page, "报到");

    // 7 手机底栏：大厅 · 项目 · 资料库 · 我的 · 更多；当前页高亮；「更多」打开其余页面
    if (mobile) {
      const tabs = page.getByRole("navigation", { name: "底部导航" });
      await expect(tabs).toBeVisible();
      await expect(page.getByTestId("tab-review")).toHaveCount(0);
      await expect(page.getByTestId("tab-more")).toHaveAttribute("aria-current", "page");
      await page.getByTestId("tab-projects").click();
      await expect(page).toHaveURL(/#\/projects/);
      await expect(page.getByTestId("tab-projects")).toHaveAttribute("aria-current", "page");
      await page.getByTestId("tab-library").click();
      await expect(page).toHaveURL(/#\/library/);
      await page.getByTestId("tab-me").click();
      await expect(page).toHaveURL(/#\/me/);
      await page.getByTestId("tab-hall").click();
      await expect(page).toHaveURL(/#\/hall/);
      // 底栏不挡内容：页面最后一块的底边在底栏上面
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const lastBottom = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll("main .card"));
        return cards[cards.length - 1].getBoundingClientRect().bottom;
      });
      const barTop = await tabs.evaluate((el) => el.getBoundingClientRect().top);
      expect(lastBottom).toBeLessThanOrEqual(barTop + 1);
      await page.getByTestId("tab-more").click();
      await expect(page.getByTestId("logout")).toBeVisible();
      await expect(page.getByRole("link", { name: "报到", exact: true })).toBeVisible();
    } else {
      await expect(page.getByTestId("tab-more")).toBeHidden();
    }
    expectClean(errors, "member01");
  });

  test("侧栏 · 审核台 · 零日页 · 看图器（admin）", async ({ page }, info) => {
    const errors = watch(page);
    const mobile = info.project.name === "mobile 375";
    await enterDemo(page);
    await login(page, "admin");

    // 2 侧栏：项目下面列出每个项目，「14 卡」/「零日」，当前项目高亮；资料库带件数
    if (!mobile) {
      const list = page.getByTestId("nav-projects");
      await expect(list.getByTestId("nav-project")).toHaveCount(4);
      await expect(list).toContainText("14 卡");
      await expect(list).toContainText("零日");
      await expect(page.getByTestId("nav-library")).toContainText(/\d+/);
      await list.getByTestId("nav-project").first().click();
      await expect(page).toHaveURL(/#\/project\//);
      await expect(list.getByTestId("nav-project").first()).toHaveAttribute("aria-current", "page");
    } else {
      await expect(page.getByTestId("tab-review")).toBeVisible();
    }

    // 3 审核台
    await open(page, "/review");
    await expect(page.getByTestId("review-scope-all")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".queue-item").first()).toContainText(/等了 \d+ 天 \d+ 小时/);
    const points = page.getByTestId("review-points");
    await expect(points).toContainText("会拿到 +36.0 活力点 = 1.5h × 20 张 ×（1 掌控 + 0.2 熟练度）× 1 质量");
    await page.getByTestId("quality-1.2").click();
    await expect(points).toContainText("+43.2 活力点");
    await expect(points).toContainText("× 1.2 质量");
    await expect(page.getByTestId("review-last-notes")).toHaveAttribute("data-tone", "danger");
    await expect(page.getByTestId("review-todos")).toContainText("要补：");
    await page.getByTestId("review-scope-mine").click();
    await expect(page.getByText("现在没有指定归你审的")).toBeVisible();
    await page.getByTestId("review-scope-all").click();
    await expectNoPageScrollX(page, "审核台");

    // 5 零日页：开工检查 · 关键日时间轴
    await open(page, "/projects");
    await page.locator("main").getByRole("link", { name: /（模板）动画短片/ }).first().click();
    // （v1.1：零日是开局向导；开工检查在第 ⑤ 步，关键日时间轴在第 ② 步）
    await page.getByTestId("wizard-step-5").click();
    const check = page.getByTestId("start-check");
    await expect(check).toContainText("可以开工了");
    await expect(page.getByTestId("start-unfilled")).toContainText(/缺人的职位 \d+ 个：.+…等 \d+ 个（能开工，之后再补）/);
    await expect(check).toContainText(/开工 = 按环节生成 8 卡、\d+ 张任务/);
    await expect(check.getByTestId("zero-start")).toBeVisible();
    await expectNoPageScrollX(page, "开局向导 ⑤");
    await page.getByTestId("wizard-step-2").click();
    const tl = page.getByTestId("key-timeline");
    await expect(tl.locator("li")).toHaveCount(4);
    await expect(tl).toContainText("分镜定稿");
    await expect(tl).toContainText("交片");
    await expectNoPageScrollX(page, "零日页");

    // 6 看图器：底部缩略图条 · 隐藏已解决 · 加一个钉
    await open(page, "/library");
    await page.getByTestId("library-project").first().click();
    await page.getByTestId("file-tile").first().locator(".file-tile-open").click();
    const viewer = page.getByTestId("viewer");
    await expect(viewer).toBeVisible();
    const strip = page.getByTestId("viewer-strip");
    await expect(strip).toBeVisible();
    await expect(strip.getByTestId("viewer-strip-item").first()).toHaveAttribute("aria-current", "true");
    const title = await viewer.locator(".viewer-title").textContent();
    await strip.getByTestId("viewer-strip-item").nth(1).click();
    await expect(strip.getByTestId("viewer-strip-item").nth(1)).toHaveAttribute("aria-current", "true");
    await expect(viewer.locator(".viewer-title")).not.toHaveText(title ?? "");
    await strip.getByTestId("viewer-strip-item").first().click();
    await expect(page.getByTestId("pins-hide-resolved")).toBeVisible();
    await page.getByTestId("viewer-add-pin").click();
    await expect(page.getByTestId("viewer-mode-pin")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("viewer-close").click();
    expectClean(errors, "admin");
  });
});
