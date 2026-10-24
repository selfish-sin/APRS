/**
 * SPEC §11.7 资料库验收：
 *   拖 / 选 / 粘贴各放一张图 → 资料库里看到缩略图 → 打开看图器放大、拖动 → 点一下放钉写意见、拖一下框一块写意见 →
 *   回复 → 解决 → 卡时间线上能看到 → 两版对比 → 资料页加一个图片块和一个段落、上下移动 →
 *   断网刷新图片还在 → 带文件导出再导入（新浏览器环境）图片还在 → 375 宽能用 → 控制台 0 报错。
 * 图是测试里现做的 PNG（纯色块），不用真作品。
 */
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { HAS_PASS, enterDemo, expectClean, expectNoPageScrollX, login, noExternal, open, watch } from "./helpers";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** 一张 w × h 的纯色 PNG（左上角一块深色，方便看出拖动）。 */
export function png(w: number, h: number, [r, g, b]: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const dark = x < w / 4 && y < h / 4;
      row[1 + x * 3] = dark ? 30 : r;
      row[2 + x * 3] = dark ? 30 : g;
      row[3 + x * 3] = dark ? 30 : b;
    }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

async function dropFile(page: Page, testId: string, name: string, bytes: Buffer) {
  await page.evaluate(
    ({ testId, name, b64 }) => {
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([data], name, { type: "image/png" }));
      const el = document.querySelector(`[data-testid="${testId}"]`)!;
      el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { testId, name, b64: bytes.toString("base64") }
  );
}

