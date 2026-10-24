/**
 * SPEC §17.5 验收（v1.1 · 项目按环节分层）：
 *   - 项目页：环节路线按顺序编号；五种状态各至少出现一次（示范工会）；当前环节高亮；概要行写对第几个环节；
 *     已结束的段折叠、能展开（现建一个从空白开始的小项目，走完前期那一个环节）。
 *   - 环节页：人员、派发、交付物、设置、动态五块都在；「指派一个人」→ 路线上那一行的头像多一个；多选 2 行派给某人；
 *     延期一行；打回一卡；发一张修正任务；改 Tn；验收这个环节 → 回到路线上变「已结束 ✓」。
 *   - 在路线上两个环节之间插一个环节 → 编号顺延 → 新环节页能打开。
 *   - 项目档案：每块「改 → 存 / 取消」只改那一块；没有「改项目」长表了。
 *   - 零日：开局向导的「上一步 / 下一步 / 先跳过」（五步走完、离开再回来、开工以后只有第一批可以开始在 zero.spec.ts）。
 *   - 三套设置都跑（中文 · en-US 时区 · 375 宽不溢出）；控制台 0 报错。English 下没有汉字在 i18n.spec.ts 里扫。
 */
import { expect, test, type Page } from "@playwright/test";
import { HAS_PASS, enterDemo, expandRoute, expectClean, expectNoPageScrollX, login, noExternal, open, openStage, routeRow, watch } from "./helpers";

test.skip(!HAS_PASS, "没有设 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER，跳过");

test.beforeEach(async ({ page }) => {
  await noExternal(page);
});

/** 项目列表里按名字找项目页的路径。 */
async function projectPath(page: Page, name: string): Promise<string> {
  await open(page, "/projects");
  const href = (await page.locator("a.project-card").filter({ hasText: name }).first().getAttribute("href")) ?? "";
  return href.replace(/^#/, "");
}

async function routeNumbers(page: Page): Promise<number[]> {
  return (await page.getByTestId("route-row").locator(".route-no").allTextContents()).map((x) => Number(x.trim()));
}

async function peopleCount(page: Page, name: string): Promise<number> {
  const people = (await routeRow(page, name)).getByTestId("route-people");
  return (await people.count()) ? Number(await people.getAttribute("data-count")) : 0;
}

test("路线：按顺序编号 · 五种状态 · 当前环节高亮 · 概要行 · 插一个环节编号顺延", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watch(page);
  await enterDemo(page);
  await login(page, "admin");

  // —— 五种状态在示范工会里各至少出现一次 ——
  const seen = new Set<string>();
  for (const name of ["安娜的旅程", "电猫与电鼠", "星期三的猫"]) {
    await open(page, await projectPath(page, name));
    await expect(page.getByTestId("stage-route")).toBeVisible();
    for (let i = 0; i < 3 && (await page.locator('[data-testid^="route-expand-"]').count()); i++) await page.locator('[data-testid^="route-expand-"]').first().click();
    for (const st of await page.getByTestId("route-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-status") ?? ""))) seen.add(st);
  }
  expect([...seen].sort()).toEqual(["active", "done", "locked", "ready", "review"]);

  // —— 「（示范）星期三的猫」：编号 1…N，前 2 个已结束 ✓、第 3 个进行中（高亮）、其余还没到；概要行写第 3 / N 个 ——
  const cat = await projectPath(page, "星期三的猫");
  await open(page, cat);
  await expandRoute(page);
  const nums = await routeNumbers(page);
  expect(nums).toEqual(nums.map((_, i) => i + 1));
  const rows = page.getByTestId("route-row");
  await expect(rows.nth(0)).toHaveAttribute("data-status", "done");
  await expect(rows.nth(0).getByTestId("route-status")).toContainText("已结束 ✓");
  await expect(rows.nth(1)).toHaveAttribute("data-status", "done");
  await expect(rows.nth(2)).toHaveAttribute("data-status", "active");
  await expect(rows.nth(2).getByTestId("route-status")).toContainText("进行中 0 / 1");
  await expect(page.locator('[data-testid="route-row"][data-current="yes"]')).toHaveCount(1);
  await expect(rows.nth(2)).toHaveAttribute("data-current", "yes");
  await expect(page.getByTestId("route-summary")).toContainText(`现在在第 3 / ${nums.length} 个环节 · 分镜`);
  await expect(page.getByTestId("route-summary")).toContainText("前期 2 个结束、进行到 分镜");
  await expect(rows.nth(3)).toHaveAttribute("data-status", "ready");
  await expect(rows.nth(4)).toHaveAttribute("data-status", "locked");
  await expect(rows.nth(4)).toContainText("等上游");
  await expect(rows.nth(0)).toContainText(/计划 第 \d+ 周.*实际/);
  await expectNoPageScrollX(page, "环节路线");

  // —— 在第 4 个（美术设计）和第 5 个（色指定设计）之间插一个环节 → 编号顺延 → 新环节页能打开 ——
  const fifth = (await rows.nth(4).locator(".route-name > .t-body-14m").textContent())?.trim() ?? "";
  await rows.nth(3).hover();
  await page.getByTestId("route-insert").nth(3).click();
  const dialog = page.getByRole("dialog", { name: /之间插一个环节/ });
  await expect(dialog).toContainText(fifth);
  await dialog.getByTestId("insert-name").fill("美术复核");
  await dialog.getByTestId("insert-kind-review").click();
  await dialog.getByTestId("insert-tn").fill("1.5");
  await expectNoPageScrollX(page, "插一个环节");
  await dialog.getByTestId("insert-go").click();
  await expect(page.getByTestId("stage-title")).toHaveText("美术复核");
  await expect(page.getByTestId("stage-sub")).toContainText(`第 5 / ${nums.length + 1} 个环节`);
  await expect(page.getByTestId("stage-people")).toBeVisible();
  await open(page, cat);
  await expandRoute(page);
  const after = await routeNumbers(page);
  expect(after).toEqual(after.map((_, i) => i + 1));
  expect(after.length).toBe(nums.length + 1);
  await expect(rows.nth(4)).toContainText("美术复核");
  await expect(rows.nth(5)).toContainText(fifth);
  await expect(rows.nth(5).locator(".route-no")).toHaveText("6");
  await (await routeRow(page, "美术复核")).click();
  await expect(page.getByTestId("stage-title")).toHaveText("美术复核");
  await expect(page.getByTestId("stage-sub")).toContainText("第 5 / ");
  await expect(page.getByTestId("stage-links")).toContainText(fifth);
  expectClean(errors, "路线");
});

