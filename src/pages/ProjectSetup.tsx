/**
 * 零日与改项目（SPEC §12 · §17）用到的几块：
 *   - NewProjectForm：选模板建项目（先进开局向导）
 *   - StartCheckCard · KeyDateTimeline · StagesPreview · AddPositionForm（开局向导和项目档案用）
 *   - AcceptDialog（验收）· ExtendDialog（延期）· AddCutsForm / CutEditForm / ArchiveCutDialog（加卡 · 改卡 · 停用）· ProjectTimelineCard（项目时间线）
 * 原来的「改项目」大表（ProjectSettingsPage）去掉了：介绍 / 日期 / 结构 / 人员在项目档案里就地改，环节在路线上插、在环节页里改。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { StatusPill } from "@/components/ui/StatusPill";
import { Empty, SelectField, Tag, TextField } from "@/components/app/bits";
import { LinkList } from "@/components/app/links";
import { FileImage } from "@/components/library/tiles";
import { GROUP, PHASE, type CutRow, type Group, type Id, type ProjectRow, type StageRow, type TaskRow } from "@/domain/model";
import { PROJECT_TEMPLATES, PROJECT_TEMPLATE_KEYS, type ProjectTemplateKey } from "@/domain/positions";
import { cutsOf, filesOn, startPreview, memberById, projectTimeline, reviewsOf, submissionsOf, taskView, tasksOf, todayOf } from "@/domain/queries";
import { groupTemplate, stageText } from "@/domain/templates";
import { addDays } from "@/domain/clock";
import { U, useI18n } from "@/i18n/I18n";
import { navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";

// ---------------------------------------------------------------------------
// 选模板建项目
// ---------------------------------------------------------------------------

export function NewProjectForm() {
  const { world, dispatch, notify } = useGuild();
  const { L, t2, err } = useI18n();
  const route = useRoute();
  const today = todayOf(world);
  const [template, setTemplate] = useState<ProjectTemplateKey>(route.query.get("group") === "video" ? "video_standard" : "anim_standard");
  const [group, setGroup] = useState<Group>("animation");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [startOn, setStartOn] = useState(today);
  const [planEndOn, setPlanEndOn] = useState(addDays(today, 7 * 12));
  const [error, setError] = useState<string | null>(null);
  const create = () => {
    const r = dispatch("project.draft", { template, name, code, startOn, planEndOn, group: template === "blank" ? group : undefined }, { quiet: true });
    if (!r.ok) {
      setError(err(r.error));
      return;
    }
    notify(L.zero.created);
    navigate(`/project/${r.created.projectId}`);
  };
  return (
    <section className="card" aria-label={L.zero.createTitle}>
      <h2 className="t-heading-18">{L.zero.createTitle}</h2>
      <p className="muted">{L.zero.createLead}</p>
      <span className="label">{L.zero.templateTitle}</span>
      <div className="roles" role="radiogroup" aria-label={L.zero.templateTitle}>
        {PROJECT_TEMPLATE_KEYS.map((k) => {
          const tpl = PROJECT_TEMPLATES[k];
          return (
            <button key={k} type="button" className="role-card" role="radio" aria-checked={template === k} aria-pressed={template === k} onClick={() => setTemplate(k)} data-testid={`template-${k}`}>
              <span className="role-card-name">{t2(tpl.name)}</span>
              <span className="muted label">{t2(tpl.desc)}</span>
            </button>
          );
        })}
      </div>
      {template === "blank" ? (
        <div className="chips" role="radiogroup" aria-label={L.zero.group}>
          {GROUP.map((g) => (
            <button key={g} type="button" className="ui-chip" aria-pressed={group === g} onClick={() => setGroup(g)}>
              {L.labels.group[g]}
            </button>
          ))}
        </div>
      ) : null}
      <div className="form-grid">
        <TextField label={L.zero.name} value={name} onChange={(e) => setName(e.target.value)} data-testid="new-name" />
        <TextField label={L.zero.code} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="new-code" />
        <TextField label={L.zero.startOn} type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
        <TextField label={L.zero.planEndOn} type="date" value={planEndOn} onChange={(e) => setPlanEndOn(e.target.value)} />
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={L.zero.createButton} Style="Accent" onClick={create} data-testid="new-create" />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 开局（零日）
// ---------------------------------------------------------------------------

/** 零日页最上面：开工检查（还缺什么 · 开工会生成多少 · 谁会自动报到）+ 开工按钮。 */
export function StartCheckCard({ project, admin }: { project: ProjectRow; admin: boolean }) {
  const { world } = useGuild();
  const { L, f, t2 } = useI18n();
  const pv = startPreview(world, project.id);
  if (!pv) return null;
  const shown = pv.unfilled.slice(0, 6);
  return (
    <section className="card start-card" aria-labelledby="start-title" data-testid="start-check">
      <div className="card-head">
        <h2 id="start-title" className="t-heading-18">
          {L.zero.startCard}
        </h2>
        <span className="label" data-testid="start-ready">
          {pv.ready ? L.zero.readyYes : L.zero.readyNo}
        </span>
      </div>
      {pv.unfilled.length ? (
        <p className="start-warn" data-testid="start-unfilled">
          {f(L.zero.unfilled, {
            n: pv.unfilled.length,
            names: shown.map((x) => (typeof x.name === "string" ? x.name : t2(x.name))).join(L.zero.listSep),
            more: pv.unfilled.length > shown.length ? f(L.zero.unfilledMore, { n: pv.unfilled.length, rest: pv.unfilled.length - shown.length }) : "",
          })}
        </p>
      ) : (
        <p className="start-ok">{L.zero.allFilled}</p>
      )}
      <div className="row start-row">
        {admin ? <StartButton project={project} /> : null}
        <span className="label">{f(L.zero.startSummary[project.group], { cuts: pv.cuts, tasks: pv.tasks, people: pv.autoEnroll })}</span>
      </div>
    </section>
  );
}

