/**
 * 第一层 · 项目页的环节路线（SPEC §17.1；排法照设计组 v6-1 / v6-6）：
 *   顶上概要：现在在第几个环节 · 每段走到哪 + 三段小进度；
 *   一张「环节路线」卡：按 前期 / 中期 / 后期 分段，环节按顺序编号 1…N，一行一个：
 *     编号 · 名字 · 类型 · 状态（字 + 颜色 + 图形）· 进度条和一句话 · 人 · 计划和实际 · 提醒；
 *   已经结束的段（和整段都还没到的段）折成一行，能展开；现在在做的那一行高亮；
 *   两个环节之间悬停出「+ 在这里插一个环节」，点开是就地的小弹层。点一行进环节页。
 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { isAdmin } from "@/domain/commands/core";
import { GRAIN, PHASE, STAGE_KIND, UNIT, type Grain, type Id, type Phase, type StageKind, type Unit } from "@/domain/model";
import { ROUTE_STATUS, memberById, projectById, stageRouteOf, type RouteCounts, type RoutePerson, type RoutePhase, type RouteRow, type RouteStatus, type StageRoute } from "@/domain/queries";
import { useI18n, type I18n } from "@/i18n/I18n";
import { Link, navigate } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { MemberAvatar, SelectField, Tag, TextField } from "./bits";
import { Pop } from "./popover";

// ---------------------------------------------------------------------------
// 小零件：状态 · 进度条 · 头像
// ---------------------------------------------------------------------------

/** 状态：字 + 颜色 + 图形一起表示（色弱也分得清）。plain = 不带底色（路线的行里）。 */
export function RouteStatusBadge({ status, counts, plain = false }: { status: RouteStatus; counts?: RouteCounts; plain?: boolean }) {
  const { L, f } = useI18n();
  return (
    <span className="route-status" data-status={status} data-plain={plain ? "yes" : undefined} data-testid="route-status">
      <RouteStatusIcon status={status} />
      <span>
        {L.route.status[status]}
        {status === "active" && counts ? ` ${f(L.route.activeCounts, { passed: counts.passed, total: counts.total })}` : ""}
      </span>
    </span>
  );
}

export function RouteStatusIcon({ status, size = 14 }: { status: RouteStatus; size?: number }) {
  return (
    <svg className="route-icon" data-status={status} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {status === "locked" ? <circle cx="8" cy="8" r="6" fill="none" strokeDasharray="2.4 2.2" /> : null}
      {status === "ready" ? <circle cx="8" cy="8" r="6" fill="none" /> : null}
      {status === "active" ? (
        <>
          <circle cx="8" cy="8" r="6" fill="none" />
          <path d="M8 2a6 6 0 0 1 0 12Z" className="solid" />
        </>
      ) : null}
      {status === "review" ? (
        <>
          <circle cx="8" cy="8" r="6" fill="none" />
          <circle cx="8" cy="8" r="2.6" className="solid" />
        </>
      ) : null}
      {status === "done" ? (
        <>
          <circle cx="8" cy="8" r="7" className="solid" />
          <path d="M4.8 8.2 7 10.4 11.4 5.8" fill="none" className="on-solid" />
        </>
      ) : null}
    </svg>
  );
}

/** 五种状态的图例（路线卡右上）。 */
export function RouteLegend() {
  const { L } = useI18n();
  return (
    <ul className="route-legend" aria-label={L.route.legendAria}>
      {ROUTE_STATUS.map((s) => (
        <li key={s} data-status={s}>
          <RouteStatusIcon status={s} />
          {L.route.status[s]}
        </li>
      ))}
    </ul>
  );
}

const BAR_PARTS = ["passed", "submitted", "working", "open"] as const;

