# AGENTS.md · ARPS制作工会

改这个仓库之前先读 `README.md` 和 `src/domain/README.md`。规格以 ARPS制作工会 · 规格 v1（`SPEC.md`，不在仓库里）为准。

## 规矩

1. **读用查询，写用命令。** 页面读数据调 `src/domain/queries.ts`，写数据调 `dispatch("命令名", 输入)`
   （`useGuild()` / `useStore()`）。不要在页面里遍历表、拼业务规则、直接读写 `localStorage`。
2. **命令被拒绝时**（`result.ok === false`）界面要给出 `result.error.message`（已经是中文）。
3. **不写死示范数据。** 示范工会只在 `src/data/demo.ts`；页面和组件里不写示范 id 和示范文字（要用就从示范数据里读）。测试可以核对示范数据是不是照规格摆的。
4. **用户可见文案写给工会成员看**：中文、简单直白，不写规格注释。
5. **时间一律走数据层时钟**（`src/domain/clock.ts`，世界时间）；排序用 `src/domain/agenda.ts`，不用 `localeCompare` 比显示文字。
6. **视觉**：只用 `src/styles/tokens.css` 的变量；游戏感从结构来，不加循环动画、发光、渐变、撒花、贴纸。
7. **口令和密钥不进仓库**：账号只存 salt + 哈希；测试从环境变量读口令。
8. **新依赖**先写理由（README「新依赖」）。

## 交付门槛

`pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm build:single` 全绿；`pnpm smoke` 全绿；
人名扫描 0 命中。提交不 reset、不 rebase、不强推。
