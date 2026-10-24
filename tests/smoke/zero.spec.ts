/**
 * SPEC §12.3 零日与改项目验收（v1.1：零日走开局向导 §17.4，改项目在路线 / 环节页 / 项目档案里就地做 §17）：
 *   用「动画短片 · 标准」模板建项目 → 开局向导：① 介绍 ② 日期 + 关键日（中途离开再回来接着这一步）③ 结构（3 卡）
 *   ④ 人员（2 个成员 + 1 个外部名字，留 1 个缺人）⑤ 开工 → 路线上只有第一批是「可以开始」→
 *   填了人的成员自动报到、能拿到任务单 → 在路线上加一个环节「分镜检查」→ 在 Layout 环节页加 2 卡 → 延期一张任务 →
 *   Layout 验收：打回 1 卡重做、其余验收通过 → 路线上变「已结束 ✓」→ 项目动态里每一步都有记录 → 刷新还在 → 375 宽能用 → 控制台 0 报错。
 * 2 个成员 = 示范工会里的木星（member01，制作人 → 策划）和栗子（Layout）；外部 = 音响写一个名字；监督（导演）留着缺人。
 */
import { expect, test } from "@playwright/test";
import { HAS_PASS, enterDemo, expandRoute, expectClean, expectNoPageScrollX, login, logout, noExternal, open, openGrid, openStage, routeRow, watch } from "./helpers";

test.skip(!HAS_PASS, "没有设 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER，跳过");

const NAME = "零日冒烟片";
const CODE = "ZSMK";

