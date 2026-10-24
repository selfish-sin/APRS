/**
 * 意见 / 提问 / 设定问题 / 拍板（SPEC §4 规则 7）。
 * 任何一格、任何阶段都能留意见；问上游要写问哪个环节或问谁；设定问题由管理员拍板，
 * 拍板以后列出的卡各留一条「要补」，相关任务卡上显示。
 */
import { THREAD_SUBJECT, type Change, type Id, type ThreadKind, type ThreadSubject } from "../model";
import type { ReadModel } from "../readmodel";
import { stageTemplate } from "../templates";
import { guarded, insert, isReviewer, mustAdmin, mustBeOneOf, mustGet, mustMember, mustText, ok, rejectT, update, type Ctx } from "./core";
import { whatText } from "../what";

function subjectOf(rm: ReadModel, ctx: Ctx, type: ThreadSubject, id: Id) {
  if (type === "project") {
    const p = mustGet(rm, ctx, "projects", id, "项目");
    return { projectId: p.id, cutId: null as Id | null, stageKey: null as string | null };
  }
  if (type === "cut") {
    const c = mustGet(rm, ctx, "cuts", id, "卡");
    return { projectId: c.projectId, cutId: c.id as Id | null, stageKey: null as string | null };
  }
  if (type === "block") {
    const b = mustGet(rm, ctx, "blocks", id, "资料页里的块");
    const page = mustGet(rm, ctx, "pages", b.pageId, "资料页");
    return { projectId: page.projectId, cutId: null as Id | null, stageKey: null as string | null };
  }
  const t = mustGet(rm, ctx, "tasks", id, "任务");
  const s = mustGet(rm, ctx, "stages", t.stageId, "环节");
  return { projectId: t.projectId, cutId: t.cutId, stageKey: s.templateKey as string | null };
}

export interface OpenThreadInput {
  subjectType: ThreadSubject;
  subjectId: Id;
  kind: Exclude<ThreadKind, "todo">;
  /** 说的是哪个环节（挂在任务上时自动是任务的环节）。 */
  stageKey?: string | null;
  /** 提问上游：问哪个环节 / 问谁（至少一个）。 */
  askStageKey?: string | null;
  askMemberId?: Id | null;
  text: string;
}

export const openThread = guarded<OpenThreadInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const subjectType = mustBeOneOf(input.subjectType, THREAD_SUBJECT, "挂在哪");
  const kind = mustBeOneOf(input.kind, ["comment", "ask", "setting"] as const, "类型");
  const subject = subjectOf(rm, ctx, subjectType, input.subjectId);
  const project = mustGet(rm, ctx, "projects", subject.projectId, "项目");
  const text = mustText(input.text, kind === "ask" ? "问题" : kind === "setting" ? "设定问题" : "意见", 500);
  const checkKey = (key: string | null | undefined, what: string) => {
    if (!key) return null;
    if (!stageTemplate(project.group, key)) rejectT("invalid", "stage_not_in_flow", { what: whatText(what) });
    return key;
  };
  const stageKey = subject.stageKey ?? checkKey(input.stageKey, "环节");
  let askStageKey: string | null = null;
  let askMemberId: Id | null = null;
  if (kind === "ask") {
    askStageKey = checkKey(input.askStageKey, "要问的环节");
    if (input.askMemberId) askMemberId = mustGet(rm, ctx, "members", input.askMemberId, "要问的人").id;
    if (!askStageKey && !askMemberId) rejectT("invalid", "ask_target");
    if (askMemberId === me.id) rejectT("invalid", "ask_self");
  }
  const t = insert(ctx, "threads", {
    projectId: project.id,
    subjectType,
    subjectId: input.subjectId,
    cutId: subject.cutId,
    stageKey,
    kind,
    askStageKey,
    askMemberId,
    status: "open",
    text,
    byMemberId: me.id,
    at: ctx.worldNow,
    replies: [],
    rulingId: null,
  });
  return ok([t.change], { threadId: t.row.id });
});

export interface ReplyInput {
  threadId: Id;
  text: string;
}

