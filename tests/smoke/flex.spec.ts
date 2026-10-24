/**
 * SPEC §13.4 灵活性验收：
 *   管理员给成员 A 指派「原画」职位 → A 自动报到原画 → 管理员把 C001–C003 原画直接派给 A →
 *   成员 B（没这个职位）去认领中割的可接任务成功、自动多一条「自己认领」的报到 →
 *   管理员把「作画监督」锁成只给指派的人，B 认领被拒、看到中文原因 →
 *   （v1.1：环节上的动作都在环节页里）在「分镜」环节页发一张修正任务挂在 C002、派给 B、勾「这一卡要等它做完」→ C002 下游等它 →
 *   B 交、审核通过 → C002 下游解锁 → 改「中割」的计划周期和 Tn → 排期视图里计划 / 实际 / 超出都对 →
 *   刷新还在 → 375 宽能用 → 控制台 0 报错。
 * A = 示范工会里的木星（member01）；B = 测试里现建的成员（测试用口令，不是真的账号）。
 */
import { expect, test, type Page } from "@playwright/test";
import { HAS_PASS, createProject, enterDemo, expectClean, expectNoPageScrollX, login, logout, noExternal, open, openGrid, openStage, watch } from "./helpers";

test.skip(!HAS_PASS, "没有设 ARPS_PASS_ADMIN / ARPS_PASS_MEMBER，跳过");

const CODE = "FLEX";
const B = { nickname: "冒烟乙", login: "smokeb", pass: "smoke-b-pass-1" };

/** 网格里第 row 行（0 起）某一列格子的状态。 */
async function cellStatus(page: Page, projectPath: string, stageName: string, row: number): Promise<string> {
  await openGrid(page, projectPath);
  const names = await page.locator("table.board thead th").allTextContents();
  const col = names.findIndex((n) => n.trim() === stageName);
  expect(col).toBeGreaterThan(0);
  const cell = page.locator("table.board tbody tr").nth(row).locator("td").nth(col - 1);
  return (await cell.locator(".cell-part").first().getAttribute("data-status")) ?? "";
}

