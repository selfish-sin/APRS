/**
 * 第二层 · 环节页（SPEC §17.2，`#/project/<id>/stage/<key>`；排法照设计组 v6-2 / v6-2b / v6-3）：
 *   页头：名字 · 状态 · 第 N / M 个环节 · 阶段 · 类型 · 粒度 · 上游 › 这里 › 下游 · 上一个 / 下一个；
 *   左边：概况（数字能点，派发表跟着筛）· 派发下游（枢纽）· 派发（按卡；每行一个小菜单；能多选）· 动态；
 *   右边：人员（动作就在这里）· 交付物（全部通过后才能验收）· 这个环节的设置（默认收起，就地改、就地存）。
 *   所有动作都在这一页就地做，不再有「改项目」大表。
 */
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { Empty, MemberAvatar, SelectField, Tag, TextField } from "@/components/app/bits";
import { ExtrasList, PublishForm } from "@/components/app/flex";
import { Pop } from "@/components/app/popover";
import { actualLine, planLine, RouteBar, RouteStatusBadge, RouteStatusIcon } from "@/components/app/route";
import { StageWall, useDeliveries } from "@/components/audit/wall";
import { localDate } from "@/domain/clock";
import { isAdmin, isReviewer } from "@/domain/commands/core";
import { GRAIN, STAGE_KIND, type Id, type StageRow, type TaskStatus } from "@/domain/model";
import {
  deadlineFactor,
  filesOn,
  memberById,
  members,
  nowOf,
  stageActivityOf,
  stagePageOf,
  submissionLinks,
  submissionsOf,
  taskView,
  type RouteCounts,
  type RouteRow,
  type StagePage as StagePageData,
  type StagePerson,
  type StageTaskView,
} from "@/domain/queries";
import { MIN_DEADLINE_HOURS, stageLocked } from "@/domain/rules";
import { stageText } from "@/domain/templates";
import { U, useI18n } from "@/i18n/I18n";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { HubDispatchForm } from "./Admin";
import { NotFound } from "./NotFound";
import { AcceptDialog, AddCutsForm, ExtendDialog } from "./ProjectSetup";

type Bucket = Exclude<keyof RouteCounts, "total">;
const BUCKETS: Bucket[] = ["passed", "submitted", "working", "open", "locked"];
const BUCKET_OF: Record<TaskStatus, Bucket> = { passed: "passed", submitted: "submitted", claimed: "working", returned: "working", open: "open", reclaimed: "open", locked: "locked" };
const BUCKET_ICON: Record<Bucket, "done" | "review" | "active" | "ready" | "locked"> = { passed: "done", submitted: "review", working: "active", open: "ready", locked: "locked" };
/** 快到时限：剩不到 6 小时。 */
const NEAR_MS = 6 * 3_600_000;

