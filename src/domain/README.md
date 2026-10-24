# src/domain · 数据层

核心做法：**命令 → 变更集 → 日志**；读用查询；ID 是 `<前缀>_<UUIDv7>`。页面只调这里导出的东西。

```tsx
import { useGuild } from "@/lib/store";
import { questFor } from "@/domain/queries";

function MyQuests() {
  const { world, me, dispatch } = useGuild();
  const quests = questFor(world, me.id);             // 读：查询
  const claim = () => dispatch("task.claim", {});    // 写：命令（被拒时 store 底部弹中文原因；quiet: true 自己显示）
  …
}
```

## 表（`model.ts`，SPEC §4）

`worlds` · `members`（昵称 · 角色 admin / reviewer / member · 加入时间 · 头像色）· `accounts`（登录名 · salt · 哈希 · 对应成员）·
`enrollments`（报到：成员 · 组 · 环节 key · 熟练度 · 同时最多几张）· `projects` · `stages`（项目里的环节，从模板生成）·
`cuts`（卡：集 · 场 · 卡号 · 层和张数 · 秒数 · 原画张数）· `tasks`（锁住 · 可接 · 已接 · 待审 · 退回 · 通过 · 收回）·
`submissions`（版本：版本号 `versionNo` · 规范文件名 · 飞书链接 · 说明 · 谁交的 · 是不是自修 · 准不准时）·
`reviews`（通过 / 退回 / 自修后通过 · 质量系数 · 意见：层 · 张号 · 标签 · 文字）· `threads`（意见 · 提问上游 · 设定问题 · 要补）·
`rulings`（拍板 · 要补的卡）· `ledger`（活力点流水：审核那一刻按当时的工时和系数算好落表）。

时间两种：行头的 `createdAt` / `updatedAt` 是真实时间；`at` · `joinedAt` · `claimedAt` · `dueAt` 是**世界时间**
（`clock.ts` 的 `worldNow`；示范工会冻结在 2026-10-23 10:00 北京时间）。日志每条也有 `worldAt`。

## 流程模板（`templates.ts`）

纯数据：动画组 20 个环节（SPEC §3 的顺序）、视频组 11 个（草案，工时都是占位，管理员能改）。每个环节：阶段 · 类型（过渡 / 枢纽 / 审核）·
粒度（项目 / 每卡 / 每卡每层）· 单位 · Tn（每 `per` 个单位几小时）· 流程代号 · 上游 · 指示器文案 · 默认工作量从哪来。
管理员改的工时和掌控系数存在 `worlds.rules.rates`（`template.set_rate`），开项目时盖在模板上。

## 规则

| # | 规则 | 在哪 |
|---|---|---|
| 1 | 上游任务全部「通过」→ 下游同一卡的任务从「锁住」变「可接」；项目级的上游 → 下游每卡都解锁；两边都是每卡每层时只看同一层 | `flow.ts`（`tasksToUnlock` · `unlockReady`），在 `task.review` 的同一条日志里 |
| 2 | 报到 = 立刻按卡号顺序配一张（项目开始日 → 卡号 → 层），不超过上限；「接任务」再配一张 | `enroll.add` · `task.claim` · `nextOpenTask` |
| 3 | 时限 = 工作量 × Tn × 时限系数（默认 1.5，最少 4 小时）；过了时限没交 → 打开时自动收回到可接，记一条；扣分是开关（默认不扣，开了扣 2 点） | `rules.ts` · `task.expire` · store 打开 / 登录时扫一遍 |
| 4 | 放弃 = 返还到可接，不扣分 | `task.release` |
| 5 | 交 = 版本号 +1；文件名按规范生成（可改）；链接或说明至少一个；链接只收 http / https | `task.submit` · `naming.ts` |
| 6 | 退回 → 回到原来的人手上（时限至少再给原来的一半、最少 12 小时）；通过 → 记活力点给交的人；自修出的一版另记给审核员 0.5 小时 × 卡；指定了审核员就只有他和管理员能审；不能审自己交的 | `task.review` |
| 7 | 拍板以后列出的卡各留一条「要补」，任务单和卡详情上显示 | `ruling.make` |
| 8 | 活力点 = Tn × 工作量 ×（掌控系数 + 熟练度）× 质量；Lv n 要累计 5 × n × (n − 1) 点（0 · 10 · 30 · 60 · 100 · 150 …）；准时率 = 时限内交的 / 交过的；合作 = 在同一卡上做过事；主环节 = 通过得最多的 | `rules.ts` · `growthOf` · `collaboratorsOf` |
| 9 | 时间一律走 `clock.ts`；排序只比 ASCII（`agenda.ts`），不用 `localeCompare` | — |

