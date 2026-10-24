# ARPS制作工会

带游戏感的工会任务板：管理员开项目 → 项目按组（动画 / 视频）套流程模板，拆成「卡 × 环节」的任务格 →
成员报到某个环节，系统自动配一张任务单 → 交上来（飞书链接 + 规范文件名 + 版本号）→ 审核员通过 / 退回 /
自修后通过 → 通过的格子点亮、下游解锁 → 每一步按必要劳动时间记活力点，人有等级和成长。

规格：ARPS制作工会 · 规格 v1（`SPEC.md`）。

## 怎么跑

```bash
pnpm install
pnpm dev            # http://localhost:5173 （hash 路由：#/hall、#/project/<id> …）
pnpm typecheck
pnpm test           # 数据层 + 存储 + 同步 + 口令（Vitest）
pnpm build          # → dist/：静态站，Vercel 直接托管；带 manifest.webmanifest + service worker（断网能开）
pnpm build:single   # → dist-single/index.html：一个文件，JS / CSS 全部内联，用来发预览
pnpm preview        # 在 4173 端口看 dist
pnpm smoke          # Playwright 冒烟 + 端到端（先 pnpm build；单文件那项要先 pnpm build:single）
pnpm shots          # 主要页面的截图 → artifacts/shots/（不进仓库）
```

冒烟和截图要登录示范工会时，口令从环境变量读：`ARPS_PASS_ADMIN`、`ARPS_PASS_MEMBER`（不在仓库里；没设时那几项跳过）。
机器上已经装好 Chromium 时不用 `playwright install`；找不到浏览器可以设 `SMOKE_CHROMIUM_PATH`。

## 账号

示范工会预建两个账号：`admin`（工会管理员 = 编的「白鹭」）和 `member01`（成员 01 = 编的「木星」，中割）。
仓库里只有 `src/data/accounts.public.json` 的 salt 和 `sha256(salt + ":" + 口令)`，口令原文不在任何文件里。
这是这台设备上的**软锁**（同一台设备上换人要输口令），不是联网登录：数据在浏览器里，懂技术的人能绕过。
管理员在「管理 → 成员和账号」里改自己的口令、给新成员建账号、重置别人的口令（同样只存哈希）。

## 结构

| 目录 | 内容 |
|---|---|
| `src/domain/` | 数据层：表（`model.ts`）· 流程模板（`templates.ts`，纯数据）· 命令（`commands/*`）· 查询（`queries.ts`）· 连线推进（`flow.ts`）· 计分和等级（`rules.ts`）· 文件名规范（`naming.ts`）· 时钟 / 排序 / id / apply / dispatch / replay / 完整性（骨架）。说明见 `src/domain/README.md` |
| `src/data/` | 示范工会（`demo.ts`：从空世界一步一步跑命令建出来；项目真、人员编）· 两个账号的 salt + 哈希 |
| `src/lib/` | store（打开工会、登录、存、导出导入、超时收回）· 存储（`arps:` 键、信封升级）· 口令（WebCrypto + 纯 JS 备用）· hash 路由 · `sync/`（SyncAdapter：本机 + HTTP） |
| `src/pages/` | P1 进门 · 登录 · P2 大厅 · P3 报到 · P4 项目 · P5 项目总览 · P6 卡详情 · P7 审核台 · P8 管理 · P9 成员 · P10 备份 |
| `src/components/` | `ui/`（基础组件）、`storage/`（本机存储和备份）· `app/`（任务单黑卡、关卡地图、网格、时间线、外壳…） |
| `src/i18n/` | 中文 / English 词典（`zh.ts` · `en.ts` · `ns/*`）、`useI18n()`、「中 / EN」切换（§16） |
| `tests/smoke/` | Playwright：每页打开 0 报错（三套设置）· 端到端主流程 · 断网 · 单文件 · English 每页扫汉字 · 从设计组搬来的 7 处界面（`ports.spec.ts`） |

## 新依赖