test("零日与改项目：模板建项目 → 开局向导五步（离开再回来）→ 开工 → 只有第一批可以开始 → 自动报到 → 插环节 → 加卡 → 延期 → 验收（打回 1 卡）→ 项目动态", async ({ page }, info) => {
  test.skip(info.project.name === "mobile 375", "375 宽在最后单独看");
  test.setTimeout(300_000);
  await noExternal(page);
  const errors = watch(page);
  await enterDemo(page);
  await login(page, "admin");

  // —— 选模板建项目 → 进开局向导第 ① 步（不生成任务）——
  await open(page, "/projects");
  await page.getByTestId("projects-new").click();
  await page.getByTestId("template-anim_standard").click();
  await page.getByTestId("new-name").fill(NAME);
  await page.getByTestId("new-code").fill(CODE);
  await page.getByTestId("new-create").click();
  await expect(page).toHaveURL(/#\/project\//);
  const projectPath = new URL(page.url()).hash.slice(1);
  const projectId = projectPath.split("/")[2];
  await expect(page.getByRole("heading", { name: new RegExp(`开局 · ${NAME}`) })).toContainText("零日");
  await expect(page.getByTestId("wizard-step-1")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("board")).toHaveCount(0);

  // ① 介绍 → 下一步
  await page.getByTestId("zero-intro").fill("一个小女孩去找她的猫。1 分钟，冒烟用。");
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("wizard-dates")).toBeVisible();
  // ② 日期 + 关键日（时间轴跟着填的日子变）→ 下一步
  await page.getByTestId("zero-plan-end").fill("2027-01-29");
  await page.getByTestId("key-date-name-0").fill("分镜定稿");
  await page.getByTestId("key-date-date-0").fill("2026-11-20");
  await expect(page.getByTestId("key-timeline")).toContainText("分镜定稿");
  await page.getByTestId("key-date-add").click();
  await page.getByTestId("key-date-name-1").fill("交片");
  await page.getByTestId("key-date-date-1").fill("2027-01-29");
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("wizard-structure")).toBeVisible();

  // —— 中途离开，再回来：接着上次那一步（③ 结构）——
  await open(page, "/hall");
  await open(page, "/projects");
  const card = page.getByTestId("project-card-zero").filter({ hasText: NAME });
  await expect(card).toContainText("第 3 / 5 步");
  await expect(page.locator(".cards > *").first()).toContainText("零日");
  await card.getByTestId("continue-setup").click();
  await expect(page.getByTestId("wizard-step-3")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("wizard-structure")).toBeVisible();

  // ③ 结构：1 集 1 场 3 卡，A 层 4 张（下面实时预览会生成哪些卡）→ 下一步
  await page.getByTestId("zero-episodes").fill("1");
  await page.getByTestId("zero-scenes").fill("1");
  await page.getByTestId("zero-cuts").fill("3");
  await page.getByTestId("zero-layers").fill("A");
  await page.getByTestId("zero-sheets").fill("4");
  await expect(page.getByTestId("cut-preview")).toHaveAttribute("data-count", "3");
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("wizard-staff")).toBeVisible();
  // ④ 人员：木星 = 制作人；栗子 = 设计稿（Layout）；音响 = 外部名字；监督（导演）缺人（不是关键职位，收在下面）
  await page.getByTestId("staff-open-producer").click();
  await page.getByTestId("staff-add-member-producer").selectOption({ label: "木星" });
  await expect(page.locator('[data-testid="staff-row"][data-position="producer"]')).toContainText("木星");
  await page.getByTestId("staff-open-layout").click();
  await page.getByTestId("staff-add-member-layout").selectOption({ label: "栗子" });
  await expect(page.locator('[data-testid="staff-row"][data-position="layout"]')).toContainText("栗子");
  await page.getByTestId("staff-open-sound").click();
  await page.getByTestId("staff-add-external-sound").fill("外面的录音老师");
  await page.getByTestId("staff-add-external-go-sound").click();
  const sound = page.locator('[data-testid="staff-row"][data-position="sound"]');
  await expect(sound).toContainText("外面的录音老师");
  await expect(sound).toContainText("外部");
  await expect(page.locator('[data-testid="staff-row"][data-position="director"]')).toBeHidden();
  await page.getByTestId("staff-rest").locator("summary").click();
  await expect(page.locator('[data-testid="staff-row"][data-position="director"]')).toContainText("缺人");
  await expect(page.locator('[data-testid="staff-row"][data-position="producer"]')).not.toContainText("缺人");
  await page.getByTestId("wizard-next").click();

  // ⑤ 开工：检查清单 → 开工 → 项目页是环节路线，只有第一批是「可以开始」
  await expect(page.getByTestId("wizard-start")).toBeVisible();
  await expect(page.getByTestId("start-check")).toContainText("3 卡");
  await page.getByTestId("zero-start").click();
  await page.getByTestId("zero-start-confirm").click();
  await expect(page.getByText(`开工了：${NAME}`)).toBeVisible();
  await expect(page.getByTestId("stage-route")).toBeVisible();
  // 还没到的中期 / 后期默认折成一行；展开了数
  await expect(page.getByTestId("route-phase-post")).toHaveAttribute("data-collapsed", "yes");
  await expandRoute(page);
  const rows = page.getByTestId("route-row");
  const total = await rows.count();
  expect(total).toBeGreaterThan(10);
  await expect(page.locator('[data-testid="route-row"][data-status="ready"]')).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-status", "ready");
  await expect(page.locator('[data-testid="route-row"][data-status="locked"]')).toHaveCount(total - 1);
  await openGrid(page, projectPath);
  await expect(page.locator("table.board tbody tr")).toHaveCount(3);

  // —— 木星：自动报到「策划」（标「指派」），拿到这个项目的任务单 ——
  await logout(page);
  await login(page, "member01");
  await open(page, "/me");
  await expect(page.getByTestId("role-assigned").filter({ hasText: "策划" })).toContainText("指派");
  await open(page, "/enroll?stage=plan");
  await page.getByTestId("enroll-submit").click();
  const got = page.getByRole("dialog", { name: "拿到一张任务单" });
  await expect(got).toBeVisible();
  await expect(got.getByTestId("quest-card")).toContainText(NAME);
  await page.getByRole("button", { name: "留在这里" }).click();
  await logout(page);
  await login(page, "admin");

  // —— 在路线最后加一个环节「分镜检查」（插在两个环节之间的情况见 v11.spec）——
  await open(page, projectPath);
  await expandRoute(page);
  const last = rows.last();
  await last.hover();
  await page.getByTestId("route-insert").last().click();
  await page.getByTestId("insert-name").fill("分镜检查");
  await page.getByTestId("insert-kind-review").click();
  await page.getByTestId("insert-grain-project").click();
  await page.getByTestId("insert-go").click();
  await expect(page.getByTestId("stage-title")).toHaveText("分镜检查");
  await expect(page.getByTestId("stage-sub")).toContainText(`第 ${total + 1} / ${total + 1} 个环节`);

  // —— 在 Layout 环节页的交付物里加 2 卡 ——
  let stage = await openStage(page, projectPath, "Layout");
  await stage.getByTestId("stage-cuts-open").click();
  await stage.getByTestId("add-cuts-count").fill("2");
  await stage.getByTestId("add-cuts-reason").fill("分镜改了，多两个镜头");
  await stage.getByTestId("add-cuts-go").click();
  await expect(page.getByText("加了 2 卡", { exact: true })).toBeVisible();
  await openGrid(page, projectPath);
  await expect(page.locator("table.board tbody tr")).toHaveCount(5);

  // —— 分镜枢纽「全部马上放出来」→ 5 张 Layout 可接 → 在环节页多选全部派给木星 ——
  stage = await openStage(page, projectPath, "分镜");
  await stage.getByTestId("hub-open").click();
  await stage.getByTestId("dispatch-release-all").check();
  await stage.getByTestId("dispatch-submit").click();
  await expect(page.getByText(/派发了 \d+ 张任务/).first()).toBeVisible();
  stage = await openStage(page, projectPath, "Layout");
  for (const c of ["C001", "C002", "C003", "C004", "C005"]) await stage.getByTestId("dispatch-row").filter({ hasText: c }).getByTestId("dispatch-pick").check();
  await stage.getByTestId("bulk-assign").click();
  await stage.getByTestId("assign-tasks-who").selectOption({ label: "木星" });
  await stage.getByTestId("assign-tasks-go").click();
  await expect(page.getByText("派了 5 张给 木星", { exact: true })).toBeVisible();

  // —— 延期一张任务（卡详情里管理员的「延期」）——
  await openGrid(page, projectPath);
  await page.locator("table.board tbody tr").first().getByRole("link").first().click();
  await expect(page.getByTestId("cut-admin")).toBeVisible();
  const dueBefore = await page.getByText(/^时限 /).first().textContent();
  await page.getByTestId("cut-extend-open").click();
  await page.getByTestId("extend-hours").fill("48");
  await page.getByTestId("extend-reason").fill("等分镜检查的结论");
  await page.getByTestId("extend-go").click();
  await expect(page.getByText("延期好了", { exact: true })).toBeVisible();
  await expect(page.getByText(/^时限 /).first()).not.toHaveText(dueBefore ?? "");

  // —— 木星交 5 张 Layout；管理员全部通过 ——
  await logout(page);
  await login(page, "member01");
  for (const c of ["C001", "C002", "C003", "C004", "C005"]) {
    await page.getByTestId("mini-quest").filter({ hasText: `${c} · Layout` }).filter({ hasText: NAME }).click();
    const quest = page.getByTestId("quest-card").filter({ hasText: `${c} · Layout` });
    await quest.getByRole("button", { name: "交", exact: true }).click();
    await page.getByTestId("link-url-0").fill(`https://feishu.example.com/drive/zsmk/${c.toLowerCase()}/lo/v01`);
    await page.getByTestId("submit-confirm").click();
    await expect(page.getByText(new RegExp(`交了 ${c} · Layout v01`))).toBeVisible();
  }
  await logout(page);
  await login(page, "admin");
  await open(page, "/review");
  for (let i = 0; i < 5; i++) {
    await page.locator(".queue-item", { hasText: NAME }).first().click();
    await page.getByTestId("review-submit").click();
    await expect(page.getByText(/通过了 C00\d · Layout/).first()).toBeVisible();
  }

  // —— 验收 Layout（环节页的交付物里）：打回 C002 重做，其余验收通过 → 路线上变「已结束 ✓」——
  stage = await openStage(page, projectPath, "Layout");
  // 交付物块默认是这一环节的交付物墙（§18.6）：一卡一格
  await expect(stage.getByTestId("stage-wall-cell")).toHaveCount(5);
  await stage.getByTestId("stage-accept-open").click();
  const accept = page.getByRole("dialog", { name: /验收 · Layout/ });
  await expect(accept.getByTestId("accept-row")).toHaveCount(5);
  const c002 = accept.getByTestId("accept-row").filter({ hasText: "C002" });
  await expect(c002).toContainText(`${CODE}_EP01_SC001_CUT002_LO_v01`);
  await expect(c002).toContainText("木星 做的");
  await c002.getByTestId("redo-open").click();
  await c002.getByTestId("redo-comment").fill("构图再松一点，人物别贴边");
  await c002.getByTestId("redo-go").click();
  await expect(page.getByText(/C002 · Layout 打回重做了/).first()).toBeVisible();
  await expect(accept).toContainText("1 卡在重做");
  await accept.getByTestId("accept-all").click();
  await expect(page.getByText("「Layout」验收通过了", { exact: true })).toBeVisible();
  await accept.getByRole("button", { name: "关上" }).click();
  await open(page, projectPath);
  await expect(await routeRow(page, "Layout")).toHaveAttribute("data-status", "done");
  await expect((await routeRow(page, "Layout")).getByTestId("route-status")).toContainText("已结束 ✓");

  // —— 木星那边：C002 回到退回、带意见（原来的活力点不扣）——
  await openGrid(page, projectPath);
  await page.locator("table.board tbody tr").nth(1).getByRole("link").first().click();
  await expect(page.getByText("构图再松一点，人物别贴边").first()).toBeVisible();

  // —— 项目动态里每一步都有记录（谁、改了什么、为什么）——
  await open(page, `${projectPath}?tab=activity`);
  const tl = page.getByTestId("project-timeline");
  for (const command of ["project.draft", "project.update", "project.set_structure", "staff.set", "project.start", "stage.add", "cut.add", "task.extend", "task.reopen", "stage.accept"]) {
    await expect(tl.locator(`[data-command="${command}"]`).first(), command).toBeVisible();
  }
  await expect(tl).toContainText("分镜改了，多两个镜头");
  await expect(tl).toContainText("等分镜检查的结论");
  await expect(tl).toContainText("构图再松一点");

  // —— 刷新还在 ——
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByTestId("project-timeline").locator('[data-command="stage.accept"]')).toBeVisible();
  await open(page, `${projectPath}?tab=profile`);
  await expect(page.getByTestId("cover-intro")).toContainText("一个小女孩去找她的猫。1 分钟，冒烟用。");
  await open(page, projectPath);
  await expect(await routeRow(page, "Layout")).toHaveAttribute("data-status", "done");
  await openGrid(page, projectPath);
  await expect(page.locator("table.board tbody tr")).toHaveCount(5);

  // —— 375 宽能用：开局向导（示范的「（模板）动画短片」）· 项目页每个标签 · 环节页 ——
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, "/projects");
  await page.locator("main").getByRole("link", { name: /（模板）动画短片/ }).first().click();
  await expect(page.getByTestId("wizard-steps")).toBeVisible();
  await expectNoPageScrollX(page, "开局向导");
  await page.getByTestId("wizard-step-4").click();
  await expect(page.locator('[data-testid="staff-row"][data-position="sound"]')).toContainText("外部");
  await expectNoPageScrollX(page, "开局向导 ④ 人员");
  for (const tab of ["route", "grid", "schedule", "library", "activity", "profile"]) {
    await open(page, `${projectPath}?tab=${tab}`);
    await expect(page.getByTestId(`ptab-${tab}`)).toHaveAttribute("aria-selected", "true");
    await expectNoPageScrollX(page, `项目页 ${tab}`);
  }
  stage = await openStage(page, projectPath, "Layout");
  await expectNoPageScrollX(page, "环节页");
  await stage.getByTestId("dispatch-menu").first().click();
  await expect(stage.getByTestId("dispatch-pop")).toBeVisible();
  await expectNoPageScrollX(page, "环节页 · 一行的动作");
  expectClean(errors, "零日与改项目");
});
