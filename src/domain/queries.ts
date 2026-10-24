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
  SubmissionRow,
  TaskRow,
  TaskStatus,
  ThreadRow,
  WorldRow,
  WorldState,
} from "./model";
import { ACTIVE_STATUS, PHASE } from "./model";
import { cutCode, fileNameFor, folderFor, taskLabel } from "./naming";
import { HOURS_PER_DAY, deadlineFactorOf, hoursOf, levelOf, rateFor, rewardOf, stageLocked, type LevelInfo } from "./rules";
import { GROUPS, groupTemplate, type StageTemplate } from "./templates";
import { isAdmin, isReviewer } from "./commands/core";

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

const byNumber = compareBy<CutRow>((c) => numberKey(c.number));
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
  /** 「安娜的旅程 · C009 · 中割 · B 层」 */
  title: string;
  statusLabel: string;
  assignee: MemberRow | null;
  /** 外包时的名字。 */
  outsourceName: string | null;
  latest: SubmissionRow | null;
  /** 「v03」或 null。 */
  versionTag: string | null;
  /** 工作量的字：「20 张」。 */
  workloadLabel: string;
}

export function workloadLabel(stage: StageRow, workload: number, group?: Group): string {
  const unit = groupUnitLabel(stage, group);
  return `${formatNumber(workload)} ${unit}`;
}

function groupUnitLabel(stage: StageRow, group?: Group): string {
  if (group === "video" && stage.unit === "cut") return "期";
  return { sheet: "张", second: "秒", cut: "卡", item: "项" }[stage.unit];
}

