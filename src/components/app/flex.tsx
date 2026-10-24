/**
 * 灵活性（SPEC §13）的界面：环节设置（只给指派的人 · 计划周期 · 时限参数）· 发新任务 · 这个环节的额外任务 ·
 * 一批派给某人 · 项目排期（按周的甘特图）。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { isAdmin, isReviewer } from "@/domain/commands/core";
import { U, useI18n } from "@/i18n/I18n";
import { EXTRA_KIND, type ExtraKind, type Group, type Id, type StageRow, type TaskRow } from "@/domain/model";
import { shortStageName } from "./board";
import { cutCode } from "@/domain/naming";
import { cutName, cutsOf, extrasOfStage, libraryOf, members, memberById, scheduleOf, taskView, tasksOf, type ScheduleRow } from "@/domain/queries";
import { stageLocked } from "@/domain/rules";
import { useFiles } from "@/lib/files/FilesProvider";
import { useGuild } from "@/lib/store";
import { DropZone } from "@/components/library/intake";
import { FileImage } from "@/components/library/tiles";
import { MemberLink, SelectField, Tag, TextArea, TextField } from "./bits";
import { TaskActions } from "./task";

/** 环节设置（管理员）：只给指派的人 · 计划周期 · 时限参数。 */
export function StageSettings({ stage }: { stage: StageRow }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, stageName, unit: unitOf } = useI18n();
  const group = world.projects[stage.projectId]?.group ?? "animation";
  const sched = scheduleOf(world, stage.projectId);
  const row = sched?.phases.flatMap((p) => p.rows).find((r) => r.stage.id === stage.id);
  const [startWeek, setStartWeek] = useState(String(row?.plan.start ?? 1));
  const [weeks, setWeeks] = useState(String(row ? row.plan.end - row.plan.start + 1 : 1));
  const [tn, setTn] = useState(String(stage.tn));
  const [factor, setFactor] = useState(stage.deadlineFactor ? String(stage.deadlineFactor) : "");
  const [minHours, setMinHours] = useState(stage.minDeadlineHours ? String(stage.minDeadlineHours) : "");
  const [error, setError] = useState<string | null>(null);
  const locked = stageLocked(stage);
  const unit = unitOf(stage.unit, group, stage.per);
  return (
    <div className="stack flex-box" data-gap="small" data-testid="stage-settings">
      <h3 className="t-body-14m">{L.flex.settings}</h3>
      <label className="check-row">
        <input
          type="checkbox"
          checked={locked}
          data-testid="stage-lock"
          onChange={(e) => {
            const r = dispatch("stage.set_lock", { stageId: stage.id, locked: e.target.checked }, { quiet: true });
            if (r.ok) notify(f(e.target.checked ? L.flex.lockOn : L.flex.lockOff, { stage: stageName(group, stage) }), "Neutral");
          }}
        />
        <span>{L.flex.lockLabel}</span>
      </label>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const r = dispatch("stage.set_period", { stageId: stage.id, startWeek: Number(startWeek), weeks: Number(weeks) }, { quiet: true });
          if (!r.ok) setError(err(r.error));
          else {
            setError(null);
            notify(L.flex.periodSaved, "Neutral");
          }
        }}
      >
        <TextField label={f(L.flex.periodStart, { n: sched?.cycleDays ?? 7 })} type="number" min={1} value={startWeek} onChange={(e) => setStartWeek(e.target.value)} data-testid="period-start" />
        <TextField label={L.flex.periodWeeks} type="number" min={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} data-testid="period-weeks" />
        <div className="form-actions">
          <Button Label={L.flex.periodSave} Size="Small" Style="Secondary" type="submit" data-testid="period-save" />
        </div>
      </form>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const r = dispatch(
            "stage.set_rate",
            { stageId: stage.id, tn: Number(tn), deadlineFactor: factor ? Number(factor) : null, minDeadlineHours: minHours ? Number(minHours) : null },
            { quiet: true }
          );
          if (!r.ok) setError(err(r.error));
          else {
            setError(null);
            notify(L.flex.rateSaved, "Neutral");
          }
        }}
      >
        <TextField label={f(L.flex.tnPer, { per: stage.per, unit })} type="number" step="0.1" min={0} value={tn} onChange={(e) => setTn(e.target.value)} data-testid="rate-tn" />
        <TextField label={L.flex.factor} type="number" step="0.1" placeholder="1.5" value={factor} onChange={(e) => setFactor(e.target.value)} />
        <TextField label={L.flex.minHours} type="number" placeholder="4" value={minHours} onChange={(e) => setMinHours(e.target.value)} />
        <div className="form-actions">
          <Button Label={L.flex.rateSave} Size="Small" Style="Secondary" type="submit" data-testid="rate-save" />
        </div>
      </form>
      <p className="label">{L.flex.rateNote}</p>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** 一批派给某人：选这个环节里几卡可接的任务。 */