/** 日期一块上面的小时间轴：开始 · 各关键日 · 计划结束（按日子摆位置）。 */
export function KeyDateTimeline({ project }: { project: ProjectRow }) {
  const { L, monthDay } = useI18n();
  const start = Date.parse(project.startOn);
  const end = Date.parse(project.planEndOn);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const pos = (d: string) => Math.min(100, Math.max(0, ((Date.parse(d) - start) / (end - start)) * 100));
  const keys = (project.keyDates ?? []).filter((k) => k.name.trim() && k.date && Number.isFinite(Date.parse(k.date))).sort((a, b) => a.date.localeCompare(b.date));
  // 关键日正好是开始 / 计划结束那天：合成一个点，用关键日的名字。
  const atStart = keys.find((k) => k.date === project.startOn);
  const atEnd = keys.find((k) => k.date === project.planEndOn);
  const points = [
    { id: "start", name: atStart?.name ?? L.zero.tlStart, date: project.startOn, edge: true, uc: !!atStart },
    ...keys.filter((k) => k !== atStart && k !== atEnd).map((k) => ({ id: k.id, name: k.name, date: k.date, edge: false, uc: true })),
    { id: "end", name: atEnd?.name ?? L.zero.tlEnd, date: project.planEndOn, edge: true, uc: !!atEnd },
  ];
  // 挨得太近的关键日，名字放到线的上面，免得叠在一起。
  let last = -100;
  let lastRow = "a";
  const rows = points.map((p, i) => {
    const at = pos(p.date);
    const near = at - last < 16 || (i === points.length - 1 ? false : pos(points[i + 1].date) - at < 16);
    const row = p.edge ? "a" : near && lastRow === "a" ? "b" : "a";
    last = at;
    lastRow = row;
    return row;
  });
  return (
    <ol className="key-timeline" aria-label={L.zero.timeline} data-testid="key-timeline" data-stagger={rows.includes("b") ? "yes" : undefined}>
      {points.map((p, i) => (
        <li key={p.id} style={{ ["--at" as string]: `${pos(p.date)}%` }} data-edge={p.edge ? "yes" : undefined} data-row={rows[i]}>
          <span className="key-timeline-dot" aria-hidden="true" />
          <span className="key-timeline-name">{p.uc ? <U>{p.name}</U> : p.name}</span>
          <span className="key-timeline-date num">{monthDay(p.date)}</span>
        </li>
      ))}
    </ol>
  );
}