export function StagePage() {
  const { world, me } = useGuild();
  const { L, f, stage: stageEl, stageName } = useI18n();
  const route = useRoute();
  const projectId = route.segments[1];
  const key = route.segments[3];
  const page = useMemo(() => stagePageOf(world, projectId, key ?? ""), [world, projectId, key]);
  const [filter, setFilter] = useState<Bucket | null>(null);
  // 派发表先收起（照设计 v7-8）；点概况里的一个数、或者「展开派发表」才展开
  const [dispatchOpen, setDispatchOpen] = useState(false);
  if (!page) return <NotFound what="project" />;
  const { project, row } = page;
  const stage = row.stage;
  const group = project.group;
  const admin = isAdmin(me);
  const rowOf = (s: StageRow) => page.routeRows.find((r) => r.stage.id === s.id);
  const chainItem = (r: RouteRow | undefined, s: StageRow) => (
    <Link key={s.id} to={`/project/${project.id}/stage/${s.templateKey}`} className="stage-chain-item" data-status={r?.status} data-testid="stage-link">
      {r ? <RouteStatusIcon status={r.status} /> : null}
      {r ? <span className="num">{r.no}</span> : null} {stageEl(group, s)}
      {r ? <span className="stage-chain-state"> · {r.status === "active" ? `${L.route.status.active} ${f(L.route.activeCounts, { passed: r.counts.passed, total: r.counts.total })}` : L.route.status[r.status]}</span> : null}
    </Link>
  );
  return (
    <>
      <div className="page-head stage-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to={`/project/${project.id}`}>
              <U>{project.name}</U>
            </Link>
            <span>›</span>
            <Link to={`/project/${project.id}`}>{L.route.title}</Link>
            <span>›</span>
            <span>{f(L.stagePage.crumbNo, { no: row.no })}</span>
          </div>
          <h1 className="t-title-32 stage-h1">
            <span data-testid="stage-title">{stageEl(group, stage)}</span>
            <RouteStatusBadge status={row.status} counts={row.counts} plain />
          </h1>
          <p className="label stage-sub" data-testid="stage-sub">
            {[
              f(L.route.stageOf, { no: row.no, total: page.routeRows.length }),
              L.labels.phase[stage.phase],
              L.labels.stageKind[stage.kind] + (stage.hub && stage.kind !== "hub" ? L.route.hubSuffix : ""),
              L.labels.grain[stage.grain],
              f(L.stagePage.taskCount, { n: row.counts.total }),
            ].join(" · ")}
            {stage.disabled ? ` · ${L.route.disabled}` : ""}
          </p>
          <nav className="stage-chain" aria-label={L.stagePage.chainAria} data-testid="stage-links">
            <span className="label">{L.stagePage.upstream}</span>
            {page.upstream.length ? page.upstream.map((s) => chainItem(rowOf(s), s)) : <span className="label">{L.stagePage.none}</span>}
            <span className="stage-chain-sep" aria-hidden="true">
              ›
            </span>
            <span className="stage-chain-here">
              <span className="num">{row.no}</span> {stageEl(group, stage)}
              {L.stagePage.here}
            </span>
            <span className="stage-chain-sep" aria-hidden="true">
              ›
            </span>
            <span className="label">{L.stagePage.downstream}</span>
            {page.downstream.length ? page.downstream.map((s) => chainItem(rowOf(s), s)) : <span className="label">{L.stagePage.none}</span>}
          </nav>
        </div>
        <nav className="page-head-actions stage-nav" aria-label={L.stagePage.prevNext}>
          {page.prev ? (
            <Link to={`/project/${project.id}/stage/${page.prev.stage.templateKey}`} className="ui-button" data-style="Secondary" data-size="Medium" data-testid="stage-prev" aria-label={f(L.stagePage.prevAria, { no: page.prev.no })}>
              <span>
                ‹ {page.prev.no} {stageName(group, page.prev.stage)}
              </span>
            </Link>
          ) : null}
          {page.next ? (
            <Link to={`/project/${project.id}/stage/${page.next.stage.templateKey}`} className="ui-button" data-style="Secondary" data-size="Medium" data-testid="stage-next" aria-label={f(L.stagePage.nextAria, { no: page.next.no })}>
              <span>
                {page.next.no} {stageName(group, page.next.stage)} ›
              </span>
            </Link>
          ) : null}
          <Link to={`/project/${project.id}`} className="ui-button" data-style="Ghost" data-size="Medium" data-testid="stage-back">
            {L.stagePage.backToRoute}
          </Link>
        </nav>
      </div>

      <div className="sp-layout">
        <div className="sp-col">
          <Overview
            page={page}
            filter={filter}
            setFilter={(b) => {
              setFilter(b);
              setDispatchOpen(true);
            }}
          />
          <DeliverBlock page={page} admin={admin} />
          {stage.hub && admin && project.status === "active" ? <HubBlock page={page} /> : null}
          <DispatchBlock page={page} admin={admin} filter={filter} setFilter={setFilter} open={dispatchOpen} setOpen={setDispatchOpen} />
        </div>
        <div className="sp-col">
          <PeopleBlock page={page} admin={admin} />
          <ConfigBlock page={page} admin={admin} />
          <ActivityBlock stageId={stage.id} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 概况
// ---------------------------------------------------------------------------

function Overview({ page, filter, setFilter }: { page: StagePageData; filter: Bucket | null; setFilter: (b: Bucket | null) => void }) {
  const { world } = useGuild();
  const i18n = useI18n();
  const { L, f, num, unit: unitOf } = i18n;
  const { row, project } = page;
  const stage = row.stage;
  const factor = stage.deadlineFactor ?? deadlineFactor(world);
  const min = stage.minDeadlineHours ?? MIN_DEADLINE_HOURS;
  const weeks = row.plan ? row.plan.end - row.plan.start + 1 : null;
  return (
    <section className="card" aria-labelledby="sp-overview" data-testid="stage-overview">
      <h2 id="sp-overview" className="t-heading-18">
        {L.stagePage.overview} <span className="label">{L.stagePage.overviewHint}</span>
      </h2>
      <div className="sp-counts" role="group" aria-label={L.stagePage.countsAria}>
        <button type="button" className="sp-count" data-part="all" aria-pressed={filter === null} onClick={() => setFilter(null)} data-testid="count-all">
          <span className="num t-heading-18">{row.counts.total}</span>
          <span className="label">{L.stagePage.all}</span>
        </button>
        {BUCKETS.map((b) => (
          <button key={b} type="button" className="sp-count" data-part={b} aria-pressed={filter === b} onClick={() => setFilter(filter === b ? null : b)} data-testid={`count-${b}`}>
            <span className="num t-heading-18">{row.counts[b]}</span>
            <span className="label sp-count-label" data-status={BUCKET_ICON[b]}>
              <RouteStatusIcon status={BUCKET_ICON[b]} size={12} />
              {L.route.legend[b]}
            </span>
          </button>
        ))}
      </div>
      <RouteBar counts={row.counts} />
      <p className="sp-plan">
        <span className="label">
          {planLine(i18n, row)}
          {weeks ? f(L.stagePage.weeks, { n: weeks }) : ""}
        </span>
        <span>{actualLine(i18n, row)}</span>
        {row.overrun ? <span className="route-over">{f(L.route.over, { n: row.overrun })}</span> : null}
      </p>
      <p className="label" data-testid="stage-params">
        {f(L.stagePage.paramsLine, { tn: num(stage.tn), per: stage.per === 1 ? "" : `${stage.per} `, unit: unitOf(stage.unit, project.group, stage.per), factor: num(factor), min: num(min), cycle: project.cycleDays ?? 7 })}
        {stage.adminSet ? L.labels.adminSet : ""}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 人员
// ---------------------------------------------------------------------------

function PeopleBlock({ page, admin }: { page: StagePageData; admin: boolean }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, stageName, waited } = useI18n();
  const stage = page.row.stage;
  const group = page.project.group;
  const [pop, setPop] = useState<"assign" | "reviewer" | null>(null);
  const locked = stageLocked(stage);
  const assigned = page.people.filter((x) => x.how === "assigned");
  const claimed = page.people.filter((x) => x.how === "claimed");
  const reviewer = page.reviewer;
  const oldest = page.pendingReview.oldestAt ? Date.parse(nowOf(world)) - Date.parse(page.pendingReview.oldestAt) : null;
  const remove = (x: StagePerson) => {
    const r = dispatch("stage.unassign", { stageId: stage.id, memberId: x.memberId, name: x.memberId ? null : x.name }, { quiet: true });
    if (!r.ok) notify(err(r.error), "Error");
    else notify(f(L.stagePage.unassigned, { name: x.name }), "Neutral");
  };
  const personRow = (x: StagePerson) => (
    <li key={x.memberId ?? `n:${x.name}`} className="sp-person" data-testid="stage-person" data-how={x.how}>
      <MemberAvatar member={memberById(world, x.memberId)} fallback={x.name} size="28" />
      <div className="list-main">
        <span className="sp-person-name">
          {x.memberId ? (
            <Link to={`/member/${x.memberId}`} className="t-body-14m">
              <U>{x.name}</U>
            </Link>
          ) : (
            <span className="t-body-14m">
              <U>{x.name}</U>
            </span>
          )}
          <span className="sp-chip" data-how={x.how}>
            {x.how === "assigned" ? L.stagePage.howAssigned : L.stagePage.howClaimed}
            {x.skill ? f(L.stagePage.skill, { n: x.skill }) : ""}
            {x.external ? ` · ${L.stagePage.external}` : ""}
          </span>
        </span>
        <span className="label">
          {f(L.stagePage.personStats, { inHand: x.inHand, passed: x.passed })} · {x.onTime === null ? L.stagePage.onTimeNone : f(L.stagePage.onTime, { pct: Math.round(x.onTime * 100) })}
        </span>
      </div>
      {admin && x.how === "assigned" ? <Button Label={L.stagePage.unassign} Size="Small" Style="Ghost" onClick={() => remove(x)} data-testid="person-remove" /> : null}
    </li>
  );
  return (
    <section className="card" aria-labelledby="sp-people" data-testid="stage-people">
      <div className="card-head">
        <h2 id="sp-people" className="t-heading-18">
          {L.stagePage.people} <span className="label">{f(L.stagePage.peopleMeta, { n: page.people.length, r: reviewer ? 1 : 0 })}</span>
        </h2>
        {admin ? (
          <div className="pop-anchor">
            <Button Label={L.stagePage.assignOpen} Size="Small" Style="Secondary" onClick={() => setPop(pop === "assign" ? null : "assign")} aria-expanded={pop === "assign"} data-testid="assign-person-open" />
            {pop === "assign" ? (
              <Pop title={L.stagePage.assignTitle} onClose={() => setPop(null)} testId="assign-person-pop">
                <AssignPersonForm stage={stage} onDone={() => setPop(null)} />
              </Pop>
            ) : null}
          </div>
        ) : null}
      </div>
      <h3 className="label sp-sub">{L.stagePage.assignedTitle}</h3>
      {assigned.length ? <ul className="list sp-people">{assigned.map(personRow)}</ul> : <p className="sp-note">{f(L.stagePage.assignedEmpty, { stage: stageName(group, stage) })}</p>}
      <h3 className="label sp-sub">{L.stagePage.claimedTitle}</h3>
      {claimed.length ? <ul className="list sp-people">{claimed.map(personRow)}</ul> : <p className="label">{L.stagePage.claimedEmpty}</p>}
      <h3 className="label sp-sub">{L.stagePage.reviewerTitle}</h3>
      <div className="sp-person" data-testid="stage-reviewer">
        {reviewer ? <MemberAvatar member={reviewer} size="28" /> : null}
        <div className="list-main">
          <span className="t-body-14m">{reviewer ? <U>{reviewer.nickname}</U> : L.project.anyReviewer}</span>
          {page.pendingReview.n ? (
            <span className="label sp-wait">
              {f(L.stagePage.pendingN, { n: page.pendingReview.n })}
              {oldest !== null ? ` · ${f(L.stagePage.longest, { t: waited(oldest) })}` : ""}
            </span>
          ) : null}
        </div>
        {admin ? (
          <div className="pop-anchor">
            <Button Label={L.stagePage.reviewerOpen} Size="Small" Style="Ghost" onClick={() => setPop(pop === "reviewer" ? null : "reviewer")} aria-expanded={pop === "reviewer"} data-testid="reviewer-open" />
            {pop === "reviewer" ? (
              <Pop title={L.stagePage.reviewerOpen} onClose={() => setPop(null)}>
                <SelectField
                  label={L.project.reviewer}
                  value={stage.reviewerId ?? ""}
                  data-testid="reviewer-select"
                  onChange={(e) => {
                    const r = dispatch("stage.set_reviewer", { stageId: stage.id, memberId: e.target.value || null }, { quiet: true });
                    if (!r.ok) notify(err(r.error), "Error");
                    else {
                      notify(L.project.reviewerSaved, "Neutral");
                      setPop(null);
                    }
                  }}
                >
                  <option value="">{L.project.anyReviewer}</option>
                  {members(world)
                    .filter((m) => isReviewer(m))
                    .map((m) => (
                      <option key={m.id} value={m.id} data-uc="">
                        {m.nickname}
                      </option>
                    ))}
                </SelectField>
              </Pop>
            ) : null}
          </div>
        ) : null}
      </div>
      <label className="sp-toggle">
        <input
          type="checkbox"
          role="switch"
          checked={locked}
          disabled={!admin}
          data-testid="stage-lock"
          onChange={(e) => {
            const r = dispatch("stage.set_lock", { stageId: stage.id, locked: e.target.checked }, { quiet: true });
            if (r.ok) notify(f(e.target.checked ? L.flex.lockOn : L.flex.lockOff, { stage: stageName(group, stage) }), "Neutral");
            else notify(err(r.error), "Error");
          }}
        />
        <span className="sp-toggle-text">
          <span className="t-body-14m">{L.stagePage.lockTitle}</span>
          <span className="label">{locked ? L.stagePage.lockOnNote : L.stagePage.lockOffNote}</span>
        </span>
      </label>
    </section>
  );
}

function AssignPersonForm({ stage, onDone }: { stage: StageRow; onDone: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err } = useI18n();
  const [who, setWho] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="stack"
      data-gap="small"
      onSubmit={(e) => {
        e.preventDefault();
        const external = who === "__name";
        const r = dispatch("stage.assign", { stageId: stage.id, memberId: external ? null : who || null, name: external ? name : null }, { quiet: true });
        if (!r.ok) return setError(err(r.error));
        notify(f(L.stagePage.assigned, { name: external ? name.trim() : memberById(world, who)?.nickname ?? "" }));
        onDone();
      }}
    >
      <SelectField label={L.stagePage.assignWho} value={who} onChange={(e) => setWho(e.target.value)} data-testid="assign-person-who">
        <option value="">{L.flex.pickOne}</option>
        {members(world).map((m) => (
          <option key={m.id} value={m.id} data-uc="">
            {m.nickname}
          </option>
        ))}
        <option value="__name">{L.stagePage.assignExternal}</option>
      </SelectField>
      {who === "__name" ? <TextField label={L.stagePage.externalName} value={name} onChange={(e) => setName(e.target.value)} data-testid="assign-person-name" /> : null}
      <p className="label">{L.stagePage.assignNote}</p>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={L.stagePage.assignGo} Size="Small" Style="Primary" type="submit" disabled={!who || (who === "__name" && !name.trim())} data-testid="assign-person-go" />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 派发下游（枢纽）
// ---------------------------------------------------------------------------

function HubBlock({ page }: { page: StagePageData }) {
  const { L, stage: stageEl } = useI18n();
  const [open, setOpen] = useState(false);
  const group = page.project.group;
  const rowOf = (s: StageRow) => page.routeRows.find((r) => r.stage.id === s.id);
  return (
    <section className="card" aria-labelledby="sp-hub" data-testid="stage-hub">
      <div className="card-head">
        <h2 id="sp-hub" className="t-heading-18">
          {L.stagePage.hubTitle} <span className="label">{L.stagePage.hubOnly}</span>
        </h2>
        <Button Label={open ? L.stagePage.configClose : L.stagePage.hubOpen} Size="Small" Style={open ? "Ghost" : "Primary"} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="hub-open" />
      </div>
      <p className="label">{L.stagePage.hubLead}</p>
      <div className="stage-chain" data-tone="muted">
        <span className="stage-chain-here">
          <span className="num">{page.row.no}</span> {stageEl(group, page.row.stage)}
        </span>
        {page.hubScope.map((s) => {
          const r = rowOf(s);
          return (
            <span key={s.id} className="stage-chain-item" data-status={r?.status}>
              <span className="stage-chain-sep" aria-hidden="true">
                ›
              </span>
              {r ? <RouteStatusIcon status={r.status} /> : null}
              {r ? <span className="num">{r.no}</span> : null} {stageEl(group, s)} <span className="stage-chain-state">· {L.labels.grain[s.grain]}</span>
            </span>
          );
        })}
      </div>
      {open ? <HubDispatchForm hubId={page.row.stage.id} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 派发
// ---------------------------------------------------------------------------

/** 连着几卡全部通过了：折成一行（按卡顺序，至少 2 卡）。 */
type DispatchItem = { kind: "row"; v: StageTaskView } | { kind: "fold"; id: string; first: string; last: string; n: number; rows: StageTaskView[] };

function foldPassed(rows: StageTaskView[], cutLabel: (v: StageTaskView) => string): DispatchItem[] {
  const byCut: { cut: string; rows: StageTaskView[] }[] = [];
  for (const v of rows) {
    const cutId = v.task.cutId ?? v.task.id;
    const last = byCut[byCut.length - 1];
    if (last && last.cut === cutId) last.rows.push(v);
    else byCut.push({ cut: cutId, rows: [v] });
  }
  const out: DispatchItem[] = [];
  let run: typeof byCut = [];
  const flush = () => {
    if (run.length >= 2) {
      const all = run.flatMap((c) => c.rows);
      out.push({ kind: "fold", id: run[0].cut, first: cutLabel(run[0].rows[0]), last: cutLabel(run[run.length - 1].rows[0]), n: all.length, rows: all });
    } else for (const c of run) for (const v of c.rows) out.push({ kind: "row", v });
    run = [];
  };
  for (const c of byCut) {
    if (c.rows.every((v) => v.task.status === "passed")) run.push(c);
    else {
      flush();
      for (const v of c.rows) out.push({ kind: "row", v });
    }
  }
  flush();
  return out;
}

function DispatchBlock({ page, admin, filter, setFilter, open, setOpen }: { page: StagePageData; admin: boolean; filter: Bucket | null; setFilter: (b: Bucket | null) => void; open: boolean; setOpen: (v: boolean) => void }) {
  const { me } = useGuild();
  const { L, f, cut: cutOf } = useI18n();
  const stage = page.row.stage;
  const group = page.project.group;
  const [picked, setPicked] = useState<Id[]>([]);
  const [pop, setPop] = useState<"bulk" | "redo" | null>(null);
  const [extending, setExtending] = useState<Id[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const rows = filter ? page.tasks.filter((v) => BUCKET_OF[v.task.status] === filter) : page.tasks;
  const live = picked.filter((id) => page.tasks.some((v) => v.task.id === id));
  const pickedViews = page.tasks.filter((v) => live.includes(v.task.id));
  const active = page.project.status === "active";
  const canPublish = active && (admin || (isReviewer(me) && stage.reviewerId === me.id));
  const toggle = (id: Id) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const cutText = (v: StageTaskView) => (v.view.cut ? cutOf(v.view.cut, group) : L.stagePage.wholeProject);
  const short = (v: StageTaskView) => cutText(v) + (v.task.layer ? ` ${v.task.layer}` : "");
  const items: DispatchItem[] = filter ? rows.map((v) => ({ kind: "row", v })) : foldPassed(rows, cutText);
  const counts = page.row.counts;
  const rowView = (v: StageTaskView) => <DispatchRow key={v.task.id} v={v} admin={admin && active} picked={live.includes(v.task.id)} onPick={() => toggle(v.task.id)} onExtend={(ids) => setExtending(ids)} />;
  return (
    <>
      <section className="card" aria-labelledby="sp-dispatch" data-testid="stage-dispatch">
        <div className="card-head">
          <h2 id="sp-dispatch" className="t-heading-18">
            {L.stagePage.dispatch} <span className="label">{f(L.stagePage.dispatchMeta, { n: page.tasks.length })}</span>
          </h2>
          <span className="row">
            {canPublish ? <Button Label={L.project.publish} Size="Small" Style="Primary" onClick={() => setPublishing(!publishing)} aria-expanded={publishing} data-testid="publish-open" /> : null}
            <button type="button" className="inline-link t-body-14m" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="dispatch-expand">
              {open ? L.stagePage.dispatchFold : L.stagePage.dispatchUnfold}
            </button>
          </span>
        </div>
        {open ? (
        <>
        <div className="chips" role="group" aria-label={L.stagePage.countsAria}>
          <button type="button" className="ui-chip" aria-pressed={filter === null} onClick={() => setFilter(null)} data-testid="filter-all">
            {f(L.stagePage.chipAll, { n: counts.total })}
          </button>
          {BUCKETS.filter((b) => counts[b]).map((b) => (
            <button key={b} type="button" className="ui-chip" aria-pressed={filter === b} onClick={() => setFilter(filter === b ? null : b)} data-testid={`filter-${b}`}>
              {L.route.legend[b]} {counts[b]}
            </button>
          ))}
        </div>
        {admin && live.length ? (
          <div className="bulk-bar" data-testid="bulk-bar">
            <span className="t-body-14m">
              {f(L.stagePage.picked, { n: live.length })}
              <span className="bulk-names">{pickedViews.map(short).join(" · ")}</span>
            </span>
            <div className="pop-anchor">
              <button type="button" className="bulk-action" onClick={() => setPop(pop === "bulk" ? null : "bulk")} data-testid="bulk-assign">
                {L.stagePage.bulkAssign}
              </button>
              {pop === "bulk" ? (
                <Pop title={f(L.stagePage.bulkAssignTitle, { n: live.length })} onClose={() => setPop(null)} align="start">
                  <AssignTasksForm
                    ids={live}
                    onDone={() => {
                      setPop(null);
                      setPicked([]);
                    }}
                  />
                </Pop>
              ) : null}
            </div>
            <button type="button" className="bulk-action" onClick={() => setExtending(live)} data-testid="bulk-extend">
              {L.stagePage.bulkExtend}
            </button>
            {pickedViews.some((v) => v.task.status === "passed") ? (
              <div className="pop-anchor">
                <button type="button" className="bulk-action" onClick={() => setPop(pop === "redo" ? null : "redo")} data-testid="bulk-redo">
                  {L.stagePage.bulkRedo}
                </button>
                {pop === "redo" ? (
                  <Pop title={L.stagePage.bulkRedoTitle} onClose={() => setPop(null)} align="start">
                    <RedoForm
                      ids={pickedViews.filter((v) => v.task.status === "passed").map((v) => v.task.id)}
                      onDone={() => {
                        setPop(null);
                        setPicked([]);
                      }}
                    />
                  </Pop>
                ) : null}
              </div>
            ) : null}
            <button type="button" className="bulk-clear" onClick={() => setPicked([])}>
              ✕ {L.stagePage.unpick}
            </button>
          </div>
        ) : null}
        {rows.length ? (
          <div className="disp-table">
            <div className="disp-row disp-headrow" aria-hidden="true">
              <span />
              <span>{L.stagePage.colCut}</span>
              <span>{L.stagePage.colStatus}</span>
              <span>{L.stagePage.colWho}</span>
              <span>{L.stagePage.colVersion}</span>
              <span>{L.stagePage.colTime}</span>
              <span />
            </div>
            <ul className="disp-list">
              {items.map((it) =>
                it.kind === "row" ? (
                  rowView(it.v)
                ) : unfolded[it.id] ? (
                  it.rows.map(rowView)
                ) : (
                  <li key={it.id} className="disp-fold" data-testid="dispatch-fold">
                    <RouteStatusIcon status="done" />
                    <span>{f(L.stagePage.foldText, { first: it.first, last: it.last, n: it.n })}</span>
                    <button type="button" className="inline-link" onClick={() => setUnfolded({ ...unfolded, [it.id]: true })}>
                      {L.route.expand}
                    </button>
                  </li>
                )
              )}
            </ul>
          </div>
        ) : (
          <Empty>{filter ? L.stagePage.filterEmpty : L.stagePage.noTasks}</Empty>
        )}
        </>
        ) : null}
        {page.extras.length ? (
          <div className="sp-extras">
            <ExtrasList stage={stage} />
          </div>
        ) : null}
        {extending ? <ExtendDialog target={{ kind: "tasks", ids: extending }} onClose={() => setExtending(null)} /> : null}
      </section>
      {publishing ? (
        <section className="card" aria-label={L.project.publish} data-testid="publish-card">
          <PublishForm stage={stage} onDone={() => setPublishing(false)} />
          <div className="form-actions">
            <Button Label={L.common.cancel} Size="Small" Style="Ghost" onClick={() => setPublishing(false)} />
          </div>
        </section>
      ) : null}
    </>
  );
}

function AssignTasksForm({ ids, onDone, reassign = false }: { ids: Id[]; onDone: () => void; reassign?: boolean }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err } = useI18n();
  const [who, setWho] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="stack"
      data-gap="small"
      onSubmit={(e) => {
        e.preventDefault();
        const external = who === "__name";
        if (reassign) {
          for (const id of ids) {
            const r = dispatch("task.reclaim", { taskId: id }, { quiet: true });
            if (!r.ok) return setError(err(r.error));
          }
        }
        const r = dispatch("task.assign", { taskIds: ids, memberId: external ? null : who, outsourceName: external ? name : null }, { quiet: true });
        if (!r.ok) return setError(err(r.error));
        notify(f(L.flex.batched, { n: ids.length, name: external ? name.trim() : memberById(world, who)?.nickname ?? "" }));
        onDone();
      }}
    >
      <SelectField label={L.flex.toWhom} value={who} onChange={(e) => setWho(e.target.value)} data-testid="assign-tasks-who">
        <option value="">{L.flex.pickOne}</option>
        {members(world).map((m) => (
          <option key={m.id} value={m.id} data-uc="">
            {m.nickname}
          </option>
        ))}
        <option value="__name">{L.stagePage.assignOutsource}</option>
      </SelectField>
      {who === "__name" ? <TextField label={L.stagePage.externalName} value={name} onChange={(e) => setName(e.target.value)} data-testid="assign-tasks-name" /> : null}
      {reassign ? <p className="label">{L.stagePage.reassignNote}</p> : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={f(L.flex.batchGo, { n: ids.length })} Size="Small" Style="Primary" type="submit" disabled={!who || (who === "__name" && !name.trim())} data-testid="assign-tasks-go" />
      </div>
    </form>
  );
}

/** 打回重做（通过的那几张）：写一句为什么；原来的活力点不扣，重做通过后按新的算。 */
function RedoForm({ ids, onDone }: { ids: Id[]; onDone: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, pt } = useI18n();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="stack"
      data-gap="small"
      onSubmit={(e) => {
        e.preventDefault();
        const one = ids.length === 1 && world.tasks[ids[0]] ? taskView(world, world.tasks[ids[0]]) : null;
        for (const id of ids) {
          const r = dispatch("task.reopen", { taskId: id, comments: [{ text }] }, { quiet: true });
          if (!r.ok) return setError(err(r.error));
        }
        notify(one ? f(L.edit.redone, { label: pt(one.labelP) }) : f(L.stagePage.redoneN, { n: ids.length }), "Neutral");
        onDone();
      }}
    >
      <TextField label={L.edit.redoComment} value={text} onChange={(e) => setText(e.target.value)} data-testid="redo-comment" />
      <p className="label">{L.stagePage.redoNote}</p>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={L.edit.redoGo} Size="Small" Style="Primary" type="submit" data-testid="redo-go" />
      </div>
    </form>
  );
}

function DispatchRow({ v, admin, picked, onPick, onExtend }: { v: StageTaskView; admin: boolean; picked: boolean; onPick: () => void; onExtend: (ids: Id[]) => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, r: rich, err, pt, countdown, dateTime, monthDay, duration, cut: cutOf } = useI18n();
  const [menu, setMenu] = useState<"menu" | "assign" | "redo" | null>(null);
  const t = v.task;
  const group = v.view.project.group;
  const label = pt(v.view.labelP);
  const running = (t.status === "claimed" || t.status === "returned") && !!t.dueAt;
  const now = Date.parse(nowOf(world));
  const left = t.dueAt ? Date.parse(t.dueAt) - now : null;
  const reviewer = memberById(world, t.extra?.reviewerId ?? v.view.stage.reviewerId);
  const backToOpen = () => {
    // 收回到可接：先收回，再放出来。
    const r = dispatch("task.reclaim", { taskId: t.id }, { quiet: true });
    if (!r.ok) return notify(err(r.error), "Error");
    const r2 = dispatch("task.reopen", { taskId: t.id }, { quiet: true });
    if (!r2.ok) return notify(err(r2.error), "Error");
    notify(f(L.stagePage.backToOpen, { label }), "Neutral");
    setMenu(null);
  };
  const who = v.view.assignee ? (
    <span className="disp-who-in">
      <MemberAvatar member={v.view.assignee} size="20" />
      <U>{v.view.assignee.nickname}</U>
    </span>
  ) : t.outsourced && t.outsourceName ? (
    <span className="disp-who-in">
      <U>{t.outsourceName}</U> <Tag>{L.stagePage.outsourced}</Tag>
    </span>
  ) : (
    <span className="muted">—</span>
  );
  let time: ReactNode = <span className="muted">—</span>;
  if (running && t.dueAt && left !== null) {
    const near = left >= 0 && left < NEAR_MS;
    time = (
      <>
        <span>{dateTime(t.dueAt)}</span>
        <span className="label" data-tone={left < 0 ? "danger" : near ? "warning" : undefined}>
          {near ? `${L.stagePage.nearDue} · ` : ""}
          {countdown(left).text}
        </span>
      </>
    );
  } else if (t.status === "submitted" && v.latest) {
    time = (
      <>
        <span>{f(L.stagePage.handedIn, { at: dateTime(v.latest.at) })}</span>
        <span className="label">
          {reviewer ? rich(L.stagePage.waitFor, { name: <U>{reviewer.nickname}</U> }) : L.stagePage.waitingReview} · {duration(now - Date.parse(v.latest.at))}
        </span>
      </>
    );
  } else if (t.status === "passed" && t.passedAt) time = <span>{f(L.stagePage.passedOn, { date: monthDay(t.passedAt) })}</span>;
  else if (t.status === "open") time = <span className="label">{L.stagePage.openNow}</span>;
  else if (t.status === "locked") time = <span className="label">{L.stagePage.waitUp}</span>;
  else if (t.status === "reclaimed") time = <span className="label">{L.stagePage.reclaimedNow}</span>;
  const inHand = t.status === "claimed" || t.status === "returned" || t.status === "submitted";
  return (
    <li className="disp-row" data-status={t.status} data-picked={picked ? "yes" : undefined} data-testid="dispatch-row" data-task={t.id}>
      {admin ? <input type="checkbox" className="disp-pick" checked={picked} onChange={onPick} aria-label={f(L.stagePage.pickAria, { label })} data-testid="dispatch-pick" /> : <span className="disp-pick" />}
      <span className="disp-label">
        <span className="t-body-14m num">{v.view.cut ? cutOf(v.view.cut, group) : L.stagePage.wholeProject}</span>
        {t.layer ? <span className="label">{f(L.labels.layerShort, { layer: t.layer })}</span> : null}
        {t.redo ? <Tag tone="warning">{L.stagePage.redoTag}</Tag> : null}
      </span>
      <span className="disp-status">
        <StatusPill Status={t.status} />
      </span>
      <span className="disp-who">{who}</span>
      <span className="disp-ver label num">{v.view.versionTag ?? "—"}</span>
      <span className="disp-due" data-overdue={left !== null && left < 0 && running ? "yes" : undefined}>
        {time}
      </span>
      <div className="pop-anchor disp-menu">
        <button type="button" className="icon-button" aria-label={f(L.stagePage.rowMenu, { label })} aria-expanded={!!menu} onClick={() => setMenu(menu ? null : "menu")} data-testid="dispatch-menu">
          <span aria-hidden="true">⋯</span>
        </button>
        {menu ? (
          <Pop title={label} onClose={() => setMenu(null)} testId="dispatch-pop">
            {menu === "menu" ? (
              <div className="pop-menu" role="menu">
                {admin && (t.status === "open" || t.status === "reclaimed") ? (
                  <button type="button" role="menuitem" onClick={() => setMenu("assign")} data-testid="row-assign" data-autofocus="">
                    {L.stagePage.assignTo}
                  </button>
                ) : null}
                {admin && inHand ? (
                  <button type="button" role="menuitem" onClick={() => setMenu("assign")} data-testid="row-reassign" data-autofocus="">
                    {L.stagePage.reassign}
                  </button>
                ) : null}
                {admin && running ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      onExtend([t.id]);
                    }}
                    data-testid="row-extend"
                  >
                    {L.stagePage.extendTo}
                  </button>
                ) : null}
                {admin && inHand ? (
                  <button type="button" role="menuitem" onClick={backToOpen} data-testid="row-reclaim">
                    {L.stagePage.reclaimToOpen}
                  </button>
                ) : null}
                {admin && t.status === "reclaimed" ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      const r = dispatch("task.reopen", { taskId: t.id }, { quiet: true });
                      if (!r.ok) notify(err(r.error), "Error");
                      else {
                        notify(f(L.task.reopened, { label }), "Neutral");
                        setMenu(null);
                      }
                    }}
                    data-testid="row-reopen"
                  >
                    {L.task.reopen}
                  </button>
                ) : null}
                {admin && t.status === "passed" ? (
                  <button type="button" role="menuitem" data-tone="danger" onClick={() => setMenu("redo")} data-testid="row-redo">
                    {L.stagePage.redoTo}
                  </button>
                ) : null}
                {v.view.cut ? (
                  <Link to={`/cut/${v.view.cut.id}`} role="menuitem" data-testid="row-cut">
                    {L.stagePage.seeCut}
                  </Link>
                ) : null}
              </div>
            ) : null}
            {menu === "assign" ? <AssignTasksForm ids={[t.id]} reassign={t.status !== "open" && t.status !== "reclaimed"} onDone={() => setMenu(null)} /> : null}
            {menu === "redo" ? <RedoForm ids={[t.id]} onDone={() => setMenu(null)} /> : null}
          </Pop>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 交付物
// ---------------------------------------------------------------------------

/** 交付物（SPEC §18.6）：默认是这一环节的交付物墙（一卡一张大缩略图，补录的标「补录」，核实过的标「已核实」）· 验收 · 加卡 · 盘点交付物。 */
function DeliverBlock({ page, admin }: { page: StagePageData; admin: boolean }) {
  const { world, me } = useGuild();
  const { L, f, r: rich, monthDay, pt } = useI18n();
  const stage = page.row.stage;
  const d = useDeliveries(page.project.id);
  const [sub, setSub] = useState<"accept" | "cuts" | null>(null);
  const list = page.tasks;
  const canAccept = !stage.acceptedAt && list.length > 0 && list.some((v) => v.task.status === "passed") && list.every((v) => v.task.status === "passed" || v.task.redo);
  const active = page.project.status === "active";
  const missing = list.filter((v) => v.task.status !== "passed" && !v.task.redo);
  const acceptedBy = memberById(world, stage.acceptedById);
  const audited = d?.audit ? monthDay(localDate(d.audit.at)) : null;
  return (
    <section className="card" aria-labelledby="sp-deliver" data-testid="stage-deliverables">
      <div className="card-head">
        <h2 id="sp-deliver" className="t-heading-18">
          {L.stagePage.deliverables}{" "}
          <span className="label">
            {f(L.audit.deliverLead, { passed: page.row.counts.passed, total: page.row.counts.total })}
            {audited ? f(L.audit.deliverAudited, { date: audited }) : ""}
          </span>
        </h2>
        {isReviewer(me) && page.project.status !== "zero" ? (
          <Link to={`/project/${page.project.id}/audit?stage=${stage.templateKey}`} className="inline-link t-body-14m" data-testid="stage-audit-link">
            {L.audit.auditLink}
          </Link>
        ) : null}
      </div>
      {d ? <StageWall d={d} stage={stage} group={page.project.group} /> : null}
      {sub === "cuts" ? <AddCutsForm projectId={page.project.id} onDone={() => setSub(null)} /> : null}
      {stage.acceptedAt ? (
        <p className="sp-accepted" data-testid="stage-accepted">
          <RouteStatusIcon status="done" size={16} />
          {rich(L.stagePage.acceptedBy, { date: monthDay(stage.acceptedAt), name: <U>{acceptedBy?.nickname ?? "—"}</U> })}
        </p>
      ) : (
        <div className="sp-accept-box" data-ready={canAccept ? "yes" : undefined}>
          {admin && active ? <Button Label={L.stagePage.acceptOpen} Style={canAccept ? "Accent" : "Secondary"} disabled={!canAccept} onClick={() => setSub("accept")} data-testid="stage-accept-open" /> : null}
          <p className="label">
            {canAccept
              ? L.stagePage.readyToAccept
              : list.length
                ? f(L.stagePage.notYetAccept, { n: missing.length, which: missing.slice(0, 3).map((v) => pt(v.view.labelP)).join(L.common.listSep) + (missing.length > 3 ? "…" : "") })
                : L.stagePage.noTasks}
          </p>
          {admin && active && stage.grain !== "project" ? (
            <button type="button" className="inline-link t-body-14m" onClick={() => setSub(sub === "cuts" ? null : "cuts")} data-testid="stage-cuts-open">
              + {L.edit.addCutsOpen}
            </button>
          ) : null}
        </div>
      )}
      {stage.acceptedAt && admin && active && stage.grain !== "project" ? (
        <button type="button" className="inline-link t-body-14m" onClick={() => setSub(sub === "cuts" ? null : "cuts")} data-testid="stage-cuts-open">
          + {L.edit.addCutsOpen}
        </button>
      ) : null}
      {sub === "accept" ? <AcceptDialog stage={stage} onClose={() => setSub(null)} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 这个环节的设置
// ---------------------------------------------------------------------------

function ConfigBlock({ page, admin }: { page: StagePageData; admin: boolean }) {
  const { world } = useGuild();
  const { L, f, lang, num, stageName, unit: unitOf } = useI18n();
  const stage = page.row.stage;
  const group = page.project.group;
  const [open, setOpen] = useState(false);
  const text = stageText(group, stage, lang);
  const active = page.project.status === "active";
  const factor = stage.deadlineFactor ?? deadlineFactor(world);
  const min = stage.minDeadlineHours ?? MIN_DEADLINE_HOURS;
  const summary = [
    L.labels.stageKind[stage.kind],
    L.labels.grain[stage.grain],
    f(L.stagePage.sumUnit, { unit: unitOf(stage.unit, group, 1) }),
    f(L.stagePage.sumTn, { tn: num(stage.tn) }),
    f(L.stagePage.sumFactor, { n: num(factor) }),
    f(L.stagePage.sumMin, { n: num(min) }),
    page.row.plan ? f(L.stagePage.sumPlan, { a: page.row.plan.start, n: page.row.plan.end - page.row.plan.start + 1 }) : null,
  ].filter(Boolean);
  return (
    <section className="card sp-config" aria-labelledby="sp-config" data-testid="stage-config" data-mode={open ? "edit" : "view"}>
      <div className="card-head">
        <h2 id="sp-config" className="t-heading-18">
          {L.stagePage.config} {open ? <span className="label">{L.stagePage.editingNow}</span> : null}
        </h2>
        {admin && active && !open ? <Button Label={L.stagePage.configOpen} Size="Small" Style="Secondary" onClick={() => setOpen(true)} aria-expanded={open} data-testid="stage-edit-open" /> : null}
      </div>
      {!open ? (
        <p className="label sp-config-sum">
          {summary.join(" · ")}
          <br />
          {L.stagePage.sumRecv}
          {text.uc.receive ? <U>{text.receive}</U> : text.receive} · {L.stagePage.sumDeliver}
          {text.uc.deliver ? <U>{text.deliver}</U> : text.deliver}
          {page.downstream.length ? ` → ${page.downstream.map((s) => stageName(group, s)).join(" / ")}` : ""}
        </p>
      ) : (
        <StageConfigForm page={page} onDone={() => setOpen(false)} />
      )}
    </section>
  );
}

function StageConfigForm({ page, onDone }: { page: StagePageData; onDone: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, lang, stageName, unit: unitOf } = useI18n();
  const stage = page.row.stage;
  const group = page.project.group;
  const text = stageText(group, stage, lang);
  const plan = page.row.plan;
  const [name, setName] = useState(text.name);
  const [kind, setKind] = useState(stage.kind);
  const [tn, setTn] = useState(String(stage.tn));
  const [factor, setFactor] = useState(stage.deadlineFactor ? String(stage.deadlineFactor) : "");
  const [minHours, setMinHours] = useState(stage.minDeadlineHours ? String(stage.minDeadlineHours) : "");
  const [startWeek, setStartWeek] = useState(String(plan?.start ?? 1));
  const [weeks, setWeeks] = useState(String(plan ? plan.end - plan.start + 1 : 1));
  const [receive, setReceive] = useState(text.receive);
  const [deliver, setDeliver] = useState(text.deliver);
  const [handTo, setHandTo] = useState(text.handTo);
  const [folder, setFolder] = useState(stage.folder);
  const [error, setError] = useState<string | null>(null);
  const delivered = page.tasks.some((v) => submissionsOf(world, v.task.id).length > 0);
  const run = (cmd: "stage.move" | "stage.disable" | "stage.remove", input: Record<string, unknown>, ok: string, after?: () => void) => {
    const r = dispatch(cmd, input as never, { quiet: true });
    if (!r.ok) notify(err(r.error), "Error");
    else {
      if (ok) notify(ok, "Neutral");
      after?.();
    }
  };
  const save = () => {
    // 只送改了的那几样（没改的模板字照旧跟着语言走）；一样一样存，哪一步被拒就停在那，原因写在表下面。
    const upd: Record<string, unknown> = { stageId: stage.id };
    if (name !== text.name) upd.name = name;
    if (kind !== stage.kind) upd.kind = kind;
    if (receive !== text.receive) upd.receive = receive;
    if (deliver !== text.deliver) upd.deliver = deliver;
    if (handTo !== text.handTo) upd.handTo = handTo;
    if (folder !== stage.folder) upd.folder = folder;
    let changed = false;
    if (Object.keys(upd).length > 1) {
      const r = dispatch("stage.update", upd as never, { quiet: true });
      if (!r.ok) return setError(err(r.error));
      changed = true;
    }
    const nf = factor ? Number(factor) : null;
    const nm = minHours ? Number(minHours) : null;
    if (Number(tn) !== stage.tn || nf !== (stage.deadlineFactor ?? null) || nm !== (stage.minDeadlineHours ?? null)) {
      const r = dispatch("stage.set_rate", { stageId: stage.id, tn: Number(tn), deadlineFactor: nf, minDeadlineHours: nm }, { quiet: true });
      if (!r.ok) return setError(err(r.error));
      changed = true;
    }
    if (!plan || Number(startWeek) !== plan.start || Number(weeks) !== plan.end - plan.start + 1) {
      const r = dispatch("stage.set_period", { stageId: stage.id, startWeek: Number(startWeek), weeks: Number(weeks) }, { quiet: true });
      if (!r.ok) return setError(err(r.error));
      changed = true;
    }
    setError(null);
    if (changed) notify(f(L.edit.stageSaved, { name }), "Neutral");
    onDone();
  };
  return (
    <form
      className="stack"
      data-gap="small"
      data-testid="stage-config-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <TextField label={L.edit.stageName} value={name} onChange={(e) => setName(e.target.value)} data-testid="config-name" />
      <span className="field-label">{L.edit.stageKind}</span>
      <div className="chips" role="radiogroup" aria-label={L.edit.stageKind}>
        {STAGE_KIND.map((k) => (
          <button key={k} type="button" className="ui-chip" role="radio" aria-checked={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`config-kind-${k}`}>
            {L.labels.stageKind[k]}
          </button>
        ))}
      </div>
      <span className="field-label">
        {L.edit.stageGrain} <span className="label">{L.stagePage.grainHint}</span>
      </span>
      <div className="chips">
        {GRAIN.map((g) => (
          <span key={g} className="ui-chip" aria-pressed={stage.grain === g} aria-disabled="true">
            {L.labels.grain[g]}
          </span>
        ))}
      </div>
      <div className="form-grid" data-cols="2">
        <TextField label={L.edit.stageUnit} value={unitOf(stage.unit, group, 1)} disabled readOnly />
        <TextField label={f(L.stagePage.tnLabel, { unit: unitOf(stage.unit, group, 1) })} type="number" step="0.1" min={0} value={tn} onChange={(e) => setTn(e.target.value)} data-testid="rate-tn" />
        <TextField label={L.flex.factor} type="number" step="0.1" placeholder={String(deadlineFactor(world))} value={factor} onChange={(e) => setFactor(e.target.value)} data-testid="rate-factor" />
        <TextField label={L.flex.minHours} type="number" placeholder={String(MIN_DEADLINE_HOURS)} value={minHours} onChange={(e) => setMinHours(e.target.value)} data-testid="rate-min" />
        <TextField label={L.stagePage.startWeek} type="number" min={1} value={startWeek} onChange={(e) => setStartWeek(e.target.value)} data-testid="period-start" />
        <TextField label={L.flex.periodWeeks} type="number" min={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} data-testid="period-weeks" />
      </div>
      <p className="label">{L.flex.rateNote}</p>
      <TextField label={L.project.receive} value={receive} onChange={(e) => setReceive(e.target.value)} />
      <TextField label={L.project.deliver} value={deliver} onChange={(e) => setDeliver(e.target.value)} />
      <TextField label={L.project.handTo} value={handTo} onChange={(e) => setHandTo(e.target.value)} />
      <TextField label={L.stagePage.folder} value={folder} onChange={(e) => setFolder(e.target.value)} data-testid="config-folder" />
      {page.downstream.length ? (
        <div className="row">
          <span className="label">{L.stagePage.downstream}</span>
          {page.downstream.map((s) => (
            <span key={s.id} className="now-tag">
              {stageName(group, s)}
            </span>
          ))}
        </div>
      ) : null}
      <div className="sp-position">
        <span className="t-body-14m">{f(L.stagePage.position, { no: page.row.no })}</span>
        <div className="row">
          <Button Label={L.stagePage.moveUp} Size="Small" Style="Secondary" disabled={!page.prev} onClick={() => run("stage.move", { stageId: stage.id, direction: "up" }, L.stagePage.moved)} data-testid="stage-move-up" />
          <Button Label={L.stagePage.moveDown} Size="Small" Style="Secondary" disabled={!page.next} onClick={() => run("stage.move", { stageId: stage.id, direction: "down" }, L.stagePage.moved)} data-testid="stage-move-down" />
        </div>
      </div>
      <div className="sp-danger">
        <span className="t-body-14m">{stage.disabled ? L.stagePage.enableTitle : L.stagePage.disableTitle}</span>
        <p className="label">{stage.disabled ? L.stagePage.enableNote : delivered ? f(L.stagePage.disableNoteDelivered, { n: page.row.counts.passed + page.row.counts.submitted }) : L.stagePage.disableNote}</p>
        <div className="row">
          <Button
            Label={stage.disabled ? L.edit.stageEnable : L.edit.stageDisable}
            Size="Small"
            Style="Secondary"
            onClick={() => run("stage.disable", { stageId: stage.id, disabled: !stage.disabled }, f(stage.disabled ? L.edit.stageEnabled : L.edit.stageDisabled, { name: stageName(group, stage) }))}
            data-testid="stage-disable"
          />
          {!delivered ? (
            <Button
              Label={L.edit.stageRemove}
              Size="Small"
              Style="Ghost"
              onClick={() => run("stage.remove", { stageId: stage.id }, f(L.edit.stageRemoved, { name: stageName(group, stage) }), () => navigate(`/project/${page.project.id}`))}
              data-testid="stage-remove"
            />
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions" data-justify="between">
        <span className="label">{L.stagePage.savedToLog}</span>
        <div className="row">
          <Button Label={L.common.cancel} Size="Small" Style="Ghost" onClick={onDone} data-testid="config-cancel" />
          <Button Label={L.common.save} Size="Small" Style="Primary" type="submit" data-testid="config-save" />
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 这个环节的动态
// ---------------------------------------------------------------------------

const ACTIVITY_SHOWN = 8;

function ActivityBlock({ stageId }: { stageId: Id }) {
  const { world } = useGuild();
  const { L, f, ph, dateTime } = useI18n();
  const [more, setMore] = useState(false);
  const all = stageActivityOf(world, stageId, 60);
  const items = more ? all : all.slice(0, ACTIVITY_SHOWN);
  return (
    <section className="card" aria-labelledby="sp-activity" data-testid="stage-activity">
      <h2 id="sp-activity" className="t-heading-18">
        {L.stagePage.activity} <span className="label">{L.stagePage.activityHint}</span>
      </h2>
      {items.length ? (
        <ol className="sp-activity">
          {items.map((i) => (
            <li key={i.entry.id} data-testid="stage-activity-item" data-command={i.entry.command}>
              <span className="label num">{dateTime(i.at)}</span>
              <span className="break">{ph(i.phrase)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>{L.stagePage.noActivity}</Empty>
      )}
      {all.length > ACTIVITY_SHOWN ? (
        <button type="button" className="inline-link label" onClick={() => setMore(!more)} data-testid="activity-more">
          {more ? L.route.collapse : f(L.stagePage.activityMore, { n: all.length - ACTIVITY_SHOWN })}
        </button>
      ) : null}
    </section>
  );
}