async function pasteFile(page: Page, bytes: Buffer) {
  await page.evaluate((b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    // 截图粘进来时浏览器给的名字就是 image.png
    dt.items.add(new File([data], "image.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
  }, bytes.toString("base64"));
}

async function openFirstLibrary(page: Page) {
  await open(page, "/library");
  await page.getByTestId("library-project").first().click();
  await expect(page.getByTestId("library-grid")).toBeVisible();
}

const tile = (page: Page, name: string | RegExp) => page.getByTestId("file-tile").filter({ hasText: name });

test.beforeEach(async ({ page }) => {
  await noExternal(page);
});

test("资料库：拖 / 选 / 粘贴放图 → 看图器放大拖动 → 钉、框、回复、解决 → 卡时间线 → 两版对比 → 资料页加块、上下移", async ({ page }, info) => {
  test.skip(!HAS_PASS, "没设口令环境变量");
  const errors = watch(page);
  const tag = info.project.name.replace(/[^a-z0-9]/gi, "").slice(0, 8);
  await enterDemo(page);
  await login(page, "admin");
  await openFirstLibrary(page);
  const before = await page.getByTestId("file-tile").count();
  // 挂到第一卡（从下拉里读出来，不写死 id）
  const cutSelect = page.getByTestId("library-to-cut");
  const cutId = (await cutSelect.locator("option").nth(1).getAttribute("value"))!;
  await cutSelect.selectOption(cutId);

  // 拖
  await dropFile(page, "library-drop", `冒烟-拖-${tag}.png`, png(640, 480, [200, 120, 90]));
  await expect(tile(page, `冒烟-拖-${tag}.png`)).toBeVisible();
  // 选
  await page.getByTestId("library-drop-pick-input").setInputFiles({ name: `冒烟-选-${tag}.png`, mimeType: "image/png", buffer: png(640, 480, [90, 160, 200]) });
  await expect(tile(page, `冒烟-选-${tag}.png`)).toBeVisible();
  // 粘贴截图
  await pasteFile(page, png(640, 480, [120, 200, 120]));
  await expect(tile(page, /截图-\d{8}-\d{6}\.png/)).toBeVisible();
  await expect(page.getByTestId("file-tile")).toHaveCount(before + 3);
  // 缩略图是记录里的小图（dataURL）或者原图
  for (const name of [`冒烟-拖-${tag}.png`, `冒烟-选-${tag}.png`]) {
    const src = await tile(page, name).locator("img").getAttribute("src");
    expect(src).toMatch(/^(data:image\/jpeg|blob:)/);
  }
  await expectNoPageScrollX(page, "资料库");

  // 看图器：放大、滚轮、拖动
  await tile(page, `冒烟-选-${tag}.png`).getByRole("button", { name: /^打开/ }).click();
  const viewer = page.getByTestId("viewer");
  await expect(viewer).toBeVisible();
  await expect(page.getByTestId("viewer-img")).toBeVisible();
  const zoom = async () => Number((await page.getByTestId("viewer-zoom").textContent())!.replace("%", ""));
  const z0 = await zoom();
  await page.getByTestId("viewer-zoom-in").click();
  expect(await zoom()).toBeGreaterThan(z0);
  const stage = page.getByTestId("viewer-stage");
  const box = (await stage.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  const z1 = await zoom();
  await page.mouse.wheel(0, -300);
  await expect.poll(zoom).toBeGreaterThan(z1);
  await page.getByTestId("viewer-fit").click();
  const t0 = await page.getByTestId("viewer-img").evaluate((el) => (el as HTMLElement).style.transform);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 30, { steps: 5 });
  await page.mouse.up();
  const t1 = await page.getByTestId("viewer-img").evaluate((el) => (el as HTMLElement).style.transform);
  expect(t1).not.toBe(t0);
  await page.getByTestId("viewer-fit").click();

  // 点一下 = 钉
  await page.getByTestId("viewer-mode-pin").click();
  await page.mouse.click(cx, cy);
  await expect(page.getByTestId("pin-form")).toBeVisible();
  await page.getByTestId("pin-text").fill("第 6 张这里漏色");
  await page.getByTestId("pin-submit").click();
  await expect(page.getByTestId("pin-mark")).toHaveCount(1);
  // 拖一下 = 框
  await page.mouse.move(cx - 60, cy - 40);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy + 30, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("pin-form")).toBeVisible();
  await page.getByTestId("pin-text").fill("这一块色线没闭合");
  await page.getByTestId("pin-submit").click();
  await expect(page.getByTestId("pin-mark")).toHaveCount(2);
  await expect(page.locator('[data-testid="pin-mark"][data-pin="box"]')).toHaveCount(1);
  // 回复 → 解决 → 隐藏已解决的
  const first = page.getByTestId("pin-item").filter({ hasText: "第 6 张这里漏色" });
  await first.getByTestId("pin-jump").click();
  await first.getByTestId("pin-reply").fill("改好了，看 v02");
  await first.getByTestId("pin-reply-send").click();
  await expect(first).toContainText("改好了，看 v02");
  await first.getByTestId("pin-resolve").click();
  await expect(first).toHaveAttribute("data-status", "resolved");
  await page.getByTestId("pins-hide-resolved").check();
  await expect(page.getByTestId("pin-mark")).toHaveCount(1);
  await page.getByTestId("pins-hide-resolved").uncheck();

  // 两版对比（同一卡的另一张）：并排 · 滑块
  await page.getByTestId("viewer-compare").click();
  await expect(page.getByTestId("viewer-compare-view")).toBeVisible();
  await expect(page.getByTestId("viewer-compare-view").locator("img")).toHaveCount(2);
  await page.getByTestId("compare-slider").click();
  await expect(page.getByTestId("compare-slider-area")).toBeVisible();
  await page.getByTestId("compare-range").fill("30");
  await expectNoPageScrollX(page, "看图器");
  await page.getByTestId("viewer-close").click();
  await expect(viewer).toHaveCount(0);

  // 卡时间线上能看到这两个钉
  await open(page, `/cut/${cutId}`);
  await expect(page.getByTestId("timeline-open-pin")).toHaveCount(2);
  await expect(page.locator(".timeline")).toContainText("第 6 张这里漏色");
  await page.getByTestId("timeline-open-pin").first().click();
  await expect(page.getByTestId("viewer")).toBeVisible();
  await page.getByTestId("viewer-close").click();

  // 资料页：加一个段落、一个图片块，上下移动
  await openFirstLibrary(page);
  await page.getByTestId("page-new-title").fill(`冒烟页 ${tag}`);
  await page.getByTestId("page-new").click();
  await expect(page.getByTestId("page-title")).toHaveText(`冒烟页 ${tag}`);
  await page.getByTestId("block-add-text").fill("这一段是冒烟写的");
  await page.getByTestId("block-add-go").click();
  await page.getByTestId("block-type-image").click();
  await page.getByTestId("block-pick").filter({ hasText: `冒烟-选-${tag}.png` }).click();
  await page.getByTestId("block-add-go").click();
  const blocks = page.getByTestId("doc-block");
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(0)).toHaveAttribute("data-type", "text");
  await blocks.nth(1).getByTestId("block-up").click();
  await expect(blocks.nth(0)).toHaveAttribute("data-type", "image");
  await expect(blocks.nth(1)).toHaveAttribute("data-type", "text");
  await blocks.nth(1).getByTestId("block-text").click();
  await page.getByTestId("block-edit").fill("改过的一段");
  await page.getByTestId("block-edit").press("Control+Enter");
  await expect(blocks.nth(1)).toContainText("改过的一段");
  await blocks.nth(0).getByTestId("doc-image").click();
  await expect(page.getByTestId("viewer-img")).toBeVisible();
  await page.getByTestId("viewer-close").click();
  await expectNoPageScrollX(page, "资料页");
  expectClean(errors, "资料库");
});