test("环节页：五块都在 · 指派一个人 · 多选 2 行派给某人 · 延期一行 · 打回一卡 · 发修正 · 改 Tn · 验收 → 已结束 ✓", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watch(page);
  await enterDemo(page);
  await login(page, "admin");
  const andlc = await projectPath(page, "安娜的旅程");

  // —— 点路线上的一行进环节页：概况 · 人员 · 派发 · 交付物 · 设置 · 动态都在 ——
  await open(page, andlc);
  await (await routeRow(page, "场景绘制")).click();
  await expect(page.getByTestId("stage-title")).toContainText("场景绘制");
  for (const block of ["stage-overview", "stage-people", "stage-dispatch", "stage-deliverables", "stage-config", "stage-activity"]) await expect(page.getByTestId(block), block).toBeVisible();
  await expectNoPageScrollX(page, "环节页");
  const stagePath = new URL(page.url()).hash.slice(1);

  // —— 「指派一个人」→ 路线上那一行的头像多一个 ——
  await open(page, andlc);
  const before = await peopleCount(page, "场景绘制");
  if (!before) await expect(await routeRow(page, "场景绘制")).toContainText("缺人");
  await open(page, stagePath);
  await page.getByTestId("assign-person-open").click();
  await page.getByTestId("assign-person-who").selectOption({ label: "栗子" });
  await page.getByTestId("assign-person-go").click();
  await expect(page.getByText("栗子 指派到这个环节了")).toBeVisible();
  await expect(page.getByTestId("stage-person").filter({ hasText: "栗子" })).toContainText("指派");
  await open(page, andlc);
  expect(await peopleCount(page, "场景绘制")).toBe(before + 1);

  // —— 多选 2 行（可接的）→ 派给木星 ——
  await open(page, stagePath);
  const dispatchBlock = page.getByTestId("stage-dispatch");
  const openRows = dispatchBlock.locator('[data-testid="dispatch-row"][data-status="open"]');
  const firstTwo = [await openRows.nth(0).getAttribute("data-task"), await openRows.nth(1).getAttribute("data-task")];
  for (const id of firstTwo) await dispatchBlock.locator(`[data-testid="dispatch-row"][data-task="${id}"]`).getByTestId("dispatch-pick").check();
  await expect(dispatchBlock.getByTestId("bulk-bar")).toContainText("已选 2 张");
  await dispatchBlock.getByTestId("bulk-assign").click();
  await dispatchBlock.getByTestId("assign-tasks-who").selectOption({ label: "木星" });
  await dispatchBlock.getByTestId("assign-tasks-go").click();
  await expect(page.getByText("派了 2 张给 木星")).toBeVisible();
  for (const id of firstTwo) await expect(dispatchBlock.locator(`[data-testid="dispatch-row"][data-task="${id}"]`)).toHaveAttribute("data-status", "claimed");

  // —— 延期一行（刚派出去的那一张）——
  const claimed = dispatchBlock.locator(`[data-testid="dispatch-row"][data-task="${firstTwo[0]}"]`);
  const dueBefore = (await claimed.locator(".disp-due").textContent()) ?? "";
  await claimed.getByTestId("dispatch-menu").click();
  await claimed.getByTestId("row-extend").click();
  await page.getByTestId("extend-hours").fill("24");
  await page.getByTestId("extend-reason").fill("等美术设定补完");
  await page.getByTestId("extend-go").click();
  await expect(page.getByText("延期好了", { exact: true })).toBeVisible();
  await expect(claimed.locator(".disp-due")).not.toHaveText(dueBefore);
  await expect(page.getByTestId("stage-activity").locator('[data-command="task.extend"]')).toHaveCount(1);
  await expectNoPageScrollX(page, "环节页 · 派发");

  // —— 打回一卡（中割：通过的一张 → 打回重做）· 发一张修正任务 · 改 Tn ——
  const inbetween = await openStage(page, andlc, "中割");
  const passed = inbetween.locator('[data-testid="dispatch-row"][data-status="passed"]').first();
  const passedId = await passed.getAttribute("data-task");
  await passed.getByTestId("dispatch-menu").click();
  await passed.getByTestId("row-redo").click();
  await passed.getByTestId("redo-comment").fill("轨目对不上，重做这一层");
  await passed.getByTestId("redo-go").click();
  await expect(page.getByText(/打回重做了/).first()).toBeVisible();
  const redone = inbetween.locator(`[data-testid="dispatch-row"][data-task="${passedId}"]`);
  await expect(redone).toHaveAttribute("data-status", "returned");
  await expect(redone).toContainText("重做");

  await inbetween.getByTestId("publish-open").click();
  const form = inbetween.getByTestId("publish-form");
  await form.getByTestId("publish-kind-fix").click();
  await form.getByTestId("publish-title").fill("C005 中割补两张");
  await form.getByTestId("publish-cut").filter({ hasText: "C005" }).click();
  await form.getByTestId("publish-go").click();
  await expect(page.getByText("发了一张修正：C005 中割补两张，等人认领", { exact: true })).toBeVisible();
  await expect(inbetween.getByTestId("extra-item").filter({ hasText: "C005 中割补两张" })).toBeVisible();

  await inbetween.getByTestId("stage-edit-open").click();
  const settings = inbetween.getByTestId("stage-config-form");
  await settings.getByTestId("rate-tn").fill("2");
  await settings.getByTestId("config-save").click();
  await expect(page.getByText("「中割」改好了").first()).toBeVisible();
  await expect(inbetween.getByTestId("stage-overview")).toContainText("2 小时");
  await expect(inbetween.getByTestId("stage-activity").locator('[data-command="stage.set_rate"]')).toHaveCount(1);
  await expectNoPageScrollX(page, "环节页 · 设置");

  // —— 验收这个环节（策划：全部通过、等验收）→ 回到路线上变「已结束 ✓」——
  await open(page, andlc);
  await expect(await routeRow(page, "策划")).toHaveAttribute("data-status", "review");
  const plan = await openStage(page, andlc, "策划");
  await expect(plan.getByTestId("stage-deliverables")).toContainText("全部通过了");
  await plan.getByTestId("stage-accept-open").click();
  const accept = page.getByRole("dialog", { name: /验收 · 策划/ });
  await accept.getByTestId("accept-all").click();
  await expect(page.getByText("「策划」验收通过了", { exact: true })).toBeVisible();
  await accept.getByRole("button", { name: "关上" }).click();
  await expect(plan.getByTestId("stage-accepted")).toContainText("验收 · 整体通过");
  await plan.getByTestId("stage-back").click();
  const planRow = await routeRow(page, "策划");
  await expect(planRow).toHaveAttribute("data-status", "done");
  await expect(planRow.getByTestId("route-status")).toContainText("已结束 ✓");
  expectClean(errors, "环节页");
});

