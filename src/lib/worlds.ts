/**
 * 工会的底 + 日志 = 世界。
 *   demo  = 示范工会（src/data/demo.ts，每次打开在代码里重新建，示范数据更新能到每个浏览器）
 *   empty = 空的（建工会那一步本身就是日志的第一条）
 * 浏览器只存底之后的日志；加载时在底上重放（对不上的留在 skipped，不丢）。
 */
import { buildDemoWorld, DEMO_TITLE, DEMO_WORLD_ID } from "@/data/demo";
import { lastSeq, replay } from "@/domain/dispatch";
import { emptyWorldState, type Id, type JournalEntry, type WorldState } from "@/domain/model";
import type { WorldBase } from "@/lib/migrations";

export { DEMO_TITLE, DEMO_WORLD_ID };

export function baseWorld(base: WorldBase): WorldState {
  return base === "demo" ? buildDemoWorld() : emptyWorldState();
}

export function baseSeq(base: WorldBase): number {
  return lastSeq(baseWorld(base));
}

/** 底之后的日志（属于这台设备的那部分）。 */
export function ownJournal(state: WorldState, base: WorldBase): JournalEntry[] {
  const seq = baseSeq(base);
  return state.journal.filter((e) => e.seq > seq);
}

export interface Rebuilt {
  state: WorldState;
  applied: number;
  skipped: { entry: JournalEntry; reason: string }[];
}

/** 在底上重放存下来的日志；以前就没对上的（previouslySkipped）原样留着。 */
export function rebuildWorld(base: WorldBase, worldId: Id, journal: JournalEntry[], previouslySkipped: JournalEntry[] = []): Rebuilt {
  const report = replay(baseWorld(base), journal, worldId);
  const reasons = new Map(report.skipped.map((x) => [x.seq, x.reason]));
  return {
    state: report.state,
    applied: report.applied,
    skipped: [
      ...previouslySkipped.map((entry) => ({ entry, reason: "earlier" })),
      ...journal.filter((e) => reasons.has(e.seq)).map((entry) => ({ entry, reason: reasons.get(entry.seq) ?? "unknown" })),
    ],
  };
}