| 依赖 | 为什么 |
|---|---|
| `vite`、`@vitejs/plugin-react` | 要静态、能装到桌面 / 手机、能打成一个 HTML |
| `vite-plugin-singlefile` | `pnpm build:single` 把 JS 和 CSS 内联进一个 `index.html`，用来发预览（没有服务器、没有别的文件也能打开） |

| `xlsx`（SheetJS CE **0.20.3**，`vendor/xlsx-0.20.3.tgz`） | 表格预览 / 检查（§15.2）和导出汇报（§15.3）。理由见下 |


### 表格库为什么选 SheetJS CE 0.20.3

- 维护中（官方在 cdn.sheetjs.com 发版，0.20.3 是现在的最新版），一个库就能在浏览器里**读** .xlsx / .xls / .csv（公式和算好的值、合并单元格、列宽都读得出来）、**写** .xlsx。ExcelJS 读不了 .xls；read-excel-file / write-excel-file 读不出公式和合并。
- **不用 npm 上的 `xlsx@0.18.5`**：它有已知漏洞（CVE-2023-30533 原型污染、CVE-2024-22363 ReDoS），SheetJS 之后不再往 npm 发版。0.20.3 已修。
- 不从 CDN 加载：官方 tarball 放在 `vendor/xlsx-0.20.3.tgz`（sha256 `8dc73fc3…b99fe8`），`pnpm install` 从本地装，打进程序。
- 普通构建里按需加载：打开表格或导出汇报时才下载 `assets/xlsx-*.js`（约 500 KB，gzip 约 163 KB）；单文件版里内联，**单文件版因此大了约 500 KB（gzip 约 163 KB）**。
- 社区版写文件时不写单元格样式：导出汇报的颜色（计划 / 实际 / 超出）和冻结表头由 `src/lib/sheets/write.ts` 在写好的 .xlsx（zip）里补进 `styles.xml` 和各表的 xml，用的是同一个库自带的 zip（`XLSX.CFB`）。

## 中文 / English（§16）

- 界面文字都在词典里：`src/i18n/zh.ts` 和 `src/i18n/en.ts`，按页面分到 `src/i18n/ns/*.ts`（每个文件导出 `zh` 和 `en`，英文那份的类型是 `Shape<typeof zh>`，少一个键就编译不过）；`src/i18n/i18n.test.ts` 再查一遍两边的键和占位符一样。
- 第一次打开按浏览器语言（`zh*` → 中文，别的 → English）；右上角 / 侧栏底部「中 / EN」切换，记在这台设备（`arps:lang`）也记在账号上（`account.set_lang`）。
- 数据层不拼句子：命令被拒返回 `code + key + params`（`src/domain/errors.ts`），时间线和提示是 `Phrase`（`src/domain/text.ts`），界面按语言拼。流程模板的环节名和位置名有两种说法；管理员自己起的名字、成员写的内容不翻，界面里包在 `<U>` / `data-uc` 里。
- 日期、数字、复数按语言（`10月23日 周五` / `Fri, Oct 23`，`1 task` / `2 tasks`）；导出汇报的表头和文件名跟着界面语言。
- 冒烟 `tests/smoke/i18n.spec.ts`：English 下每一页扫可见文字，除了 `data-uc` 和「中」按钮以外不能有汉字；切换刷新保持；被拒的原因两种语言都对；375 宽不横着滚。

## 网页 + 本地

- 本地：整站静态，数据存在浏览器（每个工会一个键 `arps:w:<id>`，格式 `arps-guild-world` v1）。装到主屏幕以后断网能开。
- 网页：同一份 `dist/` 部署到 Vercel（`vercel.json`）。以后接主服务器时只换存储那一层：`src/lib/sync` 里有
  `SyncAdapter`（`push(entries)` / `pull(afterSeq)`）的本机实现和 HTTP 实现（POST 一条命令 · GET 某个序号以后的日志），
  界面上没有「连接」按钮。
