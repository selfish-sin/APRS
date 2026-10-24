/** 测试用的小工会：确定的 id、能拨的世界时钟、每跑一步都查引用完整性。 */
import { expect } from "vitest";
import { atWorldClock } from "@/domain/clock";
import type { CommandInput, CommandName } from "@/domain/commands";
import { dispatch, type DispatchResult } from "@/domain/dispatch";
import { seededIds } from "@/domain/ids";
import { checkIntegrity } from "@/domain/integrity";
import { emptyWorldState, type Id, type IsoDateTime, type WorldState } from "@/domain/model";
import { hashPasscodeSync } from "./hash";

export const WORLD = "wld_test";
export const SALT = "00112233445566778899aabbccddeeff";

export class TestGuild {
  state: WorldState = emptyWorldState();
  private ids = seededIds(7);
  now: IsoDateTime = atWorldClock("2026-10-01", "10:00");
  admin: Id = "";
  adminAccount: Id = "";

  constructor() {
    const r = this.run(null, "guild.create", { title: "测试工会", nickname: "管理", login: "boss", salt: SALT, hash: hashPasscodeSync(SALT, "secret-1") });
    this.admin = r.memberId;
    this.adminAccount = r.accountId;
  }

  /** 拨世界时钟（小时）。查询读的是世界规则里冻结的时钟，所以一起改。 */
  advance(hours: number) {
    this.now = new Date(Date.parse(this.now) + hours * 3600_000).toISOString();
    this.freeze();
  }

  private freeze() {
    const w = this.state.worlds[WORLD];
    if (!w) return;
    this.state = { ...this.state, worlds: { ...this.state.worlds, [WORLD]: { ...w, rules: { ...w.rules, clock: { fixedNow: this.now } } } } };
  }

  try<N extends CommandName>(member: Id | null, name: N, input: CommandInput<N>): DispatchResult {
    const r = dispatch(this.state, { worldId: WORLD, accountId: null, actorMemberId: member }, name, input, {
      now: this.now,
      worldNow: this.now,
      newId: (t) => this.ids(t, Date.parse(this.now)),
    });
    if (r.ok) {
      this.state = r.state;
      this.freeze();
      expect(checkIntegrity(this.state), `${name} 之后引用对不上`).toEqual([]);
    }
    return r;
  }

  run<N extends CommandName>(member: Id | null, name: N, input: CommandInput<N>): Record<string, Id> {
    const r = this.try(member, name, input);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    return r.created;
  }

  /** 期望被拒，返回中文原因。 */
  reject<N extends CommandName>(member: Id | null, name: N, input: CommandInput<N>): string {
    const r = this.try(member, name, input);
    expect(r.ok, `${name} 应该被拒`).toBe(false);
    if (r.ok) return "";
    expect(r.error.message).toMatch(/[一-龥]/);
    return r.error.message;
  }

  member(nickname: string, role: "admin" | "reviewer" | "member" = "member"): Id {
    return this.run(this.admin, "member.join", { nickname, role }).memberId;
  }

  /** 一个小动画项目：n 卡，A / B 两层，各 `sheets` 张。 */
  project(n = 2, sheets = 4, code = "TEST"): Id {
    return this.run(this.admin, "project.create", {
      group: "animation",
      name: "测试项目",
      code,
      startOn: "2026-10-01",
      planEndOn: "2026-12-31",
      cuts: Array.from({ length: n }, (_, i) => ({ number: i + 1, layers: [{ name: "A", sheets }, { name: "B", sheets }], seconds: 4, keySheets: 2 })),
    }).projectId;
  }

  stage(projectId: Id, key: string) {
    const s = Object.values(this.state.stages).find((x) => x.projectId === projectId && x.templateKey === key);
    if (!s) throw new Error(`no stage ${key}`);
    return s;
  }

  task(projectId: Id, key: string, cut: number | null = null, layer: string | null = null) {
    const stage = this.stage(projectId, key);
    const cutRow = cut === null ? null : Object.values(this.state.cuts).find((c) => c.projectId === projectId && c.number === cut);
    const t = Object.values(this.state.tasks).find((x) => x.stageId === stage.id && x.cutId === (cutRow?.id ?? null) && x.layer === layer);
    if (!t) throw new Error(`no task ${key} ${cut} ${layer}`);
    return t;
  }

  /** 让一个环节的全部任务都通过（直接跑命令，用来铺好上游）。 */
  passStage(projectId: Id, key: string, worker: Id, reviewer: Id) {
    const stage = this.stage(projectId, key);
    if (!Object.values(this.state.enrollments).some((e) => e.memberId === worker && e.stageKey === key)) {
      this.run(worker, "enroll.add", { group: "animation", stageKey: key, skill: 0, maxActive: 9 });
    }
    for (const t of Object.values(this.state.tasks).filter((x) => x.stageId === stage.id)) {
      const cur = this.state.tasks[t.id];
      if (cur.status === "passed") continue;
      if (cur.status === "open") this.run(worker, "task.claim", { taskId: t.id });
      if (this.state.tasks[t.id].assigneeId !== worker) continue;
      this.run(worker, "task.submit", { taskId: t.id, note: "好了" });
      this.run(reviewer, "task.review", { taskId: t.id, verdict: "pass", quality: 1 });
    }
  }
}
