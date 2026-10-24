/**
 * 查询（读用查询，写用命令）。页面只调这里的函数，不自己遍历表、不拼业务规则。
 *
 * pipelineOf 三段进度 · gridOf 卡 × 环节网格 · questFor 我的任务单 · indicatorOf 指示器 ·
 * reviewQueue 待审队列 · growthOf 成长 · collaboratorsOf 合作过 · timelineOfCut 卡的时间线 ·
 * inboxOf 等我处理 · feedOf 工会动态 · enrollOptions 报到页 · dispatchPlan 枢纽派发 · …
 *
 * 排序只比 ASCII（agenda.ts）；时间都是世界时间（worldNow）。
 */
import { cmp, compareBy, layerKey, numberKey, timeKey } from "./agenda";
import { addDays, countdownZh, daysBetween, localDate, msBetween, weekStartOf, worldNow } from "./clock";
import { upstreamTasksOf, hubScope } from "./flow";
import { GROUP_LABEL, TASK_STATUS_LABEL, THREAD_KIND_LABEL, VERDICT_LABEL, formatNumber, formatPoints } from "./labels";
import type {
  AccountRow,
  BlockRow,
  CutRow,
  FileRow,
  PageRow,
  PinRow,
  EnrollmentRow,
  Group,
  Id,
  IsoDateTime,
  JournalEntry,
  LedgerRow,
  MemberRow,
  Phase,
  ProjectRow,
  ReviewRow,
  RulingRow,
  StageRow,
  SubmissionLink,
  SubmissionRow,
  TaskRow,
  TaskStatus,
  ThreadRow,
  Verdict,
  WorldRow,
  WorldState,
} from "./model";
import { ACTIVE_STATUS, PHASE } from "./model";
import { EXTRA_KIND_TEXT, cutCode, cutCode2, fileNameFor, folderFor, stageParam, taskLabel, taskLabelP } from "./naming";
import { phrase, phraseText, t2, uc, type Phrase, type Text2, type TextParam } from "./text";
import { HOURS_PER_DAY, deadlineFactorOf, hoursOf, levelOf, rateFor, rewardOf, stageLocked, taskPoints, taskRate, type LevelInfo } from "./rules";
import { GROUPS, groupTemplate, type StageTemplate } from "./templates";
import { isAdmin, isReviewer } from "./commands/core";
import { linksOf } from "./commands/links";
import { PROJECT_TEMPLATES, positionTemplate } from "./positions";

// ---------------------------------------------------------------------------
// 索引（每个世界状态建一次）
// ---------------------------------------------------------------------------

interface Index {
  world: WorldRow | undefined;
  now: IsoDateTime;
  members: MemberRow[];
  memberById: Map<Id, MemberRow>;
  accounts: AccountRow[];
  projects: ProjectRow[];
  projectById: Map<Id, ProjectRow>;
  stagesByProject: Map<Id, StageRow[]>;
  stageById: Map<Id, StageRow>;
  cutsByProject: Map<Id, CutRow[]>;
  cutById: Map<Id, CutRow>;
  tasks: TaskRow[];
  taskById: Map<Id, TaskRow>;
  tasksByProject: Map<Id, TaskRow[]>;
  tasksByStage: Map<Id, TaskRow[]>;
  tasksByCut: Map<Id, TaskRow[]>;
  /** 随时发的新任务（SPEC §13.3）。 */
  extras: TaskRow[];
  extrasByStage: Map<Id, TaskRow[]>;
  extrasByCut: Map<Id, TaskRow[]>;
  subsByTask: Map<Id, SubmissionRow[]>;
  reviewsByTask: Map<Id, ReviewRow[]>;
  threads: ThreadRow[];
  rulings: RulingRow[];
  ledgerByMember: Map<Id, LedgerRow[]>;
  enrollments: EnrollmentRow[];
  files: FileRow[];
  fileById: Map<Id, FileRow>;
  pins: PinRow[];
  pinsByFile: Map<Id, PinRow[]>;
  pages: PageRow[];
  blocksByPage: Map<Id, BlockRow[]>;
}

const INDEX = new WeakMap<WorldState, Index>();

