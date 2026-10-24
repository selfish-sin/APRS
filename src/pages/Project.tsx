/**
 * P5 项目总览（网页端预览）：上 = 三段关卡地图（节点能点开看「申报这个环节」）；
 * 下 = 卡 × 环节网格（点格子 → 卡详情），筛选：只看我 · 只看待审 · 只看卡住的。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { StatusPill } from "@/components/ui/StatusPill";
import { Empty, MemberAvatar, SelectField, Tag, TextField } from "@/components/app/bits";
import { Board, StatusLegend } from "@/components/app/board";
import { MapLegend, StageMap } from "@/components/app/stage";
import { TaskDrawer } from "@/components/app/task";
import { ThreadBody } from "@/components/app/thread";
import { dateZh } from "@/domain/clock";
import { isAdmin, isReviewer } from "@/domain/commands/core";
import { GRAIN_LABEL, GROUP_LABEL, PHASE_LABEL, PROJECT_STATUS_LABEL, STAGE_KIND_LABEL, TASK_STATUS_LABEL, rateLabel } from "@/domain/labels";
import { PROJECT_STATUS, TASK_STATUS, type ProjectStatus, type TaskRow } from "@/domain/model";
import { gridOf, members, memberById, pipelineOf, projectById, type GridFilter, type StageNode } from "@/domain/queries";
import { GROUPS } from "@/domain/templates";
import { Link, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NotFound } from "./NotFound";

const FILTERS: { id: GridFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "mine", label: "只看我" },
  { id: "review", label: "只看待审" },
  { id: "stuck", label: "只看卡住的" },
];

export function ProjectPage() {
  const { world, me } = useGuild();
  const route = useRoute();
  const id = route.segments[1];
  const [filter, setFilter] = useState<GridFilter>("all");
  const [node, setNode] = useState<StageNode | null>(null);
  const [task, setTask] = useState<TaskRow | null>(null);
  const [editing, setEditing] = useState(false);
  const project = projectById(world, id);
  const pipeline = useMemo(() => (project ? pipelineOf(world, project.id) : null), [world, project]);
  const grid = useMemo(() => (project ? gridOf(world, project.id, filter, me.id) : null), [world, project, filter, me.id]);
  if (!project || !pipeline || !grid) return <NotFound what="这个项目" />;
  const admin = isAdmin(me);
  const threads = Object.values(world.threads).filter((t) => t.projectId === project.id && t.subjectType === "project" && !t.archivedAt);
  threads.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const liveNode = node ? pipeline.phases.flatMap((p) => p.stages).find((n) => n.stage.id === node.stage.id) ?? null : null;
  const liveTask = task ? world.tasks[task.id] ?? null : null;

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/projects">项目</Link>
            <span>/</span>
            <span>{project.code}</span>
          </div>
          <h1 className="t-title-32">{project.name}</h1>
          <div className="row">
            <Tag>{GROUP_LABEL[project.group]}</Tag>
            <span className="num t-body-14m">{project.code}</span>
            <span className="label">
              {project.episode} · {project.scene} · {dateZh(project.startOn)} → {dateZh(project.planEndOn)}
            </span>
            {pipeline.overdue ? <Tag tone="danger">逾期</Tag> : null}
            <Tag tone={project.status === "active" ? "sky" : undefined}>{PROJECT_STATUS_LABEL[project.status]}</Tag>
          </div>
        </div>
        <div className="page-head-actions">
          {project.feishuRoot ? (
            <a href={project.feishuRoot} target="_blank" rel="noreferrer noopener" className="ui-button" data-style="Secondary" data-size="Medium">
              飞书根文件夹
            </a>
          ) : (
            <span className="label">还没填飞书根文件夹</span>
          )}
          {admin ? <Button Label="改项目" Style="Secondary" onClick={() => setEditing(true)} /> : null}
        </div>
      </div>

      <section className="stack" data-gap="small" aria-labelledby="map-title">
        <div className="card-head">
          <h2 id="map-title" className="t-section-24">
            三关 · 完成 <span className="num">{Math.round(pipeline.progress * 100)}%</span>
          </h2>
          <MapLegend />
        </div>
        <StageMap pipeline={pipeline} onPick={setNode} />
      </section>

      <section className="card" aria-labelledby="grid-title">
        <div className="card-head">
          <h2 id="grid-title" className="t-section-24">
            {GROUPS[project.group].cutLabel} × 环节
          </h2>
          <div className="chips" role="tablist" aria-label="筛选">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className="ui-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {grid.projectCells.length ? (
          <div className="stack" data-gap="small">
            <span className="label">全项目一份的环节</span>
            <div className="project-strip">
              {grid.projectCells.map((c) =>
                c.tasks.map((t) => (
                  <button key={t.task.id} type="button" className="strip-item" onClick={() => setTask(t.task)} aria-label={`${c.stage.name}：${TASK_STATUS_LABEL[t.task.status]}`}>
                    <StatusPill Status={t.task.status} />
                    <span>{c.stage.name}</span>
                    {t.assignee ? <MemberAvatar member={t.assignee} size="20" /> : null}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
        {grid.rows.length === 0 ? (
          <Empty action={<Button Label="看全部" Size="Small" Style="Secondary" onClick={() => setFilter("all")} />}>
            {filter === "mine" ? "这个项目里没有你做的卡。" : filter === "review" ? "现在没有待审的。" : filter === "stuck" ? "没有卡住的，挺顺。" : "这个项目还没有卡。"}
          </Empty>
        ) : (
          <Board grid={grid} />
        )}
        <div className="row" data-justify="between">
          <StatusLegend />
          {grid.hidden ? <span className="label">筛掉了 {grid.hidden} 行</span> : null}
        </div>
      </section>

      <section className="card" aria-labelledby="pthreads-title">
        <h2 id="pthreads-title" className="t-heading-18">
          项目上的意见和问题 <span className="count">{threads.length}</span>
        </h2>
        <ProjectThreadComposer projectId={project.id} />
        {threads.length === 0 ? (
          <Empty>还没有人在项目上留意见。</Empty>
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
      {editing ? <ProjectEditDialog projectId={project.id} onClose={() => setEditing(false)} /> : null}
    </>
  );
}

function ProjectThreadComposer({ projectId }: { projectId: string }) {
  const { dispatch, notify } = useGuild();
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
        if (!r.ok) setError(r.error.message);
        else {
          setText("");
          setError(null);
          notify(kind === "setting" ? "设定问题提上去了，等管理员拍板" : "留好了", "Neutral");
        }
      }}
    >
      <div className="row">
        <div className="chips">
          <button type="button" className="ui-chip" aria-pressed={kind === "comment"} onClick={() => setKind("comment")}>
            意见
          </button>
          <button type="button" className="ui-chip" aria-pressed={kind === "setting"} onClick={() => setKind("setting")}>
            设定问题
          </button>
        </div>
      </div>
      <textarea className="field-control" aria-label="写意见" placeholder={kind === "setting" ? "例如：箭头影要简化去掉，还是沿用第 9 卡的设定？" : "对整个项目说的话"} value={text} onChange={(e) => setText(e.target.value)} />
      {error ? <p className="error-text">{error}</p> : null}
      <div className="form-actions">
        <Button Label="留下" Size="Small" Style="Accent" type="submit" />
      </div>
    </form>
  );
}

function StageDrawer({ node, onClose }: { node: StageNode; onClose: () => void }) {
  const { world, me, dispatch, notify } = useGuild();
  const { stage } = node;
  const project = world.projects[stage.projectId];
  const admin = isAdmin(me);
  const reviewer = memberById(world, stage.reviewerId);
  const reviewers = members(world).filter((m) => isReviewer(m));
  return (
    <Drawer Type="Drawer" Title={stage.name} open onClose={onClose} actions={<Button Label="关上" Style="Secondary" onClick={onClose} />}>
      <div className="stack" data-gap="small" style={{ overflowY: "auto" }}>
        <div className="row">
          <Tag>{PHASE_LABEL[stage.phase]}</Tag>
          <Tag tone="lilac">
            {STAGE_KIND_LABEL[stage.kind]}
            {stage.hub && stage.kind !== "hub" ? " · 枢纽" : ""}
          </Tag>
          <Tag>{GRAIN_LABEL[stage.grain]}</Tag>
        </div>
        <p>
          {rateLabel(stage)}
          {stage.adminSet ? "（管理员定）" : ""} · 掌控系数 {stage.control}
        </p>
        {stage.note ? <p className="muted">{stage.note}</p> : null}
        <div className="chips" aria-label="各状态的张数">
          {TASK_STATUS.filter((s) => node.counts[s] > 0).map((s) => (
            <StatusPill key={s} Status={s} Label={`${TASK_STATUS_LABEL[s]} ${node.counts[s]}`} />
          ))}
        </div>
        <dl className="stack" data-gap="small" style={{ margin: 0 }}>
          <div>
            <dt className="label">收什么</dt>
            <dd style={{ margin: 0 }}>{stage.indicator.receive}</dd>
          </div>
          <div>
            <dt className="label">交什么</dt>
            <dd style={{ margin: 0 }}>{stage.indicator.deliver}</dd>
          </div>
          <div>
            <dt className="label">交给谁</dt>
            <dd style={{ margin: 0 }}>{stage.indicator.handTo}</dd>
          </div>
          <div>
            <dt className="label">报到的人</dt>
            <dd style={{ margin: 0 }}>{node.enrolled} 人</dd>
          </div>
        </dl>
        {admin ? (
          <SelectField
            label="审核员"
            value={stage.reviewerId ?? ""}
            onChange={(e) => {
              const r = dispatch("stage.set_reviewer", { stageId: stage.id, memberId: e.target.value || null });
              if (r.ok) notify("审核员改好了", "Neutral");
            }}
          >
            <option value="">审核员和管理员谁都能审</option>
            {reviewers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}
              </option>
            ))}
          </SelectField>
        ) : (
          <p className="label">审核：{reviewer ? reviewer.nickname : "审核员和管理员谁都能审"}</p>
        )}
        <div className="form-actions">
          <Link to={`/enroll?group=${project?.group ?? "animation"}&stage=${stage.templateKey}`} className="ui-button" data-style="Accent" data-size="Medium">
            申报这个环节
          </Link>
          {admin && stage.hub ? (
            <Link to={`/admin?tab=dispatch&project=${stage.projectId}&hub=${stage.id}`} className="ui-button" data-style="Secondary" data-size="Medium">
              枢纽派发
            </Link>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}

function ProjectEditDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const p = world.projects[projectId];
  const [name, setName] = useState(p.name);
  const [code, setCode] = useState(p.code);
  const [planEndOn, setPlanEndOn] = useState(p.planEndOn);
  const [feishuRoot, setFeishuRoot] = useState(p.feishuRoot ?? "");
  const [status, setStatus] = useState<ProjectStatus>(p.status);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const r = dispatch("project.update", { projectId, name, code, planEndOn, feishuRoot: feishuRoot || null, status }, { quiet: true });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    notify("项目改好了", "Neutral");
    onClose();
  };
  return (
    <Drawer
      Type="Dialog"
      Title="改项目"
      open
      onClose={onClose}
      actions={
        <>
          <Button Label="取消" Style="Secondary" onClick={onClose} />
          <Button Label="保存" Style="Accent" onClick={save} />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <TextField label="项目名字" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="代号（2–6 位大写，用在文件名里）" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <TextField label="计划结束" type="date" value={planEndOn} onChange={(e) => setPlanEndOn(e.target.value)} />
        <TextField label="飞书根文件夹的链接" type="url" placeholder="https://…" value={feishuRoot} onChange={(e) => setFeishuRoot(e.target.value)} />
        <SelectField label="状态" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
          {PROJECT_STATUS.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABEL[s]}
            </option>
          ))}
        </SelectField>
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </Drawer>
  );
}