test("已结束的段折叠、能展开：从空白开始 → 加第一个环节 → 插一个中期的 → 外包代交 → 通过 → 验收", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watch(page);
  await enterDemo(page);
  await login(page, "admin");
  await open(page, "/admin?tab=new");
  await page.getByTestId("template-blank").click();
  await page.getByTestId("new-name").fill("空白小样");
  await page.getByTestId("new-code").fill("BLNK");
  await page.getByTestId("new-create").click();
  await expect(page.getByTestId("wizard-steps")).toBeVisible();
  const path = new URL(page.url()).hash.slice(1);
  await page.getByTestId("wizard-step-3").click();
  await page.getByTestId("zero-cuts").fill("1");
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("zero-start").click();
  await page.getByTestId("zero-start-confirm").click();

  // 还没有环节：加第一个（前期），再在它后面插一个中期的
  await expect(page.getByTestId("route-empty")).toBeVisible();
  await page.getByTestId("route-add-first").click();
  await page.getByTestId("insert-name").fill("立项");
  await page.getByTestId("insert-go").click();
  await expect(page.getByTestId("stage-title")).toHaveText("立项");
  await expect(page.getByTestId("stage-sub")).toContainText("第 1 / 1 个环节");
  await open(page, path);
  await page.getByTestId("route-row").first().hover();
  await page.getByTestId("route-insert").first().click();
  await page.getByTestId("insert-name").fill("试做");
  await page.getByTestId("insert-phase").selectOption({ label: "中期" });
  await page.getByTestId("insert-go").click();
  await expect(page.getByTestId("stage-title")).toHaveText("试做");
  await expect(page.getByTestId("stage-sub")).toContainText("第 2 / 2 个环节");
  await open(page, path);
  await expect(await routeRow(page, "立项")).toHaveAttribute("data-status", "ready");
  await expect(await routeRow(page, "试做")).toHaveAttribute("data-status", "locked");

  // 立项：派给外包 → 管理员代交 → 通过 → 验收
  const stage = await openStage(page, path, "立项");
  const row = stage.getByTestId("dispatch-row").first();
  await row.getByTestId("dispatch-menu").click();
  await row.getByTestId("row-assign").click();
  await row.getByTestId("assign-tasks-who").selectOption("__name");
  await row.getByTestId("assign-tasks-name").fill("外面的老师");
  await row.getByTestId("assign-tasks-go").click();
  await expect(page.getByText("派了 1 张给 外面的老师")).toBeVisible();
  await open(page, `${path}?tab=grid`);
  await page.locator(".strip-item").first().click();
  await page.getByRole("button", { name: "代交" }).click();
  await page.getByLabel("说明").fill("外包交来的立项书");
  await page.getByTestId("submit-confirm").click();
  await expect(page.getByText(/等审核/).first()).toBeVisible();
  await page.getByRole("button", { name: "关上" }).click();
  await open(page, "/review");
  await page.locator(".queue-item", { hasText: "空白小样" }).first().click();
  await page.getByTestId("review-submit").click();
  await expect(page.getByText(/通过了/).first()).toBeVisible();
  const again = await openStage(page, path, "立项");
  await again.getByTestId("stage-accept-open").click();
  await page.getByRole("dialog", { name: /验收 · 立项/ }).getByTestId("accept-all").click();
  await expect(page.getByText("「立项」验收通过了", { exact: true })).toBeVisible();

  // 路线：前期全部结束 → 折成一行；能展开、再收起；中期的「试做」亮成可以开始、高亮
  await open(page, path);
  const pre = page.getByTestId("route-phase-pre");
  await expect(pre).toHaveAttribute("data-collapsed", "yes");
  await expect(pre).toContainText("1 个环节已结束 ✓（立项）");
  await expect(pre.getByTestId("route-row")).toHaveCount(0);
  await expect(page.getByTestId("route-summary")).toContainText("前期 1 个全部结束");
  const trial = page.getByTestId("route-row").filter({ hasText: "试做" });
  await expect(trial).toHaveAttribute("data-status", "ready");
  await expect(trial).toHaveAttribute("data-current", "yes");
  await expect(page.getByTestId("route-summary")).toContainText("第 2 / 2 个环节");
  await page.getByTestId("route-expand-pre").click();
  await expect(pre.getByTestId("route-row")).toHaveCount(1);
  await expect(pre.getByTestId("route-row")).toHaveAttribute("data-status", "done");
  await pre.getByRole("button", { name: "收起" }).click();
  await expect(pre).toHaveAttribute("data-collapsed", "yes");
  await expectNoPageScrollX(page, "折起来的路线");
  expectClean(errors, "折叠");
});

