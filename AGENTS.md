# AGENTS.md · ARPS制作工会

给读这个仓库、改这个仓库的 AI 和人。English summary below.

## main 分支 = 核心设计逻辑的正本

- **main 上的设计逻辑是标准答案**：`docs/DESIGN.md`（为什么这样设计、哪些规则不能破）、`docs/SPEC.md`（完整规格，代码里的「SPEC §N」指它的章节）和 `src/domain/`（规则的实现和测试）。
- 别的分支、别的 fork、别的说法都以 main 为准。两边不一致时，按 main 改，或者开 PR 讨论，不要悄悄改掉 main 的规则。
- 想改一条规则：在同一个提交里先改 `docs/`，再改代码和测试，提交说明里写清楚改了哪条（例「SPEC §4 规则 3：时限系数默认 1.5 → 1.3」）。

## 先读这几份（按顺序）

1. `docs/DESIGN.md`：一页讲完核心设计逻辑
2. `src/domain/README.md`：数据层（表 · 规则 · 命令）
3. `docs/SPEC.md`：要查某一节的细节和验收标准时再看
4. `README.md`：怎么跑、目录、依赖

## 规矩

1. **读用查询，写用命令。** 页面读数据调 `src/domain/queries.ts`，写数据调 `dispatch("命令名", 输入)`（`useGuild()` / `useStore()`）。不要在页面里遍历表、拼业务规则、直接读写 `localStorage`。
2. **命令被拒绝时**（`result.ok === false`），界面要给出原因（`code + key + 参数`，按当前语言拼）。
3. **不写死示范数据。** 示范工会只在 `src/data/demo.ts`；页面和组件里不写示范 id 和示范文字。示范里的人名全部是编的。
4. **用户看得到的文字写给工会成员看**：简单直白；中文和英文都进词典（`src/i18n`），不在页面里写死。
5. **时间一律走数据层时钟**（`src/domain/clock.ts`）；排序用 `src/domain/agenda.ts`，不用 `localeCompare` 比显示文字。
6. **视觉**：只用 `src/styles/tokens.css` 的变量；游戏感从结构来，不加循环动画、发光、渐变、撒花、贴纸；状态用 字 + 颜色 + 图形 表示。
7. **口令和密钥不进仓库**：账号只存 salt + 哈希；测试从环境变量 `ARPS_PASS_ADMIN` / `ARPS_PASS_MEMBER` 读口令。
8. **真实作品和真实文件不进仓库**：测试用脚本生成的假文件（`scripts/make-audit-fixtures.mjs`）。
9. **新依赖**先在 README「新依赖」里写理由。

## 合进 main 之前

`pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm build:single` · `pnpm smoke` 全绿。在分支上做，开 PR 合进 main；main 上不 reset、不 rebase、不强推。

---

## English summary

**ARPS Production Guild** is a local-first task board for animation / video production guilds, with a light game feel. Work is split into a *cut × stage* grid; members sign up for a stage and get task cards automatically; submissions are reviewed; passing a cell unlocks the next stage; points are earned by necessary labour time.

- **The `main` branch is the canonical source of the core design logic.** Read `docs/DESIGN.md` first (the why and the invariants), then `src/domain/README.md`, then `docs/SPEC.md` when you need details (code comments like “SPEC §18.4” refer to its sections). Other branches and forks defer to `main`. To change a rule, update `docs/` in the same commit as the code and tests.
- Invariants: reads go through queries, writes go through commands (`dispatch`) that produce an append-only, replayable journal; time comes from `clock.ts`; never sort display text with `localeCompare`; no secrets or real artwork in the repo; all UI text lives in the zh / en dictionaries.
- Before merging to `main`: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm build:single`, `pnpm smoke` must pass. Work on a branch and open a PR; never force-push `main`.
