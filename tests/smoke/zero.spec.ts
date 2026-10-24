/**
 * SPEC §12.3 零日与改项目验收：
 *   用「动画短片 · 标准」模板建项目 → 零日页填介绍、日期、关键日、结构（3 卡）、
 *   人员（2 个成员 + 1 个外部名字，留 1 个缺人）→ 开工 → 填了人的成员自动报到、能拿到任务单 →
 *   加一个环节「分镜检查」接在分镜后面 → 加 2 卡 → 延期一张任务 →
 *   某环节验收：打回 1 卡重做、其余验收通过 → 时间线上每一步都有记录 → 刷新还在 → 375 宽能用 → 控制台 0 报错。
 * 2 个成员 = 示范工会里的木星（member01，制作人 → 策划）和栗子（Layout）；外部 = 音响写一个名字；监督（导演）留着缺人。
 */
import { expect, test, type Page } from "@playwright/test";
import { HAS_PASS, enterDemo, expectClean, expectNoPageScrollX, login, logout, noExternal, open, watch } from "./helpers";

test.skip(!HAS_PASS, "没有设 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER，跳过");

const NAME = "零日冒烟片";
const CODE = "ZSMK";

async function stageDrawer(page: Page, projectPath: string, name: string) {
  await open(page, projectPath);
  await page.getByRole("button", { name: new RegExp(`^${name}，`) }).first().click();
  const drawer = page.getByRole("dialog", { name });
  await expect(drawer).toBeVisible();
  return drawer;
}