test("项目档案：每块「改 → 存 / 取消」只改那一块；没有「改项目」长表了", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watch(page);
  await enterDemo(page);
  await login(page, "admin");
  const cat = await projectPath(page, "星期三的猫");
  const id = cat.split("/")[2];

  // 原来的「改项目」页转到项目档案；页面上没有「改项目」按钮、也没有环节长表
  await open(page, `/project/${id}/settings?tab=stages`);
  await expect(page).toHaveURL(new RegExp(`#/project/${id}\\?tab=profile`));
  await expect(page.getByTestId("project-profile")).toBeVisible();
  await expect(page.getByTestId("project-settings")).toHaveCount(0);
  await expect(page.getByTestId("stages-card")).toHaveCount(0);
  await expect(page.getByTestId("add-stage")).toHaveCount(0);
  const blocks = ["intro", "dates", "structure", "staff"];
  for (const b of blocks) await expect(page.getByTestId(`profile-${b}`)).toHaveAttribute("data-mode", "view");

  // 介绍：改 → 只这一块变表单 → 存
  await page.getByTestId("profile-intro-edit").click();
  for (const b of blocks) await expect(page.getByTestId(`profile-${b}`)).toHaveAttribute("data-mode", b === "intro" ? "edit" : "view");
  await page.getByTestId("zero-intro").fill("改过的介绍：星期三，猫去了书店。");
  await page.getByTestId("profile-save").click();
  await expect(page.getByText("存好了").first()).toBeVisible();
  await expect(page.getByTestId("profile-intro")).toHaveAttribute("data-mode", "view");
  await expect(page.getByTestId("cover-intro")).toContainText("改过的介绍：星期三，猫去了书店。");

  // 日期：改 → 取消 → 什么都没变
  const datesBefore = (await page.getByTestId("dates-view").textContent()) ?? "";
  await page.getByTestId("profile-dates-edit").click();
  await expect(page.getByTestId("profile-dates")).toHaveAttribute("data-mode", "edit");
  await page.getByTestId("zero-cycle").fill("5");
  await page.getByTestId("profile-cancel").click();
  await expect(page.getByTestId("profile-dates")).toHaveAttribute("data-mode", "view");
  await expect(page.getByTestId("dates-view")).toHaveText(datesBefore);

  // 人员表：改 → 加一个外部名字 → 取消 → 没加上；再改 → 加 → 存 → 加上了
  const row = () => page.locator('[data-testid="staff-row"][data-position="director"]');
  await expect(row()).not.toContainText("外面的导演");
  await page.getByTestId("profile-staff-edit").click();
  await page.getByTestId("staff-open-director").click();
  await page.getByTestId("staff-add-external-director").fill("外面的导演");
  await page.getByTestId("staff-add-external-go-director").click();
  await expect(row()).toContainText("外面的导演");
  await page.getByTestId("profile-staff").getByTestId("profile-cancel").click();
  await expect(row()).not.toContainText("外面的导演");
  await page.getByTestId("profile-staff-edit").click();
  await page.getByTestId("staff-open-director").click();
  await page.getByTestId("staff-add-external-director").fill("外面的导演");
  await page.getByTestId("staff-add-external-go-director").click();
  await page.getByTestId("profile-staff").getByTestId("profile-save").click();
  await expect(page.getByTestId("profile-staff")).toHaveAttribute("data-mode", "view");
  await expect(row()).toContainText("外面的导演");

  // 结构：改 → 加 1 卡（马上生效）→ 改好了
  await page.getByTestId("profile-structure-edit").click();
  await page.getByTestId("add-cuts-count").fill("1");
  await page.getByTestId("add-cuts-reason").fill("多一个空镜");
  await page.getByTestId("add-cuts-go").click();
  await expect(page.getByText("加了 1 卡", { exact: true })).toBeVisible();
  await page.getByTestId("profile-done").click();
  await expect(page.getByTestId("profile-structure")).toHaveAttribute("data-mode", "view");
  await expect(page.getByTestId("profile-structure")).toContainText("7 卡");
  await expect(page.getByTestId("profile-intro")).toHaveAttribute("data-mode", "view");
  await expectNoPageScrollX(page, "项目档案");

  // 改了什么照旧记进项目动态
  await page.getByTestId("ptab-activity").click();
  const tl = page.getByTestId("project-timeline");
  for (const command of ["project.update", "staff.set", "cut.add"]) await expect(tl.locator(`[data-command="${command}"]`).first(), command).toBeVisible();
  expectClean(errors, "项目档案");
});

