/** P4 项目列表：每个项目一张卡（组 · 代号 · 三段进度 · 卡数 · 待审数）。 */
import { useMemo } from "react";
import { Empty, Tag } from "@/components/app/bits";
import { PhaseBars } from "@/components/app/stage";
import { isAdmin } from "@/domain/commands/core";
import { U, useI18n } from "@/i18n/I18n";
import { GROUP, type Group } from "@/domain/model";
import { pipelineOf, projects } from "@/domain/queries";
import { GROUPS } from "@/domain/templates";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";

export function ProjectsPage() {
  const { world, me } = useGuild();
  const { L, f, r: rich, date, unit: unitOf } = useI18n();
  const route = useRoute();
  const g = route.query.get("group");
  const group: Group | null = GROUP.includes(g as Group) ? (g as Group) : null;
  const list = useMemo(() => projects(world, group ?? undefined).map((p) => pipelineOf(world, p.id)!).filter(Boolean), [world, group]);
  const admin = isAdmin(me);
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">{L.project.projects}</span>
          <h1 className="t-title-32">{L.project.projects}</h1>
        </div>
        <div className="page-head-actions">
          {admin ? (
            <Link to={`/admin?tab=new${group ? `&group=${group}` : ""}`} className="ui-button" data-style="Accent" data-size="Medium">
              {L.project.newProject}
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
                <Link to={`/admin?tab=new${group ? `&group=${group}` : ""}`} className="ui-button" data-style="Secondary" data-size="Small">
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
        <div className="cards">
          {list.map((pl) => (
            <Link key={pl.project.id} to={`/project/${pl.project.id}`} className="card project-card" aria-label={`${pl.project.name}，${pl.project.code}`}>
              <div className="card-head">
                <div className="row">
                  <Tag>{L.labels.group[pl.project.group]}</Tag>
                  <span className="num t-body-14m">{pl.project.code}</span>
                </div>
                <div className="row">
                  {pl.overdue ? <Tag tone="danger">{L.project.overdue}</Tag> : null}
                  <Tag tone={pl.project.status === "active" ? "sky" : undefined}>{L.labels.projectStatus[pl.project.status]}</Tag>
                </div>
              </div>
              <h2 className="t-section-24">
                <U>{pl.project.name}</U>
              </h2>
              <span className="label">
                {date(pl.project.startOn)} → {date(pl.project.planEndOn)}
              </span>
              <PhaseBars pipeline={pl} />
              <div className="row" data-justify="between">
                <span className="label">
                  {rich(L.project.cardCuts, {
                    n: <span className="num t-body-14m">{pl.cuts}</span>,
                    unit: unitOf("cut", pl.project.group, pl.cuts),
                    pct: <span className="num t-body-14m">{Math.round(pl.progress * 100)}%</span>,
                  })}
                </span>
                <span className="label">{rich(L.project.pendingReview, { n: <span className="num t-body-14m">{pl.pendingReview}</span> })}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