export function BatchAssign({ stage }: { stage: StageRow }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, ph, cut: cutOf } = useI18n();
  const group = world.projects[stage.projectId]?.group ?? "animation";
  const open = tasksOf(world, stage.projectId).filter((t) => t.stageId === stage.id && (t.status === "open" || t.status === "reclaimed"));
  const [picked, setPicked] = useState<Id[]>([]);
  const [who, setWho] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open.length) return null;
  return (
    <div className="stack flex-box" data-gap="small" data-testid="batch-assign">
      <h3 className="t-body-14m">{L.flex.batchTitle}</h3>
      <div className="chips" role="group" aria-label={L.flex.pickCuts}>
        {open.map((t) => {
          const v = taskView(world, t);
          return (
            <button key={t.id} type="button" className="ui-chip" aria-pressed={picked.includes(t.id)} onClick={() => setPicked((xs) => (xs.includes(t.id) ? xs.filter((x) => x !== t.id) : [...xs, t.id]))} data-testid="batch-pick">
              {v?.cut ? cutOf(v.cut, group) : v ? ph(v.labelP) : null}
              {t.layer ? ` ${t.layer}` : ""}
            </button>
          );
        })}
      </div>
      <div className="row">
        <SelectField label={L.flex.toWhom} value={who} onChange={(e) => setWho(e.target.value)} data-testid="batch-who">
          <option value="">{L.flex.pickOne}</option>
          {members(world).map((m) => (
            <option key={m.id} value={m.id} data-uc="">
              {m.nickname}
            </option>
          ))}
        </SelectField>
        <Button
          Label={f(L.flex.batchGo, { n: picked.length })}
          Size="Small"
          Style="Accent"
          disabled={!picked.length || !who}
          data-testid="batch-go"
          onClick={() => {
            const r = dispatch("task.assign", { taskIds: picked, memberId: who }, { quiet: true });
            if (!r.ok) setError(err(r.error));
            else {
              notify(f(L.flex.batched, { n: picked.length, name: memberById(world, who)?.nickname ?? "" }));
              setPicked([]);
              setError(null);
            }
          }}
        />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}

