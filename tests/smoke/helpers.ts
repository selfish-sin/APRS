/** 冒烟共用：收报错、记下（并挡掉）对外网的请求、登录、看有没有横向滚动。不写死示范数据里的 id。 */
import { expect, type Page } from "@playwright/test";

export const PASS = { admin: process.env.ARPS_PASS_ADMIN ?? "", member01: process.env.ARPS_PASS_MEMBER ?? "" };
export const HAS_PASS = !!PASS.admin && !!PASS.member01;

export type Errors = { console: string[]; page: string[]; failed: string[]; external: string[] };

const BASE_ORIGIN = new URL(process.env.SMOKE_BASE_URL ?? "http://localhost:4173").origin;

/** 对外网的请求：http(s) 但不是这个站自己（境内打不开外网字体 / CDN，SPEC §14.3）。data: / blob: 不算。 */
export function isExternal(page: Page, url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  let pageOrigin = "null";
  try {
    pageOrigin = new URL(page.url()).origin;
  } catch {
    /* about:blank */
  }
  return u.origin !== BASE_ORIGIN && u.origin !== pageOrigin;
}

/** 控制台报错、页面报错、同源请求 4xx / 5xx、对外网的请求都收起来，最后要求全是 0。 */
export function watch(page: Page): Errors {
  const errors: Errors = { console: [], page: [], failed: [], external: [] };
  page.on("request", (r) => {
    if (isExternal(page, r.url())) errors.external.push(r.url().slice(0, 200));
  });
  page.on("console", (m) => {
    if (m.type() === "error") errors.console.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.page.push(String(e.message).slice(0, 300)));
  page.on("response", (r) => {
    const origin = new URL(page.url() || "http://x/").origin;
    if (r.status() >= 400 && r.url().startsWith(origin)) errors.failed.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

export function expectClean(errors: Errors, where: string) {
  expect(errors.page, `${where}：页面报错`).toEqual([]);
  expect(errors.console, `${where}：控制台报错`).toEqual([]);
  expect(errors.failed, `${where}：请求失败`).toEqual([]);
  expect(errors.external, `${where}：有对外网的请求`).toEqual([]);
}

/** 对外网的请求一律挡掉（测试机不一定上得了外网，也不该有这种请求；watch 会记下来让测试失败）。 */
export async function noExternal(page: Page) {
  await page.route(
    (url) => isExternal(page, url.toString()),
    (route) => route.abort("blockedbyclient")
  );
}

export async function open(page: Page, path: string) {
  await page.goto(`/#${path}`, { waitUntil: "networkidle" });
}

/** 页面不能横着滚（手机 375 宽）。网格自己的横向滚动在卡片里面，不算。 */
export async function expectNoPageScrollX(page: Page, where: string) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `${where}：页面横向超出了（${scroll} > ${inner}）`).toBeLessThanOrEqual(inner + 1);
}

export async function enterDemo(page: Page) {
  await open(page, "/");
  await page.getByTestId("open-demo").click();
  await expect(page.getByRole("heading", { name: "选账号登录" })).toBeVisible();
}

export async function login(page: Page, who: "admin" | "member01", pass = PASS[who]) {
  await expect(page.getByRole("heading", { name: "选账号登录" })).toBeVisible();
  await page.getByTestId(`account-${who}`).click();
  await page.getByTestId("passcode").fill(pass);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/#\/hall/);
}

/** 换人：退出，回到登录页。手机上「换人」在抽屉里。 */
export async function logout(page: Page) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page.getByTestId("logout").click();
  await expect(page.getByRole("heading", { name: "选账号登录" })).toBeVisible();
}

export async function createGuild(page: Page, pass: string) {
  await open(page, "/");
  await page.getByLabel("工会名字").fill("冒烟小组");
  await page.getByLabel("你的昵称").fill("测试员");
  await page.getByLabel("口令", { exact: true }).fill(pass);
  await page.getByLabel("再输一次").fill(pass);
  await page.getByRole("button", { name: "建好进去" }).click();
  await expect(page).toHaveURL(/#\/hall/);
}

/** 管理 → 建项目（先进零日）→ 零日页填结构（1 集 1 场 n 卡，层，每层张数）→ 开工。返回项目页的路径。 */
export async function createProject(page: Page, opts: { name: string; code: string; count: number; layers?: string; sheets?: number; group?: "video" }) {
  await open(page, opts.group === "video" ? "/admin?tab=new&group=video" : "/admin?tab=new");
  await page.getByTestId("new-name").fill(opts.name);
  await page.getByTestId("new-code").fill(opts.code);
  await page.getByTestId("new-create").click();
  await expect(page).toHaveURL(/#\/project\//);
  await startFromZero(page, opts);
  return new URL(page.url()).hash.slice(1);
}

/** 在零日页填结构（1 集 1 场 n 卡）再开工。 */
export async function startFromZero(page: Page, opts: { count: number; layers?: string; sheets?: number }) {
  await expect(page.getByTestId("structure-card")).toBeVisible();
  await page.getByTestId("zero-episodes").fill("1");
  await page.getByTestId("zero-scenes").fill("1");
  await page.getByTestId("zero-cuts").fill(String(opts.count));
  if (opts.layers !== undefined) await page.getByTestId("zero-layers").fill(opts.layers);
  if (opts.sheets !== undefined) await page.getByTestId("zero-sheets").fill(String(opts.sheets));
  await page.getByTestId("zero-structure-save").click();
  await expect(page.getByTestId("structure-card")).toContainText(new RegExp(`${opts.count} (卡|cuts?)`));
  await page.getByTestId("zero-start").click();
  await page.getByTestId("zero-start-confirm").click();
  await expect(page.getByTestId("board")).toBeVisible();
}