function StartButton({ project }: { project: ProjectRow }) {
  const { dispatch, notify } = useGuild();
  const { L, f, err } = useI18n();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = project.cutsPlan?.length ?? 0;
  return (
    <>
      <Button Label={L.zero.start} Style="Accent" onClick={() => setOpen(true)} data-testid="zero-start" />
      {open ? (
        <Drawer
          Type="Dialog"
          Title={L.zero.startConfirmTitle}
          Body={f(L.zero.startConfirmBody, { n })}
          open
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button Label={L.common.cancel} Style="Secondary" onClick={() => setOpen(false)} />
              <Button
                Label={L.zero.start}
                Style="Accent"
                data-testid="zero-start-confirm"
                onClick={() => {
                  const r = dispatch("project.start", { projectId: project.id }, { quiet: true });
                  if (!r.ok) setError(err(r.error));
                  else {
                    setOpen(false);
                    notify(f(L.zero.started, { name: project.name }));
                  }
                }}
              />
            </>
          }
        >
          {error ? <p className="error-text">{error}</p> : null}
        </Drawer>
      ) : null}
    </>
  );
}

export function AddPositionForm({ projectId, onDone }: { projectId: Id; onDone: () => void }) {
  const { dispatch } = useGuild();
  const { L, err } = useI18n();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 不用 <form>：它会放在人员表的表单里面（表单不能套表单）。
  const add = () => {
    const r = dispatch("staff.add_position", { projectId, name, desc }, { quiet: true });
    if (!r.ok) setError(err(r.error));
    else onDone();
  };
  return (
    <div className="form-grid" data-testid="add-position">
      <TextField label={L.zero.positionName} value={name} onChange={(e) => setName(e.target.value)} data-testid="add-position-name" />
      <TextField label={L.zero.positionDesc} value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="form-actions">
        <Button Label={L.common.add} Size="Small" Style="Accent" onClick={add} data-testid="add-position-go" />
        <Button Label={L.common.cancel} Size="Small" Style="Ghost" onClick={onDone} />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}

export function StagesPreview({ project }: { project: ProjectRow }) {
  const { L, t2, f, lang } = useI18n();
  const tpl = PROJECT_TEMPLATES[project.template ?? "anim_standard"];
  const stages = tpl.stages ? groupTemplate(project.group).stages : [];
  return (
    <section className="card" aria-labelledby="stages-preview-title">
      <h2 id="stages-preview-title" className="t-heading-18">
        {L.zero.stagesTitle} <span className="count">{stages.length}</span>
      </h2>
      <p className="muted">{tpl.stages ? f(L.zero.stagesLead, { template: t2(tpl.name) }) : L.zero.stagesBlank}</p>
      {PHASE.map((ph) => {
        const list = stages.filter((s) => s.phase === ph);
        if (!list.length) return null;
        return (
          <div key={ph} className="row">
            <span className="label">{L.labels.phase[ph]}{L.common.colon}</span>
            {list.map((s) => (
              <Tag key={s.key}>{stageText(project.group, { templateKey: s.key, name: s.name }, lang).name}</Tag>
            ))}
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 开工以后：延期 · 加卡 · 改卡 · 停用一卡
// ---------------------------------------------------------------------------

export function ProjectExtendCard({ project }: { project: ProjectRow }) {
  const { dispatch, notify } = useGuild();
  const { L, f, err } = useI18n();
  const [until, setUntil] = useState(project.planEndOn);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card" aria-label={L.edit.projectExtend}>
      <h2 className="t-heading-18">{L.edit.projectExtend}</h2>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const r = dispatch("project.extend", { projectId: project.id, until, reason }, { quiet: true });
          if (!r.ok) setError(err(r.error));
          else {
            setError(null);
            setReason("");
            notify(f(L.edit.projectExtended, { date: until }));
          }
        }}
      >
        <TextField label={L.edit.projectExtendUntil} type="date" value={until} onChange={(e) => setUntil(e.target.value)} data-testid="project-extend-until" />
        <TextField label={L.common.reason} hint={L.common.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="project-extend-reason" />
        <div className="form-actions">
          <Button Label={L.edit.extendGo} Size="Small" Style="Accent" type="submit" data-testid="project-extend-go" />
        </div>
      </form>
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

export function AddCutsForm({ projectId, onDone }: { projectId: Id; onDone?: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, cut: cutOf } = useI18n();
  const project = world.projects[projectId];
  const cuts = cutsOf(world, projectId);
  const [count, setCount] = useState("1");
  const [after, setAfter] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card" aria-label={L.edit.addCuts} data-testid="add-cuts">
      <h2 className="t-heading-18">{L.edit.addCuts}</h2>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(count);
          const r = dispatch("cut.add", { projectId, count: n, afterCutId: after || null, reason: reason || null }, { quiet: true });
          if (!r.ok) setError(err(r.error));
          else {
            setError(null);
            setReason("");
            notify(f(L.edit.cutsAdded, { n }));
            onDone?.();
          }
        }}
      >
        <TextField label={L.edit.addCount} type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} data-testid="add-cuts-count" />
        <SelectField label={L.edit.addAfter} value={after} onChange={(e) => setAfter(e.target.value)} data-testid="add-cuts-after">
          <option value="">{L.edit.addAtEnd}</option>
          {cuts.map((c) => (
            <option key={c.id} value={c.id}>
              {f(L.edit.addAfterCut, { cut: cutOf(c, project.group) })}
            </option>
          ))}
        </SelectField>
        <TextField label={L.common.reason} hint={L.common.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="add-cuts-reason" />
        <div className="form-actions">
          <Button Label={L.edit.addCuts} Size="Small" Style="Accent" type="submit" data-testid="add-cuts-go" />
        </div>
      </form>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function CutEditForm({ cut, onDone }: { cut: CutRow; onDone: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, cut: cutOf } = useI18n();
  const group = world.projects[cut.projectId].group;
  const [layers, setLayers] = useState(cut.layers.map((l) => `${l.name}:${l.sheets}`).join(", "));
  const [seconds, setSeconds] = useState(String(cut.seconds));
  const [reason, setReason] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = cutOf(cut, group);
  return (
    <div className="stack flex-box" data-gap="small">
      <div className="form-grid">
        {groupTemplate(group).hasLayers ? <TextField label={L.edit.cutLayers} value={layers} onChange={(e) => setLayers(e.target.value.toUpperCase())} /> : null}
        <TextField label={L.edit.cutSeconds} type="number" min={0} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
        <TextField label={L.common.reason} hint={L.common.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="form-actions">
        <Button
          Label={L.common.save}
          Size="Small"
          Style="Accent"
          onClick={() => {
            const parsed = groupTemplate(group).hasLayers
              ? layers
                  .split(/[,，]+/)
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .map((x) => {
                    const [name, sheets] = x.split(/[:：\s]+/);
                    return { name, sheets: Number(sheets) };
                  })
              : undefined;
            const r = dispatch("cut.update", { cutId: cut.id, layers: parsed, seconds: Number(seconds), reason: reason || null }, { quiet: true });
            if (!r.ok) setError(err(r.error));
            else {
              notify(f(L.edit.cutUpdated, { cut: code }));
              onDone();
            }
          }}
        />
        <Button Label={L.edit.archiveCut} Size="Small" Style="Ghost" onClick={() => setConfirmArchive(true)} />
      </div>
      {confirmArchive ? <ArchiveCutDialog cut={cut} onClose={() => setConfirmArchive(false)} /> : null}
    </div>
  );
}

export function ArchiveCutDialog({ cut, onClose }: { cut: CutRow; onClose: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, cut: cutOf } = useI18n();
  const code = cutOf(cut, world.projects[cut.projectId].group);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer
      Type="Dialog"
      Title={L.edit.archiveCut}
      Body={f(L.edit.archiveCutConfirm, { cut: code })}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.common.cancel} Style="Secondary" onClick={onClose} />
          <Button
            Label={L.edit.archiveCut}
            data-testid="archive-cut-go"
            onClick={() => {
              const r = dispatch("cut.archive", { cutId: cut.id, reason }, { quiet: true });
              if (!r.ok) setError(err(r.error));
              else {
                notify(f(L.edit.cutArchived, { cut: code }), "Neutral");
                onClose();
              }
            }}
          />
        </>
      }
    >
      <TextField label={L.common.reason} hint={L.common.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="archive-cut-reason" />
      {error ? <p className="error-text">{error}</p> : null}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// 验收 · 延期
// ---------------------------------------------------------------------------

export function AcceptDialog({ stage, onClose }: { stage: StageRow; onClose: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, lang, num } = useI18n();
  const project = world.projects[stage.projectId];
  const tasks = useMemo(() => tasksOf(world, stage.projectId).filter((t) => t.stageId === stage.id), [world, stage]);
  const [error, setError] = useState<string | null>(null);
  const name = stageText(project.group, stage, lang).name;
  const redo = tasks.filter((t) => t.redo).length;
  return (
    <Drawer
      Type="Drawer"
      Title={f(L.edit.acceptTitle, { stage: name })}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.common.close} Style="Secondary" onClick={onClose} />
          {!stage.acceptedAt ? (
            <Button
              Label={L.edit.acceptAll}
              Style="Accent"
              data-testid="accept-all"
              onClick={() => {
                const r = dispatch("stage.accept", { stageId: stage.id }, { quiet: true });
                if (!r.ok) setError(err(r.error));
                else {
                  setError(null);
                  notify(f(L.edit.accepted, { stage: name }));
                }
              }}
            />
          ) : null}
        </>
      }
    >
      <div className="stack" data-gap="small" style={{ overflowY: "auto" }} data-testid="accept-view">
        <p className="muted">{L.edit.acceptLead}</p>
        {stage.acceptedAt ? <Tag tone="success">{L.edit.acceptedTag}</Tag> : null}
        {redo ? <Tag tone="warning">{f(L.edit.redoCount, { n: redo })}</Tag> : null}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="list">
          {tasks.map((t) => (
            <AcceptRow key={t.id} task={t} />
          ))}
        </ul>
      </div>
    </Drawer>
  );
  void num;
}

function AcceptRow({ task }: { task: TaskRow }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, r: rich, ph, pt } = useI18n();
  const v = taskView(world, task);
  const subs = submissionsOf(world, task.id);
  const last = subs[subs.length - 1];
  const review = reviewsOf(world, task.id).filter((r) => r.verdict !== "return").pop();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!v) return null;
  const images = last ? filesOn(world, "submission", last.id).filter((x) => !!x.width) : [];
  return (
    <li style={{ flexDirection: "column", alignItems: "stretch" }} data-testid="accept-row">
      <div className="row" data-justify="between">
        <span className="t-body-14m">{ph(v.labelP)}</span>
        <StatusPill Status={task.status} />
      </div>
      {last ? (
        <>
          <span className="label num break">
            <U>{last.fileName}</U>
          </span>
          <LinkList submission={last} compact />
          {images.length ? (
            <div className="row">
              {images.slice(0, 4).map((img) => (
                <FileImage key={img.id} file={img} className="accept-thumb" />
              ))}
            </div>
          ) : null}
          <span className="label">
            {rich(L.edit.finalBy, {
              who: <U>{memberById(world, last.byMemberId)?.nickname ?? task.outsourceName ?? "—"}</U>,
              reviewer: <U>{review ? memberById(world, review.byMemberId)?.nickname ?? "—" : "—"}</U>,
              q: review?.quality ?? "—",
            })}
          </span>
        </>
      ) : (
        <span className="label">{L.edit.noFinal}</span>
      )}
      {task.status === "passed" ? (
        open ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const r = dispatch("task.reopen", { taskId: task.id, comments: [{ text }] }, { quiet: true });
              if (!r.ok) setError(err(r.error));
              else {
                notify(f(L.edit.redone, { label: pt(v.labelP) }), "Neutral");
                setOpen(false);
              }
            }}
          >
            <TextField label={L.edit.redoComment} value={text} onChange={(e) => setText(e.target.value)} data-testid="redo-comment" />
            <Button Label={L.edit.redoGo} Size="Small" Style="Primary" type="submit" data-testid="redo-go" />
          </form>
        ) : (
          <div className="form-actions">
            <Button Label={L.edit.redo} Size="Small" Style="Ghost" onClick={() => setOpen(true)} data-testid="redo-open" />
          </div>
        )
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
    </li>
  );
}

/** 延期：一张任务（选一张在做的）或者一个环节所有在做的。 */
export function ExtendDialog({ target, tasks, onClose }: { target: { kind: "stage"; stage: StageRow } | { kind: "task" } | { kind: "tasks"; ids: Id[] }; tasks?: TaskRow[]; onClose: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, lang, pt } = useI18n();
  const running = (tasks ?? []).filter((t) => (t.status === "claimed" || t.status === "returned") && t.dueAt);
  const [taskId, setTaskId] = useState(running[0]?.id ?? "");
  const [hours, setHours] = useState("");
  const [days, setDays] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const what =
    target.kind === "stage"
      ? stageText(world.projects[target.stage.projectId].group, target.stage, lang).name
      : target.kind === "tasks"
        ? target.ids.length === 1
          ? pt(taskView(world, world.tasks[target.ids[0]])?.labelP)
          : f(L.edit.extendN, { n: target.ids.length })
        : pt(taskView(world, world.tasks[taskId])?.labelP);
  const go = () => {
    const amount = { hours: hours ? Number(hours) : null, days: days ? Number(days) : null, until: until || null, reason };
    const r =
      target.kind === "stage"
        ? dispatch("stage.extend", { stageId: target.stage.id, ...amount }, { quiet: true })
        : target.kind === "tasks"
          ? dispatch("task.extend", { taskIds: target.ids, ...amount }, { quiet: true })
          : dispatch("task.extend", { taskId, ...amount }, { quiet: true });
    if (!r.ok) setError(err(r.error));
    else {
      notify(L.edit.extended);
      onClose();
    }
  };
  return (
    <Drawer
      Type="Dialog"
      Title={f(L.edit.extendTitle, { what })}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.common.cancel} Style="Secondary" onClick={onClose} />
          <Button Label={L.edit.extendGo} Style="Accent" onClick={go} data-testid="extend-go" />
        </>
      }
    >
      <div className="stack" data-gap="small">
        {target.kind === "task" ? (
          <SelectField label={L.edit.extendTask} value={taskId} onChange={(e) => setTaskId(e.target.value)} data-testid="extend-task">
            {running.map((t) => (
              <option key={t.id} value={t.id}>
                {pt(taskView(world, t)?.labelP)}
              </option>
            ))}
          </SelectField>
        ) : null}
        <div className="form-grid">
          <TextField label={L.edit.extendHours} type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} data-testid="extend-hours" />
          <TextField label={L.edit.extendDays} type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} />
          <TextField label={L.edit.extendUntil} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
        <TextField label={L.common.reason} hint={L.common.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="extend-reason" />
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// 项目时间线
// ---------------------------------------------------------------------------

export function ProjectTimelineCard({ projectId }: { projectId: Id }) {
  const { world } = useGuild();
  const { L, f, dateTime, ph } = useI18n();
  const items = projectTimeline(world, projectId);
  return (
    <section className="card" aria-labelledby="ptl-title" data-testid="project-timeline">
      <h2 id="ptl-title" className="t-heading-18">
        {L.edit.timelineTitle} <span className="count">{items.length}</span>
      </h2>
      <p className="label">{L.edit.timelineLead}</p>
      {items.length === 0 ? (
        <Empty>{L.edit.timelineEmpty}</Empty>
      ) : (
        <ol className="timeline">
          {items.slice(0, 60).map((i) => (
            <li key={i.key} data-testid="project-timeline-item" data-command={i.command}>
              <span className="dot" data-kind="other" aria-hidden="true">
                ·
              </span>
              <div className="timeline-body">
                <div className="timeline-head">
                  <span className="break">{ph(i.phrase)}</span>
                  <span className="label">{dateTime(i.at)}</span>
                </div>
                {i.reason ? (
                  <span className="label break">
                    {f(L.edit.because, { reason: "" })}
                    <U>{i.reason}</U>
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 卡详情里管理员的：延期 · 打回重做 · 停用这一卡
// ---------------------------------------------------------------------------

export function CutAdminCard({ cut }: { cut: CutRow }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, pt } = useI18n();
  const tasks = Object.values(world.tasks).filter((t) => t.cutId === cut.id && !t.archivedAt && !t.extra);
  const passed = tasks.filter((t) => t.status === "passed");
  const running = tasks.filter((t) => (t.status === "claimed" || t.status === "returned") && t.dueAt);
  const [sub, setSub] = useState<"extend" | "redo" | "archive" | null>(null);
  const [taskId, setTaskId] = useState(passed[0]?.id ?? "");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (cut.disabled)
    return (
      <section className="card" data-tone="muted" aria-label={L.edit.cutAdmin}>
        <Tag>{L.edit.disabledTag}</Tag>
      </section>
    );
  return (
    <section className="card" aria-labelledby="cut-admin-title" data-testid="cut-admin">
      <h2 id="cut-admin-title" className="t-heading-18">
        {L.edit.cutAdmin}
      </h2>
      <div className="form-actions">
        <Button Label={L.edit.extendOpen} Size="Small" Style="Secondary" disabled={!running.length} onClick={() => setSub("extend")} data-testid="cut-extend-open" />
        <Button Label={L.edit.redo} Size="Small" Style="Secondary" disabled={!passed.length} onClick={() => setSub(sub === "redo" ? null : "redo")} data-testid="cut-redo-open" />
        <Button Label={L.edit.archiveCut} Size="Small" Style="Ghost" onClick={() => setSub("archive")} data-testid="cut-archive-open" />
      </div>
      {!running.length ? <span className="label">{L.edit.noRunning}</span> : null}
      {sub === "redo" ? (
        <form
          className="stack"
          data-gap="small"
          onSubmit={(e) => {
            e.preventDefault();
            const r = dispatch("task.reopen", { taskId, comments: [{ text }] }, { quiet: true });
            if (!r.ok) setError(err(r.error));
            else {
              setError(null);
              setText("");
              setSub(null);
              notify(f(L.edit.redone, { label: pt(taskView(world, world.tasks[taskId])?.labelP) }), "Neutral");
            }
          }}
        >
          <SelectField label={L.edit.extendTask} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            {passed.map((t) => (
              <option key={t.id} value={t.id}>
                {pt(taskView(world, t)?.labelP)}
              </option>
            ))}
          </SelectField>
          <TextField label={L.edit.redoComment} value={text} onChange={(e) => setText(e.target.value)} data-testid="cut-redo-comment" />
          <div className="form-actions">
            <Button Label={L.edit.redoGo} Size="Small" Style="Primary" type="submit" data-testid="cut-redo-go" />
          </div>
        </form>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
      {sub === "extend" ? <ExtendDialog target={{ kind: "task" }} tasks={running} onClose={() => setSub(null)} /> : null}
      {sub === "archive" ? <ArchiveCutDialog cut={cut} onClose={() => setSub(null)} /> : null}
    </section>
  );
}
