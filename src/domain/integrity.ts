/**
 * 引用完整性检查（以后上数据库时外键会管的，加上挂在不同对象上的意见要命令自己核的）。
 * 测试里每跑一条命令都查一遍；示范数据也查。
 */
import type { Id, TableName, WorldState } from "./model";
import { TABLE_NAMES } from "./model";

export interface IntegrityProblem {
  table: TableName | "journal";
  id: Id;
  field: string;
  problem: string;
}

/** field → table it must point to (null allowed unless listed in REQUIRED). */
const REFS: Partial<Record<TableName, Record<string, TableName>>> = {
  accounts: { memberId: "members" },
  enrollments: { memberId: "members" },
  stages: { projectId: "projects", reviewerId: "members" },
  cuts: { projectId: "projects" },
  tasks: { projectId: "projects", stageId: "stages", cutId: "cuts", assigneeId: "members" },
  submissions: { taskId: "tasks", byMemberId: "members", recordedById: "members" },
  reviews: { taskId: "tasks", submissionId: "submissions", byMemberId: "members" },
  threads: { projectId: "projects", cutId: "cuts", askMemberId: "members", byMemberId: "members", rulingId: "rulings" },
  rulings: { projectId: "projects", threadId: "threads", byMemberId: "members" },
  ledger: { memberId: "members", taskId: "tasks" },
  files: { projectId: "projects", cutId: "cuts", byMemberId: "members" },
  pins: { fileId: "files", projectId: "projects", cutId: "cuts", taskId: "tasks", reviewTaskId: "tasks", byMemberId: "members" },
  pages: { projectId: "projects", byMemberId: "members" },
  blocks: { pageId: "pages", byMemberId: "members" },
};

const REQUIRED = new Set([
  "accounts.memberId",
  "enrollments.memberId",
  "stages.projectId",
  "cuts.projectId",
  "tasks.projectId",
  "tasks.stageId",
  "submissions.taskId",
  "reviews.taskId",
  "reviews.submissionId",
  "reviews.byMemberId",
  "threads.projectId",
  "threads.byMemberId",
  "rulings.projectId",
  "rulings.byMemberId",
  "ledger.memberId",
  "files.projectId",
  "files.byMemberId",
  "pins.fileId",
  "pins.projectId",
  "pins.byMemberId",
  "pages.projectId",
  "blocks.pageId",
]);

const SUBJECT_TABLE = { project: "projects", cut: "cuts", task: "tasks", block: "blocks" } as const;
const FILE_SUBJECT_TABLE = { project: "projects", cut: "cuts", task: "tasks", submission: "submissions", page: "pages", thread: "threads" } as const;

export function checkIntegrity(state: WorldState): IntegrityProblem[] {
  const problems: IntegrityProblem[] = [];
  const worldIds = new Set(Object.keys(state.worlds));
  for (const table of TABLE_NAMES) {
    const rows = Object.values(state[table] as unknown as Record<Id, Record<string, unknown>>);
    for (const row of rows) {
      const id = row.id as Id;
      const add = (field: string, problem: string) => problems.push({ table, id, field, problem });
      if (!worldIds.has(row.worldId as Id)) add("worldId", "unknown world");
      if (typeof row.version !== "number" || row.version < 1) add("version", "bad version");
      for (const [field, target] of Object.entries(REFS[table] ?? {})) {
        const v = row[field] as Id | null | undefined;
        if (v === null || v === undefined) {
          if (REQUIRED.has(`${table}.${field}`)) add(field, "missing required reference");
          continue;
        }
        const t = (state[target] as Record<Id, { worldId: Id }>)[v];
        if (!t) add(field, `→ ${target}/${v} does not exist`);
        else if (t.worldId !== row.worldId) add(field, `→ ${target}/${v} is in another world`);
      }
    }
  }
  for (const t of Object.values(state.threads)) {
    const target = SUBJECT_TABLE[t.subjectType];
    const row = target ? (state[target] as Record<Id, { worldId: Id }>)[t.subjectId] : undefined;
    if (!row) problems.push({ table: "threads", id: t.id, field: "subjectId", problem: `→ ${t.subjectType}/${t.subjectId} does not exist` });
  }
  for (const f of Object.values(state.files)) {
    const target = FILE_SUBJECT_TABLE[f.subjectType];
    const row = target ? (state[target] as Record<Id, { worldId: Id }>)[f.subjectId] : undefined;
    if (!row) problems.push({ table: "files", id: f.id, field: "subjectId", problem: `→ ${f.subjectType}/${f.subjectId} does not exist` });
    if (!/^[0-9a-f]{64}$/.test(f.sha256)) problems.push({ table: "files", id: f.id, field: "sha256", problem: "not a sha256" });
  }
  for (const p of Object.values(state.pins)) {
    const f = state.files[p.fileId];
    if (f && f.projectId !== p.projectId) problems.push({ table: "pins", id: p.id, field: "projectId", problem: "pin is in another project than its file" });
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) problems.push({ table: "pins", id: p.id, field: "x", problem: "position out of the image" });
  }
  for (const b of Object.values(state.blocks)) {
    for (const fid of b.fileIds) if (!state.files[fid]) problems.push({ table: "blocks", id: b.id, field: "fileIds", problem: `→ files/${fid} does not exist` });
  }
  for (const t of Object.values(state.tasks)) {
    const stage = state.stages[t.stageId];
    if (stage && stage.projectId !== t.projectId) problems.push({ table: "tasks", id: t.id, field: "stageId", problem: "stage is in another project" });
    const cut = t.cutId ? state.cuts[t.cutId] : undefined;
    if (cut && cut.projectId !== t.projectId) problems.push({ table: "tasks", id: t.id, field: "cutId", problem: "cut is in another project" });
    if (stage && stage.grain === "project" && t.cutId) problems.push({ table: "tasks", id: t.id, field: "cutId", problem: "project-level task has a cut" });
    if (stage && stage.grain !== "project" && !t.cutId) problems.push({ table: "tasks", id: t.id, field: "cutId", problem: "per-cut task without a cut" });
    if (stage && stage.grain === "layer" && !t.layer) problems.push({ table: "tasks", id: t.id, field: "layer", problem: "layer task without a layer" });
    const active = t.status === "claimed" || t.status === "returned";
    if (active && !t.assigneeId && !t.outsourced) problems.push({ table: "tasks", id: t.id, field: "assigneeId", problem: "task in hand without anyone" });
    if ((t.status === "open" || t.status === "locked") && t.assigneeId) problems.push({ table: "tasks", id: t.id, field: "assigneeId", problem: "free task still has an assignee" });
  }
  const versions = new Map<string, number>();
  for (const s of Object.values(state.submissions)) {
    const key = `${s.taskId}#${s.versionNo}`;
    versions.set(key, (versions.get(key) ?? 0) + 1);
    if ((versions.get(key) ?? 0) > 1) problems.push({ table: "submissions", id: s.id, field: "versionNo", problem: "two submissions with the same version" });
  }
  const logins = new Set<string>();
  for (const a of Object.values(state.accounts)) {
    if (a.archivedAt) continue;
    if (logins.has(a.login)) problems.push({ table: "accounts", id: a.id, field: "login", problem: "login is not unique" });
    logins.add(a.login);
  }
  let seq = 0;
  for (const e of state.journal) {
    if (e.seq !== seq + 1) problems.push({ table: "journal", id: e.id, field: "seq", problem: `gap at ${e.seq}` });
    seq = e.seq;
  }
  return problems;
}
