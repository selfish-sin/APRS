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
| `tests/smoke/` | Playwright：每页打开 0 报错（三套设置）· 端到端主流程 · 断网 · 单文件 |

## 新依赖

| 依赖 | 为什么 |
|---|---|
| `vite`、`@vitejs/plugin-react` | 要静态、能装到桌面 / 手机、能打成一个 HTML |
| `vite-plugin-singlefile` | `pnpm build:single` 把 JS 和 CSS 内联进一个 `index.html`，用来发预览（没有服务器、没有别的文件也能打开） |


## 网页 + 本地

- 本地：整站静态，数据存在浏览器（每个工会一个键 `arps:w:<id>`，格式 `arps-guild-world` v1）。装到主屏幕以后断网能开。
- 网页：同一份 `dist/` 部署到 Vercel（`vercel.json`）。以后接主服务器时只换存储那一层：`src/lib/sync` 里有
  `SyncAdapter`（`push(entries)` / `pull(afterSeq)`）的本机实现和 HTTP 实现（POST 一条命令 · GET 某个序号以后的日志），
  界面上没有「连接」按钮。
