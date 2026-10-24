# src/lib/migrations · 存下来的东西怎么升级

**规矩：换版本不清空。** 浏览器里存的工会（`arps:w:<worldId>`）和导出的备份文件，形状一变就要：

1. `WORLD_FORMAT_VERSION` 加一；
2. 在 `MIGRATIONS` 里加一条 `旧版本号: (旧形状) => 新形状`；
3. 加一个测试：把旧形状喂进 `migrateWorldFile`，断言出来的是新形状；
4. 升不了的，返回 `{ ok: false, reason }`，界面用 `migrationReasonZh` 说清楚，**原来的键留着不动**。

这里管的是「信封」（键和文件的外层）。信封里的日志归数据层：加载时按现在的底（示范 / 空）重放，
对不上的条目留在 `skipped`，界面上有一行提示（「有 N 步没能恢复，没有丢」）。

## 现在的信封（formatVersion 1）

```jsonc
{
  "format": "arps-guild-world",
  "formatVersion": 1,
  "base": "demo",               // demo = 示范工会（底在代码里）· empty = 自己建的（底是空的）
  "worldId": "wld_…",
  "title": "示范工会",
  "journal": [ /* 底之后的日志条目，按 seq */ ],
  "session": { "worldId": "…", "accountId": "…", "memberId": "…" },   // 这台设备上谁登录着
  "skipped": [ /* 对不上的条目，没丢 */ ],
  "savedAt": "2026-10-23T10:00:00.000Z",
  "exportedAt": "…",            // 只在导出的文件里
  "build": "abc123"             // 只在导出的文件里：页面 <meta name="build">
}
```

## 键的清单

见 `src/lib/storage/keys.ts`：`arps:worlds` · `arps:w:<worldId>` · `arps:w:<worldId>:bak`。
