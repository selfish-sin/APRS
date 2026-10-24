/**
 * 灵活性（SPEC §13）的界面：环节设置（只给指派的人 · 计划周期 · 时限参数）· 发新任务 · 这个环节的额外任务 ·
 * 一批派给某人 · 项目排期（按周的甘特图）。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { isAdmin, isReviewer } from "@/domain/commands/core";
import { dateZh } from "@/domain/clock";
import { PHASE_LABEL, UNIT_LABEL } from "@/domain/labels";
import { EXTRA_KIND, type ExtraKind, type Id, type StageRow, type TaskRow } from "@/domain/model";
import { EXTRA_KIND_LABEL } from "@/domain/naming";
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
  const sched = scheduleOf(world, stage.projectId);
  const row = sched?.phases.flatMap((p) => p.rows).find((r) => r.stage.id === stage.id);
  const [startWeek, setStartWeek] = useState(String(row?.plan.start ?? 1));
  const [weeks, setWeeks] = useState(String(row ? row.plan.end - row.plan.start + 1 : 1));
  const [tn, setTn] = useState(String(stage.tn));
  const [factor, setFactor] = useState(stage.deadlineFactor ? String(stage.deadlineFactor) : "");
  const [minHours, setMinHours] = useState(stage.minDeadlineHours ? String(stage.minDeadlineHours) : "");
  const [error, setError] = useState<string | null>(null);
  const locked = stageLocked(stage);
  const unit = UNIT_LABEL[stage.unit];
  return (
    <div className="stack flex-box" data-gap="small" data-testid="stage-settings">
      <h3 className="t-body-14m">环节设置</h3>
      <label className="check-row">
        <input
          type="checkbox"
          checked={locked}
          data-testid="stage-lock"
          onChange={(e) => {
            const r = dispatch("stage.set_lock", { stageId: stage.id, locked: e.target.checked }, { quiet: true });
            if (r.ok) notify(e.target.checked ? `「${stage.name}」只给指派的人` : `「${stage.name}」谁都能认领`, "Neutral");
          }}
        />
        <span>只给指派的人（没被指派的人看得到，但不能认领）</span>
      </label>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const r = dispatch("stage.set_period", { stageId: stage.id, startWeek: Number(startWeek), weeks: Number(weeks) }, { quiet: true });
          if (!r.ok) setError(r.error.message);
          else {
            setError(null);
            notify("计划周期改好了", "Neutral");
          }
        }}
      >
        <TextField label={`计划从第几周开始（一周 = ${sched?.cycleDays ?? 7} 天）`} type="number" min={1} value={startWeek} onChange={(e) => setStartWeek(e.target.value)} data-testid="period-start" />
        <TextField label="工期（几周）" type="number" min={1} value={weeks} onChange={(e) => setWeeks(e.target.value)} data-testid="period-weeks" />
        <div className="form-actions">
          <Button Label="存计划周期" Size="Small" Style="Secondary" type="submit" data-testid="period-save" />
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
          if (!r.ok) setError(r.error.message);
          else {
            setError(null);
            notify("时限参数改好了（只影响之后派出的任务）", "Neutral");
          }
        }}
      >
        <TextField label={`Tn（每 ${stage.per} ${unit}几小时）`} type="number" step="0.1" min={0} value={tn} onChange={(e) => setTn(e.target.value)} data-testid="rate-tn" />
        <TextField label="时限系数" type="number" step="0.1" placeholder="1.5" value={factor} onChange={(e) => setFactor(e.target.value)} />
        <TextField label="最短时限（小时）" type="number" placeholder="4" value={minHours} onChange={(e) => setMinHours(e.target.value)} />
        <div className="form-actions">
          <Button Label="存时限参数" Size="Small" Style="Secondary" type="submit" data-testid="rate-save" />
        </div>
      </form>
      <p className="label">改了只影响之后派出的任务；已经派出的任务用「延期」改。</p>
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
  const open = tasksOf(world, stage.projectId).filter((t) => t.stageId === stage.id && (t.status === "open" || t.status === "reclaimed"));
  const [picked, setPicked] = useState<Id[]>([]);
  const [who, setWho] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open.length) return null;
  return (
    <div className="stack flex-box" data-gap="small" data-testid="batch-assign">
      <h3 className="t-body-14m">直接派给某人</h3>
      <div className="chips" role="group" aria-label="选几卡">
        {open.map((t) => {
          const v = taskView(world, t);
          return (
            <button key={t.id} type="button" className="ui-chip" aria-pressed={picked.includes(t.id)} onClick={() => setPicked((xs) => (xs.includes(t.id) ? xs.filter((x) => x !== t.id) : [...xs, t.id]))} data-testid="batch-pick">
              {v?.cut ? cutName(world, v.cut) : v?.label}
              {t.layer ? ` ${t.layer}` : ""}
            </button>
          );
        })}
      </div>
      <div className="row">
        <SelectField label="派给谁" value={who} onChange={(e) => setWho(e.target.value)} data-testid="batch-who">
          <option value="">选一个</option>
          {members(world).map((m) => (
            <option key={m.id} value={m.id}>
              {m.nickname}
            </option>
          ))}
        </SelectField>
        <Button
          Label={`派 ${picked.length} 张`}
          Size="Small"
          Style="Accent"
          disabled={!picked.length || !who}
          data-testid="batch-go"
          onClick={() => {
            const r = dispatch("task.assign", { taskIds: picked, memberId: who }, { quiet: true });
            if (!r.ok) setError(r.error.message);
            else {
              notify(`派了 ${picked.length} 张给 ${memberById(world, who)?.nickname ?? ""}`);
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
      setError(r.error.message);
      return;
    }
    if (newFiles.length) await files.addFiles(newFiles, { subjectType: "task", subjectId: r.created.taskId });
    notify(`发了一张${EXTRA_KIND_LABEL[kind]}：${title}${assignee ? `，派给 ${memberById(world, assignee)?.nickname ?? ""}` : "，等人认领"}`);
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
      <h3 className="t-body-14m">在「{stage.name}」发新任务</h3>
      <div className="chips" role="radiogroup" aria-label="种类">
        {EXTRA_KIND.map((k) => (
          <button key={k} type="button" className="ui-chip" aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`publish-kind-${k}`}>
            {EXTRA_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <TextField label="标题" placeholder={kind === "fix" ? "C003 分镜加一个镜头" : kind === "setting" ? "照拍板补耳饰" : "补一张道具设定"} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="publish-title" />
      <TextArea label="说明" placeholder="要做什么、照哪个拍板、参考哪张图" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="stack" data-gap="small">
        <span className="label">挂哪几卡（可以不挂）</span>
        <div className="chips" role="group" aria-label="挂哪几卡">
          {cuts.map((c) => (
            <button key={c.id} type="button" className="ui-chip" aria-pressed={cutIds.includes(c.id)} onClick={() => setCutIds((xs) => (xs.includes(c.id) ? xs.filter((x) => x !== c.id) : [...xs, c.id]))} data-testid="publish-cut">
              {cutName(world, c)}
            </button>
          ))}
        </div>
      </div>
      <div className="chips" role="radiogroup" aria-label="怎么算活力点">
        <button type="button" className="ui-chip" aria-pressed={mode === "workload"} onClick={() => setMode("workload")}>
          按工作量（{UNIT_LABEL[stage.unit]}）
        </button>
        <button type="button" className="ui-chip" aria-pressed={mode === "points"} onClick={() => setMode("points")} data-testid="publish-mode-points">
          固定活力点
        </button>
      </div>
      <div className="form-grid">
        {mode === "workload" ? (
          <TextField label={`工作量（${UNIT_LABEL[stage.unit]}）`} type="number" step="0.5" min={0} value={workload} onChange={(e) => setWorkload(e.target.value)} data-testid="publish-workload" />
        ) : (
          <TextField label="固定活力点" type="number" step="0.5" min={0} value={points} onChange={(e) => setPoints(e.target.value)} data-testid="publish-points" />
        )}
        <TextField label="时限（小时，从接的时候算）" type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} data-testid="publish-hours" />
        <SelectField label="派给谁" value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="publish-assignee">
          <option value="">放出来让人认领</option>
          {members(world).map((m) => (
            <option key={m.id} value={m.id}>
              {m.nickname}
            </option>
          ))}
        </SelectField>
        <SelectField label="谁审" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
          <option value="">审核员和管理员谁都能审</option>
          {members(world)
            .filter((m) => isReviewer(m))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}
                {m.id === stage.reviewerId ? "（这个环节的审核员）" : ""}
              </option>
            ))}
        </SelectField>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} data-testid="publish-blocking" />
        <span>这一卡要等它做完（挂着的卡的下游等它通过；不勾就不挡流程）</span>
      </label>
      <div className="stack" data-gap="small">
        <span className="label">附图：资料库里选，或者直接拖进来 / 粘贴</span>
        {images.length ? (
          <div className="pick-grid">
            {images.map((v) => (
              <button key={v.file.id} type="button" className="pick-tile" aria-pressed={fileIds.includes(v.file.id)} onClick={() => setFileIds((xs) => (xs.includes(v.file.id) ? xs.filter((x) => x !== v.file.id) : [...xs, v.file.id]))}>
                <FileImage file={v.file} className="pick-img" />
                <span className="label break">{v.file.name}</span>
              </button>
            ))}
          </div>
        ) : null}
        <DropZone testId="publish-drop" paste={false} onFiles={(f) => setNewFiles((xs) => [...xs, ...f])} />
        {newFiles.length ? <span className="label">还要附 {newFiles.length} 个新文件（发出去以后放进资料库）</span> : null}
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label="发出去" Size="Small" Style="Accent" type="submit" data-testid="publish-go" />
      </div>
    </form>
  );
}

/** 这个环节上发过的额外 / 修正 / 补设定任务。 */
export function ExtrasList({ stage }: { stage: StageRow }) {
  const { world } = useGuild();
  const list = extrasOfStage(world, stage.id);
  if (!list.length) return null;
  return (
    <div className="stack" data-gap="small" data-testid="extras-list">
      <h3 className="t-body-14m">
        这个环节的额外任务 <span className="count">{list.length}</span>
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
  const v = taskView(world, task);
  if (!v || !task.extra) return null;
  const cuts = task.extra.cutIds.map((id) => world.cuts[id]).filter(Boolean);
  return (
    <li style={{ flexDirection: "column", alignItems: "stretch" }} data-testid="extra-item">
      <div className="row">
        <Tag tone={task.extra.kind === "fix" ? "danger" : task.extra.kind === "setting" ? "lilac" : "sky"}>{EXTRA_KIND_LABEL[task.extra.kind]}</Tag>
        <span className="t-body-14m break">{task.extra.title}</span>
        <StatusPill Status={task.status} />
        {task.extra.blocking ? <Tag tone="warning">这一卡要等它</Tag> : null}
      </div>
      <span className="label break">
        {cuts.length ? cuts.map((c) => cutName(world, c)).join("、") : "不挂卡"} · {task.extra.fixedPoints !== null ? `固定 ${task.extra.fixedPoints} 活力点` : v.workloadLabel} ·{" "}
        {task.assigneeId ? <MemberLink member={v.assignee} /> : "等人认领"}
      </span>
      {task.extra.description ? <span className="label break">{task.extra.description}</span> : null}
      <TaskActions task={task} />
    </li>
  );
}

/** 项目排期（照工会的「项目规划表」）：一行一个环节，按 前期 / 中期 / 后期 分组；横轴是周。 */
export function ScheduleView({ projectId }: { projectId: Id }) {
  const { world, me } = useGuild();
  const sched = scheduleOf(world, projectId);
  const [editing, setEditing] = useState<Id | null>(null);
  if (!sched) return null;
  const admin = isAdmin(me);
  const cols = Array.from({ length: sched.weeks }, (_, i) => i + 1);
  return (
    <div className="stack" data-gap="small">
      <div className="legend" aria-label="排期图例">
        <span className="legend-item">
          <span className="gantt-swatch" data-kind="plan" /> 计划
        </span>
        <span className="legend-item">
          <span className="gantt-swatch" data-kind="actual" /> 实际
        </span>
        <span className="legend-item">
          <span className="gantt-swatch" data-kind="over" /> 超出计划
        </span>
        <span className="legend-item">
          <span className="gantt-swatch" data-kind="today" /> 这一周
        </span>
        <span className="label">一周 = {sched.cycleDays} 天 · 从 {dateZh(sched.project.startOn)} 起</span>
      </div>
      <div className="gantt-scroll" data-testid="schedule">
        <table className="gantt" style={{ ["--weeks" as string]: sched.weeks }}>
          <thead>
            <tr>
              <th scope="col" className="gantt-name">
                环节
              </th>
              {cols.map((w) => (
                <th key={w} scope="col" data-today={w === sched.today ? "yes" : "no"} title={dateZh(sched.weekStarts[w - 1])}>
                  <span className="num">{w}</span>
                </th>
              ))}
              <th scope="col" className="gantt-pct">
                完成
              </th>
            </tr>
          </thead>
          {sched.phases.map((ph) => (
            <tbody key={ph.phase}>
              <tr className="gantt-phase">
                <th scope="rowgroup" colSpan={sched.weeks + 2}>
                  {PHASE_LABEL[ph.phase]}
                </th>
              </tr>
              {ph.rows.map((r) => (
                <GanttRow key={r.stage.id} row={r} cols={cols} today={sched.today} admin={admin} editing={editing === r.stage.id} onEdit={() => setEditing(editing === r.stage.id ? null : r.stage.id)} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {editing && admin ? <PeriodEditor stage={world.stages[editing]} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function GanttRow({ row, cols, today, admin, editing, onEdit }: { row: ScheduleRow; cols: number[]; today: number; admin: boolean; editing: boolean; onEdit: () => void }) {
  const { dispatch } = useGuild();
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
        <button type="button" className="inline-link" onClick={admin ? onEdit : undefined} disabled={!admin} aria-expanded={admin ? editing : undefined} title={admin ? "改计划周期" : undefined}>
          {row.stage.name.replace(/（.*?）/, "")}
        </button>
        {row.overrun ? (
          <span className="gantt-over-text" data-testid="schedule-overrun">
            超出 {row.overrun} 周
          </span>
        ) : null}
        {row.warning ? (
          <span className="gantt-warn" title={row.warning} data-testid="schedule-warning">
            {row.warning}
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
  return (
    <div className="card" data-tone="muted">
      <div className="row" data-justify="between">
        <h3 className="t-body-14m">「{stage.name}」的计划周期和时限参数</h3>
        <Button Label="收起" Size="Small" Style="Ghost" onClick={onClose} />
      </div>
      <StageSettings stage={stage} />
    </div>
  );
}
