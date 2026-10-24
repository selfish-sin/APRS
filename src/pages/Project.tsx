/**
 * P5 项目总览（网页端预览）：上 = 三段关卡地图（节点能点开看「申报这个环节」）；
 * 下 = 卡 × 环节网格（点格子 → 卡详情），筛选：只看我 · 只看待审 · 只看卡住的。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { StatusPill } from "@/components/ui/StatusPill";
import { Empty, MemberAvatar, SelectField, Tag } from "@/components/app/bits";
import { Board, StatusLegend } from "@/components/app/board";
import { MapLegend, StageMap } from "@/components/app/stage";
import { TaskDrawer } from "@/components/app/task";
import { BatchAssign, ExtrasList, PublishForm, ScheduleView, StageSettings } from "@/components/app/flex";
import { ReportDialog } from "@/components/app/report";
import { ThreadBody } from "@/components/app/thread";
import { AcceptDialog, AddCutsForm, ExtendDialog, ZeroDayPage } from "./ProjectSetup";
import { isAdmin, isReviewer } from "@/domain/commands/core";
import { TASK_STATUS, type TaskRow } from "@/domain/model";
import { gridOf, members, memberById, pipelineOf, projectById, type GridFilter, type StageNode } from "@/domain/queries";
import { stageText } from "@/domain/templates";
import { U, useI18n } from "@/i18n/I18n";
import { Link, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NotFound } from "./NotFound";

const FILTERS: GridFilter[] = ["all", "mine", "review", "stuck"];

export function ProjectPage() {
  const { world, me } = useGuild();
  const { L, f, r: rich, date, stageName, stage: stageEl } = useI18n();
  const route = useRoute();
  const id = route.segments[1];
  const [filter, setFilter] = useState<GridFilter>("all");
  const [node, setNode] = useState<StageNode | null>(null);
  const [task, setTask] = useState<TaskRow | null>(null);
  const [reporting, setReporting] = useState(false);
  const [view, setView] = useState<"flow" | "schedule">(route.query.get("view") === "schedule" ? "schedule" : "flow");
  const project = projectById(world, id);
  const pipeline = useMemo(() => (project ? pipelineOf(world, project.id) : null), [world, project]);
  const grid = useMemo(() => (project ? gridOf(world, project.id, filter, me.id) : null), [world, project, filter, me.id]);
  if (!project || !pipeline || !grid) return <NotFound what="project" />;
  if (project.status === "zero") return <ZeroDayPage project={project} />;
  const admin = isAdmin(me);
  const threads = Object.values(world.threads).filter((t) => t.projectId === project.id && t.subjectType === "project" && !t.archivedAt);
  threads.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const liveNode = node ? pipeline.phases.flatMap((p) => p.stages).find((n) => n.stage.id === node.stage.id) ?? null : null;
  const liveTask = task ? world.tasks[task.id] ?? null : null;
  const filterLabel: Record<GridFilter, string> = { all: L.project.filterAll, mine: L.project.filterMine, review: L.project.filterReview, stuck: L.project.filterStuck };

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/projects">{L.project.projects}</Link>
            <span>/</span>
            <span>{project.code}</span>
          </div>
          <h1 className="t-title-32">
            <U>{project.name}</U>
          </h1>
          <div className="row">
            <Tag>{L.labels.group[project.group]}</Tag>
            <span className="num t-body-14m">{project.code}</span>
            <span className="label">
              {project.episode} · {project.scene} · {date(project.startOn)} → {date(project.planEndOn)}
            </span>
            {pipeline.overdue ? <Tag tone="danger">{L.project.overdue}</Tag> : null}
            <Tag tone={project.status === "active" ? "sky" : undefined}>{L.labels.projectStatus[project.status]}</Tag>
          </div>
        </div>
        <div className="page-head-actions">
          <Link to={`/library/${project.id}`} className="ui-button" data-style="Secondary" data-size="Medium" data-testid="project-library">
            {L.project.library}
          </Link>
          {project.feishuRoot ? (
            <a href={project.feishuRoot} target="_blank" rel="noreferrer noopener" className="ui-button" data-style="Secondary" data-size="Medium">
              {L.project.feishuRoot}
            </a>
          ) : (
            <span className="label">{L.project.noFeishuRoot}</span>
          )}
          <Button Label={L.project.exportReport} Style="Secondary" onClick={() => setReporting(true)} data-testid="report-open" />
          <Link to={`/project/${project.id}/settings?tab=${admin ? "stages" : "cover"}`} className="ui-button" data-style="Secondary" data-size="Medium" data-testid="project-settings">
            {admin ? L.project.editProject : L.project.aboutProject}
          </Link>
        </div>
      </div>

      <div className="chips" role="tablist" aria-label={L.project.views}>
        <button type="button" role="tab" className="ui-chip" aria-selected={view === "flow"} aria-pressed={view === "flow"} onClick={() => setView("flow")} data-testid="view-flow">
          {L.project.flow}
        </button>
        <button type="button" role="tab" className="ui-chip" aria-selected={view === "schedule"} aria-pressed={view === "schedule"} onClick={() => setView("schedule")} data-testid="view-schedule">
          {L.project.schedule}
        </button>
      </div>

      {view === "schedule" ? (
        <section className="card" aria-labelledby="schedule-title">
          <h2 id="schedule-title" className="t-section-24">
            {L.project.scheduleTitle}
          </h2>
          <p className="label">
            {L.project.scheduleLead}
            {admin ? L.project.scheduleAdmin : ""}
          </p>
          <ScheduleView projectId={project.id} />
        </section>
      ) : (
        <>
          <section className="stack" data-gap="small" aria-labelledby="map-title">
            <div className="card-head">
              <h2 id="map-title" className="t-section-24">
                {rich(L.project.mapTitle, { pct: <span className="num">{Math.round(pipeline.progress * 100)}%</span> })}
              </h2>
              <MapLegend />
            </div>
            <StageMap pipeline={pipeline} onPick={setNode} />
          </section>

          <section className="card" aria-labelledby="grid-title">
            <div className="card-head">
              <h2 id="grid-title" className="t-section-24">
                {f(L.project.gridTitle, { unit: L.project.gridUnit[project.group] })}
              </h2>
              <div className="chips" role="tablist" aria-label={L.project.filter}>
                {FILTERS.map((id) => (
                  <button key={id} type="button" className="ui-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                    {filterLabel[id]}
                  </button>
                ))}
              </div>
            </div>
            {grid.projectCells.length ? (
              <div className="stack" data-gap="small">
                <span className="label">{L.project.projectStages}</span>
                <div className="project-strip">
                  {grid.projectCells.map((c) =>
                    c.tasks.map((t) => (
                      <button
                        key={t.task.id}
                        type="button"
                        className="strip-item"
                        onClick={() => setTask(t.task)}
                        aria-label={f(L.project.stripAria, { stage: stageName(project.group, c.stage), status: L.labels.taskStatus[t.task.status] }) + (c.extras.length ? f(L.project.stripExtras, { n: c.extras.length }) : "")}
                      >
                        <StatusPill Status={t.task.status} />
                        <span>{stageEl(project.group, c.stage)}</span>
                        {t.assignee ? <MemberAvatar member={t.assignee} size="20" /> : null}
                        {c.extras.length ? (
                          <span className="extra-count" title={f(L.project.extrasTitle, { n: c.extras.length })}>
                            {c.extras.length}
                          </span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
            {grid.rows.length === 0 ? (
              <Empty action={<Button Label={L.project.seeAll} Size="Small" Style="Secondary" onClick={() => setFilter("all")} />}>
                {filter === "mine" ? L.project.emptyMine : filter === "review" ? L.project.emptyReview : filter === "stuck" ? L.project.emptyStuck : L.project.emptyCuts}
              </Empty>
            ) : (
              <Board grid={grid} />
            )}
            <div className="row" data-justify="between">
              <StatusLegend />
              {grid.hidden ? <span className="label">{f(L.project.hidden, { n: grid.hidden })}</span> : null}
            </div>
          </section>
        </>
      )}

      <section className="card" aria-labelledby="pthreads-title">
        <h2 id="pthreads-title" className="t-heading-18">
          {L.project.threadsTitle} <span className="count">{threads.length}</span>
        </h2>
        <ProjectThreadComposer projectId={project.id} />
        {threads.length === 0 ? (
          <Empty>{L.project.threadsEmpty}</Empty>
        ) : (
          <ul className="list">
            {threads.map((t) => (
              <li key={t.id}>
                <div className="list-main">
                  <ThreadBody thread={t} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {liveNode ? <StageDrawer node={liveNode} onClose={() => setNode(null)} /> : null}
      {liveTask ? <TaskDrawer task={liveTask} onClose={() => setTask(null)} /> : null}
      {reporting ? <ReportDialog projectId={project.id} onClose={() => setReporting(false)} /> : null}
    </>
  );
}

function ProjectThreadComposer({ projectId }: { projectId: string }) {
  const { dispatch, notify } = useGuild();
  const { L, err } = useI18n();
  const [kind, setKind] = useState<"comment" | "setting">("comment");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="stack"
      data-gap="small"
      onSubmit={(e) => {
        e.preventDefault();
        const r = dispatch("thread.open", { subjectType: "project", subjectId: projectId, kind, text }, { quiet: true });
        if (!r.ok) setError(err(r.error));
        else {
          setText("");
          setError(null);
          notify(kind === "setting" ? L.project.settingSent : L.project.left, "Neutral");
        }
      }}
    >
      <div className="row">
        <div className="chips">
          <button type="button" className="ui-chip" aria-pressed={kind === "comment"} onClick={() => setKind("comment")}>
            {L.project.comment}
          </button>
          <button type="button" className="ui-chip" aria-pressed={kind === "setting"} onClick={() => setKind("setting")}>
            {L.project.setting}
          </button>
        </div>
      </div>
      <textarea className="field-control" aria-label={L.project.writeComment} placeholder={kind === "setting" ? L.project.settingPlaceholder : L.project.commentPlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
      {error ? <p className="error-text">{error}</p> : null}
      <div className="form-actions">
        <Button Label={L.project.leave} Size="Small" Style="Accent" type="submit" />
      </div>
    </form>
  );
}

function StageDrawer({ node, onClose }: { node: StageNode; onClose: () => void }) {
  const { world, me, dispatch, notify } = useGuild();
  const { L, f, r: rich, lang, stageName, rate } = useI18n();
  const { stage } = node;
  const project = world.projects[stage.projectId];
  const group = project?.group ?? "animation";
  const admin = isAdmin(me);
  const reviewer = memberById(world, stage.reviewerId);
  const reviewers = members(world).filter((m) => isReviewer(m));
  const [publishing, setPublishing] = useState(false);
  const [sub, setSub] = useState<"accept" | "extend" | "cuts" | null>(null);
  const stageTasks = Object.values(world.tasks).filter((t) => t.stageId === stage.id && !t.archivedAt && !t.extra);
  const text = stageText(group, stage, lang);
  const uc = (custom: boolean, s: string) => (custom ? <U>{s}</U> : s);
  if (sub === "accept") return <AcceptDialog stage={stage} onClose={() => setSub(null)} />;
  if (sub === "extend") return <ExtendDialog target={{ kind: "stage", stage }} tasks={stageTasks} onClose={() => setSub(null)} />;
  return (
    <Drawer Type="Drawer" Title={stageName(group, stage)} open onClose={onClose} actions={<Button Label={L.project.close} Style="Secondary" onClick={onClose} />}>
      <div className="stack" data-gap="small" style={{ overflowY: "auto" }}>
        {admin ? (
          <div className="form-actions" data-testid="stage-admin">
            <Button Label={L.project.accept} Size="Small" Style="Secondary" onClick={() => setSub("accept")} data-testid="stage-accept-open" />
            <Button Label={L.project.extend} Size="Small" Style="Secondary" onClick={() => setSub("extend")} data-testid="stage-extend-open" />
            {stage.grain !== "project" ? <Button Label={L.project.addCuts} Size="Small" Style="Secondary" onClick={() => setSub(sub === "cuts" ? null : "cuts")} data-testid="stage-cuts-open" /> : null}
          </div>
        ) : null}
        {sub === "cuts" ? <AddCutsForm projectId={stage.projectId} onDone={() => setSub(null)} /> : null}
        {stage.acceptedAt || stage.disabled ? (
          <div className="row">
            {stage.acceptedAt ? <Tag tone="success">{L.project.accepted}</Tag> : null}
            {stage.disabled ? <Tag>{L.project.disabled}</Tag> : null}
          </div>
        ) : null}
        <div className="row">
          <Tag>{L.labels.phase[stage.phase]}</Tag>
          <Tag tone="lilac">
            {L.labels.stageKind[stage.kind]}
            {stage.hub && stage.kind !== "hub" ? L.project.hubSuffix : ""}
          </Tag>
          <Tag>{L.labels.grain[stage.grain]}</Tag>
        </div>
        <p>
          {rate(stage, group)}
          {stage.adminSet ? L.labels.adminSet : ""}
          {f(L.project.control, { n: stage.control })}
        </p>
        {text.note ? <p className="muted">{uc(text.uc.note, text.note)}</p> : null}
        <div className="chips" aria-label={L.project.countsAria}>
          {TASK_STATUS.filter((s) => node.counts[s] > 0).map((s) => (
            <StatusPill key={s} Status={s} Label={`${L.labels.taskStatus[s]} ${node.counts[s]}`} />
          ))}
        </div>
        <dl className="stack" data-gap="small" style={{ margin: 0 }}>
          <div>
            <dt className="label">{L.project.receive}</dt>
            <dd style={{ margin: 0 }}>{uc(text.uc.receive, text.receive)}</dd>
          </div>
          <div>
            <dt className="label">{L.project.deliver}</dt>
            <dd style={{ margin: 0 }}>{uc(text.uc.deliver, text.deliver)}</dd>
          </div>
          <div>
            <dt className="label">{L.project.handTo}</dt>
            <dd style={{ margin: 0 }}>{uc(text.uc.handTo, text.handTo)}</dd>
          </div>
          <div>
            <dt className="label">{L.project.enrolled}</dt>
            <dd style={{ margin: 0 }}>{f(L.project.people, { n: node.enrolled })}</dd>
          </div>
        </dl>
        {admin ? (
          <SelectField
            label={L.project.reviewer}
            value={stage.reviewerId ?? ""}
            onChange={(e) => {
              const r = dispatch("stage.set_reviewer", { stageId: stage.id, memberId: e.target.value || null });
              if (r.ok) notify(L.project.reviewerSaved, "Neutral");
            }}
          >
            <option value="">{L.project.anyReviewer}</option>
            {reviewers.map((m) => (
              <option key={m.id} value={m.id} data-uc="">
                {m.nickname}
              </option>
            ))}
          </SelectField>
        ) : (
          <p className="label">{rich(L.project.reviewBy, { name: reviewer ? <U>{reviewer.nickname}</U> : L.project.anyReviewer })}</p>
        )}
        <ExtrasList stage={stage} />
        {publishing ? <PublishForm stage={stage} onDone={() => setPublishing(false)} /> : null}
        {admin && stage.grain !== "project" ? <BatchAssign stage={stage} /> : null}
        {admin ? <StageSettings stage={stage} /> : null}
        <div className="form-actions">
          {(admin || (isReviewer(me) && stage.reviewerId === me.id)) && !publishing ? <Button Label={L.project.publish} Style="Secondary" onClick={() => setPublishing(true)} data-testid="publish-open" /> : null}
          <Link to={`/enroll?group=${group}&stage=${stage.templateKey}`} className="ui-button" data-style="Accent" data-size="Medium">
            {L.project.enroll}
          </Link>
          {admin && stage.hub ? (
            <Link to={`/admin?tab=dispatch&project=${stage.projectId}&hub=${stage.id}`} className="ui-button" data-style="Secondary" data-size="Medium">
              {L.project.dispatch}
            </Link>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}