/** 回复：提问被别人回了 → 「已答」。 */
export const replyThread = guarded<ReplyInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const t = mustGet(rm, ctx, "threads", input.threadId, "这条意见");
  const text = mustText(input.text, "回复", 500);
  if (t.replies.length >= 100) rejectT("state", "replies_full");
  const replies = [...t.replies, { byMemberId: me.id, text, at: ctx.worldNow }];
  const status = t.kind === "ask" && t.status === "open" && me.id !== t.byMemberId ? "answered" : t.status;
  const ch = update("threads", t, { replies, status });
  return ok(ch ? [ch] : [], { threadId: t.id });
});

export interface ResolveInput {
  threadId: Id;
}

/** 关掉一条：意见 / 提问由提的人、审核员或管理员关；「要补」补完了谁都能标（做这卡的人最常用）。 */
export const resolveThread = guarded<ResolveInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const t = mustGet(rm, ctx, "threads", input.threadId, "这条意见");
  if (t.kind === "setting" && t.status === "open") rejectT("state", "setting_needs_ruling");
  if (t.status === "done") rejectT("state", "thread_closed");
  if (t.kind !== "todo" && t.byMemberId !== me.id && !isReviewer(me)) rejectT("forbidden", "thread_close_forbidden");
  const ch = update("threads", t, { status: "done" });
  return ok(ch ? [ch] : [], { threadId: t.id });
});

export interface RulingInput {
  /** 回答哪条设定问题（可以不挂，直接拍板）。 */
  threadId?: Id | null;
  projectId?: Id | null;
  question?: string | null;
  decision: string;
  /** 要补的卡。 */
  cutIds?: Id[];
  /** 要补的是哪个环节。 */
  stageKey?: string | null;
}

/** 管理员拍板：记下结论，给列出的卡各留一条「要补」。 */
export const makeRuling = guarded<RulingInput>((rm, input, ctx) => {
  const me = mustAdmin(rm, ctx, "拍板");
  const decision = mustText(input.decision, "结论", 300);
  const thread = input.threadId ? mustGet(rm, ctx, "threads", input.threadId, "设定问题") : null;
  if (thread && thread.kind !== "setting") rejectT("invalid", "ruling_only_setting");
  if (thread && thread.status !== "open") rejectT("state", "ruling_done");
  const projectId = thread?.projectId ?? input.projectId;
  const project = mustGet(rm, ctx, "projects", projectId, "项目");
  const question = thread?.text ?? mustText(input.question, "问题", 500);
  let stageKey: string | null = null;
  if (input.stageKey) {
    if (!stageTemplate(project.group, input.stageKey)) rejectT("invalid", "fix_stage_not_in_flow");
    stageKey = input.stageKey;
  } else if (thread?.stageKey) stageKey = thread.stageKey;
  const cutIds = Array.from(new Set(Array.isArray(input.cutIds) ? input.cutIds : []));
  if (cutIds.length > 200) rejectT("invalid", "fix_cuts_too_many");
  const cuts = cutIds.map((id) => {
    const c = mustGet(rm, ctx, "cuts", id, "要补的卡");
    if (c.projectId !== project.id) rejectT("invalid", "fix_cut_other_project");
    return c;
  });
  cuts.sort((a, b) => a.number - b.number);
  const r = insert(ctx, "rulings", { projectId: project.id, threadId: thread?.id ?? null, question, decision, cutIds: cuts.map((c) => c.id), stageKey, byMemberId: me.id, at: ctx.worldNow });
  const changes: Change[] = [r.change];
  if (thread) {
    const ch = update("threads", thread, { status: "ruled", rulingId: r.row.id, replies: [...thread.replies, { byMemberId: me.id, text: decision, ruling: true as const, at: ctx.worldNow }] });
    if (ch) changes.push(ch);
  }
  for (const c of cuts) {
    const t = insert(ctx, "threads", {
      projectId: project.id,
      subjectType: "cut",
      subjectId: c.id,
      cutId: c.id,
      stageKey,
      kind: "todo",
      askStageKey: null,
      askMemberId: null,
      status: "open",
      // 只存结论；「要补」是这一条的种类（界面按语言写）。
      text: decision,
      byMemberId: me.id,
      at: ctx.worldNow,
      replies: [],
      rulingId: r.row.id,
    });
    changes.push(t.change);
  }
  return ok(changes, { rulingId: r.row.id });
});
