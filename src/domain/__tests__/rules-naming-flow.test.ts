import { describe, expect, it } from "vitest";
import { cmp, compareBy, numberKey } from "@/domain/agenda";
import { addHours, countdownZh, dateTimeZh } from "@/domain/clock";
import { dispatch, replay } from "@/domain/dispatch";
import { hubScope, tasksToUnlock } from "@/domain/flow";
import { isIdOf, seededIds } from "@/domain/ids";
import { formatPoints, rateLabel } from "@/domain/labels";
import { emptyWorldState } from "@/domain/model";
import { cutCode, fileNameFor, folderFor, taskLabel } from "@/domain/naming";
import { LEVEL_TABLE, deadlineHours, levelOf, pointsOf, rewardOf } from "@/domain/rules";
import { ANIMATION, VIDEO } from "@/domain/templates";
import { TestGuild, WORLD } from "./helpers";

describe("等级和计分", () => {
  it("等级表 10 · 30 · 60 · 100 · 150 …", () => {
    expect(LEVEL_TABLE.slice(0, 7)).toEqual([0, 10, 30, 60, 100, 150, 210]);
    expect(levelOf(0)).toMatchObject({ level: 1, floor: 0, next: 10, progress: 0 });
    expect(levelOf(45)).toMatchObject({ level: 3, floor: 30, next: 60, progress: 0.5 });
    expect(levelOf(1e9).next).toBeNull();
  });

  it("活力点 = Tn × 工作量 ×（掌控 + 熟练度）× 质量；时限 = Tn × 工作量 × 1.5（最少 4 小时）", () => {
    expect(pointsOf(30, 1, 0.2, 1.2)).toBe(43.2);
    expect(rewardOf({ tn: 2, per: 15, control: 1 }, 60, 0.5)).toBe(12);
    expect(deadlineHours({ tn: 1.5, per: 1 }, { workload: 20 }, undefined)).toBe(45);
    expect(deadlineHours({ tn: 1.5, per: 1 }, { workload: 20 }, { deadlineFactor: 2 })).toBe(60);
    expect(deadlineHours({ tn: 0.5, per: 1 }, { workload: 1 }, undefined)).toBe(4);
    expect(formatPoints(12, true)).toBe("+12.0");
    expect(formatPoints(-2)).toBe("−2.0");
    expect(rateLabel({ tn: 4, per: 15, unit: "second" })).toBe("4 小时 / 15 秒");
    expect(rateLabel({ tn: 1.5, per: 1, unit: "sheet" })).toBe("1.5 小时 / 张");
  });
});

describe("文件名规范", () => {
  const project = { code: "LTHJ", episode: "EP01", scene: "SC001", group: "animation" as const };
  const cut = { number: 5, episode: "EP01", scene: "SC001" };
  it("[项目]_[集数]_[场景]_[镜头]_[层级]_[流程]_[版本]", () => {
    expect(fileNameFor(project, { code: "ANI", fileCode: "ANI" }, cut, "A", 4)).toBe("LTHJ_EP01_SC001_CUT005_A_ANI_v04");
    expect(fileNameFor(project, { code: null, fileCode: "STB" }, null, null, 1)).toBe("LTHJ_EP01_STB_v01");
    expect(folderFor(project, { folder: "ANI" }, cut)).toBe("/EP01/ANI/SC001/CUT005/");
    expect(folderFor(project, { folder: "分镜" }, null)).toBe("/EP01/分镜/");
    expect(cutCode({ number: 9 })).toBe("C009");
    expect(cutCode({ number: 3 }, "video")).toBe("第 3 期");
    expect(taskLabel({ name: "中割" }, { number: 9 }, { layer: "B" })).toBe("C009 · 中割 · B 层");
  });
});