test("灵活性：指派职位 · 一批派 · 自己认领 · 锁环节 · 发修正挡下游 · 改周期和 Tn · 排期", async ({ page }, info) => {
  test.setTimeout(240_000);
  await noExternal(page);
  const errors = watch(page);
  await enterDemo(page);
  await login(page, "admin");

  // —— 开一个小项目（3 卡），Layout 枢纽和原画监督枢纽都「全部马上放出来」——
  const projectPath = await createProject(page, { name: "灵活性测试片", code: CODE, count: 3, layers: "A", sheets: 4 });
  const projectId = projectPath.split("/")[2];
  for (const hub of ["Layout", "原画监督"]) {
    await open(page, `/admin?tab=dispatch&project=${projectId}`);
    await page.getByTestId("dispatch-hub").selectOption({ label: hub });
    if (hub === "原画监督") await page.getByTestId("dispatch-include-inbetween").check();
    await page.getByTestId("dispatch-release-all").check();
    await page.getByTestId("dispatch-submit").click();
    await expect(page.getByText(/派发了 \d+ 张任务/).first()).toBeVisible();
  }
  expect(await cellStatus(page, projectPath, "中割", 1)).toBe("open");

  // —— 1. 给 A（木星）指派「原画」职位 → 自动报到 ——
  await open(page, "/members");
  await page.getByRole("link", { name: "木星" }).first().click();
  await expect(page.getByTestId("member-roles")).toBeVisible();
  const memberPath = new URL(page.url()).hash.slice(1);
  await page.getByTestId("role-pick").selectOption({ label: "动画组 · 原画" });
  await page.getByTestId("role-assign").click();
  await expect(page.getByTestId("role-assigned").filter({ hasText: "原画" })).toContainText("指派");

  // —— 2. 把 C001–C003 原画直接派给 A ——
  // （§17：一批派在环节页的「派发」里：多选几行 → 派给某人）
  let stage = await openStage(page, projectPath, "原画");
  const dispatchBlock = stage.getByTestId("stage-dispatch");
  for (const c of ["C001", "C002", "C003"]) await dispatchBlock.getByTestId("dispatch-row").filter({ hasText: c }).getByTestId("dispatch-pick").check();
  await dispatchBlock.getByTestId("bulk-assign").click();
  await dispatchBlock.getByTestId("assign-tasks-who").selectOption({ label: "木星" });
  await dispatchBlock.getByTestId("assign-tasks-go").click();
  await expect(page.getByText("派了 3 张给 木星", { exact: true })).toBeVisible();
  expect(await cellStatus(page, projectPath, "原画", 0)).toBe("claimed");

  // —— 3. 加成员 B（建账号）——
  await open(page, "/admin?tab=members");
  await page.getByLabel("昵称").fill(B.nickname);
  await page.getByLabel("登录名（可以不建账号）").fill(B.login);
  await page.getByLabel("口令", { exact: true }).fill(B.pass);
  await page.getByRole("button", { name: "加进来" }).click();
  await expect(page.getByText(new RegExp(`加了 ${B.nickname}`))).toBeVisible();

  // —— 4. 「作画监督」（原画监督）锁成只给指派的人 ——
  stage = await openStage(page, projectPath, "原画监督");
  await stage.getByTestId("stage-lock").check();
  await expect(stage.getByTestId("stage-lock")).toBeChecked();

  // —— 5. B 认领中割（没这个职位）→ 成功，多一条「自己认领」；认领作画监督被拒，看到中文原因 ——
  await logout(page);
  await page.getByTestId(`account-${B.login}`).click();
  await page.getByTestId("passcode").fill(B.pass);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/#\/hall/);
  await open(page, "/enroll");
  await page.getByTestId("role-inbetween").click();
  await page.getByTestId("enroll-claim").click();
  await expect(page.getByRole("dialog", { name: "拿到一张任务单" })).toBeVisible();
  await page.getByRole("button", { name: "留在这里" }).click();
  await open(page, "/me");
  await expect(page.getByTestId("role-own").filter({ hasText: "中割" })).toContainText("自己认领");
  await open(page, "/enroll");
  await page.getByTestId("role-key_check").click();
  await expect(page.getByTestId("role-key_check")).toContainText("只给指派的人");
  await page.getByTestId("enroll-submit").click();
  await expect(page.getByText("这个环节只给指派的人，找管理员").first()).toBeVisible();
  await expectNoPageScrollX(page, "报到");
  // 被拒的那一下只是提示（不是程序出错），控制台里那条 warn 不算报错
  await logout(page);

  // —— 6. 管理员在「分镜」节点发一张修正：挂 C002、派给 B、这一卡要等它做完 ——
  await login(page, "admin");
  stage = await openStage(page, projectPath, "分镜");
  await stage.getByTestId("publish-open").click();
  const form = stage.getByTestId("publish-form");
  await form.getByTestId("publish-kind-fix").click();
  await form.getByTestId("publish-title").fill("C002 分镜加一个镜头");
  await form.getByTestId("publish-cut").filter({ hasText: "C002" }).click();
  await form.getByTestId("publish-workload").fill("2");
  await form.getByTestId("publish-hours").fill("24");
  await form.getByTestId("publish-assignee").selectOption({ label: B.nickname });
  await form.getByTestId("publish-blocking").check();
  await form.getByTestId("publish-go").click();
  await expect(page.getByText(`发了一张修正：C002 分镜加一个镜头，派给 ${B.nickname}`, { exact: true })).toBeVisible();
  await expect(stage.getByTestId("extra-item")).toContainText("这一卡要等它");
  // C002 下游等它：中割 C002 回到锁住；C003 不受影响；分镜那一格右上角 1 件
  expect(await cellStatus(page, projectPath, "中割", 1)).toBe("locked");
  expect(await cellStatus(page, projectPath, "中割", 2)).toBe("open");
  await expect(page.locator(".project-strip .extra-count")).toHaveText("1");

  // —— 7. B 交 → 管理员审核通过 → C002 下游解锁 ——
  await logout(page);
  await page.getByTestId(`account-${B.login}`).click();
  await page.getByTestId("passcode").fill(B.pass);
  await page.getByTestId("login-submit").click();
  await page.getByTestId("mini-quest").filter({ hasText: "分镜加一个镜头" }).click();
  const quest = page.getByTestId("quest-card").filter({ hasText: "分镜加一个镜头" });
  await expect(quest.getByTestId("quest-assigned-by")).toHaveText("白鹭派给你的");
  await quest.getByRole("button", { name: "交", exact: true }).click();
  await page.getByLabel("说明").fill("加了一个 2 秒的空镜");
  await page.getByTestId("submit-confirm").click();
  await expect(page.getByText(/等审核/).first()).toBeVisible();
  await logout(page);
  await login(page, "admin");
  await open(page, "/review");
  await page.locator(".queue-item").filter({ hasText: "分镜加一个镜头" }).click();
  await page.getByTestId("quality-1.0").click();
  await page.getByTestId("review-submit").click();
  await expect(page.getByText(/通过了 C002 · 分镜修正/).first()).toBeVisible();
  expect(await cellStatus(page, projectPath, "中割", 1)).toBe("open");

  // —— 8. 改「中割」的计划周期（第 2 周起 1 周）和 Tn ——
  stage = await openStage(page, projectPath, "中割");
  await stage.getByTestId("stage-edit-open").click();
  const settings = stage.getByTestId("stage-config-form");
  await settings.getByTestId("period-start").fill("2");
  await settings.getByTestId("period-weeks").fill("1");
  await settings.getByTestId("rate-tn").fill("2");
  await settings.getByTestId("config-save").click();
  await expect(page.getByText("「中割」改好了").first()).toBeVisible();
  await expect(stage.getByTestId("stage-params")).toContainText("Tn 2 小时");

  // —— 9. 排期视图：计划在第 2 周，实际从这周（第 1 周）开始；下游早于上游结束有提醒 ——
  const checkSchedule = async () => {
    await page.getByTestId("ptab-schedule").click();
    const row = page.locator('[data-testid="schedule-row"][data-stage="inbetween"]');
    await expect(row).toBeVisible();
    const cells = row.locator("td");
    await expect(cells.nth(1).getByTestId("gantt-plan")).toHaveCount(1);
    await expect(cells.nth(0).getByTestId("gantt-plan")).toHaveCount(0);
    await expect(cells.nth(2).getByTestId("gantt-plan")).toHaveCount(0);
    await expect(cells.nth(0).getByTestId("gantt-actual")).toHaveCount(1);
    await expect(row.getByTestId("schedule-warning")).toContainText("早于上游");
    await expect(row.getByTestId("schedule-overrun")).toHaveCount(0);
  };
  await open(page, projectPath);
  await checkSchedule();
  await expectNoPageScrollX(page, "排期");
  // 示范项目「安娜的旅程」：中割实际做了好几个月，超出计划，超出的格子数 = 「超出 N 周」
  await open(page, "/projects");
  await page.locator("a.project-card").filter({ hasText: "安娜的旅程" }).click();
  await page.getByTestId("ptab-schedule").click();
  const andlcRow = page.locator('[data-testid="schedule-row"][data-stage="inbetween"]');
  const overText = (await andlcRow.getByTestId("schedule-overrun").textContent()) ?? "";
  const n = Number(overText.match(/超出 (\d+) 周/)?.[1] ?? 0);
  expect(n).toBeGreaterThan(0);
  await expect(andlcRow.getByTestId("gantt-over")).toHaveCount(n);

  // —— 10. 刷新还在 ——
  await page.reload({ waitUntil: "networkidle" });
  await open(page, projectPath);
  await checkSchedule();
  await open(page, memberPath);
  await expect(page.getByTestId("role-assigned").filter({ hasText: "原画" })).toContainText("指派");
  await expectNoPageScrollX(page, "成员页");
  expect(errors.page).toEqual([]);
  // 被拒的那一下 store 会 console.warn（不是 error）；控制台报错要是 0
  expect(errors.console).toEqual([]);
  expect(errors.failed).toEqual([]);
  expect(errors.external).toEqual([]);
  void info;
  void expectClean;
});