/** 在这个环节上发一张新任务（管理员和这个环节的审核员）。 */
export function PublishForm({ stage, onDone }: { stage: StageRow; onDone?: () => void }) {
  const { world, me, dispatch, notify } = useGuild();
  const { L, f, err, stageName, unit: unitOf, cut: cutOf } = useI18n();
  const group = world.projects[stage.projectId]?.group ?? "animation";
  const files = useFiles();
  const [kind, setKind] = useState<ExtraKind>("fix");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cutIds, setCutIds] = useState<Id[]>([]);
  const [mode, setMode] = useState<"workload" | "points">("workload");
  const [workload, setWorkload] = useState("1");
  const [points, setPoints] = useState("3");
  const [hours, setHours] = useState("24");
  const [assignee, setAssignee] = useState("");
  const [reviewer, setReviewer] = useState(stage.reviewerId ?? "");
  const [blocking, setBlocking] = useState(false);
  const [fileIds, setFileIds] = useState<Id[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cuts = cutsOf(world, stage.projectId);
  const images = useMemo(() => libraryOf(world, stage.projectId).filter((v) => v.kind === "image").slice(0, 24), [world, stage.projectId]);
  if (!(isAdmin(me) || (isReviewer(me) && stage.reviewerId === me.id))) return null;
  const publish = async () => {
    const r = dispatch(
      "task.publish",
      {
        stageId: stage.id,
        kind,
        title,
        description: description || null,
        cutIds,
        workload: mode === "workload" ? Number(workload) : null,
        fixedPoints: mode === "points" ? Number(points) : null,
        deadlineHours: hours ? Number(hours) : null,
        assigneeId: assignee || null,
        reviewerId: reviewer || null,
        fileIds,
        blocking,
      },
      { quiet: true }
    );
    if (!r.ok) {
      setError(err(r.error));
      return;
    }
    if (newFiles.length) await files.addFiles(newFiles, { subjectType: "task", subjectId: r.created.taskId });
    const kindText = L.labels.extraKind[kind];
    notify(assignee ? f(L.flex.published, { kind: kindText, title, name: memberById(world, assignee)?.nickname ?? "" }) : f(L.flex.publishedOpen, { kind: kindText, title }));
    setTitle("");
    setDescription("");
    setCutIds([]);
    setFileIds([]);
    setNewFiles([]);
    setBlocking(false);
    setError(null);
    onDone?.();
  };
  return (
    <form
      className="stack flex-box"
      data-gap="small"
      data-testid="publish-form"
      onSubmit={(e) => {
        e.preventDefault();
        void publish();
      }}
    >
      <h3 className="t-body-14m">{f(L.flex.publishTitle, { stage: stageName(group, stage) })}</h3>
      <div className="chips" role="radiogroup" aria-label={L.flex.kind}>
        {EXTRA_KIND.map((k) => (
          <button key={k} type="button" className="ui-chip" aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`publish-kind-${k}`}>
            {L.labels.extraKind[k]}
          </button>
        ))}
      </div>
      <TextField label={L.flex.title} placeholder={kind === "fix" ? L.flex.titleFix : kind === "setting" ? L.flex.titleSetting : L.flex.titleExtra} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="publish-title" />
      <TextArea label={L.flex.description} placeholder={L.flex.descriptionPlaceholder} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="stack" data-gap="small">
        <span className="label">{L.flex.attachCuts}</span>
        <div className="chips" role="group" aria-label={L.flex.attachCuts}>
          {cuts.map((c) => (
            <button key={c.id} type="button" className="ui-chip" aria-pressed={cutIds.includes(c.id)} onClick={() => setCutIds((xs) => (xs.includes(c.id) ? xs.filter((x) => x !== c.id) : [...xs, c.id]))} data-testid="publish-cut">
              {cutOf(c, group)}
            </button>
          ))}
        </div>
      </div>
      <div className="chips" role="radiogroup" aria-label={L.flex.pointsMode}>
        <button type="button" className="ui-chip" aria-pressed={mode === "workload"} onClick={() => setMode("workload")}>
          {f(L.flex.byWorkload, { unit: unitOf(stage.unit, group, 2) })}
        </button>
        <button type="button" className="ui-chip" aria-pressed={mode === "points"} onClick={() => setMode("points")} data-testid="publish-mode-points">
          {L.flex.fixedPoints}
        </button>
      </div>
      <div className="form-grid">
        {mode === "workload" ? (
          <TextField label={f(L.flex.workload, { unit: unitOf(stage.unit, group, 2) })} type="number" step="0.5" min={0} value={workload} onChange={(e) => setWorkload(e.target.value)} data-testid="publish-workload" />
        ) : (
          <TextField label={L.flex.fixedPoints} type="number" step="0.5" min={0} value={points} onChange={(e) => setPoints(e.target.value)} data-testid="publish-points" />
        )}
        <TextField label={L.flex.hours} type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} data-testid="publish-hours" />
        <SelectField label={L.flex.assignTo} value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="publish-assignee">
          <option value="">{L.flex.openToClaim}</option>
          {members(world).map((m) => (
            <option key={m.id} value={m.id} data-uc="">
              {m.nickname}
            </option>
          ))}
        </SelectField>
        <SelectField label={L.flex.reviewer} value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
          <option value="">{L.flex.anyReviewer}</option>
          {members(world)
            .filter((m) => isReviewer(m))
            .map((m) => (
              <option key={m.id} value={m.id} data-uc="">
                {m.nickname}
                {m.id === stage.reviewerId ? L.flex.stageReviewer : ""}
              </option>
            ))}
        </SelectField>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} data-testid="publish-blocking" />
        <span>{L.flex.blocking}</span>
      </label>
      <div className="stack" data-gap="small">
        <span className="label">{L.flex.attachImages}</span>
        {images.length ? (
          <div className="pick-grid">
            {images.map((v) => (
              <button key={v.file.id} type="button" className="pick-tile" aria-pressed={fileIds.includes(v.file.id)} onClick={() => setFileIds((xs) => (xs.includes(v.file.id) ? xs.filter((x) => x !== v.file.id) : [...xs, v.file.id]))}>
                <FileImage file={v.file} className="pick-img" />
                <span className="label break">
                  <U>{v.file.name}</U>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <DropZone testId="publish-drop" paste={false} onFiles={(fs) => setNewFiles((xs) => [...xs, ...fs])} />
        {newFiles.length ? <span className="label">{f(L.flex.newFiles, { n: newFiles.length })}</span> : null}
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={L.flex.publishGo} Size="Small" Style="Accent" type="submit" data-testid="publish-go" />
      </div>
    </form>
  );
}

/** 这个环节上发过的额外 / 修正 / 补设定任务。 */
export function ExtrasList({ stage }: { stage: StageRow }) {
  const { world } = useGuild();
  const { L } = useI18n();
  const list = extrasOfStage(world, stage.id);
  if (!list.length) return null;
  return (
    <div className="stack" data-gap="small" data-testid="extras-list">
      <h3 className="t-body-14m">
        {L.flex.extrasTitle} <span className="count">{list.length}</span>
      </h3>
      <ul className="list">
        {list.map((t) => (
          <ExtraItem key={t.id} task={t} />
        ))}
      </ul>
    </div>
  );
}

function ExtraItem({ task }: { task: TaskRow }) {
  const { world } = useGuild();
  const { L, f, ph, cut: cutOf } = useI18n();
  const v = taskView(world, task);
  if (!v || !task.extra) return null;
  const cuts = task.extra.cutIds.map((id) => world.cuts[id]).filter(Boolean);
  return (
    <li style={{ flexDirection: "column", alignItems: "stretch" }} data-testid="extra-item">
      <div className="row">
        <Tag tone={task.extra.kind === "fix" ? "danger" : task.extra.kind === "setting" ? "lilac" : "sky"}>{L.labels.extraKind[task.extra.kind]}</Tag>
        <span className="t-body-14m break">
          <U>{task.extra.title}</U>
        </span>
        <StatusPill Status={task.status} />
        {task.extra.blocking ? <Tag tone="warning">{L.flex.waitsTag}</Tag> : null}
      </div>
      <span className="label break">
        {cuts.length ? cuts.map((c) => cutOf(c, v.project.group)).join(L.common.listSep) : L.flex.noCut} · {task.extra.fixedPoints !== null ? f(L.flex.fixedN, { n: task.extra.fixedPoints }) : ph(v.workloadP)} ·{" "}
        {task.assigneeId ? <MemberLink member={v.assignee} /> : L.flex.waitingClaim}
      </span>
      {task.extra.description ? (
        <span className="label break">
          <U>{task.extra.description}</U>
        </span>
      ) : null}
      <TaskActions task={task} />
    </li>
  );
}

/** 项目排期（照工会的「项目规划表」）：一行一个环节，按 前期 / 中期 / 后期 分组；横轴是周。 */
export function ScheduleView({ projectId }: { projectId: Id }) {
  const { world, me } = useGuild();
  const { L, f, date } = useI18n();
  const sched = scheduleOf(world, projectId);
  const [editing, setEditing] = useState<Id | null>(null);
  if (!sched) return null;
  const admin = isAdmin(me);
  const cols = Array.from({ length: sched.weeks }, (_, i) => i + 1);
  return (
    <div className="stack" data-gap="small">
      <div className="legend" aria-label={L.flex.legend}>
        <span className="legend-item">
          <span className="gantt-swatch" data-kind="plan" /> {L.flex.plan}
        </span>
        <span className="legend-item">
          <span className="gantt-swatch" data-kind="actual" /> {L.flex.actual}
        </span>
        <span className="legend-item">
          <span className="gantt-swatch" data-kind="over" /> {L.flex.over}
        </span>
        <span className="legend-item">
          <span className="gantt-swatch" data-kind="today" /> {L.flex.thisWeek}
        </span>
        <span className="label">{f(L.flex.weekIs, { n: sched.cycleDays, date: date(sched.project.startOn) })}</span>
      </div>
      <div className="gantt-scroll" data-testid="schedule">
        <table className="gantt" style={{ ["--weeks" as string]: sched.weeks }}>
          <thead>
            <tr>
              <th scope="col" className="gantt-name">
                {L.flex.stage}
              </th>
              {cols.map((w) => (
                <th key={w} scope="col" data-today={w === sched.today ? "yes" : "no"} title={date(sched.weekStarts[w - 1])}>
                  <span className="num">{w}</span>
                </th>
              ))}
              <th scope="col" className="gantt-pct">
                {L.flex.done}
              </th>
            </tr>
          </thead>
          {sched.phases.map((ph) => (
            <tbody key={ph.phase}>
              <tr className="gantt-phase">
                <th scope="rowgroup" colSpan={sched.weeks + 2}>
                  {L.labels.phase[ph.phase]}
                </th>
              </tr>
              {ph.rows.map((r) => (
                <GanttRow key={r.stage.id} row={r} group={sched.project.group} cols={cols} today={sched.today} admin={admin} editing={editing === r.stage.id} onEdit={() => setEditing(editing === r.stage.id ? null : r.stage.id)} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {editing && admin ? <PeriodEditor stage={world.stages[editing]} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function GanttRow({ row, group, cols, today, admin, editing, onEdit }: { row: ScheduleRow; group: Group; cols: number[]; today: number; admin: boolean; editing: boolean; onEdit: () => void }) {
  const { dispatch } = useGuild();
  const { L, f, ph, pt, stageName } = useI18n();
  const name = stageName(group, row.stage);
  const [drag, setDrag] = useState<{ from: number; shift: number } | null>(null);
  const plan = { start: row.plan.start + (drag?.shift ?? 0), end: row.plan.end + (drag?.shift ?? 0) };
  const commit = () => {
    if (!drag) return;
    const shift = drag.shift;
    setDrag(null);
    if (shift) dispatch("stage.set_period", { stageId: row.stage.id, startWeek: Math.max(1, row.plan.start + shift), weeks: row.plan.end - row.plan.start + 1 });
  };
  return (
    <tr data-testid="schedule-row" data-stage={row.stage.templateKey} data-dragging={drag ? "yes" : "no"} onPointerUp={commit} onPointerLeave={commit}>
      <th scope="row" className="gantt-name">
        <button type="button" className="inline-link" onClick={admin ? onEdit : undefined} disabled={!admin} aria-expanded={admin ? editing : undefined} title={admin ? L.flex.editPeriod : undefined}>
          {shortStageName(name)}
        </button>
        {row.overrun ? (
          <span className="gantt-over-text" data-testid="schedule-overrun">
            {f(L.flex.overrun, { n: row.overrun })}
          </span>
        ) : null}
        {row.warningP ? (
          <span className="gantt-warn" title={pt(row.warningP)} data-testid="schedule-warning">
            {ph(row.warningP)}
          </span>
        ) : null}
      </th>
      {cols.map((w) => {
        const inPlan = w >= plan.start && w <= plan.end;
        const inActual = !!row.actual && w >= row.actual.start && w <= row.actual.end;
        const over = inActual && w > row.plan.end;
        return (
          <td
            key={w}
            data-today={w === today ? "yes" : "no"}
            data-plan={inPlan ? "yes" : "no"}
            onPointerDown={admin && inPlan ? (e) => {
              e.preventDefault();
              setDrag({ from: w, shift: 0 });
            } : undefined}
            onPointerEnter={drag ? () => setDrag({ ...drag, shift: w - drag.from }) : undefined}
          >
            <span className="gantt-cell">
              {inPlan ? <span className="gantt-bar" data-kind="plan" data-testid="gantt-plan" /> : null}
              {inActual ? <span className="gantt-bar" data-kind={over ? "over" : "actual"} data-testid={over ? "gantt-over" : "gantt-actual"} /> : null}
            </span>
          </td>
        );
      })}
      <td className="gantt-pct num">{Math.round(row.progress * 100)}%</td>
    </tr>
  );
}

function PeriodEditor({ stage, onClose }: { stage: StageRow; onClose: () => void }) {
  const { world } = useGuild();
  const { L, f, stageName } = useI18n();
  return (
    <div className="card" data-tone="muted">
      <div className="row" data-justify="between">
        <h3 className="t-body-14m">{f(L.flex.periodTitle, { stage: stageName(world.projects[stage.projectId]?.group ?? "animation", stage) })}</h3>
        <Button Label={L.flex.collapse} Size="Small" Style="Ghost" onClick={onClose} />
      </div>
      <StageSettings stage={stage} />
    </div>
  );
}