/** 进度条：通过 / 待审 / 在做 / 可接（剩下的是锁住）。 */
export function RouteBar({ counts }: { counts: RouteCounts }) {
  const { L } = useI18n();
  const total = Math.max(1, counts.total);
  const title = BAR_PARTS.filter((k) => counts[k])
    .map((k) => `${L.route.legend[k]} ${counts[k]}`)
    .join(" · ");
  return (
    <span className="route-bar" role="img" aria-label={title || L.route.legend.none} title={title}>
      {BAR_PARTS.map((k) => (counts[k] ? <span key={k} data-part={k} style={{ width: `${(counts[k] / total) * 100}%` }} /> : null))}
    </span>
  );
}

/** 人：最多 5 个头像 + 「+3」；没人时写「缺人」（已经轮到它了）或「还没人」。 */
export function PeopleStack({ people, max = 5, urgent = true }: { people: RoutePerson[]; max?: number; urgent?: boolean }) {
  const { world } = useGuild();
  const { L, f } = useI18n();
  if (!people.length) return <span className="route-nobody" data-urgent={urgent ? "yes" : undefined}>{urgent ? L.route.noPeople : L.route.nobodyYet}</span>;
  const shown = people.slice(0, max);
  return (
    <span className="people-stack" aria-label={people.map((x) => x.name).join(L.common.listSep)} data-uc="" data-testid="route-people" data-count={people.length}>
      {shown.map((x) => (
        <MemberAvatar key={x.memberId ?? `n:${x.name}`} member={memberById(world, x.memberId)} fallback={x.name} size="28" />
      ))}
      {people.length > max ? <span className="people-more">{f(L.route.morePeople, { n: people.length - max })}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 字：计划 / 实际 · 一句话进度 · 每段走到哪
// ---------------------------------------------------------------------------

export function planLine(i18n: I18n, row: RouteRow): string {
  const { L, f } = i18n;
  if (!row.plan) return L.route.noPlan;
  return row.plan.start === row.plan.end ? f(L.route.planOne, { a: row.plan.start }) : f(L.route.planLine, { a: row.plan.start, b: row.plan.end });
}

export function actualLine(i18n: I18n, row: RouteRow): string {
  const { L, f } = i18n;
  if (row.actual) {
    if (!row.actual.done) return f(L.route.actualFrom, { a: row.actual.start });
    return row.actual.start === row.actual.end ? f(L.route.actualOne, { a: row.actual.start }) : f(L.route.actualDone, { a: row.actual.start, b: row.actual.end });
  }
  return row.status === "ready" ? L.route.nobodyClaimed : L.route.notBegun;
}

/** 计划和实际（一行写完；环节页概况用）。 */
export function planText(i18n: I18n, row: RouteRow): string {
  return [planLine(i18n, row), row.actual || row.status === "ready" ? actualLine(i18n, row) : null].filter(Boolean).join(" · ");
}

function upstreamNames(i18n: I18n, route: StageRoute, row: RouteRow): string {
  const byKey = new Map(route.rows.map((r) => [r.stage.templateKey, r]));
  return row.stage.upstream
    .map((k) => byKey.get(k))
    .filter((r): r is RouteRow => !!r && r.status !== "done" && r.status !== "review")
    .map((r) => i18n.stageName(route.project.group, r.stage))
    .join(" · ");
}

/** 进度条下面那一句：通过 25 · 待审 2 · 在做 1 / 0 / 14 · 等上游：上色。 */
function progressCaption(i18n: I18n, route: StageRoute, row: RouteRow): string {
  const { L, f } = i18n;
  const c = row.counts;
  if (row.status === "done") return f(L.route.capDone, { passed: c.passed, total: c.total });
  if (row.status === "review") return f(L.route.capReview, { passed: c.passed, total: c.total });
  if (row.status === "ready") return f(L.route.capReady, { total: c.total, open: c.open });
  if (row.status === "locked") {
    const names = upstreamNames(i18n, route, row);
    return names ? f(L.route.capWaitFor, { total: c.total, names }) : f(L.route.capLocked, { total: c.total });
  }
  return (["passed", "submitted", "working", "open", "locked"] as const)
    .filter((k) => c[k])
    .map((k) => `${L.route.legend[k]} ${c[k]}`)
    .join(" · ");
}

interface PhaseFacts {
  done: number;
  review: number;
  active: number;
  ready: number;
  locked: number;
}

function factsOf(ph: RoutePhase): PhaseFacts {
  const out: PhaseFacts = { done: 0, review: 0, active: 0, ready: 0, locked: 0 };
  for (const r of ph.rows) if (!r.stage.disabled) out[r.status] += 1;
  return out;
}

/** 一段走到哪：「2 个结束、进行到 分镜、1 个可以开始」。 */
function phaseParts(i18n: I18n, route: StageRoute, ph: RoutePhase): string[] {
  const { L, f, stageName } = i18n;
  const x = factsOf(ph);
  if (ph.allDone) return [f(L.route.allDoneN, { n: ph.total })];
  if (!x.done && !x.review && !x.active && !x.ready) return [f(L.route.allLockedN, { n: x.locked })];
  const parts: string[] = [];
  if (x.done) parts.push(f(L.route.partDone, { n: x.done }));
  if (x.review) parts.push(f(L.route.partReview, { n: x.review }));
  if (x.active) parts.push(ph.reached && ph.reached.status === "active" ? f(L.route.partAt, { stage: stageName(route.project.group, ph.reached.stage) }) : f(L.route.partActive, { n: x.active }));
  if (x.ready) parts.push(f(L.route.partReady, { n: x.ready }));
  if (x.locked) parts.push(f(L.route.partLocked, { n: x.locked }));
  return parts;
}

/** 默认折起来的段：已经结束的；整段都还没到的（不是现在这一段）。 */
function foldedByDefault(route: StageRoute, ph: RoutePhase): boolean {
  if (ph.allDone) return true;
  const x = factsOf(ph);
  const untouched = !x.done && !x.review && !x.active && !x.ready;
  return untouched && route.current?.stage.phase !== ph.phase && route.rows.length > 0;
}

// ---------------------------------------------------------------------------
// 路线
// ---------------------------------------------------------------------------

/** 项目页「环节」标签：路线本身。 */
export function StageRouteView({ projectId }: { projectId: Id }) {
  const { world, me } = useGuild();
  const i18n = useI18n();
  const { L, f, stage: stageEl, stageName } = i18n;
  const route = stageRouteOf(world, projectId);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [insertAt, setInsertAt] = useState<string | null>(null);
  if (!route) return null;
  const group = route.project.group;
  const admin = isAdmin(me) && route.project.status === "active";
  const phases = route.phases.filter((ph) => ph.rows.length);
  const summary = phases.map((ph) => f(L.route.sumPhase, { phase: L.labels.phase[ph.phase], parts: phaseParts(i18n, route, ph).join(L.route.sumSep) }));
  return (
    <section className="stack" aria-labelledby="route-title" data-testid="stage-route">
      <div className="card route-summary" data-testid="route-summary">
        <div className="route-summary-main">
          <h2 id="route-title" className="t-heading-18">
            {route.current ? (
              <>
                {f(L.route.atStage, { no: route.current.no, total: route.total })} · {stageEl(group, route.current.stage)}
                {route.farthest ? (
                  <span className="route-farthest" data-testid="route-farthest">
                    {" · "}
                    {f(L.route.farthest, { no: route.farthest.no })} {stageEl(group, route.farthest.stage)}
                  </span>
                ) : null}
              </>
            ) : (
              L.route.notStarted
            )}
          </h2>
          <p className="label">{summary.join(" · ")}</p>
        </div>
        <div className="route-phase-bars">
          {phases.map((ph) => {
            const x = factsOf(ph);
            return (
              <div key={ph.phase} className="route-phase-bar">
                <span className="label">
                  <span className="t-body-14m">{L.labels.phase[ph.phase]}</span> <span className="num">{ph.allDone ? L.route.phaseAllDone : f(L.route.phaseCount, { done: ph.done, total: ph.total })}</span>
                </span>
                <span className="route-bar">
                  <span data-part="passed" style={{ width: `${(ph.done / Math.max(1, ph.total)) * 100}%` }} />
                  <span data-part="current" style={{ width: `${((x.active + x.review) / Math.max(1, ph.total)) * 100}%` }} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {!route.rows.length ? (
        <section className="card" data-testid="route-empty">
          <p className="muted">{L.route.empty}</p>
          {admin ? (
            <div className="pop-anchor">
              <Button Label={L.route.addFirst} Style="Accent" onClick={() => setInsertAt(insertAt === "first" ? null : "first")} data-testid="route-add-first" />
              {insertAt === "first" ? <InsertStagePop projectId={projectId} after={null} next={null} onClose={() => setInsertAt(null)} /> : null}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="card route-card" aria-labelledby="route-card-title">
          <div className="card-head">
            <h2 id="route-card-title" className="t-heading-18">
              {L.route.title} <span className="label">{f(L.route.titleMeta, { n: route.total })}</span>
            </h2>
            <RouteLegend />
          </div>
          {phases.map((ph) => {
            const folded = open[ph.phase] === undefined ? foldedByDefault(route, ph) : !open[ph.phase];
            const parts = phaseParts(i18n, route, ph);
            const x = factsOf(ph);
            if (folded)
              return (
                <div key={ph.phase} className="route-band" data-tone={ph.allDone ? "done" : "todo"} data-testid={`route-phase-${ph.phase}`} data-collapsed="yes">
                  {ph.allDone ? <RouteStatusIcon status="done" size={16} /> : null}
                  <span className="t-body-14m">{L.labels.phase[ph.phase]}</span>
                  <span className="route-band-text">
                    {ph.allDone ? f(L.route.collapsed, { n: ph.total }) : f(L.route.phaseMeta, { n: ph.total, parts: parts.join(" · ") })}
                    {ph.allDone ? <span className="route-band-names">{f(L.route.bandNames, { names: ph.rows.map((r) => stageName(group, r.stage)).join(" · ") })}</span> : null}
                  </span>
                  <span className="route-bar route-band-bar">
                    <span data-part="passed" style={{ width: `${(ph.done / Math.max(1, ph.total)) * 100}%` }} />
                  </span>
                  <button type="button" className="inline-link route-band-toggle" onClick={() => setOpen({ ...open, [ph.phase]: true })} aria-expanded="false" data-testid={`route-expand-${ph.phase}`}>
                    {L.route.expand}
                  </button>
                </div>
              );
            return (
              <div key={ph.phase} className="route-phase" data-testid={`route-phase-${ph.phase}`}>
                <div className="route-phase-head">
                  <h3 className="t-heading-18">{L.labels.phase[ph.phase]}</h3>
                  <span className="label">{f(L.route.phaseMeta, { n: ph.total, parts: parts.join(" · ") })}</span>
                  <span className="route-bar route-phase-mini">
                    <span data-part="passed" style={{ width: `${(ph.done / Math.max(1, ph.total)) * 100}%` }} />
                    <span data-part="current" style={{ width: `${((x.active + x.review) / Math.max(1, ph.total)) * 100}%` }} />
                  </span>
                  {foldedByDefault(route, ph) || open[ph.phase] ? (
                    <button type="button" className="inline-link route-band-toggle" onClick={() => setOpen({ ...open, [ph.phase]: false })} aria-expanded="true">
                      {L.route.collapse}
                    </button>
                  ) : null}
                </div>
                <ol className="route-list">
                  {ph.rows.map((row) => (
                    <RouteRowView key={row.stage.id} route={route} row={row} admin={admin} inserting={insertAt === row.stage.id} onInsert={(on) => setInsertAt(on ? row.stage.id : null)} />
                  ))}
                </ol>
              </div>
            );
          })}
        </section>
      )}
    </section>
  );
}

function RouteRowView({ route, row, admin, inserting, onInsert }: { route: StageRoute; row: RouteRow; admin: boolean; inserting: boolean; onInsert: (on: boolean) => void }) {
  const i18n = useI18n();
  const { L, f, stage: stageEl, stageName } = i18n;
  const group = route.project.group;
  const next = route.rows[row.no] ?? null;
  const urgent = row.status === "ready" || row.status === "active" || row.status === "review";
  return (
    <li className="route-item">
      <Link
        to={`/project/${route.project.id}/stage/${row.stage.templateKey}`}
        className="route-row"
        data-status={row.status}
        data-current={row.current ? "yes" : undefined}
        data-disabled={row.stage.disabled ? "yes" : undefined}
        aria-current={row.current ? "step" : undefined}
        data-testid="route-row"
        data-key={row.stage.templateKey}
      >
        <span className="route-no num" aria-label={f(L.route.noAria, { no: row.no })}>
          {row.no}
        </span>
        <span className="route-name">
          <span className="t-body-14m">{stageEl(group, row.stage)}</span>
          <span className="kind-tag">
            {L.labels.stageKind[row.stage.kind]}
            {row.stage.hub && row.stage.kind !== "hub" ? L.route.hubSuffix : ""}
          </span>
          {row.current ? <span className="now-tag">{L.route.current}</span> : null}
          {row.stage.disabled ? <Tag>{L.route.disabled}</Tag> : null}
        </span>
        <span className="route-state">
          <RouteStatusBadge status={row.status} counts={row.counts} plain />
        </span>
        <span className="route-prog">
          <RouteBar counts={row.counts} />
          <span className="label">{progressCaption(i18n, route, row)}</span>
        </span>
        <span className="route-who">
          <PeopleStack people={row.people} urgent={urgent} />
        </span>
        <span className="route-plan">
          <span className="label">{planLine(i18n, row)}</span>
          <span className="route-actual">
            {actualLine(i18n, row)}
            {row.overrun ? <span className="route-over"> {f(L.route.over, { n: row.overrun })}</span> : null}
          </span>
        </span>
        <span className="route-alerts">
          {row.alerts.pending ? <Tag tone="warning">{f(L.route.alertPending, { n: row.alerts.pending })}</Tag> : null}
          {row.alerts.returned ? <Tag tone="danger">{f(L.route.alertReturned, { n: row.alerts.returned })}</Tag> : null}
          {row.alerts.nearDue ? <Tag tone="danger">{f(L.route.alertNearDue, { n: row.alerts.nearDue })}</Tag> : null}
          {row.alerts.noPeople && urgent ? <Tag tone="danger">{L.route.noPeople}</Tag> : null}
          {row.extrasOpen ? <Tag tone="lilac">{f(L.route.alertExtras, { n: row.extrasOpen })}</Tag> : null}
        </span>
        <span className="route-chev" aria-hidden="true">
          ›
        </span>
      </Link>
      {admin ? (
        <div className="route-insert-slot" data-open={inserting ? "yes" : undefined}>
          <div className="pop-anchor">
            <button
              type="button"
              className="route-insert"
              aria-label={next ? f(L.route.insertBetween, { a: stageName(group, row.stage), b: stageName(group, next.stage) }) : f(L.route.insertAfter, { a: stageName(group, row.stage) })}
              aria-expanded={inserting}
              onClick={() => onInsert(!inserting)}
              data-testid="route-insert"
            >
              <span aria-hidden="true">+</span> {L.route.insertHere}
            </button>
            {inserting ? <InsertStagePop projectId={route.project.id} after={row} next={next} onClose={() => onInsert(false)} /> : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 在两个环节之间插一个（就地的小弹层）
// ---------------------------------------------------------------------------

/** 名字 · 阶段 · 类型 · 粒度 · 单位 · Tn，其余用默认。after = null：项目里还没有环节，加第一个。 */
function InsertStagePop({ projectId, after, next, onClose }: { projectId: Id; after: RouteRow | null; next: RouteRow | null; onClose: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, say, stageName } = useI18n();
  const group = projectById(world, projectId)?.group ?? "animation";
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>(after?.stage.phase ?? "pre");
  const [kind, setKind] = useState<StageKind>("transit");
  const [grain, setGrain] = useState<Grain>(!after || after.stage.grain === "project" ? "project" : after.stage.grain);
  const [unit, setUnit] = useState<Unit>(!after || after.stage.grain === "project" ? "item" : after.stage.unit);
  const [tn, setTn] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const title = !after ? L.route.addFirst : next ? f(L.route.insertBetween, { a: stageName(group, after.stage), b: stageName(group, next.stage) }) : f(L.route.insertAfter, { a: stageName(group, after.stage) });
  const go = () => {
    const r = dispatch("stage.add", { projectId, name, phase, kind, grain, unit, tn: Number(tn), afterKey: after?.stage.templateKey ?? null }, { quiet: true });
    if (!r.ok) return setError(err(r.error));
    const added = r.state.stages[r.created.stageId];
    notify(say((d) => d.route.inserted, { no: after ? after.no + 1 : 1, name: { uc: name.trim() } }));
    onClose();
    if (added) navigate(`/project/${projectId}/stage/${added.templateKey}`);
  };
  return (
    <Pop title={title} onClose={onClose} testId="insert-pop">
      <form
        className="stack"
        data-gap="small"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <p className="label">{after ? (next ? f(L.route.insertShift, { no: after.no + 1 }) : L.route.insertNote) : L.route.firstNote}</p>
        <TextField label={L.route.fieldName} value={name} onChange={(e) => setName(e.target.value)} data-testid="insert-name" />
        <SelectField label={L.route.fieldPhase} value={phase} onChange={(e) => setPhase(e.target.value as Phase)} data-testid="insert-phase">
          {PHASE.map((p) => (
            <option key={p} value={p}>
              {L.labels.phase[p]}
            </option>
          ))}
        </SelectField>
        <span className="field-label">{L.route.fieldKind}</span>
        <div className="chips" role="radiogroup" aria-label={L.route.fieldKind}>
          {STAGE_KIND.map((k) => (
            <button key={k} type="button" className="ui-chip" role="radio" aria-checked={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`insert-kind-${k}`}>
              {L.labels.stageKind[k]}
            </button>
          ))}
        </div>
        <span className="field-label">{L.route.fieldGrain}</span>
        <div className="chips" role="radiogroup" aria-label={L.route.fieldGrain}>
          {GRAIN.map((g) => (
            <button
              key={g}
              type="button"
              className="ui-chip"
              role="radio"
              aria-checked={grain === g}
              aria-pressed={grain === g}
              onClick={() => {
                setGrain(g);
                if (g === "project" && unit !== "item" && unit !== "second") setUnit("item");
                if (g !== "project" && unit === "item") setUnit("sheet");
              }}
              data-testid={`insert-grain-${g}`}
            >
              {L.labels.grain[g]}
            </button>
          ))}
        </div>
        <div className="form-grid" data-cols="2">
          <SelectField label={L.route.fieldUnit} value={unit} onChange={(e) => setUnit(e.target.value as Unit)} data-testid="insert-unit">
            {UNIT.map((u) => (
              <option key={u} value={u}>
                {L.labels.unit[u]}
              </option>
            ))}
          </SelectField>
          <TextField label={L.route.fieldTn} type="number" step="0.1" min={0.1} value={tn} onChange={(e) => setTn(e.target.value)} data-testid="insert-tn" />
        </div>
        <p className="label">{L.route.insertRest}</p>
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <Button Label={L.common.cancel} Size="Small" Style="Ghost" onClick={onClose} />
          <Button Label={L.route.insertGo} Size="Small" Style="Primary" type="submit" data-testid="insert-go" />
        </div>
      </form>
    </Pop>
  );
}

/** 现在在第几个环节（页头用）。 */
export function RouteHeadline({ projectId }: { projectId: Id }) {
  const { world } = useGuild();
  const { L, f, stage: stageEl } = useI18n();
  const route = stageRouteOf(world, projectId);
  if (!route?.current) return null;
  return (
    <span className="route-headline" data-testid="route-headline">
      <RouteStatusIcon status={route.current.status} />
      {f(L.route.atStage, { no: route.current.no, total: route.total })} · {stageEl(route.project.group, route.current.stage)}
    </span>
  );
}