枢纽派发（`hub.dispatch`）：一个枢纽管到下一个枢纽为止（直接接在后面的枢纽也算，例如 分镜 → Layout）。
派发 = 改这些任务的工作量（还可以给某一卡加一层，生成新任务）+ 放出来：`ready` 只放上游通过的（其余的等上游通过自动放），
`all` 全部马上放出来（不等上游）。一次派发一条日志。

## 命令（`commands/index.ts`，名字会记进日志，是稳定的接口）

| 命令 | 谁 | 做什么 |
|---|---|---|
| `guild.create` | 建的人 | 建一个全空的工会：工会 + 管理员 + 账号 |
| `rules.set` | 管理员 | 时限系数 · 超时扣分开关 · 工会名字 |
| `member.join` · `member.set_role` · `member.update` | 管理员（改自己的资料：自己） | 加成员 · 改角色（至少留一个管理员）· 改昵称和头像色 |
| `account.create` · `account.set_passcode` | 管理员（改自己的口令：自己） | 建账号 · 改 / 重置口令（只收 salt + 哈希） |
| `enroll.add` · `enroll.remove` | 自己（管理员可以代录） | 报到（自动配一张）· 取消报到 |
| `task.claim` · `task.submit` · `task.release` · `task.expire` | 自己（管理员可以代交） | 接 · 交 · 放弃 · 超时收回 |
| `task.reclaim` · `task.reopen` · `task.assign` | 管理员 | 收回（暂时谁都不能接）· 重新放出 · 指派给成员或外包 |
| `task.review` | 审核员 · 管理员 | 通过 / 退回 / 自修后通过 |
| `project.create` · `project.update` | 管理员 | 开项目（一步生成环节 + 卡 + 任务）· 改项目 |
| `stage.set_reviewer` · `template.set_rate` · `hub.dispatch` | 管理员 | 指定审核员 · 改工时与系数 · 枢纽派发 |
| `thread.open` · `thread.reply` · `thread.resolve` | 任何人 | 留意见 / 问上游 / 设定问题 · 回复 · 关掉（要补 = 补好了） |
| `ruling.make` | 管理员 | 拍板 |

每个命令都有测试（`__tests__/commands.*.test.ts`）；测试里每跑一步都查一遍引用完整性（`integrity.ts`）。

## 查询（`queries.ts`）

`pipelineOf`（三段进度 + 每个环节计数）· `gridOf`（卡 × 环节网格，筛选：只看我 / 只看待审 / 只看卡住的）·
`questFor` / `questOf`（任务单：工作量 · 倒计时 · 奖励 · 指示器）· `indicatorOf`（收什么、从哪个上游版本收、交到哪个文件夹、规范文件名、交给谁）·
`reviewQueue` / `canReview` · `growthOf` · `collaboratorsOf` · `timelineOfCut` · `inboxOf`（退回的 · 被问到的 · 要补的）·
`feedOf`（工会动态）· `enrollOptions`（报到页）· `dispatchPlan` / `estimateOf`（枢纽派发和人数天数估算）· `rateTable` · `overdueTasks` …

## 示范工会（`src/data/demo.ts`）

不是直接写表：从一个空世界开始一步一步跑上面这些命令（确定的 id 生成器 `seededIds`、每步带着历史上的世界时间），
所以示范数据也有完整的日志。浏览器只存示范之后的日志，加载时在示范的底上重放。