function live<T extends { archivedAt: string | null }>(rows: Record<Id, T>): T[] {
  return Object.values(rows).filter((r) => !r.archivedAt);
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

const byNumber = compareBy<CutRow>((c) => numberKey(c.number), (c) => c.suffix ?? "");
const bySort = compareBy<StageRow>((s) => s.sort);
const taskOrder = compareBy<TaskRow>((t) => t.sort, (t) => layerKey(t.layer));

export function indexOf(state: WorldState): Index {
  const hit = INDEX.get(state);
  if (hit) return hit;
  const world = Object.values(state.worlds)[0];
  const members = live(state.members).sort(compareBy<MemberRow>((m) => timeKey(m.joinedAt)));
  const projects = live(state.projects).sort(compareBy<ProjectRow>((p) => p.startOn, (p) => timeKey(p.createdAt)));
  const stages = live(state.stages);
  const cuts = live(state.cuts);
  const tasks = live(state.tasks).sort(taskOrder);
  const idx: Index = {
    world,
    now: worldNow(world),
    members,
    memberById: new Map(members.map((m) => [m.id, m])),
    accounts: live(state.accounts).sort(compareBy<AccountRow>((a) => a.login)),
    projects,
    projectById: new Map(projects.map((p) => [p.id, p])),
    stagesByProject: new Map(),
    stageById: new Map(stages.map((s) => [s.id, s])),
    cutsByProject: new Map(),
    cutById: new Map(cuts.map((c) => [c.id, c])),
    tasks,
    taskById: new Map(tasks.map((t) => [t.id, t])),
    tasksByProject: new Map(),
    tasksByStage: new Map(),
    tasksByCut: new Map(),
    extras: [],
    extrasByStage: new Map(),
    extrasByCut: new Map(),
    subsByTask: new Map(),
    reviewsByTask: new Map(),
    threads: live(state.threads).sort(compareBy<ThreadRow>((t) => timeKey(t.at))),
    rulings: live(state.rulings).sort(compareBy<RulingRow>((r) => timeKey(r.at))),
    ledgerByMember: new Map(),
    enrollments: live(state.enrollments).sort(compareBy<EnrollmentRow>((e) => timeKey(e.createdAt))),
    files: live(state.files ?? {}).sort(compareBy<FileRow>((f) => timeKey(f.at), (f) => timeKey(f.createdAt))),
    fileById: new Map(),
    pins: live(state.pins ?? {}).sort(compareBy<PinRow>((p) => timeKey(p.at))),
    pinsByFile: new Map(),
    pages: live(state.pages ?? {}).sort(compareBy<PageRow>((p) => timeKey(p.at), (p) => timeKey(p.createdAt))),
    blocksByPage: new Map(),
  };
  for (const f of idx.files) idx.fileById.set(f.id, f);
  for (const p of idx.pins) push(idx.pinsByFile, p.fileId, p);
  for (const list of Array.from(idx.pinsByFile.values())) list.sort((a, b) => a.number - b.number);
  for (const b of live(state.blocks ?? {})) push(idx.blocksByPage, b.pageId, b);
  for (const list of Array.from(idx.blocksByPage.values())) list.sort((a, b) => a.sort - b.sort || cmp(a.id, b.id));
  for (const s of stages) push(idx.stagesByProject, s.projectId, s);
  for (const list of Array.from(idx.stagesByProject.values())) list.sort(bySort);
  for (const c of cuts) push(idx.cutsByProject, c.projectId, c);
  for (const list of Array.from(idx.cutsByProject.values())) list.sort(byNumber);
  for (const t of tasks) {
    if (t.extra) {
      // 随时发的新任务（额外 · 修正 · 补设定）不进流程的统计；另外按环节、按挂着的卡收。
      idx.extras.push(t);
      push(idx.extrasByStage, t.stageId, t);
      for (const cid of t.extra.cutIds) push(idx.extrasByCut, cid, t);
      continue;
    }
    push(idx.tasksByProject, t.projectId, t);
    push(idx.tasksByStage, t.stageId, t);
    if (t.cutId) push(idx.tasksByCut, t.cutId, t);
  }
  for (const s of live(state.submissions)) push(idx.subsByTask, s.taskId, s);
  for (const list of Array.from(idx.subsByTask.values())) list.sort((a, b) => a.versionNo - b.versionNo);
  for (const r of live(state.reviews)) push(idx.reviewsByTask, r.taskId, r);
  for (const list of Array.from(idx.reviewsByTask.values())) list.sort(compareBy<ReviewRow>((r) => timeKey(r.at), (r) => timeKey(r.createdAt)));
  for (const l of live(state.ledger)) push(idx.ledgerByMember, l.memberId, l);
  for (const list of Array.from(idx.ledgerByMember.values())) list.sort(compareBy<LedgerRow>((l) => timeKey(l.at), (l) => timeKey(l.createdAt)));
  INDEX.set(state, idx);
  return idx;
}

// ---------------------------------------------------------------------------
// 基本的读
// ---------------------------------------------------------------------------

export function theWorld(state: WorldState): WorldRow | undefined {
  return indexOf(state).world;
}

/** 世界的「现在」（示范工会冻结在 2026-10-23）。 */
export function nowOf(state: WorldState): IsoDateTime {
  return indexOf(state).now;
}

export function todayOf(state: WorldState): string {
  return localDate(nowOf(state));
}

export function members(state: WorldState): MemberRow[] {
  return indexOf(state).members;
}

export function memberById(state: WorldState, id: Id | null | undefined): MemberRow | undefined {
  return id ? indexOf(state).memberById.get(id) : undefined;
}

export function accounts(state: WorldState): AccountRow[] {
  return indexOf(state).accounts;
}

export function accountOfMember(state: WorldState, memberId: Id): AccountRow | undefined {
  return indexOf(state).accounts.find((a) => a.memberId === memberId);
}

export function projects(state: WorldState, group?: Group): ProjectRow[] {
  const all = indexOf(state).projects;
  return group ? all.filter((p) => p.group === group) : all;
}

export function projectById(state: WorldState, id: Id | null | undefined): ProjectRow | undefined {
  return id ? indexOf(state).projectById.get(id) : undefined;
}

export function stagesOf(state: WorldState, projectId: Id): StageRow[] {
  return indexOf(state).stagesByProject.get(projectId) ?? [];
}

export function stageById(state: WorldState, id: Id | null | undefined): StageRow | undefined {
  return id ? indexOf(state).stageById.get(id) : undefined;
}

export function cutsOf(state: WorldState, projectId: Id): CutRow[] {
  return indexOf(state).cutsByProject.get(projectId) ?? [];
}

export function cutById(state: WorldState, id: Id | null | undefined): CutRow | undefined {
  return id ? indexOf(state).cutById.get(id) : undefined;
}

export function taskById(state: WorldState, id: Id | null | undefined): TaskRow | undefined {
  return id ? indexOf(state).taskById.get(id) : undefined;
}

export function tasksOf(state: WorldState, projectId: Id): TaskRow[] {
  return indexOf(state).tasksByProject.get(projectId) ?? [];
}

export function submissionsOf(state: WorldState, taskId: Id): SubmissionRow[] {
  return indexOf(state).subsByTask.get(taskId) ?? [];
}

export function reviewsOf(state: WorldState, taskId: Id): ReviewRow[] {
  return indexOf(state).reviewsByTask.get(taskId) ?? [];
}

export function enrollmentsOf(state: WorldState, memberId: Id): EnrollmentRow[] {
  return indexOf(state).enrollments.filter((e) => e.memberId === memberId);
}

export function cutName(state: WorldState, cut: CutRow): string {
  return cutCode(cut, projectById(state, cut.projectId)?.group);
}

/** 计划结束已经过了、项目还没完成 = 逾期。 */
export function isOverdueProject(state: WorldState, p: ProjectRow): boolean {
  return p.status !== "done" && p.planEndOn < todayOf(state);
}

// ---------------------------------------------------------------------------
// 任务的样子
// ---------------------------------------------------------------------------

export interface TaskView {
  task: TaskRow;
  stage: StageRow;
  project: ProjectRow;
  cut: CutRow | null;
  /** 「C009 · 中割 · B 层」 */
  label: string;
  /** 两种语言的 label。 */
  labelP: Phrase;
  /** 「安娜的旅程 · C009 · 中割 · B 层」 */
  title: string;
  titleP: Phrase;
  statusLabel: string;
  assignee: MemberRow | null;
  /** 外包时的名字。 */
  outsourceName: string | null;
  latest: SubmissionRow | null;
  /** 「v03」或 null。 */
  versionTag: string | null;
  /** 工作量的字：「20 张」。 */
  workloadLabel: string;
  workloadP: Phrase;
}

export function workloadLabel(stage: StageRow, workload: number, group?: Group): string {
  const unit = groupUnitLabel(stage, group);
  return `${formatNumber(workload)} ${unit}`;
}

function groupUnitLabel(stage: StageRow, group?: Group): string {
  if (group === "video" && stage.unit === "cut") return "期";
  return { sheet: "张", second: "秒", cut: "卡", item: "项" }[stage.unit];
}

const UNIT_EN: Record<string, [string, string]> = { sheet: ["drawing", "drawings"], second: ["sec", "sec"], cut: ["cut", "cuts"], item: ["item", "items"], episode: ["episode", "episodes"] };

/** 工作量（两种语言）：「20 张」/「20 drawings」。 */
export function workloadP(stage: Pick<StageRow, "unit">, workload: number, group?: Group): Phrase {
  const zh = group === "video" && stage.unit === "cut" ? "期" : { sheet: "张", second: "秒", cut: "卡", item: "项" }[stage.unit];
  const [one, other] = UNIT_EN[group === "video" && stage.unit === "cut" ? "episode" : stage.unit];
  return phrase(`{n} ${zh}`, `{n} {n|${one}|${other}}`, { n: Math.round(workload * 10) / 10 });
}

export function taskView(state: WorldState, task: TaskRow): TaskView | null {
  const idx = indexOf(state);
  const stage = idx.stageById.get(task.stageId);
  const project = idx.projectById.get(task.projectId);
  if (!stage || !project) return null;
  const cut = task.cutId ? idx.cutById.get(task.cutId) ?? null : null;
  const label = taskLabel(stage, cut, task, project.group);
  const labelP = taskLabelP(stage, cut, task, project.group);
  const subs = idx.subsByTask.get(task.id) ?? [];
  const latest = subs.length ? subs[subs.length - 1] : null;
  return {
    task,
    stage,
    project,
    cut,
    label,
    labelP,
    title: `${project.name} · ${label}`,
    titleP: phrase("{project} · {label}", "{project} · {label}", { project: uc(project.name), label: labelP }),
    statusLabel: TASK_STATUS_LABEL[task.status],
    assignee: task.assigneeId ? idx.memberById.get(task.assigneeId) ?? null : null,
    outsourceName: task.outsourced ? task.outsourceName : null,
    latest,
    versionTag: latest ? `v${String(latest.versionNo).padStart(2, "0")}` : null,
    workloadLabel: workloadLabel(stage, task.workload, project.group),
    workloadP: workloadP(stage, task.workload, project.group),
  };
}

export function taskViewById(state: WorldState, id: Id | null | undefined): TaskView | null {
  const t = taskById(state, id);
  return t ? taskView(state, t) : null;
}

/** 卡住了：退回的、快到时限（24 小时内）或已经超时的。 */
export function isStuck(state: WorldState, task: TaskRow): boolean {
  if (task.status === "returned") return true;
  if (task.status === "claimed" && task.dueAt) {
    return msBetween(nowOf(state), task.dueAt) < 24 * 3600_000;
  }
  return false;
}

export function overdueTasks(state: WorldState): TaskRow[] {
  const now = Date.parse(nowOf(state));
  return indexOf(state).tasks.filter((t) => ACTIVE_STATUS.includes(t.status) && !!t.dueAt && Date.parse(t.dueAt) < now);
}

// ---------------------------------------------------------------------------
// 三段进度
// ---------------------------------------------------------------------------

export type NodeState = "locked" | "open" | "active" | "done";

export interface StageNode {
  stage: StageRow;
  counts: Record<TaskStatus, number>;
  total: number;
  passed: number;
  progress: number;
  state: NodeState;
  /** 报到了这个环节的人数。 */
  enrolled: number;
}

export interface PhaseView {
  phase: Phase;
  stages: StageNode[];
  total: number;
  passed: number;
  progress: number;
  state: NodeState;
}

export interface Pipeline {
  project: ProjectRow;
  phases: PhaseView[];
  total: number;
  passed: number;
  progress: number;
  pendingReview: number;
  cuts: number;
  overdue: boolean;
}

function emptyCounts(): Record<TaskStatus, number> {
  return { locked: 0, open: 0, claimed: 0, submitted: 0, returned: 0, passed: 0, reclaimed: 0 };
}

function nodeState(counts: Record<TaskStatus, number>, total: number): NodeState {
  if (total > 0 && counts.passed === total) return "done";
  if (counts.claimed + counts.submitted + counts.returned + counts.passed > 0) return "active";
  if (counts.open > 0) return "open";
  return "locked";
}

export function pipelineOf(state: WorldState, projectId: Id): Pipeline | null {
  const idx = indexOf(state);
  const project = idx.projectById.get(projectId);
  if (!project) return null;
  const stages = idx.stagesByProject.get(projectId) ?? [];
  const nodes: StageNode[] = stages.map((stage) => {
    const tasks = idx.tasksByStage.get(stage.id) ?? [];
    const counts = emptyCounts();
    for (const t of tasks) counts[t.status] += 1;
    const total = tasks.length;
    const enrolled = new Set(idx.enrollments.filter((e) => e.group === project.group && e.stageKey === stage.templateKey).map((e) => e.memberId)).size;
    return { stage, counts, total, passed: counts.passed, progress: total ? counts.passed / total : 0, state: nodeState(counts, total), enrolled };
  });
  const phases: PhaseView[] = PHASE.map((phase) => {
    const list = nodes.filter((n) => n.stage.phase === phase);
    const total = list.reduce((n, s) => n + s.total, 0);
    const passed = list.reduce((n, s) => n + s.passed, 0);
    const counts = emptyCounts();
    for (const s of list) for (const k of Object.keys(counts) as TaskStatus[]) counts[k] += s.counts[k];
    return { phase, stages: list, total, passed, progress: total ? passed / total : 0, state: nodeState(counts, total) };
  });
  const total = nodes.reduce((n, s) => n + s.total, 0);
  const passed = nodes.reduce((n, s) => n + s.passed, 0);
  return {
    project,
    phases,
    total,
    passed,
    progress: total ? passed / total : 0,
    pendingReview: nodes.reduce((n, s) => n + s.counts.submitted, 0),
    cuts: (idx.cutsByProject.get(projectId) ?? []).length,
    overdue: isOverdueProject(state, project),
  };
}

// ---------------------------------------------------------------------------
// 卡 × 环节网格
// ---------------------------------------------------------------------------

export type GridFilter = "all" | "mine" | "review" | "stuck";

export interface GridTask {
  task: TaskRow;
  assignee: MemberRow | null;
  versionTag: string | null;
  stuck: boolean;
  mine: boolean;
}

export interface GridCell {
  stage: StageRow;
  tasks: GridTask[];
  /** 合起来的状态（几层里最要紧的那个）。 */
  status: TaskStatus | null;
  /** 挂在这一格上的额外 / 修正 / 补设定任务（格子右上角的小数字）。 */
  extras: TaskRow[];
}

export interface GridRow {
  cut: CutRow;
  code: string;
  cells: GridCell[];
  stuck: boolean;
  /** 这一卡开着的「要补」/ 提问有几条。 */
  openThreads: number;
}

export interface Grid {
  project: ProjectRow;
  /** 项目级的环节（每个一格，放在网格上面一排）。 */
  projectCells: GridCell[];
  /** 每卡的环节（网格的列）。 */
  columns: StageRow[];
  rows: GridRow[];
  /** 筛掉了几行。 */
  hidden: number;
}

const URGENCY: TaskStatus[] = ["returned", "submitted", "claimed", "open", "reclaimed", "locked", "passed"];

export function cellStatus(tasks: { task: TaskRow }[]): TaskStatus | null {
  if (!tasks.length) return null;
  if (tasks.every((t) => t.task.status === "passed")) return "passed";
  for (const s of URGENCY) if (tasks.some((t) => t.task.status === s)) return s;
  return null;
}

function gridTask(state: WorldState, task: TaskRow, memberId: Id | null): GridTask {
  const idx = indexOf(state);
  const subs = idx.subsByTask.get(task.id) ?? [];
  const latest = subs[subs.length - 1];
  return {
    task,
    assignee: task.assigneeId ? idx.memberById.get(task.assigneeId) ?? null : null,
    versionTag: latest ? `v${String(latest.versionNo).padStart(2, "0")}` : null,
    stuck: isStuck(state, task),
    mine: !!memberId && (task.assigneeId === memberId || subs.some((s) => s.byMemberId === memberId)),
  };
}

export function gridOf(state: WorldState, projectId: Id, filter: GridFilter = "all", memberId: Id | null = null): Grid | null {
  const idx = indexOf(state);
  const project = idx.projectById.get(projectId);
  if (!project) return null;
  const stages = idx.stagesByProject.get(projectId) ?? [];
  const columns = stages.filter((s) => s.grain !== "project");
  const projectCells: GridCell[] = stages
    .filter((s) => s.grain === "project")
    .map((stage) => {
      const tasks = (idx.tasksByStage.get(stage.id) ?? []).map((t) => gridTask(state, t, memberId));
      return { stage, tasks, status: cellStatus(tasks), extras: idx.extrasByStage.get(stage.id) ?? [] };
    });
  const openByCut = new Map<Id, number>();
  for (const t of idx.threads) if (t.cutId && t.status === "open" && (t.kind === "todo" || t.kind === "ask")) openByCut.set(t.cutId, (openByCut.get(t.cutId) ?? 0) + 1);
  const all: GridRow[] = (idx.cutsByProject.get(projectId) ?? []).map((cut) => {
    const cutTasks = idx.tasksByCut.get(cut.id) ?? [];
    const cutExtras = idx.extrasByCut.get(cut.id) ?? [];
    const cells = columns.map((stage) => {
      const tasks = cutTasks.filter((t) => t.stageId === stage.id).map((t) => gridTask(state, t, memberId));
      return { stage, tasks, status: cellStatus(tasks), extras: cutExtras.filter((x) => x.stageId === stage.id) };
    });
    const openThreads = openByCut.get(cut.id) ?? 0;
    const stuck = openThreads > 0 || cells.some((c) => c.tasks.some((t) => t.stuck));
    return { cut, code: cutCode(cut, project.group), cells, stuck, openThreads };
  });
  const rows = all.filter((r) => {
    if (filter === "mine") return r.cells.some((c) => c.tasks.some((t) => t.mine));
    if (filter === "review") return r.cells.some((c) => c.tasks.some((t) => t.task.status === "submitted"));
    if (filter === "stuck") return r.stuck;
    return true;
  });
  return { project, projectCells, columns, rows, hidden: all.length - rows.length };
}

// ---------------------------------------------------------------------------
// 指示器 · 任务单
// ---------------------------------------------------------------------------

export interface IndicatorSource {
  stage: StageRow;
  tasks: { task: TaskRow; label: string; labelP: Phrase; assignee: MemberRow | null; latest: SubmissionRow | null; folder: string }[];
}

export interface Indicator {
  receive: { text: string; from: IndicatorSource[] };
  deliver: { text: string; folder: string; fileName: string; version: number };
  handTo: { text: string; stages: { stage: StageRow; reviewer: MemberRow | null }[] };
  reviewer: MemberRow | null;
  /** 这一卡开着的「要补」（拍板以后留下的）。 */
  todos: ThreadRow[];
}

export function indicatorOf(state: WorldState, taskId: Id): Indicator | null {
  const idx = indexOf(state);
  const task = idx.taskById.get(taskId);
  if (!task) return null;
  const stage = idx.stageById.get(task.stageId);
  const project = idx.projectById.get(task.projectId);
  if (!stage || !project) return null;
  const stages = idx.stagesByProject.get(project.id) ?? [];
  const byKey = new Map(stages.map((s) => [s.templateKey, s]));
  const byStage = new Map<Id, TaskRow[]>();
  for (const s of stages) byStage.set(s.id, idx.tasksByStage.get(s.id) ?? []);
  const cut = task.cutId ? idx.cutById.get(task.cutId) ?? null : null;
  const from = upstreamTasksOf(task, stage, byKey, byStage).map((g) => ({
    stage: g.stage,
    tasks: g.tasks.map((t) => {
      const subs = idx.subsByTask.get(t.id) ?? [];
      const c = t.cutId ? idx.cutById.get(t.cutId) ?? null : null;
      return {
        task: t,
        label: taskLabel(g.stage, c, t, project.group),
        labelP: taskLabelP(g.stage, c, t, project.group),
        assignee: t.assigneeId ? idx.memberById.get(t.assigneeId) ?? null : null,
        latest: subs[subs.length - 1] ?? null,
        folder: folderFor(project, g.stage, c),
      };
    }),
  }));
  const next = stages.filter((s) => s.upstream.includes(stage.templateKey));
  const version = task.versions + 1;
  const todos = idx.threads.filter((t) => t.kind === "todo" && t.status === "open" && !!cut && t.cutId === cut.id && (!t.stageKey || t.stageKey === stage.templateKey));
  return {
    receive: { text: stage.indicator.receive, from },
    deliver: { text: stage.indicator.deliver, folder: folderFor(project, stage, cut), fileName: fileNameFor(project, stage, cut, task.layer, version), version },
    handTo: { text: stage.indicator.handTo, stages: next.map((s) => ({ stage: s, reviewer: s.reviewerId ? idx.memberById.get(s.reviewerId) ?? null : null })) },
    reviewer: stage.reviewerId ? idx.memberById.get(stage.reviewerId) ?? null : null,
    todos,
  };
}

export interface Quest {
  view: TaskView;
  indicator: Indicator;
  /** 按质量 1.0 估的活力点。 */
  reward: number;
  dueAt: IsoDateTime | null;
  remainingMs: number | null;
  countdown: ReturnType<typeof countdownZh> | null;
  /** 退回时最近一次的意见。 */
  lastReturn: ReviewRow | null;
  /** 管理员直接派的：谁派的（「白鹭派给你的」）。 */
  assignedBy: MemberRow | null;
}

export function skillOf(state: WorldState, memberId: Id | null, group: Group, stageKey: string): number {
  if (!memberId) return 0;
  return indexOf(state).enrollments.find((e) => e.memberId === memberId && e.group === group && e.stageKey === stageKey)?.skill ?? 0;
}

export function questOf(state: WorldState, task: TaskRow, memberId: Id | null = task.assigneeId): Quest | null {
  const view = taskView(state, task);
  const indicator = indicatorOf(state, task.id);
  if (!view || !indicator) return null;
  const now = nowOf(state);
  // 交了在等审核的不算时间（时限只管手上的）。
  const remainingMs = task.dueAt && task.status !== "submitted" ? msBetween(now, task.dueAt) : null;
  const reviews = reviewsOf(state, task.id);
  const last = reviews[reviews.length - 1];
  return {
    view,
    indicator,
    reward: rewardOf(view.stage, task.workload, skillOf(state, memberId, view.project.group, view.stage.templateKey), task),
    assignedBy: task.assignedById ? memberById(state, task.assignedById) ?? null : null,
    dueAt: task.status === "submitted" ? null : task.dueAt,
    remainingMs,
    countdown: remainingMs === null ? null : countdownZh(remainingMs),
    lastReturn: task.status === "returned" && last?.verdict === "return" ? last : null,
  };
}

/** 我的任务单：手上的（退回的在前，然后按时限），再是交了在等审核的。 */
export function questFor(state: WorldState, memberId: Id): Quest[] {
  const mine = indexOf(state).tasks.filter((t) => t.assigneeId === memberId && (ACTIVE_STATUS.includes(t.status) || t.status === "submitted"));
  const rank = (t: TaskRow) => (t.status === "returned" ? 0 : t.status === "claimed" ? 1 : 2);
  mine.sort(compareBy<TaskRow>(rank, (t) => timeKey(t.dueAt), (t) => t.sort));
  return mine.map((t) => questOf(state, t, memberId)).filter((q): q is Quest => !!q);
}

// ---------------------------------------------------------------------------
// 审核台
// ---------------------------------------------------------------------------

export interface ReviewItem {
  view: TaskView;
  submission: SubmissionRow;
  submitter: MemberRow | null;
  /** 这一张归谁审（环节或新任务上写的审核员；没写 = 管理员）。 */
  reviewerId: Id | null;
  /** 这一卡、这个环节拍板后要补的（还没补好）。 */
  todos: ThreadRow[];
  /** 通过时活力点怎么算（审核台上公开算式）。 */
  points: PointsPreview;
  /** 之前每一版和它的审核。 */
  history: { submission: SubmissionRow; review: ReviewRow | null }[];
  waitingMs: number;
}

export function canReview(state: WorldState, memberId: Id, task: TaskRow): { ok: boolean; reason: string | null; reasonP: Phrase | null } {
  const no = (ph: Phrase) => ({ ok: false, reason: phraseText(ph, "zh"), reasonP: ph });
  const me = memberById(state, memberId);
  if (!isReviewer(me)) return no(phrase("只有审核员和管理员可以审核", "Only reviewers and admins can review."));
  if (task.status !== "submitted") return no(phrase("现在没有等审核的版本", "There's no version waiting for review."));
  const stage = stageById(state, task.stageId);
  const reviewerId = task.extra?.reviewerId ?? stage?.reviewerId ?? null;
  if (stage && reviewerId && reviewerId !== memberId && !isAdmin(me)) {
    const nick = memberById(state, reviewerId)?.nickname;
    const what = task.extra ? uc(task.extra.title) : stageParam(projectById(state, stage.projectId)?.group ?? "animation", stage);
    return no(phrase("「{what}」由{who}审核", "“{what}” is reviewed by {who}.", { what, who: nick ? uc(nick) : t2("指定的审核员", "the assigned reviewer") }));
  }
  const subs = submissionsOf(state, task.id);
  if (subs[subs.length - 1]?.byMemberId === memberId) return no(phrase("这一版是你交的，要别人来审", "You submitted this version, so someone else has to review it."));
  return { ok: true, reason: null, reasonP: null };
}

export function reviewItem(state: WorldState, task: TaskRow): ReviewItem | null {
  const view = taskView(state, task);
  const subs = submissionsOf(state, task.id);
  const submission = subs[subs.length - 1];
  if (!view || !submission) return null;
  const reviews = reviewsOf(state, task.id);
  const cut = view.cut;
  const todos = indexOf(state).threads.filter((t) => t.kind === "todo" && t.status === "open" && !t.archivedAt && !!cut && t.cutId === cut.id && (!t.stageKey || t.stageKey === view.stage.templateKey));
  return {
    view,
    submission,
    submitter: memberById(state, submission.byMemberId) ?? null,
    reviewerId: task.extra?.reviewerId ?? view.stage.reviewerId ?? null,
    todos,
    points: pointsPreview(state, task, submission.byMemberId ?? null),
    history: subs.slice(0, -1).map((s) => ({ submission: s, review: reviews.find((r) => r.submissionId === s.id) ?? null })),
    waitingMs: Math.max(0, msBetween(submission.at, nowOf(state))),
  };
}

/**
 * 通过时活力点的算式（和 task.review 记账用的是同一套公式）：
 * 活力点 = Tn × 工作量 ×（掌控 + 熟练度）× 质量；固定活力点的新任务 = 固定值 × 质量；外包的不记。
 */
export interface PointsPreview {
  member: MemberRow | null;
  outsourced: boolean;
  fixed: number | null;
  tn: number;
  per: number;
  workload: number;
  unit: StageRow["unit"];
  group: Group;
  control: number;
  skill: number;
  hours: number;
  /** 按这个质量系数会记多少。 */
  pointsAt: (quality: number) => number;
}

export function pointsPreview(state: WorldState, task: TaskRow, memberId: Id | null): PointsPreview {
  const stage = stageById(state, task.stageId)!;
  const group = projectById(state, task.projectId)?.group ?? "animation";
  const rate = taskRate(stage, task);
  const skill = memberId ? skillOf(state, memberId, group, stage.templateKey) : 0;
  const fixed = task.extra && task.extra.fixedPoints !== null ? task.extra.fixedPoints : null;
  return {
    member: memberId ? memberById(state, memberId) ?? null : null,
    outsourced: !!task.outsourced || !memberId,
    fixed,
    tn: rate.tn,
    per: rate.per > 0 ? rate.per : 1,
    workload: task.workload,
    unit: stage.unit,
    group,
    control: stage.control,
    skill,
    hours: hoursOf(rate, task.workload),
    pointsAt: (q) => taskPoints(stage, task, skill, q),
  };
}

/** 待审队列：我能审的，等得最久的在前。 */
export function reviewQueue(state: WorldState, memberId: Id): ReviewItem[] {
  return indexOf(state)
    .tasks.filter((t) => t.status === "submitted" && canReview(state, memberId, t).ok)
    .map((t) => reviewItem(state, t))
    .filter((x): x is ReviewItem => !!x)
    .sort((a, b) => b.waitingMs - a.waitingMs || cmp(a.view.task.id, b.view.task.id));
}

/** 全工会在等审核的（给不能审的人看个数）。 */
export function pendingReviewCount(state: WorldState): number {
  return indexOf(state).tasks.filter((t) => t.status === "submitted").length;
}

// ---------------------------------------------------------------------------
// 成长 · 合作
// ---------------------------------------------------------------------------

export interface Growth {
  member: MemberRow;
  points: number;
  level: LevelInfo;
  weekPoints: number;
  ledger: LedgerRow[];
  onTime: { onTime: number; total: number; rate: number | null };
  mainStage: { key: string; name: string; group: Group; count: number } | null;
  stages: { key: string; name: string; group: Group; count: number; points: number }[];
  joinedDays: number;
  passedTasks: number;
}

export function growthOf(state: WorldState, memberId: Id): Growth | null {
  const idx = indexOf(state);
  const member = idx.memberById.get(memberId);
  if (!member) return null;
  const ledger = idx.ledgerByMember.get(memberId) ?? [];
  const points = Math.round(ledger.reduce((n, l) => n + l.points, 0) * 10) / 10;
  const today = todayOf(state);
  const weekStart = weekStartOf(today);
  const weekPoints = Math.round(ledger.filter((l) => localDate(l.at) >= weekStart && localDate(l.at) <= today).reduce((n, l) => n + l.points, 0) * 10) / 10;
  const subs: SubmissionRow[] = [];
  for (const list of Array.from(idx.subsByTask.values())) for (const s of list) if (s.byMemberId === memberId && !s.selfFix) subs.push(s);
  const onTime = subs.filter((s) => s.onTime).length;
  const byStage = new Map<string, { key: string; name: string; group: Group; count: number; points: number }>();
  let passedTasks = 0;
  for (const l of ledger) {
    if (l.kind !== "task" || !l.taskId) continue;
    const t = idx.taskById.get(l.taskId);
    const s = t ? idx.stageById.get(t.stageId) : undefined;
    const p = t ? idx.projectById.get(t.projectId) : undefined;
    if (!s || !p) continue;
    passedTasks += 1;
    const key = `${p.group}:${s.templateKey}`;
    const cur = byStage.get(key) ?? { key: s.templateKey, name: s.name, group: p.group, count: 0, points: 0 };
    cur.count += 1;
    cur.points = Math.round((cur.points + l.points) * 10) / 10;
    byStage.set(key, cur);
  }
  const stages = Array.from(byStage.values()).sort((a, b) => b.count - a.count || b.points - a.points || cmp(a.key, b.key));
  return {
    member,
    points,
    level: levelOf(points),
    weekPoints,
    ledger: [...ledger].reverse(),
    onTime: { onTime, total: subs.length, rate: subs.length ? onTime / subs.length : null },
    mainStage: stages[0] ? { key: stages[0].key, name: stages[0].name, group: stages[0].group, count: stages[0].count } : null,
    stages,
    joinedDays: Math.max(0, daysBetween(localDate(member.joinedAt), today)),
    passedTasks,
  };
}

/** 和谁在同一卡上做过事（接过或交过同一卡的任务），按一起做过的卡数排。 */
export function collaboratorsOf(state: WorldState, memberId: Id): { member: MemberRow; cuts: number }[] {
  const idx = indexOf(state);
  const workersOf = (cutId: Id) => {
    const ids = new Set<Id>();
    for (const t of idx.tasksByCut.get(cutId) ?? []) {
      if (t.assigneeId) ids.add(t.assigneeId);
      for (const s of idx.subsByTask.get(t.id) ?? []) if (s.byMemberId) ids.add(s.byMemberId);
    }
    return ids;
  };
  const counts = new Map<Id, number>();
  for (const cutId of Array.from(idx.tasksByCut.keys())) {
    const ids = workersOf(cutId);
    if (!ids.has(memberId)) continue;
    for (const id of Array.from(ids)) if (id !== memberId) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([id, cuts]) => ({ member: idx.memberById.get(id), cuts }))
    .filter((x): x is { member: MemberRow; cuts: number } => !!x.member)
    .sort((a, b) => b.cuts - a.cuts || cmp(timeKey(a.member.joinedAt), timeKey(b.member.joinedAt)) || cmp(a.member.id, b.member.id));
}

// ---------------------------------------------------------------------------
// 卡的时间线
// ---------------------------------------------------------------------------

export type TimelineKind = "claim" | "release" | "expire" | "reclaim" | "reopen" | "dispatch" | "submit" | "review" | "thread" | "ruling" | "file" | "pin";

export interface TimelineItem {
  key: string;
  at: IsoDateTime;
  kind: TimelineKind;
  memberId: Id | null;
  task: TaskRow | null;
  stage: StageRow | null;
  text: string;
  /** 两种语言的 text（用户写的放进 uc）。 */
  phrase: Phrase;
  submission?: SubmissionRow;
  review?: ReviewRow;
  thread?: ThreadRow;
  ruling?: RulingRow;
  file?: FileRow;
  pin?: PinRow;
  seq: number;
}

const SOMEONE = t2("有人", "Someone");

const THREAD_KIND_TEXT: Record<ThreadRow["kind"], Text2> = { comment: t2("意见", "comment"), ask: t2("提问上游", "question"), setting: t2("设定问题", "settings question"), todo: t2("要补", "to-do") };

const VERDICT_TEXT: Record<Verdict, Text2> = { pass: t2("通过", "passed"), return: t2("退回", "sent back"), fix_pass: t2("自修后通过", "self-fixed and passed") };

const JOURNAL_KIND: Record<string, TimelineKind> = {
  "task.claim": "claim",
  "enroll.add": "claim",
  "task.assign": "claim",
  "task.release": "release",
  "task.expire": "expire",
  "task.reclaim": "reclaim",
  "task.reopen": "reopen",
  "hub.dispatch": "dispatch",
};

export function timelineOfCut(state: WorldState, cutId: Id): TimelineItem[] {
  const idx = indexOf(state);
  const cut = idx.cutById.get(cutId);
  if (!cut) return [];
  const project = idx.projectById.get(cut.projectId);
  const group = project?.group ?? "animation";
  const tasks = [...(idx.tasksByCut.get(cutId) ?? []), ...(idx.extrasByCut.get(cutId) ?? [])];
  const taskIds = new Set(tasks.map((t) => t.id));
  const items: TimelineItem[] = [];
  const stageOfTask = (t: TaskRow | undefined) => (t ? idx.stageById.get(t.stageId) ?? null : null);
  const name = (id: Id | null | undefined): TextParam => {
    const m = id ? idx.memberById.get(id) : undefined;
    return m ? uc(m.nickname) : SOMEONE;
  };
  // 卡详情里不重复卡号：「中割 A 层」/「In-between Layer A」。
  const labelOf = (t: TaskRow): TextParam => {
    const s = stageOfTask(t);
    if (!s) return t2("任务", "a task");
    const st = stageParam(group, s);
    return t.layer ? phrase("{stage} {layer} 层", "{stage} Layer {layer}", { stage: st, layer: t.layer }) : st;
  };
  const push = (item: Omit<TimelineItem, "text">) => items.push({ ...item, text: phraseText(item.phrase, "zh") });
  for (const e of state.journal) {
    const kind = JOURNAL_KIND[e.command];
    if (!kind) continue;
    for (const ch of e.changes) {
      if (ch.op !== "update" || ch.table !== "tasks" || !taskIds.has(ch.id)) continue;
      const patch = ch.patch as Partial<TaskRow>;
      const prev = ch.prev as Partial<TaskRow>;
      const t = idx.taskById.get(ch.id)!;
      const L = labelOf(t);
      let ph: Phrase | null = null;
      if (kind === "claim" && patch.status === "claimed")
        ph = patch.assigneeId
          ? phrase("{who} 接了 {task}", "{who} took {task}", { who: name(patch.assigneeId), task: L })
          : phrase("{task} 外包给 {name}", "{task} outsourced to {name}", { task: L, name: patch.outsourceName ? uc(patch.outsourceName) : t2("外包", "an outsourcer") });
      else if (kind === "release" && patch.status === "open")
        ph =
          e.actorMemberId === prev.assigneeId
            ? phrase("{who} 放弃了 {task}，回到可接", "{who} gave up {task}; it's open again", { who: name(prev.assigneeId), task: L })
            : phrase("{who} 把 {task} 从 {from} 手上收回给大家", "{who} took {task} back from {from} and opened it to everyone", { who: name(e.actorMemberId), task: L, from: name(prev.assigneeId) });
      else if (kind === "expire") ph = phrase("{task} 超过时限没交，从 {from} 手上收回到可接", "{task} passed its deadline and was taken back from {from}; it's open again", { task: L, from: name(prev.assigneeId) });
      else if (kind === "reclaim") ph = phrase("{who} 收回了 {task}", "{who} reclaimed {task}", { who: name(e.actorMemberId), task: L });
      else if (kind === "reopen") ph = phrase("{who} 重新放出了 {task}", "{who} reopened {task}", { who: name(e.actorMemberId), task: L });
      else if (kind === "dispatch") ph = phrase("{who} 派发了 {task}（{amount}）", "{who} dispatched {task} ({amount})", { who: name(e.actorMemberId), task: L, amount: workloadP(stageOfTask(t)!, patch.workload ?? t.workload, project?.group) });
      if (!ph) continue;
      push({ key: `${e.id}:${ch.id}`, at: e.worldAt ?? e.createdAt, kind, memberId: e.actorMemberId, task: t, stage: stageOfTask(t), phrase: ph, seq: e.seq });
    }
  }
  const seqOf = new Map<Id, number>();
  state.journal.forEach((e) => {
    for (const v of Object.values(e.created ?? {})) seqOf.set(v, e.seq);
  });
  for (const t of tasks) {
    for (const s of idx.subsByTask.get(t.id) ?? []) {
      const who = s.byMemberId ? name(s.byMemberId) : t.outsourceName ? uc(t.outsourceName) : t2("外包", "An outsourcer");
      const v = `v${String(s.versionNo).padStart(2, "0")}`;
      push({
        key: s.id,
        at: s.at,
        kind: "submit",
        memberId: s.byMemberId,
        task: t,
        stage: stageOfTask(t),
        phrase: s.selfFix
          ? phrase("{who} 自修出 {v}", "{who} self-fixed {v}", { who, v })
          : s.recordedById
            ? phrase("{who} 交了 {task} {v}（{by} 代交）", "{who} submitted {task} {v} (entered by {by})", { who, task: labelOf(t), v, by: name(s.recordedById) })
            : phrase("{who} 交了 {task} {v}", "{who} submitted {task} {v}", { who, task: labelOf(t), v }),
        submission: s,
        seq: seqOf.get(s.id) ?? 0,
      });
    }
    for (const r of idx.reviewsByTask.get(t.id) ?? []) {
      const base = { who: name(r.byMemberId), verdict: VERDICT_TEXT[r.verdict], task: labelOf(t) };
      push({
        key: r.id,
        at: r.at,
        kind: "review",
        memberId: r.byMemberId,
        task: t,
        stage: stageOfTask(t),
        phrase: r.quality !== null ? phrase("{who} {verdict}了 {task}（质量 {q}）", "{who} {verdict} {task} (quality {q})", { ...base, q: r.quality.toFixed(1) }) : phrase("{who} {verdict}了 {task}", "{who} {verdict} {task}", base),
        review: r,
        seq: seqOf.get(r.id) ?? 0,
      });
    }
  }
  for (const th of idx.threads) {
    if (th.cutId !== cutId) continue;
    const t = th.subjectType === "task" ? idx.taskById.get(th.subjectId) ?? null : null;
    const stage = t ? stageOfTask(t) : null;
    const ph =
      th.kind === "todo"
        ? phrase("{text}", "{text}", { text: uc(th.text) })
        : th.kind === "ask"
          ? phrase("{who} 提问", "{who} asked a question", { who: name(th.byMemberId) })
          : th.kind === "setting"
            ? phrase("{who} 提了设定问题", "{who} raised a settings question", { who: name(th.byMemberId) })
            : phrase("{who} 留了意见", "{who} left a comment", { who: name(th.byMemberId) });
    push({ key: th.id, at: th.at, kind: "thread", memberId: th.byMemberId, task: t, stage, phrase: ph, thread: th, seq: seqOf.get(th.id) ?? 0 });
  }
  for (const f of idx.files) {
    if (f.cutId !== cutId) continue;
    push({
      key: f.id,
      at: f.at,
      kind: "file",
      memberId: f.byMemberId,
      task: null,
      stage: null,
      phrase: f.width ? phrase("{who} 放了图「{name}」", "{who} added the image “{name}”", { who: name(f.byMemberId), name: uc(f.name) }) : phrase("{who} 放了文件「{name}」", "{who} added the file “{name}”", { who: name(f.byMemberId), name: uc(f.name) }),
      file: f,
      seq: seqOf.get(f.id) ?? 0,
    });
  }
  for (const p of idx.pins) {
    if (p.cutId !== cutId) continue;
    const f = idx.fileById.get(p.fileId);
    const t = p.taskId ? idx.taskById.get(p.taskId) ?? null : null;
    const params = { who: name(p.byMemberId), file: f ? uc(f.name) : t2("图", "an image"), n: p.number };
    const zh = `{who} 在「{file}」上${p.kind === "box" ? "框了" : "钉了"} #{n}${p.reviewTaskId ? "（审核退回时）" : ""}`;
    const en = `{who} ${p.kind === "box" ? "boxed" : "pinned"} #{n} on “{file}”${p.reviewTaskId ? " (when sending it back)" : ""}`;
    push({
      key: p.id,
      at: p.at,
      kind: "pin",
      memberId: p.byMemberId,
      task: t,
      stage: stageOfTask(t ?? undefined),
      phrase: phrase(zh, en, params),
      file: f,
      pin: p,
      seq: seqOf.get(p.id) ?? 0,
    });
  }
  return items.sort((a, b) => cmp(timeKey(b.at), timeKey(a.at)) || b.seq - a.seq || cmp(b.key, a.key));
}

// ---------------------------------------------------------------------------
// 等我处理
// ---------------------------------------------------------------------------

export interface ThreadView {
  thread: ThreadRow;
  project: ProjectRow | null;
  cut: CutRow | null;
  /** 「安娜的旅程 · C011」 */
  where: string;
  whereP: Phrase;
  by: MemberRow | null;
  kindLabel: string;
}

export function threadView(state: WorldState, thread: ThreadRow): ThreadView {
  const project = projectById(state, thread.projectId) ?? null;
  const cut = cutById(state, thread.cutId) ?? null;
  return {
    thread,
    project,
    cut,
    where: [project?.name, cut ? cutCode(cut, project?.group) : null].filter(Boolean).join(" · "),
    whereP: threadWhereP(project, cut),
    by: memberById(state, thread.byMemberId) ?? null,
    kindLabel: THREAD_KIND_LABEL[thread.kind],
  };
}

function threadWhereP(project: ProjectRow | null, cut: CutRow | null): Phrase {
  if (project && cut) return phrase("{project} · {cut}", "{project} · {cut}", { project: uc(project.name), cut: cutCode2(cut, project.group) });
  if (project) return phrase("{project}", "{project}", { project: uc(project.name) });
  if (cut) return phrase("{cut}", "{cut}", { cut: cutCode2(cut) });
  return phrase("", "");
}

export interface Inbox {
  returned: Quest[];
  asked: ThreadView[];
  todos: ThreadView[];
  /** 图上的意见：@ 了我的、审核退回时钉在我的任务上的、钉在我手上任务的图上的。 */
  pins: PinView[];
  /** 审核员标了「打不开」的链接。 */
  links: BrokenLink[];
  total: number;
}

export function inboxOf(state: WorldState, memberId: Id): Inbox {
  const idx = indexOf(state);
  const returned = questFor(state, memberId).filter((q) => q.view.task.status === "returned");
  const myKeys = new Set(idx.enrollments.filter((e) => e.memberId === memberId).map((e) => `${e.group}:${e.stageKey}`));
  // 我在哪些卡 · 环节上做过事。
  const worked = new Set<string>();
  const workedCut = new Set<Id>();
  for (const t of idx.tasks) {
    const did = t.assigneeId === memberId || (idx.subsByTask.get(t.id) ?? []).some((s) => s.byMemberId === memberId);
    if (!did) continue;
    const s = idx.stageById.get(t.stageId);
    if (s && t.cutId) {
      worked.add(`${t.cutId}:${s.templateKey}`);
      workedCut.add(t.cutId);
    }
    if (s) worked.add(`${t.projectId}:${s.templateKey}`);
  }
  const asked = idx.threads
    .filter((t) => t.kind === "ask" && t.status === "open" && t.byMemberId !== memberId)
    .filter((t) => {
      if (t.askMemberId) return t.askMemberId === memberId;
      if (!t.askStageKey) return false;
      const p = idx.projectById.get(t.projectId);
      if (!p || !myKeys.has(`${p.group}:${t.askStageKey}`)) return false;
      return t.cutId ? worked.has(`${t.cutId}:${t.askStageKey}`) || worked.has(`${t.projectId}:${t.askStageKey}`) : worked.has(`${t.projectId}:${t.askStageKey}`);
    })
    .map((t) => threadView(state, t));
  const todos = idx.threads
    .filter((t) => t.kind === "todo" && t.status === "open" && !!t.cutId)
    .filter((t) => (t.stageKey ? worked.has(`${t.cutId}:${t.stageKey}`) : workedCut.has(t.cutId!)))
    .map((t) => threadView(state, t));
  const pins = indexOf(state)
    .pins.filter((p) => p.status === "open" && p.byMemberId !== memberId)
    .filter((p) => {
      if (p.mentions.includes(memberId)) return true;
      const task = p.reviewTaskId ? idx.taskById.get(p.reviewTaskId) : p.taskId ? idx.taskById.get(p.taskId) : undefined;
      return !!task && task.assigneeId === memberId && task.status !== "passed";
    })
    .map((p) => pinView(state, p))
    .filter((v): v is PinView => !!v);
  // 审核员标了「打不开」的链接（我交的版本上）：换一条就清掉。
  const links: BrokenLink[] = [];
  for (const t of idx.tasks) {
    for (const sub of idx.subsByTask.get(t.id) ?? []) {
      if (sub.byMemberId !== memberId) continue;
      for (const link of linksOf(sub)) {
        if (!link.broken) continue;
        const view = taskView(state, t);
        if (view) links.push({ submission: sub, view, link, by: idx.memberById.get(link.broken.byMemberId) ?? null });
      }
    }
  }
  return { returned, asked, todos, pins, links, total: returned.length + asked.length + todos.length + pins.length + links.length };
}

export interface BrokenLink {
  submission: SubmissionRow;
  view: TaskView;
  link: SubmissionLink;
  by: MemberRow | null;
}

/** 一版挂的链接（旧的记录只有一条 link）。 */
export function submissionLinks(sub: SubmissionRow): SubmissionLink[] {
  return linksOf(sub);
}

/** 开着的设定问题（管理员拍板用）。 */
export function openSettingQuestions(state: WorldState): ThreadView[] {
  return indexOf(state)
    .threads.filter((t) => t.kind === "setting" && t.status === "open")
    .map((t) => threadView(state, t));
}

export function rulingsOf(state: WorldState, projectId?: Id): RulingRow[] {
  const all = indexOf(state).rulings;
  return projectId ? all.filter((r) => r.projectId === projectId) : all;
}

// ---------------------------------------------------------------------------
// 工会动态
// ---------------------------------------------------------------------------

export interface FeedItem {
  entry: JournalEntry;
  at: IsoDateTime;
  memberId: Id | null;
  text: string;
  phrase: Phrase;
}

function p0(p: Record<string, unknown>): Id {
  return String(p.pinId ?? "");
}

function taskShort(state: WorldState, id: unknown): TextParam {
  const v = typeof id === "string" ? taskViewById(state, id) : null;
  return v ? phrase("{code} {label}", "{code} {label}", { code: v.project.code, label: v.labelP }) : t2("一张任务", "a task");
}

function whoOf(state: WorldState, id: Id | null | undefined): TextParam {
  const m = id ? memberById(state, id) : undefined;
  return m ? uc(m.nickname) : SOMEONE;
}

function memberP(state: WorldState, id: unknown): TextParam {
  const m = typeof id === "string" ? memberById(state, id) : undefined;
  return m ? uc(m.nickname) : t2("成员", "a member");
}

function stageP(state: WorldState, id: unknown, fallback: Text2 = t2("环节", "a stage")): TextParam {
  const st = typeof id === "string" ? stageById(state, id) : undefined;
  if (!st) return fallback;
  return stageParam(projectById(state, st.projectId)?.group ?? "animation", st);
}

function templateStageP(group: Group, key: unknown): TextParam {
  const t = groupTemplate(group).stages.find((x) => x.key === key);
  return t ? stageParam(group, { templateKey: t.key, name: t.name }) : t2("环节", "a stage");
}

function projectP(state: WorldState, id: unknown, fallback: unknown = ""): TextParam {
  const pr = typeof id === "string" ? projectById(state, id) : undefined;
  return uc(pr?.name ?? String(fallback ?? ""));
}

function cutP(state: WorldState, id: unknown): TextParam {
  const c = typeof id === "string" ? state.cuts[id] : undefined;
  return c ? cutCode2(c, projectById(state, c.projectId)?.group) : t2("一卡", "a cut");
}

const vOf = (n: number) => `v${String(n).padStart(2, "0")}`;

/** 工会动态的一句（两种语言；名字、标题这些用户写的放进 uc）。 */
export function feedPhrase(state: WorldState, e: JournalEntry): Phrase | null {
  const who = whoOf(state, e.actorMemberId);
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const created = e.created ?? {};
  const P = (zh: string, en: string, params: Record<string, TextParam> = {}) => phrase(zh, en, { who, ...params });
  switch (e.command) {
    case "guild.create":
      return P("{who} 建了工会", "{who} created the guild");
    case "member.join":
      return P("{who} 把 {name} 加进了工会", "{who} added {name} to the guild", { name: uc(String(p.nickname ?? "")) });
    case "member.set_role":
      return P("{who} 改了 {name} 的角色", "{who} changed {name}'s role", { name: memberP(state, p.memberId) });
    case "enroll.add": {
      const stage = templateStageP((p.group as Group) ?? "animation", p.stageKey);
      return created.taskId
        ? P("{who} 报到了「{stage}」，拿到 {task}", "{who} signed up for “{stage}” and got {task}", { stage, task: taskShort(state, created.taskId) })
        : P("{who} 报到了「{stage}」", "{who} signed up for “{stage}”", { stage });
    }
    case "task.claim":
      return P("{who} 接了 {task}", "{who} took {task}", { task: taskShort(state, created.taskId ?? p.taskId) });
    case "task.submit": {
      const sub = created.submissionId ? state.submissions[created.submissionId] : undefined;
      return sub
        ? P("{who} 交了 {task} {v}", "{who} submitted {task} {v}", { task: taskShort(state, p.taskId), v: vOf(sub.versionNo) })
        : P("{who} 交了 {task}", "{who} submitted {task}", { task: taskShort(state, p.taskId) });
    }
    case "task.review": {
      const r = created.reviewId ? state.reviews[created.reviewId] : undefined;
      const verdict = VERDICT_TEXT[(p.verdict as Verdict) ?? "pass"] ?? t2("审核", "reviewed");
      const task = taskShort(state, p.taskId);
      return r?.quality
        ? P("{who} {verdict}了 {task}（质量 {q}）", "{who} {verdict} {task} (quality {q})", { verdict, task, q: r.quality.toFixed(1) })
        : P("{who} {verdict}了 {task}", "{who} {verdict} {task}", { verdict, task });
    }
    case "task.release":
      return P("{who} 放弃了 {task}", "{who} gave up {task}", { task: taskShort(state, p.taskId) });
    case "task.expire":
      return P("{task} 超时，收回到可接", "{task} ran past its deadline and is open again", { task: taskShort(state, p.taskId) });
    case "task.reclaim":
      return P("{who} 收回了 {task}", "{who} reclaimed {task}", { task: taskShort(state, p.taskId) });
    case "task.reopen":
      return Array.isArray(p.comments) && p.comments.length
        ? P("{who} 把 {task} 打回重做", "{who} sent {task} back for a redo", { task: taskShort(state, p.taskId) })
        : P("{who} 重新放出了 {task}", "{who} reopened {task}", { task: taskShort(state, p.taskId) });
    case "task.assign": {
      const ids = Array.isArray(p.taskIds) && p.taskIds.length ? (p.taskIds as Id[]) : [p.taskId as Id];
      const what = ids.length > 1 ? phrase("{task} 等 {n} 张", "{task} and {more} more", { task: taskShort(state, ids[0]), n: ids.length, more: ids.length - 1 }) : taskShort(state, ids[0]);
      const to = p.memberId ? memberP(state, p.memberId) : phrase("外包（{name}）", "an outsourcer ({name})", { name: uc(String(p.outsourceName ?? "")) });
      return P("{who} 把 {what} 派给了 {to}", "{who} assigned {what} to {to}", { what, to });
    }
    case "task.publish": {
      const t = created.taskId ? state.tasks[created.taskId] : undefined;
      if (!t?.extra) return null;
      const params = { stage: stageP(state, t.stageId), kind: EXTRA_KIND_TEXT[t.extra.kind], title: uc(t.extra.title), to: t.assigneeId ? memberP(state, t.assigneeId) : null };
      return t.assigneeId
        ? P("{who} 在「{stage}」发了一张{kind}：{title}，派给 {to}", "{who} posted a new {kind} on “{stage}”: {title}, assigned to {to}", params)
        : P("{who} 在「{stage}」发了一张{kind}：{title}，等人认领", "{who} posted a new {kind} on “{stage}”: {title}, open to claim", params);
    }
    case "role.assign":
    case "role.unassign": {
      const params = { name: memberP(state, p.memberId), stage: templateStageP((p.group as Group) ?? "animation", p.stageKey) };
      return e.command === "role.assign"
        ? P("{who} 给 {name} 指派了职位「{stage}」", "{who} assigned {name} to “{stage}”", params)
        : P("{who} 撤掉了 {name} 的职位「{stage}」", "{who} removed {name} from “{stage}”", params);
    }
    case "stage.set_lock":
      return p.locked
        ? P("{who} 把「{stage}」锁成只给指派的人", "{who} locked “{stage}” to assigned people", { stage: stageP(state, p.stageId) })
        : P("{who} 把「{stage}」放开给大家认领", "{who} opened “{stage}” for anyone to claim", { stage: stageP(state, p.stageId) });
    case "stage.set_period":
      return P("{who} 改了「{stage}」的计划周期（第 {w} 周起，{n} 周）", "{who} changed the planned schedule of “{stage}” (from week {w}, {n} {n|week|weeks})", { stage: stageP(state, p.stageId), w: String(p.startWeek), n: Number(p.weeks) });
    case "link.mark_broken": {
      const sub = state.submissions[p.submissionId as Id];
      return sub ? P("{who} 标了 {task} {v} 的一条链接「打不开」", "{who} marked a link on {task} {v} as broken", { task: taskShort(state, sub.taskId), v: vOf(sub.versionNo) }) : null;
    }
    case "link.replace": {
      const sub = state.submissions[p.submissionId as Id];
      return sub ? P("{who} 换了 {task} {v} 的一条链接", "{who} replaced a link on {task} {v}", { task: taskShort(state, sub.taskId), v: vOf(sub.versionNo) }) : null;
    }
    case "project.draft":
      return P("{who} 建了项目「{project}」（零日）", "{who} created the project “{project}” (pre-start)", { project: projectP(state, created.projectId, p.name) });
    case "project.set_structure": {
      const st = p.structure as { episodes?: number; scenesPerEpisode?: number; cutsPerScene?: number } | undefined;
      const n = (st?.episodes ?? 1) * (st?.scenesPerEpisode ?? 1) * (st?.cutsPerScene ?? 0);
      return P("{who} 改了「{project}」的结构（{n} 卡）", "{who} changed the structure of “{project}” ({n} {n|cut|cuts})", { project: projectP(state, p.projectId), n });
    }
    case "project.start":
      return P("{who} 让「{project}」开工了", "{who} started “{project}”", { project: projectP(state, p.projectId) });
    case "project.extend":
      return P("{who} 把「{project}」的计划结束改到 {date}", "{who} moved the planned end of “{project}” to {date}", { project: projectP(state, p.projectId), date: String(p.until ?? "") });
    case "staff.set": {
      const proj = projectById(state, p.projectId as Id);
      const pos = proj?.staff?.find((x) => x.key === p.positionKey);
      const tpl = positionTemplate(proj?.template, String(p.positionKey));
      const name: TextParam = pos?.custom ? uc(pos.custom.name) : tpl ? tpl.name : t2("职位", "a position");
      return P("{who} 改了人员表「{name}」", "{who} updated “{name}” in the staff list", { name });
    }
    case "staff.add_position":
      return P("{who} 在人员表里加了职位「{name}」", "{who} added the position “{name}” to the staff list", { name: uc(String(p.name ?? "")) });
    case "stage.add": {
      const after = p.afterKey ? stagesOf(state, p.projectId as Id).find((x) => x.templateKey === p.afterKey) : undefined;
      const group = projectById(state, p.projectId as Id)?.group ?? "animation";
      return p.afterKey
        ? P("{who} 加了环节「{name}」，接在「{after}」后面", "{who} added the stage “{name}” after “{after}”", { name: uc(String(p.name ?? "")), after: after ? stageParam(group, after) : "" })
        : P("{who} 加了环节「{name}」", "{who} added the stage “{name}”", { name: uc(String(p.name ?? "")) });
    }
    case "stage.update":
      return P("{who} 改了环节「{stage}」", "{who} edited the stage “{stage}”", { stage: stageP(state, p.stageId, t2("", "")) });
    case "stage.move":
      return p.direction === "up"
        ? P("{who} 把环节「{stage}」往前挪了", "{who} moved the stage “{stage}” earlier", { stage: stageP(state, p.stageId, t2("", "")) })
        : P("{who} 把环节「{stage}」往后挪了", "{who} moved the stage “{stage}” later", { stage: stageP(state, p.stageId, t2("", "")) });
    case "stage.remove": {
      const st = state.stages[p.stageId as Id];
      return P("{who} 删了环节「{stage}」", "{who} deleted the stage “{stage}”", { stage: st ? stageParam(projectById(state, st.projectId)?.group ?? "animation", st) : "" });
    }
    case "stage.disable":
      return p.disabled
        ? P("{who} 停用了环节「{stage}」", "{who} disabled the stage “{stage}”", { stage: stageP(state, p.stageId, t2("", "")) })
        : P("{who} 重新启用了环节「{stage}」", "{who} re-enabled the stage “{stage}”", { stage: stageP(state, p.stageId, t2("", "")) });
    case "stage.accept":
      return P("{who} 验收通过了「{stage}」", "{who} accepted “{stage}”", { stage: stageP(state, p.stageId, t2("", "")) });
    case "stage.extend":
      return P("{who} 给「{stage}」在做的任务延期{by}", "{who} extended the tasks in progress in “{stage}”{by}", { stage: stageP(state, p.stageId, t2("", "")), by: extendP(p) });
    case "task.extend": {
      const ids = Array.isArray(p.taskIds) && p.taskIds.length ? (p.taskIds as Id[]) : [p.taskId as Id];
      return ids.length > 1
        ? P("{who} 给 {task} 等 {n} 张延期{by}", "{who} extended {task} and {more} more{by}", { task: taskShort(state, ids[0]), n: ids.length, more: ids.length - 1, by: extendP(p) })
        : P("{who} 给 {task} 延期{by}", "{who} extended {task}{by}", { task: taskShort(state, ids[0]), by: extendP(p) });
    }
    case "stage.assign":
    case "stage.unassign": {
      const params = { name: p.memberId ? memberP(state, p.memberId) : uc(String(p.name ?? "")), stage: stageP(state, p.stageId) };
      return e.command === "stage.assign"
        ? P("{who} 把 {name} 指派到「{stage}」", "{who} assigned {name} to “{stage}”", params)
        : P("{who} 把 {name} 从「{stage}」撤掉了", "{who} removed {name} from “{stage}”", params);
    }
    case "cut.add": {
      const n = Number(p.count ?? 1);
      return p.afterCutId && state.cuts[p.afterCutId as Id]
        ? P("{who} 加了 {n} 卡（插在 {cut} 后面）", "{who} added {n} {n|cut|cuts} (after {cut})", { n, cut: cutP(state, p.afterCutId) })
        : P("{who} 加了 {n} 卡", "{who} added {n} {n|cut|cuts}", { n });
    }
    case "cut.update":
      return P("{who} 改了 {cut}（层 / 张数 / 秒数）", "{who} edited {cut} (layers / drawings / seconds)", { cut: cutP(state, p.cutId) });
    case "cut.archive":
      return P("{who} 停用了 {cut}", "{who} disabled {cut}", { cut: cutP(state, p.cutId) });
    case "stage.set_rate":
      return P("{who} 改了「{stage}」的时限参数", "{who} changed the deadline settings of “{stage}”", { stage: stageP(state, p.stageId) });
    case "project.create":
      return P("{who} 开了项目「{project}」", "{who} started the project “{project}”", { project: projectP(state, created.projectId, p.name) });
    case "project.update":
      return P("{who} 改了项目「{project}」", "{who} edited the project “{project}”", { project: projectP(state, p.projectId) });
    case "hub.dispatch": {
      const n = (Array.isArray(p.rows) ? p.rows.length : 0) + (Array.isArray(p.add) ? p.add.length : 0);
      return P("{who} 在「{stage}」派发了 {n} 张任务", "{who} dispatched {n} {n|task|tasks} from “{stage}”", { stage: stageP(state, p.hubStageId, t2("枢纽", "a hub")), n });
    }
    case "thread.open": {
      const t = created.threadId ? state.threads[created.threadId] : undefined;
      if (!t) return null;
      const where = threadView(state, t).whereP;
      if (t.kind === "ask") return P("{who} 在 {where} 提问", "{who} asked a question on {where}", { where });
      if (t.kind === "setting") return P("{who} 在 {where} 提了设定问题", "{who} raised a settings question on {where}", { where });
      return P("{who} 在 {where} 留了意见", "{who} left a comment on {where}", { where });
    }
    case "thread.reply": {
      const t = state.threads[p.threadId as Id];
      return t ? P("{who} 回复了 {where} 的{kind}", "{who} replied to a {kind} on {where}", { where: threadView(state, t).whereP, kind: THREAD_KIND_TEXT[t.kind] }) : null;
    }
    case "ruling.make":
      return P("{who} 拍板：{decision}", "{who} ruled: {decision}", { decision: uc(String(p.decision ?? "")) });
    case "template.set_rate":
      return P("{who} 改了「{stage}」的工时", "{who} changed the hours for “{stage}”", { stage: templateStageP((p.group as Group) ?? "animation", p.stageKey) });
    case "rules.set":
      return P("{who} 改了工会规则", "{who} changed the guild rules");
    case "file.add": {
      const f = created.fileId ? state.files[created.fileId] : undefined;
      if (!f) return null;
      return f.width ? P("{who} 放了图「{name}」", "{who} added the image “{name}”", { name: uc(f.name) }) : P("{who} 放了文件「{name}」", "{who} added the file “{name}”", { name: uc(f.name) });
    }
    case "pin.add": {
      const pin = created.pinId ? state.pins[created.pinId] : undefined;
      if (!pin) return null;
      const f = state.files[pin.fileId];
      const params = { file: f ? uc(f.name) : t2("图", "an image"), n: pin.number, text: uc(pin.text) };
      return pin.kind === "box" ? P("{who} 在「{file}」上框了 #{n}：{text}", "{who} boxed #{n} on “{file}”: {text}", params) : P("{who} 在「{file}」上钉了 #{n}：{text}", "{who} pinned #{n} on “{file}”: {text}", params);
    }
    case "pin.reply": {
      const pin = state.pins[p0(p)];
      return pin ? P("{who} 回复了 #{n}（{file}）", "{who} replied to #{n} ({file})", { n: pin.number, file: state.files[pin.fileId] ? uc(state.files[pin.fileId].name) : t2("图", "image") }) : null;
    }
    case "pin.resolve": {
      const pin = state.pins[p0(p)];
      return pin ? P("{who} 解决了 #{n}（{file}）", "{who} resolved #{n} ({file})", { n: pin.number, file: state.files[pin.fileId] ? uc(state.files[pin.fileId].name) : t2("图", "image") }) : null;
    }
    case "page.create":
      return P("{who} 建了资料页「{title}」", "{who} created the page “{title}”", { title: uc(String(p.title ?? "")) });
    case "stage.set_reviewer":
      return P("{who} 指定了「{stage}」的审核员", "{who} set the reviewer for “{stage}”", { stage: stageP(state, p.stageId) });
    default:
      return null;
  }
}

export function feedText(state: WorldState, e: JournalEntry): string | null {
  const ph = feedPhrase(state, e);
  return ph ? phraseText(ph, "zh") : null;
}

/** 延期的量：「 2 天 3 小时」「到 2026-11-02」/「 by 2 days 3 h」「 to 2026-11-02」。 */
function extendP(p: Record<string, unknown>): Phrase {
  if (p.until) return phrase("到 {d}", " to {d}", { d: String(p.until) });
  const days = Number(p.days) || 0;
  const hours = Number(p.hours) || 0;
  if (days && hours) return phrase(" {d} 天 {h} 小时", " by {d} {d|day|days} {h} h", { d: days, h: hours });
  if (days) return phrase(" {d} 天", " by {d} {d|day|days}", { d: days });
  if (hours) return phrase(" {h} 小时", " by {h} h", { h: hours });
  return phrase("", "");
}

/** 改项目的那些命令（项目时间线上列出来）。 */
const PROJECT_COMMANDS = new Set([
  "project.create",
  "project.draft",
  "project.update",
  "project.set_structure",
  "project.start",
  "project.extend",
  "staff.set",
  "staff.add_position",
  "stage.add",
  "stage.update",
  "stage.move",
  "stage.remove",
  "stage.disable",
  "stage.accept",
  "stage.extend",
  "stage.set_lock",
  "stage.set_period",
  "stage.set_rate",
  "stage.set_reviewer",
  "stage.assign",
  "stage.unassign",
  "task.extend",
  "task.reopen",
  "task.publish",
  "hub.dispatch",
  "cut.add",
  "cut.update",
  "cut.archive",
]);

export interface ProjectTimelineItem {
  key: string;
  seq: number;
  at: IsoDateTime;
  command: string;
  memberId: Id | null;
  text: string;
  phrase: Phrase;
  /** 为什么（延期、停用、加卡时写的原因）。 */
  reason: string | null;
}

function projectOfEntry(state: WorldState, e: JournalEntry): Id | null {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  if (typeof p.projectId === "string") return p.projectId;
  if (e.created?.projectId) return e.created.projectId;
  const stageId = (p.stageId ?? p.hubStageId) as Id | undefined;
  if (stageId && state.stages[stageId]) return state.stages[stageId].projectId;
  if (typeof p.taskId === "string" && state.tasks[p.taskId]) return state.tasks[p.taskId].projectId;
  if (Array.isArray(p.taskIds) && typeof p.taskIds[0] === "string" && state.tasks[p.taskIds[0]]) return state.tasks[p.taskIds[0]].projectId;
  if (typeof p.cutId === "string" && state.cuts[p.cutId]) return state.cuts[p.cutId].projectId;
  return null;
}

/** 项目时间线：改项目的每一步（谁、改了什么、为什么），新的在前。 */
export function projectTimeline(state: WorldState, projectId: Id): ProjectTimelineItem[] {
  const out: ProjectTimelineItem[] = [];
  for (const e of state.journal) {
    if (!PROJECT_COMMANDS.has(e.command)) continue;
    if (e.command === "task.reopen" && !(Array.isArray((e.payload as { comments?: unknown[] })?.comments) && (e.payload as { comments: unknown[] }).comments.length)) continue;
    if (projectOfEntry(state, e) !== projectId) continue;
    const ph = feedPhrase(state, e);
    if (!ph) continue;
    const text = phraseText(ph, "zh");
    const p = (e.payload ?? {}) as Record<string, unknown>;
    // 打回重做的「为什么」= 写的意见。
    const comments = Array.isArray(p.comments) ? (p.comments as { text?: unknown }[]).map((c) => (typeof c?.text === "string" ? c.text.trim() : "")).filter(Boolean) : [];
    const reason = typeof p.reason === "string" && p.reason.trim() ? p.reason.trim() : comments.length ? comments.join("；") : null;
    out.push({ key: e.id, seq: e.seq, at: e.worldAt ?? e.createdAt, command: e.command, memberId: e.actorMemberId, text, phrase: ph, reason });
  }
  return out.reverse();
}

/** 工会动态：按世界时间倒着排（同一刻按日志顺序），最近的 `limit` 条。 */
export function feedOf(state: WorldState, limit = 12): FeedItem[] {
  const order = state.journal.map((e, i) => ({ e, i, t: timeKey(e.worldAt ?? e.createdAt) }));
  order.sort((a, b) => b.t - a.t || b.i - a.i);
  const out: FeedItem[] = [];
  for (const { e } of order) {
    if (out.length >= limit) break;
    const ph = feedPhrase(state, e);
    if (ph) out.push({ entry: e, at: e.worldAt ?? e.createdAt, memberId: e.actorMemberId, text: phraseText(ph, "zh"), phrase: ph });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 报到页
// ---------------------------------------------------------------------------

export interface EnrollOption {
  template: StageTemplate;
  /** 现在可接几张（进行中的项目里）。 */
  open: number;
  enrolled: number;
  mine: EnrollmentRow | null;
  /** 我手上这个环节有几张。 */
  active: number;
  tn: number;
  per: number;
  /** 进行中的项目里这个环节都锁成「只给指派的人」。 */
  locked: boolean;
  /** 锁着、我又没被指派。 */
  lockedForMe: boolean;
}

export function enrollOptions(state: WorldState, memberId: Id | null, group: Group): EnrollOption[] {
  const idx = indexOf(state);
  const tpl = groupTemplate(group);
  const activeProjects = new Set(idx.projects.filter((p) => p.group === group && p.status === "active").map((p) => p.id));
  return tpl.stages.map((t) => {
    const stageIds = new Set<Id>();
    for (const p of Array.from(activeProjects)) for (const s of idx.stagesByProject.get(p) ?? []) if (s.templateKey === t.key) stageIds.add(s.id);
    let open = 0;
    let active = 0;
    for (const id of Array.from(stageIds))
      for (const task of idx.tasksByStage.get(id) ?? []) {
        if (task.status === "open" && !task.outsourced) open += 1;
        if (memberId && task.assigneeId === memberId && ACTIVE_STATUS.includes(task.status)) active += 1;
      }
    const rate = rateFor(idx.world?.rules, group, t.key);
    const mineRow = memberId ? idx.enrollments.find((e) => e.memberId === memberId && e.group === group && e.stageKey === t.key) ?? null : null;
    const stagesHere = Array.from(stageIds).map((id) => idx.stageById.get(id)!).filter(Boolean);
    const lockedAll = stagesHere.length > 0 && stagesHere.every((s) => stageLocked(s));
    return {
      template: t,
      locked: lockedAll,
      lockedForMe: lockedAll && !mineRow?.assigned,
      open,
      enrolled: new Set(idx.enrollments.filter((e) => e.group === group && e.stageKey === t.key).map((e) => e.memberId)).size,
      mine: memberId ? idx.enrollments.find((e) => e.memberId === memberId && e.group === group && e.stageKey === t.key) ?? null : null,
      active,
      tn: rate?.tn ?? t.tn,
      per: rate?.per ?? t.per,
    };
  });
}

// ---------------------------------------------------------------------------
// 枢纽派发
// ---------------------------------------------------------------------------

export interface DispatchRowView {
  task: TaskRow;
  cut: CutRow | null;
  label: string;
  editable: boolean;
}

export interface DispatchScope {
  stage: StageRow;
  rows: DispatchRowView[];
  enrolled: number;
  /** 直接接在枢纽后面的（默认勾上）。 */
  direct: boolean;
}

export interface DispatchPlan {
  hub: StageRow;
  project: ProjectRow;
  scopes: DispatchScope[];
  /** 离计划结束还有几天（已经过了 = 0）。 */
  daysLeft: number;
}

export function hubStages(state: WorldState, projectId: Id): StageRow[] {
  return stagesOf(state, projectId).filter((s) => s.hub);
}

export function dispatchPlan(state: WorldState, hubStageId: Id): DispatchPlan | null {
  const idx = indexOf(state);
  const hub = idx.stageById.get(hubStageId);
  if (!hub || !hub.hub) return null;
  const project = idx.projectById.get(hub.projectId);
  if (!project) return null;
  const stages = idx.stagesByProject.get(project.id) ?? [];
  const direct = new Set(stages.filter((s) => s.upstream.includes(hub.templateKey)).map((s) => s.id));
  const scopes = hubScope(stages, hub).map((stage) => ({
    stage,
    direct: direct.has(stage.id),
    enrolled: new Set(idx.enrollments.filter((e) => e.group === project.group && e.stageKey === stage.templateKey).map((e) => e.memberId)).size,
    rows: (idx.tasksByStage.get(stage.id) ?? []).map((task) => {
      const cut = task.cutId ? idx.cutById.get(task.cutId) ?? null : null;
      return { task, cut, label: taskLabel(stage, cut, task, project.group), editable: task.status === "locked" || task.status === "open" || task.status === "reclaimed" };
    }),
  }));
  return { hub, project, scopes, daysLeft: Math.max(0, daysBetween(todayOf(state), project.planEndOn)) };
}

/** 大概要几个人、几天：总工时 ÷（报到人数 × 每天 4 小时）；按计划结束倒推要几个人。 */
export function estimateOf(hours: number, enrolled: number, daysLeft: number): { hours: number; days: number; peopleByPlan: number | null } {
  const h = Math.max(0, hours);
  const days = h === 0 ? 0 : Math.ceil(h / (Math.max(1, enrolled) * HOURS_PER_DAY));
  const peopleByPlan = daysLeft > 0 ? Math.ceil(h / (daysLeft * HOURS_PER_DAY)) : null;
  return { hours: Math.round(h * 10) / 10, days, peopleByPlan };
}

export function stageHours(stage: StageRow, workload: number): number {
  return hoursOf(stage, workload);
}

// ---------------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------------

/** 工时与系数表：每个组每个环节现在的 Tn / per / 掌控系数。 */
export function rateTable(state: WorldState, group: Group): { template: StageTemplate; tn: number; per: number; control: number; changed: boolean }[] {
  const rules = theWorld(state)?.rules;
  return groupTemplate(group).stages.map((t) => {
    const r = rateFor(rules, group, t.key);
    return { template: t, tn: r?.tn ?? t.tn, per: r?.per ?? t.per, control: r?.control ?? 1, changed: !!r };
  });
}

export function deadlineFactor(state: WorldState): number {
  return deadlineFactorOf(theWorld(state)?.rules);
}

export function groupLabel(group: Group): string {
  return GROUP_LABEL[group];
}

/** 这周一到今天（动态里「本周」）。 */
export function thisWeek(state: WorldState): { from: string; to: string } {
  const today = todayOf(state);
  return { from: weekStartOf(today), to: addDays(weekStartOf(today), 6) };
}

/** 活力点的字。 */
export const points = formatPoints;

// ---------------------------------------------------------------------------
// 资料库（SPEC §11）
// ---------------------------------------------------------------------------

export type FileKind = "image" | "sheet" | "pdf" | "video" | "archive" | "clip" | "other";

export const FILE_KIND_LABEL: Record<FileKind, string> = { image: "图片", sheet: "表格", pdf: "PDF", video: "视频", archive: "压缩包", clip: "CLIP 文件", other: "文件" };

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : "";
}

export function fileKind(f: Pick<FileRow, "name" | "mime" | "width">): FileKind {
  const ext = extOf(f.name);
  if (f.width || f.mime.startsWith("image/")) return "image";
  if (["xlsx", "xlsm", "xls", "csv", "ods"].includes(ext)) return "sheet";
  if (ext === "pdf" || f.mime === "application/pdf") return "pdf";
  if (["mp4", "webm", "mov", "m4v"].includes(ext) || f.mime.startsWith("video/")) return "video";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  if (ext === "clip") return "clip";
  return "other";
}

/** 「1.2 MB」 */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export interface FileView {
  file: FileRow;
  kind: FileKind;
  kindLabel: string;
  uploader: MemberRow | null;
  /** 挂在哪：「C005 · 上色 · A 层 v04」「资料库」「资料页「设定集」」。 */
  where: string;
  whereP: Phrase;
  cut: CutRow | null;
  pins: { open: number; total: number };
}

export function fileWhere(state: WorldState, f: FileRow): string {
  return phraseText(fileWhereP(state, f), "zh");
}

export function fileWhereP(state: WorldState, f: FileRow): Phrase {
  const idx = indexOf(state);
  const project = idx.projectById.get(f.projectId);
  switch (f.subjectType) {
    case "project":
      return phrase("资料库", "Library");
    case "cut": {
      const c = idx.cutById.get(f.subjectId);
      return c ? phrase("{cut}", "{cut}", { cut: cutCode2(c, project?.group) }) : phrase("卡", "Cut");
    }
    case "task": {
      const v = taskViewById(state, f.subjectId);
      return v ? v.labelP : phrase("任务", "Task");
    }
    case "submission": {
      const sub = state.submissions[f.subjectId];
      const v = sub ? taskViewById(state, sub.taskId) : null;
      return v ? phrase("{label} {v}", "{label} {v}", { label: v.labelP, v: vOf(sub.versionNo) }) : phrase("版本", "Version");
    }
    case "page":
      return phrase("资料页「{title}」", "Page “{title}”", { title: uc(state.pages[f.subjectId]?.title ?? "") });
    case "thread": {
      const t = state.threads[f.subjectId];
      return t ? phrase("{kind}里", "In a {kind}", { kind: THREAD_KIND_TEXT[t.kind] }) : phrase("意见里", "In a comment");
    }
  }
}

export function fileView(state: WorldState, f: FileRow): FileView {
  const idx = indexOf(state);
  const kind = fileKind(f);
  const pins = idx.pinsByFile.get(f.id) ?? [];
  return {
    file: f,
    kind,
    kindLabel: FILE_KIND_LABEL[kind],
    uploader: idx.memberById.get(f.byMemberId) ?? null,
    where: fileWhere(state, f),
    whereP: fileWhereP(state, f),
    cut: f.cutId ? idx.cutById.get(f.cutId) ?? null : null,
    pins: { open: pins.filter((p) => p.status === "open").length, total: pins.length },
  };
}

export function fileById(state: WorldState, id: Id | null | undefined): FileRow | undefined {
  return id ? indexOf(state).fileById.get(id) : undefined;
}

export interface LibraryFilter {
  cutId?: Id | null;
  stageKey?: string | null;
  kind?: FileKind | null;
  tag?: string | null;
  byMemberId?: Id | null;
  q?: string | null;
  order?: "new" | "old";
}

/** 一个项目的资料库：这个项目里所有文件（不管挂在哪），可以筛、可以搜文件名，按时间排。 */
export function libraryOf(state: WorldState, projectId: Id, filter: LibraryFilter = {}): FileView[] {
  const q = filter.q?.trim().toLowerCase() ?? "";
  const list = indexOf(state).files.filter((f) => {
    if (f.projectId !== projectId) return false;
    if (filter.cutId && f.cutId !== filter.cutId) return false;
    if (filter.stageKey && f.stageKey !== filter.stageKey) return false;
    if (filter.kind && fileKind(f) !== filter.kind) return false;
    if (filter.tag && !f.tags.includes(filter.tag)) return false;
    if (filter.byMemberId && f.byMemberId !== filter.byMemberId) return false;
    // 只比 ASCII 和字本身（toLowerCase 只影响拉丁字母），不用 localeCompare。
    if (q && !f.name.toLowerCase().includes(q)) return false;
    return true;
  });
  const ordered = filter.order === "old" ? list : [...list].reverse();
  return ordered.map((f) => fileView(state, f));
}

export function libraryFacets(state: WorldState, projectId: Id): { tags: string[]; uploaders: MemberRow[]; stageKeys: string[] } {
  const idx = indexOf(state);
  const files = idx.files.filter((f) => f.projectId === projectId);
  const tags = Array.from(new Set(files.flatMap((f) => f.tags))).sort(cmp);
  const uploaderIds = new Set(files.map((f) => f.byMemberId));
  const stageKeys = new Set(files.map((f) => f.stageKey).filter((k): k is string => !!k));
  return {
    tags,
    uploaders: idx.members.filter((m) => uploaderIds.has(m.id)),
    stageKeys: (idx.stagesByProject.get(projectId) ?? []).map((s) => s.templateKey).filter((k) => stageKeys.has(k)),
  };
}

/** 挂在某个东西上的文件（卡详情、交的版本、意见、资料页）。 */
export function filesOn(state: WorldState, subjectType: FileRow["subjectType"], subjectId: Id): FileRow[] {
  return indexOf(state).files.filter((f) => f.subjectType === subjectType && f.subjectId === subjectId);
}

/** 这一卡的全部文件（不管挂在卡、任务还是版本上）。 */
export function filesOfCut(state: WorldState, cutId: Id): FileRow[] {
  return indexOf(state).files.filter((f) => f.cutId === cutId);
}

/** 同一张任务所有版本上的文件。 */
export function filesOfTask(state: WorldState, taskId: Id): FileRow[] {
  const subs = new Set(submissionsOf(state, taskId).map((s) => s.id));
  return indexOf(state).files.filter((f) => (f.subjectType === "task" && f.subjectId === taskId) || (f.subjectType === "submission" && subs.has(f.subjectId)));
}

export function pinsOf(state: WorldState, fileId: Id): PinRow[] {
  return indexOf(state).pinsByFile.get(fileId) ?? [];
}

export interface PinView {
  pin: PinRow;
  file: FileRow;
  by: MemberRow | null;
  /** 「安娜的旅程 · C005 · 上色 A 层 v04」 */
  where: string;
  whereP: Phrase;
}

export function pinView(state: WorldState, pin: PinRow): PinView | null {
  const f = indexOf(state).fileById.get(pin.fileId);
  if (!f) return null;
  const project = projectById(state, f.projectId);
  const whereP = project ? phrase("{project} · {where}", "{project} · {where}", { project: uc(project.name), where: fileWhereP(state, f) }) : fileWhereP(state, f);
  return { pin, file: f, by: memberById(state, pin.byMemberId) ?? null, where: phraseText(whereP, "zh"), whereP };
}

/**
 * 两版对比的候选：同一卡同一环节的别的图（先），再是同一卡的，再是同一个项目的；新的在前。
 */
export function compareCandidates(state: WorldState, fileId: Id): FileRow[] {
  const idx = indexOf(state);
  const f = idx.fileById.get(fileId);
  if (!f) return [];
  const images = idx.files.filter((x) => x.id !== f.id && x.projectId === f.projectId && fileKind(x) === "image");
  const rank = (x: FileRow) => (f.cutId && x.cutId === f.cutId && x.stageKey === f.stageKey ? 0 : f.cutId && x.cutId === f.cutId ? 1 : 2);
  return images.sort((a, b) => rank(a) - rank(b) || cmp(timeKey(b.at), timeKey(a.at)) || cmp(a.id, b.id));
}

export function pagesOf(state: WorldState, projectId: Id): PageRow[] {
  return indexOf(state).pages.filter((p) => p.projectId === projectId);
}

export function pageById(state: WorldState, id: Id | null | undefined): PageRow | undefined {
  const p = id ? state.pages?.[id] : undefined;
  return p && !p.archivedAt ? p : undefined;
}

export function blocksOf(state: WorldState, pageId: Id): BlockRow[] {
  return indexOf(state).blocksByPage.get(pageId) ?? [];
}

/** 资料库里一共存了多少字节（同一个文件只算一次）。 */
export function libraryBytes(state: WorldState): { files: number; bytes: number } {
  const seen = new Map<string, number>();
  for (const f of indexOf(state).files) seen.set(f.sha256, f.size);
  let bytes = 0;
  for (const v of Array.from(seen.values())) bytes += v;
  return { files: seen.size, bytes };
}

/** 世界里用到的全部文件的 sha256（导出「连文件一起」用）。 */
export function usedShas(state: WorldState): { sha256: string; size: number; mime: string; name: string }[] {
  const seen = new Map<string, { sha256: string; size: number; mime: string; name: string }>();
  for (const f of Object.values(state.files ?? {})) if (!seen.has(f.sha256)) seen.set(f.sha256, { sha256: f.sha256, size: f.size, mime: f.mime, name: f.name });
  return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// 灵活性（SPEC §13）：随时发的新任务 · 职位 · 排期
// ---------------------------------------------------------------------------

/** 一个环节上发过的额外 / 修正 / 补设定任务（新的在前）。 */
export function extrasOfStage(state: WorldState, stageId: Id): TaskRow[] {
  return [...(indexOf(state).extrasByStage.get(stageId) ?? [])].sort(compareBy<TaskRow>((t) => timeKey(t.extra?.at ?? t.createdAt))).reverse();
}

export interface MemberRoles {
  /** 管理员指派的职位。 */
  assigned: { enrollment: EnrollmentRow; name: string }[];
  /** 自己报到 / 自己认领做过的环节（没被指派的）。 */
  own: { enrollment: EnrollmentRow; name: string; claimed: boolean; done: number }[];
}

export function memberRoles(state: WorldState, memberId: Id): MemberRoles {
  const idx = indexOf(state);
  const mine = idx.enrollments.filter((e) => e.memberId === memberId);
  const nameOf = (e: EnrollmentRow) => groupTemplate(e.group).stages.find((t) => t.key === e.stageKey)?.name ?? e.stageKey;
  const done = (e: EnrollmentRow) =>
    idx.tasks.filter((t) => {
      if (t.status !== "passed") return false;
      const s = idx.stageById.get(t.stageId);
      const p = idx.projectById.get(t.projectId);
      return s?.templateKey === e.stageKey && p?.group === e.group && (idx.subsByTask.get(t.id) ?? []).some((x) => x.byMemberId === memberId);
    }).length;
  return {
    assigned: mine.filter((e) => e.assigned).map((enrollment) => ({ enrollment, name: nameOf(enrollment) })),
    own: mine.filter((e) => !e.assigned).map((enrollment) => ({ enrollment, name: nameOf(enrollment), claimed: (enrollment.origin ?? "self") === "claimed", done: done(enrollment) })),
  };
}

export interface ScheduleRow {
  stage: StageRow;
  /** 计划（第几周开始、到第几周结束，1 起）。 */
  plan: { start: number; end: number; custom: boolean };
  /** 实际：从第一张被接到最后一张通过（没完就到今天）。没开始 = null。 */
  actual: { start: number; end: number; done: boolean } | null;
  progress: number;
  /** 比计划多出来的周数（0 = 没超）。 */
  overrun: number;
  /** 下游计划开始早于上游计划结束：提醒一句（不拦）。 */
  warning: string | null;
  warningP: Phrase | null;
}

export interface Schedule {
  project: ProjectRow;
  cycleDays: number;
  /** 一共画几周。 */
  weeks: number;
  /** 今天在第几周。 */
  today: number;
  /** 每一周的开始日子。 */
  weekStarts: string[];
  phases: { phase: Phase; rows: ScheduleRow[] }[];
}

/** 第几周（1 起）：从项目开始那天算，每 cycleDays 天一格。 */
export function weekOf(project: ProjectRow, date: string): number {
  const days = daysBetween(project.startOn, date);
  return Math.floor(days / (project.cycleDays ?? 7)) + 1;
}

/** 没改过计划时的默认值：沿着上游往下排，一个环节一格接一格（最长那条路正好排满计划工期）。 */
export function defaultPlans(stages: StageRow[], totalWeeks: number): Map<Id, { start: number; end: number }> {
  const live = stages.filter((s) => !s.archivedAt).sort(bySort);
  const byKey = new Map(live.map((s) => [s.templateKey, s]));
  const depth = new Map<string, number>();
  const depthOf = (s: StageRow, seen = new Set<string>()): number => {
    const hit = depth.get(s.templateKey);
    if (hit !== undefined) return hit;
    if (seen.has(s.templateKey)) return 0;
    seen.add(s.templateKey);
    const ups = s.upstream.map((k) => byKey.get(k)).filter((x): x is StageRow => !!x);
    const d = ups.length ? Math.max(...ups.map((u) => depthOf(u, seen))) + 1 : 0;
    depth.set(s.templateKey, d);
    return d;
  };
  for (const s of live) depthOf(s);
  const levels = Math.max(1, ...Array.from(depth.values()).map((d) => d + 1));
  const per = Math.max(1, Math.floor(totalWeeks / levels));
  const out = new Map<Id, { start: number; end: number }>();
  for (const s of live) {
    const d = depth.get(s.templateKey) ?? 0;
    const start = d * per + 1;
    out.set(s.id, { start, end: start + per - 1 });
  }
  return out;
}

export function scheduleOf(state: WorldState, projectId: Id): Schedule | null {
  const idx = indexOf(state);
  const project = idx.projectById.get(projectId);
  if (!project) return null;
  const cycleDays = project.cycleDays ?? 7;
  const stages = idx.stagesByProject.get(projectId) ?? [];
  const planWeeks = Math.max(1, weekOf(project, project.planEndOn));
  const defaults = defaultPlans(stages, planWeeks);
  const today = weekOf(project, todayOf(state));
  const plans = new Map<Id, { start: number; end: number; custom: boolean }>();
  for (const s of stages) {
    const d = defaults.get(s.id) ?? { start: 1, end: 1 };
    plans.set(s.id, s.plan ? { start: s.plan.startWeek, end: s.plan.startWeek + s.plan.weeks - 1, custom: true } : { ...d, custom: false });
  }
  const byKey = new Map(stages.map((s) => [s.templateKey, s]));
  const rows: ScheduleRow[] = stages.map((stage) => {
    const tasks = idx.tasksByStage.get(stage.id) ?? [];
    const plan = plans.get(stage.id)!;
    const starts: string[] = [];
    for (const t of tasks) {
      const first = t.claimedAt ?? (idx.subsByTask.get(t.id) ?? [])[0]?.at ?? t.passedAt;
      if (first) starts.push(localDate(first));
    }
    const passed = tasks.filter((t) => t.status === "passed");
    const done = tasks.length > 0 && passed.length === tasks.length;
    let actual: ScheduleRow["actual"] = null;
    if (starts.length) {
      starts.sort(cmp);
      const endDate = done ? passed.map((t) => localDate(t.passedAt ?? t.updatedAt)).sort(cmp).pop()! : todayOf(state);
      actual = { start: weekOf(project, starts[0]), end: Math.max(weekOf(project, starts[0]), weekOf(project, endDate)), done };
    }
    // 超出：实际条在计划结束以后的那一段有几周（图上画成红色的那几格）；还没开始、已经过了计划 = 晚了几周。
    const overrun = actual ? Math.max(0, actual.end - Math.max(plan.end, actual.start - 1)) : Math.max(0, today - plan.end);
    let warning: string | null = null;
    let warningP: Phrase | null = null;
    for (const k of stage.upstream) {
      const up = byKey.get(k);
      const upPlan = up ? plans.get(up.id) : undefined;
      if (up && upPlan && plan.start < upPlan.end) {
        warningP = phrase("计划开始（第 {a} 周）早于上游「{up}」计划结束（第 {b} 周）", "Planned start (week {a}) is before upstream “{up}” is planned to end (week {b})", { a: plan.start, up: stageParam(project.group, up), b: upPlan.end });
        warning = phraseText(warningP, "zh");
        break;
      }
    }
    return { stage, plan, actual, progress: tasks.length ? passed.length / tasks.length : 0, overrun, warning, warningP };
  });
  const weeks = Math.max(planWeeks, today, ...rows.map((r) => Math.max(r.plan.end, r.actual?.end ?? 0)));
  const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(project.startOn, i * cycleDays));
  return { project, cycleDays, weeks, today, weekStarts, phases: PHASE.map((phase) => ({ phase, rows: rows.filter((r) => r.stage.phase === phase) })) };
}

// ---------------------------------------------------------------------------
// 零日：开工检查
// ---------------------------------------------------------------------------

export interface StartPreview {
  /** 结构填好了几卡。 */
  cuts: number;
  /** 开工会生成几张任务（按模板的环节：整个项目一张 · 每卡一张 · 每层一张）。 */
  tasks: number;
  /** 还没人的职位（模板里的名字 / 自己加的名字）。 */
  unfilled: { key: string; name: Text2 | string; custom: boolean }[];
  /** 人员表里填了人的成员，开工时会自动报到的有几人。 */
  autoEnroll: number;
  /** 开工会生成几个环节（照模板）。 */
  stages: number;
  /** 关键职位（每个环节对应的第一个职位）：一共几个、填了几个、空着的是哪几个。 */
  keyPositions: { total: number; filled: number; empty: (Text2 | string)[] };
  /** 外部名字（只记在人员表里，不报到）。 */
  externals: number;
  /** 文件名会是这样（拿第一个分层的环节和第一卡举例；还没有卡 = null）。 */
  sampleFile: string | null;
  /** 能不能开工（结构至少一卡）。 */
  ready: boolean;
}

export function startPreview(state: WorldState, projectId: Id): StartPreview | null {
  const p = projectById(state, projectId);
  if (!p) return null;
  const plan = p.cutsPlan ?? [];
  const tpl = PROJECT_TEMPLATES[p.template ?? "anim_standard"];
  let tasks = 0;
  if (tpl.stages)
    for (const t of groupTemplate(p.group).stages) {
      if (t.grain === "project") tasks += 1;
      else if (t.grain === "cut") tasks += plan.length;
      else tasks += plan.reduce((n, c) => n + c.layers.length, 0);
    }
  const staff = p.staff ?? [];
  const unfilled = staff
    .filter((pos) => !pos.people.length)
    .map((pos) => {
      const t = positionTemplate(p.template, pos.key);
      return pos.custom ? { key: pos.key, name: pos.custom.name, custom: true } : { key: pos.key, name: t ? t.name : pos.key, custom: !t };
    });
  const members = new Set<Id>();
  for (const pos of staff) if (pos.stageKeys.length) for (const x of pos.people) if ("memberId" in x) members.add(x.memberId);
  const seen = new Set<string>();
  const keys: NonNullable<ProjectRow["staff"]> = [];
  for (const pos of staff)
    for (const k of pos.stageKeys)
      if (!seen.has(k)) {
        seen.add(k);
        if (!keys.includes(pos)) keys.push(pos);
      }
  const tplStages = tpl.stages ? groupTemplate(p.group).stages : [];
  const sampleStage = tplStages.find((t) => t.grain === "layer" && t.code) ?? tplStages.find((t) => t.grain === "cut") ?? null;
  const first = plan[0];
  const sampleFile =
    sampleStage && first
      ? fileNameFor(p, { code: sampleStage.code, fileCode: sampleStage.fileCode }, { number: first.number, episode: first.episode, scene: first.scene }, sampleStage.grain === "layer" ? first.layers[0]?.name ?? null : null, 1)
      : null;
  return {
    cuts: plan.length,
    tasks,
    unfilled,
    autoEnroll: members.size,
    ready: plan.length > 0,
    stages: tplStages.length,
    keyPositions: {
      total: keys.length,
      filled: keys.filter((x) => x.people.length).length,
      empty: keys.filter((x) => !x.people.length).map((pos) => (pos.custom ? pos.custom.name : positionTemplate(p.template, pos.key)?.name ?? pos.key)),
    },
    externals: staff.reduce((n, pos) => n + pos.people.filter((x) => "name" in x).length, 0),
    sampleFile,
  };
}

// ---------------------------------------------------------------------------
// v1.1 · 项目按环节分层（SPEC §17）：环节路线 · 环节页
// ---------------------------------------------------------------------------

/** 环节在路线上的状态：还没到 · 可以开始 · 进行中 · 待验收 · 已结束。 */
export type RouteStatus = "locked" | "ready" | "active" | "review" | "done";
export const ROUTE_STATUS: readonly RouteStatus[] = ["locked", "ready", "active", "review", "done"];

export interface RouteCounts {
  total: number;
  passed: number;
  /** 交了等审。 */
  submitted: number;
  /** 在做（已接 · 退回）。 */
  working: number;
  /** 可接（含收回的）。 */
  open: number;
  locked: number;
}

export interface RoutePerson {
  memberId: Id | null;
  name: string;
  external: boolean;
}

export interface RouteRow {
  /** 第几个环节（1 起，按路线顺序）。 */
  no: number;
  stage: StageRow;
  status: RouteStatus;
  counts: RouteCounts;
  /** 在这个环节做事的人：人员表里管这个环节的 + 接过这个环节任务的（外包写名字）。 */
  people: RoutePerson[];
  plan: { start: number; end: number } | null;
  actual: { start: number; end: number; done: boolean } | null;
  /** 超出计划几周。 */
  overrun: number;
  alerts: { pending: number; returned: number; nearDue: number; noPeople: boolean };
  /** 这个环节随时发的新任务还没做完的几张。 */
  extrasOpen: number;
  current: boolean;
}

export interface RoutePhase {
  phase: Phase;
  rows: RouteRow[];
  done: number;
  total: number;
  allDone: boolean;
  /** 这一段走到哪（最后一个开始了的环节）。 */
  reached: RouteRow | null;
  started: boolean;
}

export interface StageRoute {
  project: ProjectRow;
  rows: RouteRow[];
  phases: RoutePhase[];
  /** 现在在第几个环节：最早的那个还没结束、正在做的（卡住进度的）；没有在做的 = 最早等验收的；都没开始 = 第一个可以开始的。 */
  current: RouteRow | null;
  /** 最远做到哪（开始了的环节里最后一个，比「现在」靠后时才有）。 */
  farthest: RouteRow | null;
  total: number;
}

const NEAR_DUE_MS = 6 * 3600_000;

/** 一个环节的状态（只看流程里的任务，随时发的新任务不算）。 */
export function routeStatusOf(stage: StageRow, tasks: TaskRow[]): RouteStatus {
  if (stage.acceptedAt) return "done";
  const list = tasks.filter((t) => !t.extra && !t.archivedAt);
  if (!list.length) return "locked";
  if (list.every((t) => t.status === "passed")) return "review";
  if (list.some((t) => t.status === "claimed" || t.status === "submitted" || t.status === "returned" || t.status === "passed")) return "active";
  if (list.some((t) => t.status === "open" || t.status === "reclaimed")) return "ready";
  return "locked";
}

function routeCounts(tasks: TaskRow[]): RouteCounts {
  const c: RouteCounts = { total: 0, passed: 0, submitted: 0, working: 0, open: 0, locked: 0 };
  for (const t of tasks) {
    if (t.extra || t.archivedAt) continue;
    c.total += 1;
    if (t.status === "passed") c.passed += 1;
    else if (t.status === "submitted") c.submitted += 1;
    else if (t.status === "claimed" || t.status === "returned") c.working += 1;
    else if (t.status === "open" || t.status === "reclaimed") c.open += 1;
    else c.locked += 1;
  }
  return c;
}

/** 管这个环节的人：人员表（职位）里的 + 接过这个环节任务的。 */
export function stagePeopleOf(state: WorldState, stage: StageRow): RoutePerson[] {
  const idx = indexOf(state);
  const p = idx.projectById.get(stage.projectId);
  const out: RoutePerson[] = [];
  const seen = new Set<string>();
  const add = (x: RoutePerson) => {
    const k = x.memberId ? `m:${x.memberId}` : `n:${x.name}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(x);
  };
  for (const pos of p?.staff ?? []) {
    if (!pos.stageKeys.includes(stage.templateKey)) continue;
    for (const x of pos.people) {
      if ("memberId" in x) {
        const m = idx.memberById.get(x.memberId);
        if (m) add({ memberId: m.id, name: m.nickname, external: false });
      } else add({ memberId: null, name: x.name, external: true });
    }
  }
  for (const t of [...(idx.tasksByStage.get(stage.id) ?? []), ...(idx.extrasByStage.get(stage.id) ?? [])]) {
    if (t.assigneeId) {
      const m = idx.memberById.get(t.assigneeId);
      if (m) add({ memberId: m.id, name: m.nickname, external: false });
    } else if (t.outsourced && t.outsourceName) add({ memberId: null, name: t.outsourceName, external: true });
    for (const sub of idx.subsByTask.get(t.id) ?? []) {
      if (sub.selfFix || !sub.byMemberId) continue;
      const m = idx.memberById.get(sub.byMemberId);
      if (m) add({ memberId: m.id, name: m.nickname, external: false });
    }
  }
  return out;
}

/** 项目页的环节路线：1…N 编号，每行的状态 · 进度 · 人 · 计划和实际 · 提醒。 */
export function stageRouteOf(state: WorldState, projectId: Id): StageRoute | null {
  const idx = indexOf(state);
  const project = idx.projectById.get(projectId);
  if (!project) return null;
  const stages = idx.stagesByProject.get(projectId) ?? [];
  const sched = scheduleOf(state, projectId);
  const schedRow = new Map<Id, ScheduleRow>();
  for (const ph of sched?.phases ?? []) for (const r of ph.rows) schedRow.set(r.stage.id, r);
  const now = Date.parse(nowOf(state));
  const rows: RouteRow[] = stages.map((stage, i) => {
    const tasks = idx.tasksByStage.get(stage.id) ?? [];
    const counts = routeCounts(tasks);
    const status = routeStatusOf(stage, tasks);
    const people = stagePeopleOf(state, stage);
    const sr = schedRow.get(stage.id);
    const nearDue = tasks.filter((t) => (t.status === "claimed" || t.status === "returned") && t.dueAt && Date.parse(t.dueAt) - now < NEAR_DUE_MS).length;
    const returned = tasks.filter((t) => t.status === "returned").length;
    const extrasOpen = (idx.extrasByStage.get(stage.id) ?? []).filter((t) => t.status !== "passed").length;
    return {
      no: i + 1,
      stage,
      status,
      counts,
      people,
      plan: sr ? { start: sr.plan.start, end: sr.plan.end } : null,
      actual: sr?.actual ?? null,
      overrun: sr?.overrun ?? 0,
      alerts: { pending: counts.submitted, returned, nearDue, noPeople: !people.length && status !== "done" && !stage.disabled },
      extrasOpen,
      current: false,
    };
  });
  const live = rows.filter((r) => !r.stage.disabled);
  // 「现在」= 最早的那个还没结束、正在做的环节（卡住进度的那个）；没有在做的，就是最早等验收的，再没有就是第一个可以开始的。
  const current = live.find((r) => r.status === "active") ?? live.find((r) => r.status === "review") ?? live.find((r) => r.status === "ready") ?? null;
  if (current) current.current = true;
  // 最远做到哪：开始了的环节里最后一个（比「现在」靠后才说）。
  const began = live.filter((r) => r.status === "active" || r.status === "review" || r.status === "done");
  const last = began[began.length - 1] ?? null;
  const farthest = last && current && last.no > current.no ? last : null;
  const phases: RoutePhase[] = PHASE.map((phase) => {
    const list = rows.filter((r) => r.stage.phase === phase);
    const active = list.filter((r) => !r.stage.disabled);
    const done = active.filter((r) => r.status === "done").length;
    const began = active.filter((r) => r.status !== "locked" && r.status !== "ready");
    return { phase, rows: list, done, total: active.length, allDone: active.length > 0 && done === active.length, reached: began.length ? began[began.length - 1] : null, started: began.length > 0 };
  });
  return { project, rows, phases, current, farthest, total: rows.length };
}

export interface StageTaskView {
  task: TaskRow;
  view: TaskView;
  latest: SubmissionRow | null;
  /** 最近一次审核（交付物里写谁审的、质量）。 */
  review: ReviewRow | null;
}

export interface StagePerson extends RoutePerson {
  /** 怎么来的：人员表指派 · 自己认领 / 接过任务。 */
  how: "assigned" | "claimed";
  inHand: number;
  passed: number;
  /** 准时率（这个环节里交过的）；没交过 = null。 */
  onTime: number | null;
  /** 熟练度（报到这个环节记的；外部名字 = null）。 */
  skill: number | null;
}

export interface StagePage {
  project: ProjectRow;
  row: RouteRow;
  /** 整条路线（页头的上游 / 下游写它们的状态）。 */
  routeRows: RouteRow[];
  prev: RouteRow | null;
  next: RouteRow | null;
  upstream: StageRow[];
  downstream: StageRow[];
  tasks: StageTaskView[];
  extras: StageTaskView[];
  people: StagePerson[];
  reviewer: MemberRow | null;
  /** 这个环节是枢纽：派发下游时管到哪些环节。 */
  hubScope: StageRow[];
  /** 等审核的：几张、最早交的那一版是什么时候（审核员那一行写「最久等了多久」）。 */
  pendingReview: { n: number; oldestAt: IsoDateTime | null };
}

function stageTaskView(state: WorldState, t: TaskRow): StageTaskView | null {
  const view = taskView(state, t);
  if (!view) return null;
  const subs = submissionsOf(state, t.id);
  const reviews = reviewsOf(state, t.id);
  return { task: t, view, latest: subs[subs.length - 1] ?? null, review: reviews[reviews.length - 1] ?? null };
}

/** 第二层 · 环节页（`#/project/<id>/stage/<key>`）要的东西。 */
export function stagePageOf(state: WorldState, projectId: Id, key: string): StagePage | null {
  const route = stageRouteOf(state, projectId);
  if (!route) return null;
  const i = route.rows.findIndex((r) => r.stage.templateKey === key);
  if (i < 0) return null;
  const row = route.rows[i];
  const idx = indexOf(state);
  const stages = route.rows.map((r) => r.stage);
  const stage = row.stage;
  const byKey = new Map(stages.map((s) => [s.templateKey, s]));
  const upstream = stage.upstream.map((k) => byKey.get(k)).filter((s): s is StageRow => !!s);
  const downstream = stages.filter((s) => s.upstream.includes(stage.templateKey));
  const tasks = (idx.tasksByStage.get(stage.id) ?? []).map((t) => stageTaskView(state, t)).filter((x): x is StageTaskView => !!x);
  const extras = (idx.extrasByStage.get(stage.id) ?? []).map((t) => stageTaskView(state, t)).filter((x): x is StageTaskView => !!x);
  const staffIds = new Set<string>();
  for (const pos of route.project.staff ?? []) {
    if (!pos.stageKeys.includes(stage.templateKey)) continue;
    for (const x of pos.people) staffIds.add("memberId" in x ? `m:${x.memberId}` : `n:${x.name}`);
  }
  const all = [...tasks, ...extras];
  const people: StagePerson[] = row.people.map((x) => {
    const mine = all.filter((v) => (x.memberId ? v.task.assigneeId === x.memberId : v.task.outsourced && v.task.outsourceName === x.name));
    const subs = all.flatMap((v) => submissionsOf(state, v.task.id).filter((s) => !s.selfFix && (x.memberId ? s.byMemberId === x.memberId : false)));
    const firstSubs = new Map<Id, SubmissionRow>();
    for (const s of subs) if (!firstSubs.has(s.taskId)) firstSubs.set(s.taskId, s);
    const timed = Array.from(firstSubs.values());
    return {
      ...x,
      how: staffIds.has(x.memberId ? `m:${x.memberId}` : `n:${x.name}`) ? "assigned" : "claimed",
      inHand: mine.filter((v) => v.task.status === "claimed" || v.task.status === "returned").length,
      passed: x.memberId ? all.filter((v) => v.task.status === "passed" && submissionsOf(state, v.task.id).some((s) => s.byMemberId === x.memberId && !s.selfFix)).length : mine.filter((v) => v.task.status === "passed").length,
      onTime: timed.length ? timed.filter((s) => s.onTime).length / timed.length : null,
      skill: x.memberId ? idx.enrollments.find((e) => e.memberId === x.memberId && e.group === route.project.group && e.stageKey === stage.templateKey)?.skill ?? null : null,
    };
  });
  const waiting = all.filter((v) => v.task.status === "submitted" && v.latest).map((v) => v.latest!.at).sort(cmp);
  return {
    project: route.project,
    row,
    routeRows: route.rows,
    prev: route.rows[i - 1] ?? null,
    next: route.rows[i + 1] ?? null,
    upstream,
    downstream,
    tasks,
    extras,
    people,
    reviewer: stage.reviewerId ? idx.memberById.get(stage.reviewerId) ?? null : null,
    hubScope: stage.hub ? hubScope(stages, stage) : [],
    pendingReview: { n: waiting.length, oldestAt: waiting[0] ?? null },
  };
}

/** 这个环节的动态：派了谁、谁交了、谁审了、改了什么（新的在前）。 */
export function stageActivityOf(state: WorldState, stageId: Id, limit = 30): FeedItem[] {
  const out: FeedItem[] = [];
  const touches = (e: JournalEntry): boolean => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (p.stageId === stageId || p.hubStageId === stageId) return true;
    const ids = [p.taskId, ...(Array.isArray(p.taskIds) ? p.taskIds : []), e.created?.taskId].filter((x): x is string => typeof x === "string");
    if (ids.some((id) => state.tasks[id]?.stageId === stageId)) return true;
    for (const c of e.changes) {
      if (c.table === "stages" && (c.op === "insert" ? c.row.id : c.id) === stageId) return true;
      if (c.table === "tasks") {
        const id = c.op === "insert" ? c.row.id : c.id;
        if (state.tasks[id]?.stageId === stageId && c.op !== "insert") return true;
      }
    }
    return false;
  };
  for (let i = state.journal.length - 1; i >= 0 && out.length < limit; i--) {
    const e = state.journal[i];
    if (!touches(e)) continue;
    const ph = feedPhrase(state, e);
    if (ph) out.push({ entry: e, at: e.worldAt ?? e.createdAt, memberId: e.actorMemberId, text: phraseText(ph, "zh"), phrase: ph });
  }
  return out;
}