export function taskView(state: WorldState, task: TaskRow): TaskView | null {
  const idx = indexOf(state);
  const stage = idx.stageById.get(task.stageId);
  const project = idx.projectById.get(task.projectId);
  if (!stage || !project) return null;
  const cut = task.cutId ? idx.cutById.get(task.cutId) ?? null : null;
  const label = taskLabel(stage, cut, task, project.group);
  const subs = idx.subsByTask.get(task.id) ?? [];
  const latest = subs.length ? subs[subs.length - 1] : null;
  return {
    task,
    stage,
    project,
    cut,
    label,
    title: `${project.name} · ${label}`,
    statusLabel: TASK_STATUS_LABEL[task.status],
    assignee: task.assigneeId ? idx.memberById.get(task.assigneeId) ?? null : null,
    outsourceName: task.outsourced ? task.outsourceName : null,
    latest,
    versionTag: latest ? `v${String(latest.versionNo).padStart(2, "0")}` : null,
    workloadLabel: workloadLabel(stage, task.workload, project.group),
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
  tasks: { task: TaskRow; label: string; assignee: MemberRow | null; latest: SubmissionRow | null; folder: string }[];
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
  /** 之前每一版和它的审核。 */
  history: { submission: SubmissionRow; review: ReviewRow | null }[];
  waitingMs: number;
}

export function canReview(state: WorldState, memberId: Id, task: TaskRow): { ok: boolean; reason: string | null } {
  const me = memberById(state, memberId);
  if (!isReviewer(me)) return { ok: false, reason: "只有审核员和管理员可以审核" };
  if (task.status !== "submitted") return { ok: false, reason: "现在没有等审核的版本" };
  const stage = stageById(state, task.stageId);
  const reviewerId = task.extra?.reviewerId ?? stage?.reviewerId ?? null;
  if (stage && reviewerId && reviewerId !== memberId && !isAdmin(me)) {
    return { ok: false, reason: `「${task.extra ? task.extra.title : stage.name}」由${memberById(state, reviewerId)?.nickname ?? "指定的审核员"}审核` };
  }
  const subs = submissionsOf(state, task.id);
  if (subs[subs.length - 1]?.byMemberId === memberId) return { ok: false, reason: "这一版是你交的，要别人来审" };
  return { ok: true, reason: null };
}

export function reviewItem(state: WorldState, task: TaskRow): ReviewItem | null {
  const view = taskView(state, task);
  const subs = submissionsOf(state, task.id);
  const submission = subs[subs.length - 1];
  if (!view || !submission) return null;
  const reviews = reviewsOf(state, task.id);
  return {
    view,
    submission,
    submitter: memberById(state, submission.byMemberId) ?? null,
    history: subs.slice(0, -1).map((s) => ({ submission: s, review: reviews.find((r) => r.submissionId === s.id) ?? null })),
    waitingMs: Math.max(0, msBetween(submission.at, nowOf(state))),
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
  submission?: SubmissionRow;
  review?: ReviewRow;
  thread?: ThreadRow;
  ruling?: RulingRow;
  file?: FileRow;
  pin?: PinRow;
  seq: number;
}

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
  const tasks = [...(idx.tasksByCut.get(cutId) ?? []), ...(idx.extrasByCut.get(cutId) ?? [])];
  const taskIds = new Set(tasks.map((t) => t.id));
  const items: TimelineItem[] = [];
  const stageOfTask = (t: TaskRow | undefined) => (t ? idx.stageById.get(t.stageId) ?? null : null);
  const name = (id: Id | null | undefined) => (id ? idx.memberById.get(id)?.nickname ?? "有人" : "有人");
  const labelOf = (t: TaskRow) => {
    const s = stageOfTask(t);
    return s ? `${s.name}${t.layer ? ` ${t.layer} 层` : ""}` : "任务";
  };
  for (const e of state.journal) {
    const kind = JOURNAL_KIND[e.command];
    if (!kind) continue;
    for (const ch of e.changes) {
      if (ch.op !== "update" || ch.table !== "tasks" || !taskIds.has(ch.id)) continue;
      const patch = ch.patch as Partial<TaskRow>;
      const prev = ch.prev as Partial<TaskRow>;
      const t = idx.taskById.get(ch.id)!;
      let text: string | null = null;
      if (kind === "claim" && patch.status === "claimed") text = patch.assigneeId ? `${name(patch.assigneeId)} 接了 ${labelOf(t)}` : `${labelOf(t)} 外包给 ${patch.outsourceName ?? "外包"}`;
      else if (kind === "release" && patch.status === "open") text = e.actorMemberId === prev.assigneeId ? `${name(prev.assigneeId)} 放弃了 ${labelOf(t)}，回到可接` : `${name(e.actorMemberId)} 把 ${labelOf(t)} 从 ${name(prev.assigneeId)} 手上收回给大家`;
      else if (kind === "expire") text = `${labelOf(t)} 超过时限没交，从 ${name(prev.assigneeId)} 手上收回到可接`;
      else if (kind === "reclaim") text = `${name(e.actorMemberId)} 收回了 ${labelOf(t)}`;
      else if (kind === "reopen") text = `${name(e.actorMemberId)} 重新放出了 ${labelOf(t)}`;
      else if (kind === "dispatch") text = `${name(e.actorMemberId)} 派发了 ${labelOf(t)}（${formatNumber(patch.workload ?? t.workload)} ${groupUnitLabel(stageOfTask(t)!, project?.group)}）`;
      if (!text) continue;
      items.push({ key: `${e.id}:${ch.id}`, at: e.worldAt ?? e.createdAt, kind, memberId: e.actorMemberId, task: t, stage: stageOfTask(t), text, seq: e.seq });
    }
  }
  const seqOf = new Map<Id, number>();
  state.journal.forEach((e) => {
    for (const v of Object.values(e.created ?? {})) seqOf.set(v, e.seq);
  });
  for (const t of tasks) {
    for (const s of idx.subsByTask.get(t.id) ?? []) {
      const who = s.byMemberId ? name(s.byMemberId) : t.outsourceName ?? "外包";
      items.push({
        key: s.id,
        at: s.at,
        kind: "submit",
        memberId: s.byMemberId,
        task: t,
        stage: stageOfTask(t),
        text: s.selfFix ? `${who} 自修出 v${String(s.versionNo).padStart(2, "0")}` : `${who} 交了 ${labelOf(t)} v${String(s.versionNo).padStart(2, "0")}${s.recordedById ? `（${name(s.recordedById)} 代交）` : ""}`,
        submission: s,
        seq: seqOf.get(s.id) ?? 0,
      });
    }
    for (const r of idx.reviewsByTask.get(t.id) ?? []) {
      const q = r.quality !== null ? `（质量 ${r.quality.toFixed(1)}）` : "";
      items.push({ key: r.id, at: r.at, kind: "review", memberId: r.byMemberId, task: t, stage: stageOfTask(t), text: `${name(r.byMemberId)} ${VERDICT_LABEL[r.verdict]}了 ${labelOf(t)}${q}`, review: r, seq: seqOf.get(r.id) ?? 0 });
    }
  }
  for (const th of idx.threads) {
    if (th.cutId !== cutId) continue;
    const t = th.subjectType === "task" ? idx.taskById.get(th.subjectId) ?? null : null;
    const stage = t ? stageOfTask(t) : null;
    const text = th.kind === "todo" ? th.text : `${name(th.byMemberId)} ${th.kind === "ask" ? "提问" : th.kind === "setting" ? "提了设定问题" : "留了意见"}`;
    items.push({ key: th.id, at: th.at, kind: "thread", memberId: th.byMemberId, task: t, stage, text, thread: th, seq: seqOf.get(th.id) ?? 0 });
  }
  for (const f of idx.files) {
    if (f.cutId !== cutId) continue;
    items.push({ key: f.id, at: f.at, kind: "file", memberId: f.byMemberId, task: null, stage: null, text: `${name(f.byMemberId)} 放了${f.width ? "图" : "文件"}「${f.name}」`, file: f, seq: seqOf.get(f.id) ?? 0 });
  }
  for (const p of idx.pins) {
    if (p.cutId !== cutId) continue;
    const f = idx.fileById.get(p.fileId);
    const t = p.taskId ? idx.taskById.get(p.taskId) ?? null : null;
    items.push({
      key: p.id,
      at: p.at,
      kind: "pin",
      memberId: p.byMemberId,
      task: t,
      stage: stageOfTask(t ?? undefined),
      text: `${name(p.byMemberId)} 在「${f?.name ?? "图"}」上${p.kind === "box" ? "框了" : "钉了"} #${p.number}${p.reviewTaskId ? "（审核退回时）" : ""}`,
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
    by: memberById(state, thread.byMemberId) ?? null,
    kindLabel: THREAD_KIND_LABEL[thread.kind],
  };
}

export interface Inbox {
  returned: Quest[];
  asked: ThreadView[];
  todos: ThreadView[];
  /** 图上的意见：@ 了我的、审核退回时钉在我的任务上的、钉在我手上任务的图上的。 */
  pins: PinView[];
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
  return { returned, asked, todos, pins, total: returned.length + asked.length + todos.length + pins.length };
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
}

function p0(p: Record<string, unknown>): Id {
  return String(p.pinId ?? "");
}

function taskShort(state: WorldState, id: unknown): string {
  const v = typeof id === "string" ? taskViewById(state, id) : null;
  return v ? `${v.project.code} ${v.label}` : "一张任务";
}

export function feedText(state: WorldState, e: JournalEntry): string | null {
  const who = memberById(state, e.actorMemberId)?.nickname ?? "有人";
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const created = e.created ?? {};
  switch (e.command) {
    case "guild.create":
      return `${who} 建了工会`;
    case "member.join":
      return `${who} 把 ${String(p.nickname ?? "")} 加进了工会`;
    case "member.set_role":
      return `${who} 改了 ${memberById(state, p.memberId as Id)?.nickname ?? "成员"} 的角色`;
    case "enroll.add": {
      const project = Object.values(GROUPS).find((g) => g.key === p.group);
      const stage = project?.stages.find((s) => s.key === p.stageKey);
      const got = created.taskId ? `，拿到 ${taskShort(state, created.taskId)}` : "";
      return `${who} 报到了「${stage?.name ?? "环节"}」${got}`;
    }
    case "task.claim":
      return `${who} 接了 ${taskShort(state, created.taskId ?? p.taskId)}`;
    case "task.submit": {
      const sub = created.submissionId ? state.submissions[created.submissionId] : undefined;
      return `${who} 交了 ${taskShort(state, p.taskId)}${sub ? ` v${String(sub.versionNo).padStart(2, "0")}` : ""}`;
    }
    case "task.review": {
      const r = created.reviewId ? state.reviews[created.reviewId] : undefined;
      const q = r?.quality ? `（质量 ${r.quality.toFixed(1)}）` : "";
      return `${who} ${VERDICT_LABEL[(p.verdict as "pass") ?? "pass"] ?? "审核"}了 ${taskShort(state, p.taskId)}${q}`;
    }
    case "task.release":
      return `${who} 放弃了 ${taskShort(state, p.taskId)}`;
    case "task.expire":
      return `${taskShort(state, p.taskId)} 超时，收回到可接`;
    case "task.reclaim":
      return `${who} 收回了 ${taskShort(state, p.taskId)}`;
    case "task.reopen":
      return `${who} 重新放出了 ${taskShort(state, p.taskId)}`;
    case "task.assign": {
      const ids = Array.isArray(p.taskIds) && p.taskIds.length ? (p.taskIds as Id[]) : [p.taskId as Id];
      const what = ids.length > 1 ? `${taskShort(state, ids[0])} 等 ${ids.length} 张` : taskShort(state, ids[0]);
      return `${who} 把 ${what} 派给了 ${p.memberId ? memberById(state, p.memberId as Id)?.nickname ?? "成员" : `外包（${String(p.outsourceName ?? "")}）`}`;
    }
    case "task.publish": {
      const t = created.taskId ? state.tasks[created.taskId] : undefined;
      const stage = t ? stageById(state, t.stageId) : undefined;
      if (!t?.extra) return null;
      const kind = { extra: "额外任务", fix: "修正", setting: "补设定" }[t.extra.kind];
      const to = t.assigneeId ? `，派给 ${memberById(state, t.assigneeId)?.nickname ?? "成员"}` : "，等人认领";
      return `${who} 在「${stage?.name ?? "环节"}」发了一张${kind}：${t.extra.title}${to}`;
    }
    case "role.assign":
    case "role.unassign": {
      const name = groupTemplate((p.group as Group) ?? "animation").stages.find((s) => s.key === p.stageKey)?.name ?? "环节";
      const m = memberById(state, p.memberId as Id)?.nickname ?? "成员";
      return e.command === "role.assign" ? `${who} 给 ${m} 指派了职位「${name}」` : `${who} 撤掉了 ${m} 的职位「${name}」`;
    }
    case "stage.set_lock":
      return `${who} 把「${stageById(state, p.stageId as Id)?.name ?? "环节"}」${p.locked ? "锁成只给指派的人" : "放开给大家认领"}`;
    case "stage.set_period":
      return `${who} 改了「${stageById(state, p.stageId as Id)?.name ?? "环节"}」的计划周期（第 ${String(p.startWeek)} 周起，${String(p.weeks)} 周）`;
    case "stage.set_rate":
      return `${who} 改了「${stageById(state, p.stageId as Id)?.name ?? "环节"}」的时限参数`;
    case "project.create":
      return `${who} 开了项目「${projectById(state, created.projectId)?.name ?? String(p.name ?? "")}」`;
    case "project.update":
      return `${who} 改了项目「${projectById(state, p.projectId as Id)?.name ?? ""}」`;
    case "hub.dispatch": {
      const hub = stageById(state, p.hubStageId as Id);
      const n = (Array.isArray(p.rows) ? p.rows.length : 0) + (Array.isArray(p.add) ? p.add.length : 0);
      return `${who} 在「${hub?.name ?? "枢纽"}」派发了 ${n} 张任务`;
    }
    case "thread.open": {
      const t = created.threadId ? state.threads[created.threadId] : undefined;
      if (!t) return null;
      const v = threadView(state, t);
      return `${who} 在 ${v.where} ${t.kind === "ask" ? "提问" : t.kind === "setting" ? "提了设定问题" : "留了意见"}`;
    }
    case "thread.reply": {
      const t = state.threads[p.threadId as Id];
      return t ? `${who} 回复了 ${threadView(state, t).where} 的${THREAD_KIND_LABEL[t.kind]}` : null;
    }
    case "ruling.make":
      return `${who} 拍板：${String(p.decision ?? "")}`;
    case "template.set_rate":
      return `${who} 改了「${groupTemplate((p.group as Group) ?? "animation").stages.find((s) => s.key === p.stageKey)?.name ?? "环节"}」的工时`;
    case "rules.set":
      return `${who} 改了工会规则`;
    case "file.add": {
      const f = created.fileId ? state.files[created.fileId] : undefined;
      return f ? `${who} 放了${f.width ? "图" : "文件"}「${f.name}」` : null;
    }
    case "pin.add": {
      const pin = created.pinId ? state.pins[created.pinId] : undefined;
      const f = pin ? state.files[pin.fileId] : undefined;
      return pin ? `${who} 在「${f?.name ?? "图"}」上${pin.kind === "box" ? "框了" : "钉了"} #${pin.number}：${pin.text}` : null;
    }
    case "pin.reply": {
      const pin = state.pins[p0(p)];
      return pin ? `${who} 回复了 #${pin.number}（${state.files[pin.fileId]?.name ?? "图"}）` : null;
    }
    case "pin.resolve": {
      const pin = state.pins[p0(p)];
      return pin ? `${who} 解决了 #${pin.number}（${state.files[pin.fileId]?.name ?? "图"}）` : null;
    }
    case "page.create":
      return `${who} 建了资料页「${String(p.title ?? "")}」`;
    case "stage.set_reviewer":
      return `${who} 指定了「${stageById(state, p.stageId as Id)?.name ?? "环节"}」的审核员`;
    default:
      return null;
  }
}

/** 工会动态：按世界时间倒着排（同一刻按日志顺序），最近的 `limit` 条。 */
export function feedOf(state: WorldState, limit = 12): FeedItem[] {
  const order = state.journal.map((e, i) => ({ e, i, t: timeKey(e.worldAt ?? e.createdAt) }));
  order.sort((a, b) => b.t - a.t || b.i - a.i);
  const out: FeedItem[] = [];
  for (const { e } of order) {
    if (out.length >= limit) break;
    const text = feedText(state, e);
    if (text) out.push({ entry: e, at: e.worldAt ?? e.createdAt, memberId: e.actorMemberId, text });
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

export type FileKind = "image" | "pdf" | "video" | "archive" | "clip" | "other";

export const FILE_KIND_LABEL: Record<FileKind, string> = { image: "图片", pdf: "PDF", video: "视频", archive: "压缩包", clip: "CLIP 文件", other: "文件" };

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : "";
}

export function fileKind(f: Pick<FileRow, "name" | "mime" | "width">): FileKind {
  const ext = extOf(f.name);
  if (f.width || f.mime.startsWith("image/")) return "image";
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
  cut: CutRow | null;
  pins: { open: number; total: number };
}

export function fileWhere(state: WorldState, f: FileRow): string {
  const idx = indexOf(state);
  const project = idx.projectById.get(f.projectId);
  switch (f.subjectType) {
    case "project":
      return "资料库";
    case "cut": {
      const c = idx.cutById.get(f.subjectId);
      return c ? cutCode(c, project?.group) : "卡";
    }
    case "task":
      return taskViewById(state, f.subjectId)?.label ?? "任务";
    case "submission": {
      const sub = state.submissions[f.subjectId];
      const v = sub ? taskViewById(state, sub.taskId) : null;
      return v ? `${v.label} v${String(sub.versionNo).padStart(2, "0")}` : "版本";
    }
    case "page":
      return `资料页「${state.pages[f.subjectId]?.title ?? ""}」`;
    case "thread": {
      const t = state.threads[f.subjectId];
      return t ? `${THREAD_KIND_LABEL[t.kind]}里` : "意见里";
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
}

export function pinView(state: WorldState, pin: PinRow): PinView | null {
  const f = indexOf(state).fileById.get(pin.fileId);
  if (!f) return null;
  const project = projectById(state, f.projectId);
  return { pin, file: f, by: memberById(state, pin.byMemberId) ?? null, where: [project?.name, fileWhere(state, f)].filter(Boolean).join(" · ") };
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
    for (const k of stage.upstream) {
      const up = byKey.get(k);
      const upPlan = up ? plans.get(up.id) : undefined;
      if (up && upPlan && plan.start < upPlan.end) {
        warning = `计划开始（第 ${plan.start} 周）早于上游「${up.name}」计划结束（第 ${upPlan.end} 周）`;
        break;
      }
    }
    return { stage, plan, actual, progress: tasks.length ? passed.length / tasks.length : 0, overrun, warning };
  });
  const weeks = Math.max(planWeeks, today, ...rows.map((r) => Math.max(r.plan.end, r.actual?.end ?? 0)));
  const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(project.startOn, i * cycleDays));
  return { project, cycleDays, weeks, today, weekStarts, phases: PHASE.map((phase) => ({ phase, rows: rows.filter((r) => r.stage.phase === phase) })) };
}
