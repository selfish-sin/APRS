/**
 * 第一层 · 项目页（SPEC §17.1）：默认是环节路线；页内标签：
 *   环节（默认）· 卡 × 环节（原来的三关地图 + 网格）· 排期 · 资料库 · 项目动态 · 项目档案。
 * 零日的项目进开局向导（§17.4）。点路线上任何一行 → 第二层环节页。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { Empty, MemberAvatar, Tag } from "@/components/app/bits";
import { Board, StatusLegend } from "@/components/app/board";
import { MapLegend, StageMap } from "@/components/app/stage";
import { TaskDrawer } from "@/components/app/task";
import { ScheduleView } from "@/components/app/flex";
import { ReportDialog } from "@/components/app/report";
import { RouteHeadline, StageRouteView } from "@/components/app/route";
import { ThreadBody } from "@/components/app/thread";
import { ProjectTimelineCard } from "./ProjectSetup";
import { ProjectProfile } from "./ProjectProfile";
import { ZeroWizard } from "./ZeroWizard";
import { LibraryPage } from "./Library";
import { isAdmin } from "@/domain/commands/core";
import type { ProjectRow, TaskRow } from "@/domain/model";
import { gridOf, pipelineOf, projectById, type GridFilter } from "@/domain/queries";
import { U, useI18n } from "@/i18n/I18n";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NotFound } from "./NotFound";

const FILTERS: GridFilter[] = ["all", "mine", "review", "stuck"];
export const PROJECT_TABS = ["route", "grid", "schedule", "library", "activity", "profile"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export function ProjectPage() {
  const { world, me } = useGuild();
  const { L, date } = useI18n();
  const route = useRoute();
  const id = route.segments[1];
  const [reporting, setReporting] = useState(false);
  const project = projectById(world, id);
  const pipeline = useMemo(() => (project ? pipelineOf(world, project.id) : null), [world, project]);
  if (!project || !pipeline) return <NotFound what="project" />;
  if (project.status === "zero") return <ZeroWizard project={project} />;
  const q = route.query.get("tab");
  const tab: ProjectTab = PROJECT_TABS.find((t) => t === q) ?? (route.query.get("view") === "schedule" ? "schedule" : "route");
  const admin = isAdmin(me);
  const label: Record<ProjectTab, string> = { route: L.route.tabs.route, grid: L.route.tabs.grid, schedule: L.route.tabs.schedule, library: L.route.tabs.library, activity: L.route.tabs.activity, profile: L.route.tabs.profile };

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
          {tab !== "route" ? <RouteHeadline projectId={project.id} /> : null}
        </div>
        <div className="page-head-actions">
          {project.feishuRoot ? (
            <a href={project.feishuRoot} target="_blank" rel="noreferrer noopener" className="ui-button" data-style="Secondary" data-size="Medium">
              {L.project.feishuRoot}
            </a>
          ) : null}
          <Button Label={L.project.exportReport} Style="Secondary" onClick={() => setReporting(true)} data-testid="report-open" />
        </div>
      </div>

      <div className="tabs project-tabs" role="tablist" aria-label={L.project.views}>
        {PROJECT_TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => navigate(t === "route" ? `/project/${project.id}` : `/project/${project.id}?tab=${t}`, { replace: true })} data-testid={`ptab-${t}`}>
            {label[t]}
          </button>
        ))}
      </div>

      {tab === "route" ? <StageRouteView projectId={project.id} /> : null}
      {tab === "grid" ? <GridTab project={project} /> : null}
      {tab === "schedule" ? (
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
      ) : null}
      {tab === "library" ? <LibraryPage projectId={project.id} embedded /> : null}
      {tab === "activity" ? <ActivityTab project={project} /> : null}
      {tab === "profile" ? <ProjectProfile project={project} /> : null}

      {reporting ? <ReportDialog projectId={project.id} onClose={() => setReporting(false)} /> : null}
    </>
  );
}

/** 「卡 × 环节」：原来的三关地图（点一个环节 → 环节页）+ 卡 × 环节网格。 */
function GridTab({ project }: { project: ProjectRow }) {
  const { world, me } = useGuild();
  const { L, f, r: rich, stageName, stage: stageEl } = useI18n();
  const [filter, setFilter] = useState<GridFilter>("all");
  const [task, setTask] = useState<TaskRow | null>(null);
  const pipeline = useMemo(() => pipelineOf(world, project.id), [world, project.id]);
  const grid = useMemo(() => gridOf(world, project.id, filter, me.id), [world, project.id, filter, me.id]);
  if (!pipeline || !grid) return null;
  const liveTask = task ? world.tasks[task.id] ?? null : null;
  const filterLabel: Record<GridFilter, string> = { all: L.project.filterAll, mine: L.project.filterMine, review: L.project.filterReview, stuck: L.project.filterStuck };
  return (
    <>
      <section className="stack" data-gap="small" aria-labelledby="map-title">
        <div className="card-head">
          <h2 id="map-title" className="t-section-24">
            {rich(L.project.mapTitle, { pct: <span className="num">{Math.round(pipeline.progress * 100)}%</span> })}
          </h2>
          <MapLegend />
        </div>
        <StageMap pipeline={pipeline} onPick={(node) => navigate(`/project/${project.id}/stage/${node.stage.templateKey}`)} />
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
      {liveTask ? <TaskDrawer task={liveTask} onClose={() => setTask(null)} /> : null}
    </>
  );
}

/** 「项目动态」：项目时间线（改项目的每一步）+ 项目上的意见和设定问题。 */
function ActivityTab({ project }: { project: ProjectRow }) {
  const { world } = useGuild();
  const { L } = useI18n();
  const threads = Object.values(world.threads).filter((t) => t.projectId === project.id && t.subjectType === "project" && !t.archivedAt);
  threads.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return (
    <>
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
      <ProjectTimelineCard projectId={project.id} />
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
