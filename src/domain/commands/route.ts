/**
 * v1.1（SPEC §17）：项目按环节分层。
 *   stage.assign · stage.unassign：在环节页里「指派一个人」/「撤掉」——写进项目人员表里管这个环节的职位
 *     （没有就按环节名加一个），开工以后的成员马上报到这个环节（标「指派」）。
 *   project.set_setup_step：开局向导做到第几步（离开再回来接着做）。
 */
import { DEFAULT_MAX_ACTIVE } from "../rules";
import type { Change, Id, ProjectRow, StaffPerson, StaffPosition, StageRow } from "../model";
import type { ReadModel } from "../readmodel";
import { uc } from "../text";
import { guarded, insert, mustAdmin, mustGet, ok, optText, rejectT, update, type Ctx } from "./core";

export interface StagePersonInput {
  stageId: Id;
  /** 成员；或者 name = 外部名字（不在工会里的人 / 外包）。 */
  memberId?: Id | null;
  name?: string | null;
}

/** 管这个环节的职位：人员表里 stageKeys 含这个环节的（第一个）。 */
function positionsFor(p: ProjectRow, stage: StageRow): StaffPosition[] {
  return (p.staff ?? []).filter((x) => x.stageKeys.includes(stage.templateKey));
}

function samePerson(a: StaffPerson, b: StaffPerson): boolean {
  if ("memberId" in a && "memberId" in b) return a.memberId === b.memberId;
  if ("name" in a && "name" in b) return a.name === b.name;
  return false;
}

function personOf(rm: ReadModel, ctx: Ctx, input: StagePersonInput): { person: StaffPerson; label: string } {
  if (input.memberId) {
    const m = mustGet(rm, ctx, "members", input.memberId, "成员");
    return { person: { memberId: m.id }, label: m.nickname };
  }
  const name = optText(input.name, 24);
  if (!name) rejectT("invalid", "stage_person_pick");
  return { person: { name }, label: name };
}

/** 在环节页里指派一个人：进人员表（管这个环节的职位），开工以后的成员马上报到这个环节。 */
export const assignStagePerson = guarded<StagePersonInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "指派职位");
  const stage = mustGet(rm, ctx, "stages", input.stageId, "环节");
  const p = mustGet(rm, ctx, "projects", stage.projectId, "项目");
  const { person, label } = personOf(rm, ctx, input);
  const staff = (p.staff ?? []).map((x) => ({ ...x, people: [...x.people] }));
  let pos = staff.find((x) => x.stageKeys.includes(stage.templateKey));
  if (!pos) {
    // 这个环节在人员表里还没有职位（例如后来插进来的环节）：按环节名加一个。
    pos = { key: `s-${stage.templateKey}`, custom: { name: stage.name, desc: null }, stageKeys: [stage.templateKey], people: [] };
    staff.push(pos);
  }
  if (positionsFor({ ...p, staff }, stage).some((x) => x.people.some((y) => samePerson(y, person)))) rejectT("invalid", "stage_person_dup", { name: uc(label) });
  if (pos.people.length >= 8) rejectT("invalid", "staff_too_many", { max: 8 });
  pos.people.push(person);
  const changes: Change[] = [];
  const ch = update("projects", p, { staff });
  if (ch) changes.push(ch);
  if ("memberId" in person && p.status !== "zero") {
    const e = rm.where("enrollments", { memberId: person.memberId, group: p.group, stageKey: stage.templateKey })[0];
    if (e) {
      const c = e.assigned ? null : update("enrollments", e, { assigned: true });
      if (c) changes.push(c);
    } else {
      changes.push(insert(ctx, "enrollments", { memberId: person.memberId, group: p.group, stageKey: stage.templateKey, skill: 0, maxActive: DEFAULT_MAX_ACTIVE, origin: "assigned" as const, assigned: true }).change);
    }
  }
  return ok(changes, { projectId: p.id, stageId: stage.id });
});

/** 撤掉：从管这个环节的职位里拿掉；是因为指派才报到的成员取消报到（自己报到过的只去掉「指派」）。手上的任务不动。 */
export const unassignStagePerson = guarded<StagePersonInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "撤掉职位");
  const stage = mustGet(rm, ctx, "stages", input.stageId, "环节");
  const p = mustGet(rm, ctx, "projects", stage.projectId, "项目");
  const { person, label } = personOf(rm, ctx, input);
  let found = false;
  const staff = (p.staff ?? []).map((x) => {
    if (!x.stageKeys.includes(stage.templateKey)) return x;
    const people = x.people.filter((y) => !samePerson(y, person));
    if (people.length !== x.people.length) found = true;
    return { ...x, people };
  });
  if (!found) rejectT("state", "stage_person_missing", { name: uc(label) });
  const changes: Change[] = [];
  const ch = update("projects", p, { staff });
  if (ch) changes.push(ch);
  if ("memberId" in person) {
    const e = rm.where("enrollments", { memberId: person.memberId, group: p.group, stageKey: stage.templateKey })[0];
    if (e?.assigned) {
      if ((e.origin ?? "self") === "assigned") changes.push({ op: "archive", table: "enrollments", id: e.id, expectVersion: e.version });
      else {
        const c = update("enrollments", e, { assigned: false });
        if (c) changes.push(c);
      }
    }
  }
  return ok(changes, { projectId: p.id, stageId: stage.id });
});

export interface SetupStepInput {
  projectId: Id;
  step: number;
}

/** 开局向导做到第几步（存在项目上；向导打开时从这一步接着做）。 */
export const setSetupStep = guarded<SetupStepInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "开局");
  const p = mustGet(rm, ctx, "projects", input.projectId, "项目");
  if (p.status !== "zero") rejectT("state", "setup_not_zero");
  const step = Number(input.step);
  if (!Number.isInteger(step) || step < 1 || step > 5) rejectT("invalid", "setup_step_bad");
  const c = update("projects", p, { setupStep: step });
  return ok(c ? [c] : [], { projectId: p.id });
});