test("资料库：断网刷新图片还在（文件在 IndexedDB 里）", async ({ browser }, info) => {
  test.skip(!HAS_PASS, "没设口令环境变量");
  test.skip(info.project.name !== "zh-CN Asia/Shanghai", "只在一套设置里跑");
  test.skip(!!process.env.SMOKE_BASE_URL && !process.env.SMOKE_BASE_URL.startsWith("http"), "只对 http 站点");
  const context = await browser.newContext({ serviceWorkers: "allow", baseURL: info.project.use.baseURL, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  const page = await context.newPage();
  const errors = watch(page);
  await enterDemo(page);
  await login(page, "admin");
  await openFirstLibrary(page);
  await page.getByTestId("library-drop-pick-input").setInputFiles({ name: "断网也在.png", mimeType: "image/png", buffer: png(320, 240, [180, 90, 160]) });
  await expect(tile(page, "断网也在.png")).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: "networkidle" });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(tile(page, "断网也在.png")).toHaveAttribute("data-here", "yes");
  await tile(page, "断网也在.png").getByRole("button", { name: /^打开/ }).click();
  const img = page.getByTestId("viewer-img");
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(320);
  expect(errors.page).toEqual([]);
  expect(errors.console).toEqual([]);
  await context.close();
});

test("资料库：带文件导出 → 新浏览器环境导入，图片还在；不带文件导入是占位，再放同一个文件就对上", async ({ browser, page }, info) => {
  test.skip(!HAS_PASS, "没设口令环境变量");
  test.skip(info.project.name !== "zh-CN Asia/Shanghai", "只在一套设置里跑");
  const errors = watch(page);
  const bytes = png(300, 200, [60, 140, 220]);
  await enterDemo(page);
  await login(page, "admin");
  await openFirstLibrary(page);
  await page.getByTestId("library-drop-pick-input").setInputFiles({ name: "带着走.png", mimeType: "image/png", buffer: bytes });
  await expect(tile(page, "带着走.png")).toBeVisible();
  await open(page, "/backup");
  await expect(page.getByTestId("usage-records")).toContainText("记录");
  await expect(page.getByTestId("usage-files")).toContainText("文件");
  // 带文件
  await page.getByTestId("export-with-files").check();
  let dl = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const withFiles = readFileSync((await (await dl).path())!, "utf8");
  expect(Object.keys(JSON.parse(withFiles).files ?? {}).length).toBeGreaterThan(0);
  // 不带文件
  await page.getByTestId("export-with-files").uncheck();
  dl = page.waitForEvent("download");
  await page.getByTestId("export").click();
  const recordsOnly = readFileSync((await (await dl).path())!, "utf8");
  expect(JSON.parse(recordsOnly).files).toBeUndefined();
  expectClean(errors, "导出");

  for (const [label, text] of [
    ["带文件", withFiles],
    ["只带记录", recordsOnly],
  ] as const) {
    const ctx = await browser.newContext({ baseURL: info.project.use.baseURL, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
    const p2 = await ctx.newPage();
    await noExternal(p2);
    const e2 = watch(p2);
    await open(p2, "/");
    await expect(p2.getByTestId("open-demo")).toBeVisible();
    await p2.getByTestId("storage-import-file").setInputFiles({ name: "b.json", mimeType: "application/json", buffer: Buffer.from(text) });
    await expect(p2.getByText(/0 步没能恢复/)).toBeVisible();
    if (label === "带文件") await expect(p2.getByText(/个文件也放回这台设备了/)).toBeVisible();
    await p2.getByTestId("storage-import-done").click();
    // 备份里带着导出时的登录；没带就登录一下。
    if (await p2.getByRole("heading", { name: "选账号登录" }).isVisible()) await login(p2, "admin");
    await openFirstLibrary(p2);
    if (label === "带文件") {
      await expect(tile(p2, "带着走.png")).toHaveAttribute("data-here", "yes");
      await tile(p2, "带着走.png").getByRole("button", { name: /^打开/ }).click();
      await expect.poll(() => p2.getByTestId("viewer-img").evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(300);
      await p2.getByTestId("viewer-close").click();
    } else {
      await expect(tile(p2, "带着走.png")).toHaveAttribute("data-here", "no");
      await expect(tile(p2, "带着走.png")).toContainText("不在这台设备上");
      await dropFile(p2, "library-drop", "随便叫什么.png", bytes);
      await expect(p2.getByText(/1 个对上了原来的记录/)).toBeVisible();
      await expect(tile(p2, "带着走.png")).toHaveAttribute("data-here", "yes");
      await expect(tile(p2, "随便叫什么.png")).toHaveCount(0);
    }
    expectClean(e2, `导入（${label}）`);
    await ctx.close();
  }
});

test("审核时附图、在图上钉，只钉不写也能退回（钉的就是退回意见）", async ({ page }, info) => {
  test.skip(!HAS_PASS, "没设口令环境变量");
  test.skip(info.project.name !== "zh-CN Asia/Shanghai", "只在一套设置里跑");
  const errors = watch(page);
  await enterDemo(page);
  await login(page, "admin");
  await open(page, "/review");
  await expect(page.getByTestId("review-images")).toBeVisible();
  await page.getByTestId("review-drop-pick-input").setInputFiles({ name: "审核截图.png", mimeType: "image/png", buffer: png(400, 300, [230, 210, 120]) });
  await expect(page.getByTestId("viewer")).toBeVisible();
  await page.getByTestId("viewer-mode-pin").click();
  const box = (await page.getByTestId("viewer-stage").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("pin-form")).toContainText("审核意见");
  await page.getByTestId("pin-text").fill("第 18 张下巴漏色");
  await page.getByTestId("pin-submit").click();
  await expect(page.getByTestId("pin-item")).toContainText("审核");
  await page.getByTestId("viewer-close").click();
  await page.getByRole("tab", { name: "退回" }).click();
  await page.getByTestId("review-submit").click();
  await expect(page.getByText(/退回了/)).toBeVisible();
  expectClean(errors, "审核附图");
});