test("开局向导：上一步 / 下一步 / 先跳过，每一步存了就算数", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watch(page);
  await enterDemo(page);
  await login(page, "admin");
  await open(page, "/projects");
  await page.getByTestId("projects-new").click();
  await page.getByTestId("new-name").fill("向导小样");
  await page.getByTestId("new-code").fill("WZD");
  await page.getByTestId("new-create").click();
  const steps = ["intro", "dates", "structure", "staff", "start"];
  await expect(page.getByTestId("wizard-intro")).toBeVisible();
  await expect(page.getByTestId("wizard-prev")).toHaveCount(0);
  await expectNoPageScrollX(page, "开局 ①");
  // 先跳过：不存，直接往后走
  await page.getByTestId("cover-name").fill("不该存上的名字");
  await page.getByTestId("wizard-skip").click();
  await expect(page.getByTestId("wizard-dates")).toBeVisible();
  // 上一步：回到 ①，名字还是原来的
  await page.getByTestId("wizard-prev").click();
  await expect(page.getByTestId("cover-name")).toHaveValue("向导小样");
  // 下一步 = 存了往后走
  await page.getByTestId("zero-intro").fill("向导里写的介绍");
  await page.getByTestId("wizard-next").click();
  for (let i = 1; i < 4; i++) {
    await expect(page.getByTestId(`wizard-${steps[i]}`)).toBeVisible();
    await expect(page.getByTestId(`wizard-step-${i + 1}`)).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId(`wizard-step-${i}`).locator(".wizard-no")).toHaveText("✓");
    await expectNoPageScrollX(page, `开局 ${i + 1}`);
    await page.getByTestId("wizard-next").click();
  }
  await expect(page.getByTestId("wizard-start")).toBeVisible();
  await expect(page.getByTestId("wizard-next")).toHaveCount(0);
  await expect(page.getByTestId("start-check")).toBeVisible();
  await expectNoPageScrollX(page, "开局 ⑤");
  // 刷新还在第 ⑤ 步；介绍存上了
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByTestId("wizard-step-5")).toHaveAttribute("aria-current", "step");
  await page.getByTestId("wizard-step-1").click();
  await expect(page.getByTestId("zero-intro")).toHaveValue("向导里写的介绍");
  expectClean(errors, "开局向导");
});
