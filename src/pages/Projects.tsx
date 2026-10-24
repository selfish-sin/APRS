/** P4 项目列表：每个项目一张卡（组 · 代号 · 三段进度 · 卡数 · 待审数）。 */
import { useMemo } from "react";
import { Empty, Tag } from "@/components/app/bits";
import { PhaseBars } from "@/components/app/stage";
import { isAdmin } from "@/domain/commands/core";
import { dateZh } from "@/domain/clock";
import { GROUP_LABEL, PROJECT_STATUS_LABEL } from "@/domain/labels";
import { GROUP, type Group } from "@/domain/model";
import { pipelineOf, projects } from "@/domain/queries";
import { GROUPS } from "@/domain/templates";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";

export function ProjectsPage() {
  const { world, me } = useGuild();
  const route = useRoute();
  const g = route.query.get("group");
  const group: Group | null = GROUP.includes(g as Group) ? (g as Group) : null;
  const list = useMemo(() => projects(world, group ?? undefined).map((p) => pipelineOf(world, p.id)!).filter(Boolean), [world, group]);
  const admin = isAdmin(me);
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">项目</span>
          <h1 className="t-title-32">项目</h1>
        </div>
        <div className="page-head-actions">
          {admin ? (
            <Link to={`/admin?tab=new${group ? `&group=${group}` : ""}`} className="ui-button" data-style="Accent" data-size="Medium">
              开新项目
            </Link>
          ) : null}
        </div>
      </div>
      <div className="chips" role="tablist" aria-label="按组看">
        <button type="button" className="ui-chip" aria-pressed={!group} onClick={() => navigate("/projects")}>
          全部
        </button>
        {GROUP.map((x) => (
          <button key={x} type="button" className="ui-chip" aria-pressed={group === x} onClick={() => navigate(`/projects?group=${x}`)}>
            {GROUP_LABEL[x]}
            {GROUPS[x].draft ? "（草案）" : ""}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <section className="card">
          <Empty
            action={
              admin ? (
                <Link to={`/admin?tab=new${group ? `&group=${group}` : ""}`} className="ui-button" data-style="Secondary" data-size="Small">
                  {group ? `开一个${GROUP_LABEL[group]}项目` : "开第一个项目"}
                </Link>
              ) : null
            }
          >
            {group ? `${GROUP_LABEL[group]}还没有项目。` : "还没有项目。"}
            {admin ? "" : "请管理员开项目。"}
          </Empty>
        </section>
      ) : (
        <div className="cards">
          {list.map((pl) => (
            <Link key={pl.project.id} to={`/project/${pl.project.id}`} className="card project-card" aria-label={`${pl.project.name}，${pl.project.code}`}>
              <div className="card-head">
                <div className="row">
                  <Tag>{GROUP_LABEL[pl.project.group]}</Tag>
                  <span className="num t-body-14m">{pl.project.code}</span>
                </div>
                <div className="row">
                  {pl.overdue ? <Tag tone="danger">逾期</Tag> : null}
                  <Tag tone={pl.project.status === "active" ? "sky" : undefined}>{PROJECT_STATUS_LABEL[pl.project.status]}</Tag>
                </div>
              </div>
              <h2 className="t-section-24">{pl.project.name}</h2>
              <span className="label">
                {dateZh(pl.project.startOn)} → {dateZh(pl.project.planEndOn)}
              </span>
              <PhaseBars pipeline={pl} />
              <div className="row" data-justify="between">
                <span className="label">
                  <span className="num t-body-14m">{pl.cuts}</span> {GROUPS[pl.project.group].cutLabel} · 完成 <span className="num t-body-14m">{Math.round(pl.progress * 100)}%</span>
                </span>
                <span className="label">
                  待审 <span className="num t-body-14m">{pl.pendingReview}</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
