/**
 * ARPS制作工会 · 数据层的表（SPEC §4）。
 *
 * 每张表同一个行头（id · worldId · createdAt · updatedAt · version · archivedAt）；
 * `version` 是乐观锁；删除 = 归档。写操作只走命令（commands/*）→ 变更集 → 日志（journal）。
 *
 * 时间有两种：行头的 createdAt / updatedAt 是真实时间；表里的 `at` · `joinedAt` · `claimedAt` · `dueAt`
 * 是世界时间（示范工会冻结在 2026-10-23）。页面显示、排序、算时限都用世界时间。
 */

export type Id = string;
/** ISO 8601 date-time, e.g. 2026-10-23T02:00:00.000Z */
export type IsoDateTime = string;
/** Calendar date, e.g. 2026-10-23 */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// 枚举（存英文代码，中文在 labels.ts）
// ---------------------------------------------------------------------------

export const ROLE = ["admin", "reviewer", "member"] as const;
export type Role = (typeof ROLE)[number];

export const GROUP = ["animation", "video"] as const;
export type Group = (typeof GROUP)[number];

/** 三段：前期 · 中期 · 后期。 */
export const PHASE = ["pre", "mid", "post"] as const;
export type Phase = (typeof PHASE)[number];

/** 环节类型：过渡（一进一出）· 枢纽（算出后面的工作量并派发，或几路汇合）· 审核（本身是检查）。 */
export const STAGE_KIND = ["transit", "hub", "review"] as const;
export type StageKind = (typeof STAGE_KIND)[number];

/** 粒度：项目一份 · 每卡一份 · 每卡每层一份。 */
export const GRAIN = ["project", "cut", "layer"] as const;
export type Grain = (typeof GRAIN)[number];

/** 工作量单位：张 · 秒 · 卡 · 项。 */
export const UNIT = ["sheet", "second", "cut", "item"] as const;
export type Unit = (typeof UNIT)[number];

/** 熟练度系数（报到时选）。 */
export const SKILL = [0.5, 0.2, 0, -0.2] as const;
export type Skill = (typeof SKILL)[number];

/** 质量系数（审核通过时选）。 */
export const QUALITY = [0.5, 1, 1.2] as const;
export type Quality = (typeof QUALITY)[number];

/**
 * 任务状态：锁住（上游没完）· 可接 · 已接 · 待审 · 退回 · 通过 · 收回（管理员收回，暂时谁都不能接）。
 * 超时自动收回不停在「收回」，直接回到「可接」（SPEC §4 规则 3）。
 */
