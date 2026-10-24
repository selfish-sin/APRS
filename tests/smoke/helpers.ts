/** 冒烟共用：收报错、挡掉外网字体、登录、看有没有横向滚动。不写死示范数据里的 id。 */
import { expect, type Page } from "@playwright/test";

export const PASS = { admin: process.env.ARPS_PASS_ADMIN ?? "", member01: process.env.ARPS_PASS_MEMBER ?? "" };
export const HAS_PASS = !!PASS.admin && !!PASS.member01;

export type Errors = { console: string[]; page: string[]; failed: string[] };

/** 控制台报错、页面报错、同源请求 4xx / 5xx 都收起来，最后要求全是 0。 */
export function watch(page: Page): Errors {
  const errors: Errors = { console: [], page: [], failed: [] };
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
}

/** 字体走 Google Fonts；测试机不一定上得了外网，给个空的样式表（页面退回系统字体）。 */
export async function offlineFonts(page: Page) {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
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

/** 管理 → 开项目（批量：n 卡，层，每层张数）。返回项目页的路径。 */
export async function createProject(page: Page, opts: { name: string; code: string; count: number; layers: string; sheets: number }) {
  await open(page, "/admin?tab=new");
  await page.getByTestId("new-name").fill(opts.name);
  await page.getByTestId("new-code").fill(opts.code);
  await page.getByTestId("new-count").fill(String(opts.count));
  await page.getByTestId("new-layers").fill(opts.layers);
  await page.getByTestId("new-sheets").fill(String(opts.sheets));
  await page.getByTestId("new-create").click();
  await expect(page).toHaveURL(/#\/project\//);
  return new URL(page.url()).hash.slice(1);
}
