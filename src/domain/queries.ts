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
  CutRow,
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
import { HOURS_PER_DAY, deadlineFactorOf, hoursOf, levelOf, rateFor, rewardOf, type LevelInfo } from "./rules";
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
  subsByTask: Map<Id, SubmissionRow[]>;
  reviewsByTask: Map<Id, ReviewRow[]>;
  threads: ThreadRow[];
  rulings: RulingRow[];
  ledgerByMember: Map<Id, LedgerRow[]>;
  enrollments: EnrollmentRow[];
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
    subsByTask: new Map(),
    reviewsByTask: new Map(),
    threads: live(state.threads).sort(compareBy<ThreadRow>((t) => timeKey(t.at))),
    rulings: live(state.rulings).sort(compareBy<RulingRow>((r) => timeKey(r.at))),
    ledgerByMember: new Map(),
    enrollments: live(state.enrollments).sort(compareBy<EnrollmentRow>((e) => timeKey(e.createdAt))),
  };
  for (const s of stages) push(idx.stagesByProject, s.projectId, s);
  for (const list of Array.from(idx.stagesByProject.values())) list.sort(bySort);
  for (const c of cuts) push(idx.cutsByProject, c.projectId, c);
  for (const list of Array.from(idx.cutsByProject.values())) list.sort(byNumber);
  for (const t of tasks) {
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
      return { stage, tasks, status: cellStatus(tasks) };
    });
  const openByCut = new Map<Id, number>();
  for (const t of idx.threads) if (t.cutId && t.status === "open" && (t.kind === "todo" || t.kind === "ask")) openByCut.set(t.cutId, (openByCut.get(t.cutId) ?? 0) + 1);
  const all: GridRow[] = (idx.cutsByProject.get(projectId) ?? []).map((cut) => {
    const cutTasks = idx.tasksByCut.get(cut.id) ?? [];
    const cells = columns.map((stage) => {
      const tasks = cutTasks.filter((t) => t.stageId === stage.id).map((t) => gridTask(state, t, memberId));
      return { stage, tasks, status: cellStatus(tasks) };
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
    reward: rewardOf(view.stage, task.workload, skillOf(state, memberId, view.project.group, view.stage.templateKey)),
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
  if (stage?.reviewerId && stage.reviewerId !== memberId && !isAdmin(me)) {
    return { ok: false, reason: `「${stage.name}」由${memberById(state, stage.reviewerId)?.nickname ?? "指定的审核员"}审核` };
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

export type TimelineKind = "claim" | "release" | "expire" | "reclaim" | "reopen" | "dispatch" | "submit" | "review" | "thread" | "ruling";

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
  const tasks = idx.tasksByCut.get(cutId) ?? [];
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
  return { returned, asked, todos, total: returned.length + asked.length + todos.length };
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
    case "task.assign":
      return `${who} 把 ${taskShort(state, p.taskId)} 交给了 ${p.memberId ? memberById(state, p.memberId as Id)?.nickname ?? "成员" : `外包（${String(p.outsourceName ?? "")}）`}`;
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
    return {
      template: t,
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