export const TASK_STATUS = ["locked", "open", "claimed", "submitted", "returned", "passed", "reclaimed"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

/** 手上的任务（算「同时最多几张」）：已接 · 退回。待审的不算（在审核员手上）。 */
export const ACTIVE_STATUS: readonly TaskStatus[] = ["claimed", "returned"];

export const VERDICT = ["pass", "return", "fix_pass"] as const;
export type Verdict = (typeof VERDICT)[number];

/** 意见 / 提问：意见 · 提问上游 · 设定问题 · 要补（拍板以后自动留在卡上的）。 */
export const THREAD_KIND = ["comment", "ask", "setting", "todo"] as const;
export type ThreadKind = (typeof THREAD_KIND)[number];

export const THREAD_STATUS = ["open", "answered", "ruled", "done"] as const;
export type ThreadStatus = (typeof THREAD_STATUS)[number];

/** 意见挂在哪：项目 · 卡 · 任务 · 资料页里的一个块。 */
export const THREAD_SUBJECT = ["project", "cut", "task", "block"] as const;
export type ThreadSubject = (typeof THREAD_SUBJECT)[number];

export const PROJECT_STATUS = ["active", "paused", "done"] as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[number];

/** 活力点流水的种类：做任务 · 审核员自修 · 超时扣分。 */
export const LEDGER_KIND = ["task", "self_fix", "penalty"] as const;
export type LedgerKind = (typeof LEDGER_KIND)[number];

/** 文件挂在哪（SPEC §11.1）：项目（资料库）· 卡 · 任务 · 版本 · 资料页 · 意见。 */
export const FILE_SUBJECT = ["project", "cut", "task", "submission", "page", "thread"] as const;
export type FileSubject = (typeof FILE_SUBJECT)[number];

/** 图上的评论：点一下 = 钉 · 拖一下 = 框。 */
export const PIN_KIND = ["point", "box"] as const;
export type PinKind = (typeof PIN_KIND)[number];

export const PIN_STATUS = ["open", "resolved"] as const;
export type PinStatus = (typeof PIN_STATUS)[number];

/** 资料页的块（SPEC §11.5）：标题 · 段落 · 图片（单张）· 图片网格 · 文件 · 清单 · 分割线。 */
export const BLOCK_TYPE = ["heading", "text", "image", "gallery", "file", "checklist", "divider"] as const;
export type BlockType = (typeof BLOCK_TYPE)[number];

/** 头像色（Figma color/avatar/*，只给人用）。 */
export const AVATAR_TONE = ["peach", "lilac", "sand", "sage", "slate"] as const;
export type AvatarToneName = (typeof AVATAR_TONE)[number];

export const JOURNAL_SOURCE = ["manual", "system", "seed"] as const;
export type JournalSource = (typeof JOURNAL_SOURCE)[number];

// ---------------------------------------------------------------------------
// 行
// ---------------------------------------------------------------------------

export interface RowHeader {
  id: Id;
  worldId: Id;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Optimistic lock: starts at 1, +1 on every update / archive. */
  version: number;
  /** Soft delete. */
  archivedAt: IsoDateTime | null;
}

/** 管理员改过的工时和系数（盖在模板上）。 */
export interface RateOverride {
  /** 每 `per` 个单位要几小时。 */
  tn?: number;
  per?: number;
  /** 掌控系数。 */
  control?: number;
}

export interface WorldRules {
  /** 冻结的世界时钟（示范工会）。 */
  clock?: { fixedNow?: IsoDateTime };
  /** 时限系数：时限 = 工作量 × Tn × 这个数（默认 1.5）。 */
  deadlineFactor?: number;
  /** 超时收回时扣不扣活力点（默认不扣）。 */
  expiryPenalty?: boolean;
  /** 管理员改过的工时与系数：组 → 环节 key → 覆盖值。 */
  rates?: Partial<Record<Group, Record<string, RateOverride>>>;
  [key: string]: unknown;
}

export interface WorldRow extends RowHeader {
  title: string;
  rules: WorldRules;
}

export interface MemberRow extends RowHeader {
  nickname: string;
  role: Role;
  /** 世界时间。 */
  joinedAt: IsoDateTime;
  tone: AvatarToneName;
}

/**
 * 账号 = 这台设备上的一把软锁（SPEC §10）：只存 salt 和 sha256(salt + ":" + 口令)，不存口令。
 */
export interface AccountRow extends RowHeader {
  login: string;
  displayName: string;
  memberId: Id;
  salt: string;
  hash: string;
}

/** 报到是怎么来的：自己报到 · 管理员指派职位 · 第一次认领别的环节时自动加的（SPEC §13.1）。 */
export const ENROLL_ORIGIN = ["self", "assigned", "claimed"] as const;
export type EnrollOrigin = (typeof ENROLL_ORIGIN)[number];

export interface EnrollmentRow extends RowHeader {
  memberId: Id;
  group: Group;
  /** 流程模板里的环节 key。 */
  stageKey: string;
  skill: Skill;
  /** 同时最多几张（默认 2）。 */
  maxActive: number;
  /** 怎么来的（旧的记录没有 = 自己报到）。 */
  origin?: EnrollOrigin;
  /** 管理员指派了这个职位（成员卡上显示「指派」）。 */
  assigned?: boolean;
}

export interface ProjectRow extends RowHeader {
  group: Group;
  name: string;
  /** 2–6 位大写，用在文件名里。 */
  code: string;
  episode: string;
  scene: string;
  startOn: IsoDate;
  planEndOn: IsoDate;
  status: ProjectStatus;
  /** 飞书根文件夹（只存链接）。 */
  feishuRoot: string | null;
  /** 一周期几天（排期按这个画格子，默认 7）。 */
  cycleDays?: number;
}

export interface StageIndicator {
  /** 收什么（从上游拿到的东西）。 */
  receive: string;
  /** 交什么。 */
  deliver: string;
  /** 交给谁（下一个环节）。 */
  handTo: string;
}

/** 项目里的环节，开项目时从模板生成。 */
export interface StageRow extends RowHeader {
  projectId: Id;
  templateKey: string;
  name: string;
  phase: Phase;
  kind: StageKind;
  /** 枢纽（原画监督这种既是审核又是枢纽的，kind = review、hub = true）。 */
  hub: boolean;
  grain: Grain;
  unit: Unit;
  /** 每 `per` 个单位的必要劳动时间（小时）。 */
  tn: number;
  per: number;
  /** 掌控系数（默认 1）。 */
  control: number;
  /** 流程代号（文件名用），例如 ANI；前期的环节可以没有。 */
  code: string | null;
  /** 文件名里的那一段（没有流程代号时用它）。 */
  fileCode: string;
  /** 文件夹里的那一段，例如 ANI、分镜。 */
  folder: string;
  upstream: string[];
  indicator: StageIndicator;
  reviewerId: Id | null;
  sort: number;
  /** 工时由管理员定（模板里是个占位数）。 */
  adminSet: boolean;
  note: string | null;
  /** 只给指派的人（SPEC §13.1；没写 = 审核类环节锁、其余不锁）。 */
  locked?: boolean;
  /** 计划周期：从项目开始的第几个周期开始（1 起）、做几个周期（SPEC §13.2；没写 = 按阶段排的默认值）。 */
  plan?: StagePlan | null;
  /** 这个环节自己的时限系数 / 最短时限（没写 = 用工会的 1.5 / 4 小时）。 */
  deadlineFactor?: number | null;
  minDeadlineHours?: number | null;
}

export interface StagePlan {
  startWeek: number;
  weeks: number;
}

export interface CutLayer {
  /** A / B …（一个大写字母）。 */
  name: string;
  sheets: number;
}

/** 卡（镜头）。视频组里一「期」也是一行 cut。 */
export interface CutRow extends RowHeader {
  projectId: Id;
  episode: string;
  scene: string;
  number: number;
  layers: CutLayer[];
  seconds: number;
  /** 原画张数（Layout 枢纽定）。 */
  keySheets: number;
}

export interface TaskRow extends RowHeader {
  projectId: Id;
  stageId: Id;
  /** 项目级的环节为空。 */
  cutId: Id | null;
  layer: string | null;
  workload: number;
  status: TaskStatus;
  assigneeId: Id | null;
  claimedAt: IsoDateTime | null;
  dueAt: IsoDateTime | null;
  /** 外包：交的人不在工会里，由管理员代交。 */
  outsourced: boolean;
  outsourceName: string | null;
  /** 最新的版本号（还没交过 = 0）。 */
  versions: number;
  submittedAt: IsoDateTime | null;
  passedAt: IsoDateTime | null;
  /** 枢纽派发过的时间。 */
  dispatchedAt: IsoDateTime | null;
  sort: number;
  /** 管理员直接派的：谁派的（任务单上写「白鹭派给你的」）。 */
  assignedById?: Id | null;
  /** 接的时候的工时（之后改 Tn 不影响已经派出去的）。 */
  rate?: { tn: number; per: number } | null;
  /** 随时发的新任务（额外任务 · 修正 · 补设定，SPEC §13.3）；普通任务没有。 */
  extra?: ExtraTask | null;
}

export const EXTRA_KIND = ["extra", "fix", "setting"] as const;
export type ExtraKind = (typeof EXTRA_KIND)[number];

export interface ExtraTask {
  kind: ExtraKind;
  title: string;
  description: string | null;
  /** 挂在哪几卡（可以不挂）。 */
  cutIds: Id[];
  /** 直接给一个固定活力点（不按工时算）。 */
  fixedPoints: number | null;
  /** 时限（小时，从接的时候算）。 */
  deadlineHours: number;
  /** 谁审（没写 = 这个环节的审核员）。 */
  reviewerId: Id | null;
  /** 勾了「这一卡要等它做完」：挂着的卡的下游等它通过。 */
  blocking: boolean;
  /** 附图（资料库里的文件）。 */
  fileIds: Id[];
  byMemberId: Id;
  at: IsoDateTime;
  /** 发布时因为「要等它」锁回去的任务（它通过以后放回去）。 */
  relocked?: Id[];
}

export interface SubmissionRow extends RowHeader {
  taskId: Id;
  /** 版本号 1、2、3 …（行头的 version 是乐观锁，别搞混）。 */
  versionNo: number;
  fileName: string;
  /** 飞书链接（只收 http / https）。 */
  link: string | null;
  note: string | null;
  /** 算在谁名下：做的人；审核员自修 = 审核员；外包 = null。 */
  byMemberId: Id | null;
  /** 管理员代录 / 代交时是管理员。 */
  recordedById: Id | null;
  selfFix: boolean;
  onTime: boolean;
  at: IsoDateTime;
}

export interface ReviewComment {
  layer: string | null;
  /** 张号，例如「6、7」「1–4」。 */
  sheets: string | null;
  tag: string | null;
  text: string;
}

export interface ReviewRow extends RowHeader {
  taskId: Id;
  submissionId: Id;
  verdict: Verdict;
  quality: Quality | null;
  comments: ReviewComment[];
  byMemberId: Id;
  at: IsoDateTime;
}

export interface ThreadReply {
  byMemberId: Id;
  text: string;
  at: IsoDateTime;
}

export interface ThreadRow extends RowHeader {
  projectId: Id;
  subjectType: ThreadSubject;
  subjectId: Id;
  /** 挂在卡或任务上时，那张卡（卡的时间线用）。 */
  cutId: Id | null;
  /** 说的是哪个环节（可以不写）。 */
  stageKey: string | null;
  kind: ThreadKind;
  /** 提问上游：问哪个环节 / 问谁。 */
  askStageKey: string | null;
  askMemberId: Id | null;
  status: ThreadStatus;
  text: string;
  byMemberId: Id;
  at: IsoDateTime;
  replies: ThreadReply[];
  /** 「要补」来自哪条拍板。 */
  rulingId: Id | null;
}

export interface RulingRow extends RowHeader {
  projectId: Id;
  threadId: Id | null;
  question: string;
  decision: string;
  cutIds: Id[];
  /** 要补的是哪个环节（可以不写）。 */
  stageKey: string | null;
  byMemberId: Id;
  at: IsoDateTime;
}

/** 活力点流水（落表：审核那一刻按当时的工时和系数算好）。 */
export interface LedgerRow extends RowHeader {
  memberId: Id;
  taskId: Id | null;
  kind: LedgerKind;
  /** Tn × 工作量（小时）。 */
  hours: number;
  /** 掌控系数 + 熟练度系数。 */
  factor: number;
  quality: number;
  points: number;
  at: IsoDateTime;
  note: string | null;
}

/**
 * 文件的信息（SPEC §11.1）。文件本身在 IndexedDB（`arps-files`，按 sha256 存，同一个文件只存一份），
 * 这里只有「是什么、挂在哪、谁传的」和一张很小的缩略图，和别的数据一样走日志、能导出、能重放。
 */
export interface FileRow extends RowHeader {
  sha256: string;
  name: string;
  mime: string;
  size: number;
  /** 图片的宽高（像素）；不是图片为 null。 */
  width: number | null;
  height: number | null;
  /** ≤ 20KB 的缩略图 dataURL（文件不在这台设备上时也能看个大概）。 */
  thumb: string | null;
  subjectType: FileSubject;
  subjectId: Id;
  /** 从挂的地方带出来的（资料库筛选用）。 */
  projectId: Id;
  cutId: Id | null;
  stageKey: string | null;
  tags: string[];
  byMemberId: Id;
  at: IsoDateTime;
}

export interface PinReply {
  byMemberId: Id;
  text: string;
  at: IsoDateTime;
}

/** 图上的一个钉 / 框：位置按图的比例存（0–1），缩放以后还在原处。 */
export interface PinRow extends RowHeader {
  fileId: Id;
  /** 这张图上的第几个（1、2、3 …）。 */
  number: number;
  kind: PinKind;
  x: number;
  y: number;
  /** 框才有。 */
  w: number | null;
  h: number | null;
  layer: string | null;
  sheets: string | null;
  tag: string | null;
  text: string;
  /** @ 了谁。 */
  mentions: Id[];
  /** 审核退回时钉的：哪张任务（交的人的「等我处理」里会有）。 */
  reviewTaskId: Id | null;
  /** 从图带出来的（卡的时间线用）。 */
  projectId: Id;
  cutId: Id | null;
  taskId: Id | null;
  status: PinStatus;
  replies: PinReply[];
  byMemberId: Id;
  at: IsoDateTime;
}

/** 资料页（像 Notion，但以图为主）。 */
export interface PageRow extends RowHeader {
  projectId: Id;
  title: string;
  byMemberId: Id;
  at: IsoDateTime;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface BlockRow extends RowHeader {
  pageId: Id;
  type: BlockType;
  /** 标题 / 段落的字。 */
  text: string | null;
  /** 图片 / 网格 / 文件块：只存文件 id。 */
  fileIds: Id[];
  /** 清单。 */
  items: ChecklistItem[];
  /** 顺序（小的在前，可以是小数）。 */
  sort: number;
  byMemberId: Id;
}

// ---------------------------------------------------------------------------
// 表
// ---------------------------------------------------------------------------

export interface Tables {
  worlds: WorldRow;
  members: MemberRow;
  accounts: AccountRow;
  enrollments: EnrollmentRow;
  projects: ProjectRow;
  stages: StageRow;
  cuts: CutRow;
  tasks: TaskRow;
  submissions: SubmissionRow;
  reviews: ReviewRow;
  threads: ThreadRow;
  rulings: RulingRow;
  ledger: LedgerRow;
  files: FileRow;
  pins: PinRow;
  pages: PageRow;
  blocks: BlockRow;
}

export type TableName = keyof Tables;

export const TABLE_NAMES: TableName[] = [
  "worlds",
  "members",
  "accounts",
  "enrollments",
  "projects",
  "stages",
  "cuts",
  "tasks",
  "submissions",
  "reviews",
  "threads",
  "rulings",
  "ledger",
  "files",
  "pins",
  "pages",
  "blocks",
];

/** Fields a command may never patch. */
export type HeaderField = keyof RowHeader;
export type Patch<T> = Partial<Omit<T, HeaderField>>;

// ---------------------------------------------------------------------------
// Journal (append-only)
// ---------------------------------------------------------------------------

export type Change =
  | { [K in TableName]: { op: "insert"; table: K; row: Tables[K] } }[TableName]
  | {
      [K in TableName]: {
        op: "update";
        table: K;
        id: Id;
        patch: Patch<Tables[K]>;
        /** Values before the patch — for the feed, audit and undo. */
        prev: Patch<Tables[K]>;
        expectVersion: number;
      };
    }[TableName]
  | { [K in TableName]: { op: "archive"; table: K; id: Id; expectVersion: number } }[TableName];

export interface JournalEntry {
  id: Id;
  /** Total order inside one world. */
  seq: number;
  worldId: Id;
  /** 哪个账号（这台设备上登录的那个）。 */
  accountId: Id | null;
  /** 以哪个成员的身份。 */
  actorMemberId: Id | null;
  /** e.g. "task.submit" */
  command: string;
  payload: unknown;
  changes: Change[];
  /** 真实时间。 */
  createdAt: IsoDateTime;
  /** 世界时间（这一步在工会里是什么时候发生的）。 */
  worldAt: IsoDateTime;
  /** manual = 人点的 · system = 打开时自动做的（超时收回）· seed = 示范数据。 */
  source?: JournalSource;
  /** 命令新建了什么（created.taskId …），动态和时间线用。 */
  created?: Record<string, Id>;
}

/** Everything one world holds, keyed by id per table (insertion order kept). */
export type WorldTables = { [K in TableName]: Record<Id, Tables[K]> };

export interface WorldState extends WorldTables {
  journal: JournalEntry[];
}

export function emptyWorldState(): WorldState {
  const s = { journal: [] } as unknown as WorldState;
  for (const t of TABLE_NAMES) (s as unknown as Record<string, unknown>)[t] = {};
  return s;
}
