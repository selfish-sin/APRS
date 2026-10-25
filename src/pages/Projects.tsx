/**
 * P4 项目列表（排法照设计稿 v6-5a）：一行一个项目——封面 · 名字 · 走到第几个环节 · 代号 · 卡数 · 一句话进度 · 头像 · 打开。
 * §17.4：右上一个显眼的「新建项目」；零日的项目排最前，带「零日」标、开局做到第几步和「继续开局」。
 */
import { useMemo } from "react";
import { Empty, Tag } from "@/components/app/bits";
import { PeopleStack, RouteStatusIcon } from "@/components/app/route";
import { FileImage } from "@/components/library/tiles";
import { isAdmin } from "@/domain/commands/core";
import { U, useI18n } from "@/i18n/I18n";
import { GROUP, type Group, type ProjectRow } from "@/domain/model";
import { pipelineOf, projects, stageRouteOf, type RoutePerson } from "@/domain/queries";
import { WIZARD_STEPS, wizardStepOf } from "./ZeroWizard";
import { GROUPS } from "@/domain/templates";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";

function Thumb({ project }: { project: ProjectRow }) {
  const { world } = useGuild();
  const file = project.coverFileId ? world.files[project.coverFileId] : undefined;
  return (
    <span className="project-thumb" data-group={project.group} data-zero={project.status === "zero" ? "yes" : undefined} aria-hidden="true">
      {file ? (
        <FileImage file={file} />
      ) : (
        <svg viewBox="0 0 96 56" className="cover-ph">
          <circle cx="64" cy="20" r="8" />
          <path d="M12 46h72" />
        </svg>
      )}
    </span>
  );
}

export function ProjectsPage() {
  const { world, me } = useGuild();
  const { L, f, unit: unitOf, stage: stageEl } = useI18n();
  const route = useRoute();
  const g = route.query.get("group");
  const group: Group | null = GROUP.includes(g as Group) ? (g as Group) : null;
  const list = useMemo(() => {
    const all = projects(world, group ?? undefined).map((p) => pipelineOf(world, p.id)!).filter(Boolean);
    // 零日的排最前（还在开局，最要人管）。
    return [...all.filter((x) => x.project.status === "zero"), ...all.filter((x) => x.project.status !== "zero")];
  }, [world, group]);
  const admin = isAdmin(me);
  const newHref = `/admin?tab=new${group ? `&group=${group}` : ""}`;
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">{L.project.projects}</span>
          <h1 className="t-title-32">{L.project.projects}</h1>
          {admin ? <p className="label">{L.wizard.newLead}</p> : null}
        </div>
        <div className="page-head-actions">
          {admin ? (
            <Link to={newHref} className="ui-button projects-new" data-style="Primary" data-size="Medium" data-testid="projects-new">
              + {L.project.newProject}
            </Link>
          ) : null}
        </div>
      </div>
      <div className="chips" role="tablist" aria-label={L.project.byGroup}>
        <button type="button" className="ui-chip" aria-pressed={!group} onClick={() => navigate("/projects")}>
          {L.project.all}
        </button>
        {GROUP.map((x) => (
          <button key={x} type="button" className="ui-chip" aria-pressed={group === x} onClick={() => navigate(`/projects?group=${x}`)}>
            {L.labels.group[x]}
            {GROUPS[x].draft ? L.project.draftSuffix : ""}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <section className="card">
          <Empty
            action={
              admin ? (
                <Link to={newHref} className="ui-button" data-style="Secondary" data-size="Small">
                  {group ? f(L.project.newOfGroup, { group: L.labels.group[group] }) : L.project.newFirst}
                </Link>
              ) : null
            }
          >
            {group ? f(L.project.noneOfGroup, { group: L.labels.group[group] }) : L.project.none}
            {admin ? "" : L.project.askAdmin}
          </Empty>
        </section>
      ) : (
        <div className="cards project-rows">
          {list.map((pl) => {
            const p = pl.project;
            if (p.status === "zero") {
              const step = wizardStepOf(p);
              return (
                <Link key={p.id} to={`/project/${p.id}`} className="card project-card project-row" data-zero="yes" aria-label={`${p.name}，${p.code}`} data-testid="project-card-zero">
                  <Thumb project={p} />
                  <span className="project-row-main">
                    <span className="project-row-title">
                      <span className="t-heading-18">
                        <U>{p.name}</U>
                      </span>
                      <Tag tone="inverse">{L.zero.short}</Tag>
                    </span>
                    <span className="label">
                      <span className="num">{p.code}</span> · {L.labels.group[p.group]} · {f(L.wizard.atStep, { n: step, total: 5, name: L.wizard.steps[WIZARD_STEPS[step - 1]] })}
                    </span>
                  </span>
                  <span className="project-row-wizard">
                    <span className="label">
                      {f(L.project.stepOf, { n: step, total: 5 })} <span className="t-body-14m">{L.wizard.steps[WIZARD_STEPS[step - 1]]}</span>
                    </span>
                    <span className="wizard-mini">
                      {WIZARD_STEPS.map((s, i) => (
                        <span key={s} data-state={i + 1 < step ? "done" : i + 1 === step ? "current" : "todo"} />
                      ))}
                    </span>
                    {step > 1 ? <span className="label project-row-saved">{f(L.project.stepsSaved, { n: step - 1 })}</span> : null}
                  </span>
                  <span className="ui-button" data-style="Primary" data-size="Small" data-testid="continue-setup">
                    {L.wizard.continue}
                  </span>
                </Link>
              );
            }
            const r = stageRouteOf(world, p.id);
            const people: RoutePerson[] = [];
            const seen = new Set<string>();
            for (const row of r?.rows ?? [])
              for (const x of row.people) {
                const k = x.memberId ?? `n:${x.name}`;
                if (seen.has(k)) continue;
                seen.add(k);
                people.push(x);
              }
            return (
              <Link key={p.id} to={`/project/${p.id}`} className="card project-card project-row" aria-label={`${p.name}，${p.code}`}>
                <Thumb project={p} />
                <span className="project-row-main">
                  <span className="project-row-title">
                    <span className="t-heading-18">
                      <U>{p.name}</U>
                    </span>
                    {r?.current ? (
                      <span className="project-row-at">
                        <RouteStatusIcon status={r.current.status} />
                        {f(L.route.stageOf, { no: r.current.no, total: r.total })} · {stageEl(p.group, r.current.stage)}
                      </span>
                    ) : null}
                    {p.status !== "active" ? <Tag>{L.labels.projectStatus[p.status]}</Tag> : null}
                    {pl.overdue ? <Tag tone="danger">{L.project.overdue}</Tag> : null}
                  </span>
                  <span className="label">
                    <span className="num">{p.code}</span> · {L.labels.group[p.group]} · {pl.cuts} {unitOf("cut", p.group, pl.cuts)} · {f(L.project.rowProgress, { pct: Math.round(pl.progress * 100), n: pl.pendingReview })}
                  </span>
                </span>
                <span className="project-row-people">
                  <PeopleStack people={people} urgent={false} />
                </span>
                <span className="project-row-open t-body-14m">{L.project.open}</span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