test("零日与改项目：模板建项目 → 零日页 → 开工 → 自动报到拿任务单 → 加环节 → 加卡 → 延期 → 验收（打回 1 卡）→ 时间线", async ({ page }, info) => {
  test.skip(info.project.name === "mobile 375", "375 宽在最后单独看");
  test.setTimeout(300_000);
  await noExternal(page);
  const errors = watch(page);
  await enterDemo(page);
  await login(page, "admin");

  // —— 选模板建项目 → 进零日页（不生成任务）——
  await open(page, "/admin?tab=new");
  await page.getByTestId("template-anim_standard").click();
  await page.getByTestId("new-name").fill(NAME);
  await page.getByTestId("new-code").fill(CODE);
  await page.getByTestId("new-create").click();
  await expect(page).toHaveURL(/#\/project\//);
  const projectPath = new URL(page.url()).hash.slice(1);
  const projectId = projectPath.split("/")[2];
  await expect(page.getByText("零日 · 筹备中")).toBeVisible();
  await expect(page.getByTestId("board")).toHaveCount(0);

  // 介绍
  await page.getByTestId("zero-intro").fill("一个小女孩去找她的猫。1 分钟，冒烟用。");
  await page.getByTestId("zero-cover-save").click();
  await expect(page.getByText("存好了").first()).toBeVisible();
  // 日期 + 关键日
  await page.getByTestId("zero-plan-end").fill("2027-01-29");
  await page.getByTestId("key-date-name-0").fill("分镜定稿");
  await page.getByTestId("key-date-date-0").fill("2026-11-20");
  await page.getByTestId("key-date-add").click();
  await page.getByTestId("key-date-name-1").fill("交片");
  await page.getByTestId("key-date-date-1").fill("2027-01-29");
  await page.getByTestId("zero-dates-save").click();
  // 结构：1 集 1 场 3 卡，A 层 4 张
  await page.getByTestId("zero-episodes").fill("1");
  await page.getByTestId("zero-scenes").fill("1");
  await page.getByTestId("zero-cuts").fill("3");
  await page.getByTestId("zero-layers").fill("A");
  await page.getByTestId("zero-sheets").fill("4");
  await page.getByTestId("zero-structure-save").click();
  await expect(page.getByTestId("structure-card")).toContainText("一共 3 卡");
  // 人员：木星 = 制作人；栗子 = 设计稿（Layout）；音响 = 外部名字；监督（导演）缺人
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
  await expect(page.locator('[data-testid="staff-row"][data-position="director"]')).toContainText("缺人");
  await expect(page.locator('[data-testid="staff-row"][data-position="producer"]')).not.toContainText("缺人");

  // —— 开工 ——
  await page.getByTestId("zero-start").click();
  await page.getByTestId("zero-start-confirm").click();
  await expect(page.getByText(`开工了：${NAME}`)).toBeVisible();
  await expect(page.getByTestId("board")).toBeVisible();
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

  // —— 加一个环节「分镜检查」，接在分镜后面 ——
  await open(page, `/project/${projectId}/settings?tab=stages`);
  await page.getByTestId("add-stage-name").fill("分镜检查");
  await page.getByTestId("add-stage-after").selectOption({ label: "分镜" });
  await page.getByTestId("add-stage-phase").selectOption({ label: "前期" });
  await page.getByLabel(/插进去/).uncheck();
  await page.getByTestId("add-stage-go").click();
  await expect(page.getByText("加了环节「分镜检查」", { exact: true })).toBeVisible();
  await expect(page.getByTestId("stage-row").filter({ hasText: "分镜检查" })).toBeVisible();

  // —— 加 2 卡（在 Layout 节点的抽屉里）——
  let drawer = await stageDrawer(page, projectPath, "Layout");
  await drawer.getByTestId("stage-cuts-open").click();
  await drawer.getByTestId("add-cuts-count").fill("2");
  await drawer.getByTestId("add-cuts-reason").fill("分镜改了，多两个镜头");
  await drawer.getByTestId("add-cuts-go").click();
  await expect(page.getByText("加了 2 卡", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "关上" }).click();
  await expect(page.locator("table.board tbody tr")).toHaveCount(5);

  // —— 分镜枢纽「全部马上放出来」→ 5 张 Layout 可接 → 全部直接派给木星 ——
  await open(page, `/admin?tab=dispatch&project=${projectId}`);
  await page.getByTestId("dispatch-hub").selectOption({ label: "分镜" });
  await page.getByTestId("dispatch-release-all").check();
  await page.getByTestId("dispatch-submit").click();
  await expect(page.getByText(/派发了 \d+ 张任务/)).toBeVisible();
  drawer = await stageDrawer(page, projectPath, "Layout");
  const batch = drawer.getByTestId("batch-assign");
  for (const c of ["C001", "C002", "C003", "C004", "C005"]) await batch.getByTestId("batch-pick").filter({ hasText: c }).click();
  await batch.getByTestId("batch-who").selectOption({ label: "木星" });
  await batch.getByTestId("batch-go").click();
  await expect(page.getByText("派了 5 张给 木星", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "关上" }).click();

  // —— 延期一张任务（卡详情里管理员的「延期」）——
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

  // —— 验收 Layout：打回 C002 重做，其余验收通过 ——
  drawer = await stageDrawer(page, projectPath, "Layout");
  await drawer.getByTestId("stage-accept-open").click();
  const accept = page.getByRole("dialog", { name: /验收 · Layout/ });
  await expect(accept.getByTestId("accept-row")).toHaveCount(5);
  const c002 = accept.getByTestId("accept-row").filter({ hasText: "C002" });
  await expect(c002).toContainText(`${CODE}_EP01_SC001_CUT002_LO_v01`);
  await expect(c002).toContainText("木星 做的");
  await c002.getByTestId("redo-open").click();
  await c002.getByTestId("redo-comment").fill("构图再松一点，人物别贴边");
  await c002.getByTestId("redo-go").click();
  await expect(page.getByText(/C002 · Layout 打回重做了/)).toBeVisible();
  await expect(accept).toContainText("1 卡在重做");
  await accept.getByTestId("accept-all").click();
  await expect(page.getByText("「Layout」验收通过了", { exact: true })).toBeVisible();
  await accept.getByRole("button", { name: "关上" }).click();
  await open(page, projectPath);
  await expect(page.getByRole("button", { name: /^Layout，已验收，/ })).toBeVisible();

  // —— 木星那边：C002 回到退回、带意见（原来的活力点不扣）——
  // （在项目时间线和卡详情里都看得到；这里看卡详情）
  await page.locator("table.board tbody tr").nth(1).getByRole("link").first().click();
  await expect(page.getByText("构图再松一点，人物别贴边").first()).toBeVisible();

  // —— 时间线上每一步都有记录（谁、改了什么、为什么）——
  await open(page, `/project/${projectId}/settings?tab=cover`);
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
  await expect(page.getByTestId("zero-intro")).toHaveValue("一个小女孩去找她的猫。1 分钟，冒烟用。");
  await open(page, projectPath);
  await expect(page.getByRole("button", { name: /^Layout，已验收，/ })).toBeVisible();
  await expect(page.locator("table.board tbody tr")).toHaveCount(5);

  // —— 375 宽能用：零日页（示范的「（模板）动画短片」）· 项目设置每一栏 · 项目总览 · 验收 ——
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, "/projects");
  await page.getByRole("link", { name: /（模板）动画短片/ }).first().click();
  await expect(page.getByText("零日 · 筹备中")).toBeVisible();
  await expect(page.locator('[data-testid="staff-row"][data-position="sound"]')).toContainText("外部");
  await expectNoPageScrollX(page, "零日页");
  for (const tab of ["cover", "dates", "structure", "staff", "stages"]) {
    await open(page, `/project/${projectId}/settings?tab=${tab}`);
    await expect(page.getByTestId(`settings-tab-${tab}`)).toHaveAttribute("aria-selected", "true");
    await expectNoPageScrollX(page, `项目设置 ${tab}`);
  }
  await open(page, projectPath);
  await expectNoPageScrollX(page, "项目总览");
  drawer = await stageDrawer(page, projectPath, "Layout");
  await drawer.getByTestId("stage-accept-open").click();
  await expect(page.getByRole("dialog", { name: /验收 · Layout/ }).getByTestId("accept-row").first()).toBeVisible();
  await expectNoPageScrollX(page, "验收");
  expectClean(errors, "零日与改项目");
});