describe("流程模板", () => {
  it("动画组 20 个环节，上游都在模板里，没有绕圈", () => {
    for (const tpl of [ANIMATION, VIDEO]) {
      const keys = new Set(tpl.stages.map((s) => s.key));
      const seen = new Set<string>();
      for (const s of tpl.stages) {
        for (const u of s.upstream) {
          expect(keys.has(u), `${tpl.key}.${s.key} → ${u}`).toBe(true);
          expect(seen.has(u), `${s.key} 的上游 ${u} 要排在它前面或已出现`).toBe(true);
        }
        seen.add(s.key);
      }
    }
    expect(ANIMATION.stages.map((s) => s.name)).toEqual([
      "策划",
      "剧本",
      "分镜",
      "美术设计（人设 / 美设）",
      "色指定设计",
      "Layout",
      "原画",
      "原画监督",
      "清线",
      "中割",
      "中割检修",
      "输出上色文件（导出胶片）",
      "上色（执行色指定）",
      "检查色指定",
      "导出（上色 · 线稿 · 分层）",
      "场景绘制",
      "影像合成",
      "特效 · 调色",
      "配音 · 音效",
      "成片输出",
    ]);
  });

  it("枢纽管到下一个枢纽为止；上游全通过才解锁", () => {
    const g = new TestGuild();
    const p = g.project(1, 2);
    const stages = Object.values(g.state.stages).filter((s) => s.projectId === p);
    const scope = (key: string) => hubScope(stages, stages.find((s) => s.templateKey === key)!).map((s) => s.templateKey);
    expect(scope("inbetween_check")).toEqual(["color_out", "paint", "paint_check", "export"]);
    expect(scope("composite")).toEqual(["fx"]);
    expect(scope("final")).toEqual([]);
    const tasks = Object.values(g.state.tasks).filter((t) => t.projectId === p);
    expect(tasksToUnlock(stages, tasks)).toEqual([]);
    const plan = tasks.find((t) => t.stageId === stages.find((s) => s.templateKey === "plan")!.id)!;
    const passed = tasks.map((t) => (t.id === plan.id ? { ...t, status: "passed" as const } : t));
    const unlocked = tasksToUnlock(stages, passed).map((id) => stages.find((s) => s.id === passed.find((t) => t.id === id)!.stageId)!.templateKey);
    expect(unlocked.sort()).toEqual(["art", "script"]);
  });
});

describe("骨架：id · 时钟 · 排序 · 重放", () => {
  it("确定的 id 是带前缀的 UUIDv7，同样的种子同样的结果", () => {
    const a = seededIds(1);
    const b = seededIds(1);
    const x = a("tasks", 1_700_000_000_000);
    expect(x).toBe(b("tasks", 1_700_000_000_000));
    expect(isIdOf("tasks", x)).toBe(true);
    expect(x).toMatch(/^tsk_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("倒计时和日期的字（北京时间）", () => {
    expect(countdownZh(2 * 3600_000 + 5 * 60_000)).toMatchObject({ text: "还剩 2 小时 5 分", big: "02:05", overdue: false });
    expect(countdownZh(-26 * 3600_000).text).toBe("超时 1 天 2 小时");
    expect(dateTimeZh("2026-10-23T02:00:00.000Z")).toBe("10月23日 10:00");
    expect(addHours("2026-10-23T02:00:00.000Z", 1.5)).toBe("2026-10-23T03:30:00.000Z");
  });

  it("排序只比 ASCII，最后按 id", () => {
    const rows = [{ id: "b", n: 2 }, { id: "a", n: 2 }, { id: "c", n: 1 }];
    expect(rows.sort(compareBy<{ id: string; n: number }>((r) => numberKey(r.n))).map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(cmp("C010", "C009")).toBe(1);
  });

  it("重放：同样的日志在底上重放出同样的世界；别的世界的条目跳过", () => {
    const g = new TestGuild();
    const p = g.project(1, 2);
    g.passStage(p, "plan", g.admin, g.member("审审", "reviewer"));
    const r = replay(emptyWorldState(), g.state.journal, WORLD);
    expect(r.skipped).toEqual([]);
    expect(r.state.tasks).toEqual(g.state.tasks);
    const other = replay(emptyWorldState(), g.state.journal.slice(0, 1).map((e) => ({ ...e, worldId: "wld_other" })), WORLD);
    expect(other.skipped[0].reason).toBe("other_world");
  });

  it("不认识的命令被拒，给中文原因", () => {
    const r = dispatch(emptyWorldState(), { worldId: WORLD, accountId: null, actorMemberId: null }, "nope" as "task.claim", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/没有这个操作/);
  });
});
