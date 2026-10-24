/** 一张任务能做的事（看你是谁）：接这张 · 交 · 放弃 · 去审核 · 管理员收回 / 重新放出 / 指派（含外包）。 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { StatusPill } from "@/components/ui/StatusPill";
import { isAdmin } from "@/domain/commands/core";
import { U, useI18n } from "@/i18n/I18n";
import type { TaskRow } from "@/domain/model";
import { canReview, members, questOf, reviewsOf, submissionsOf, taskView, type TaskView } from "@/domain/queries";
import { Link } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { MemberLink, SelectField, TextField } from "./bits";
import { ReleaseDialog, SubmitDialog } from "./quest";
import { LinkList } from "./links";

export function TaskActions({ task, size = "Small" }: { task: TaskRow; size?: "Small" | "Medium" }) {
  const { world, me, dispatch, notify } = useGuild();
  const { L, f, pt } = useI18n();
  const [dialog, setDialog] = useState<"submit" | "release" | "assign" | null>(null);
  const view = taskView(world, task);
  if (!view) return null;
  const mine = task.assigneeId === me.id;
  const admin = isAdmin(me);
  const inHand = task.status === "claimed" || task.status === "returned";
  const review = task.status === "submitted" ? canReview(world, me.id, task) : null;
  const quest = dialog === "submit" ? questOf(world, task, task.assigneeId) : null;
  const run = (ok: boolean, text: string) => ok && notify(text, "Neutral");
  const label = pt(view.labelP);
  return (
    <div className="form-actions">
      {task.status === "open" ? (
        <Button
          Label={L.task.claim}
          Size={size}
          Style="Accent"
          onClick={() => {
            const r = dispatch("task.claim", { taskId: task.id });
            run(r.ok, f(L.task.claimed, { label }));
          }}
        />
      ) : null}
      {inHand && (mine || admin) ? <Button Label={mine ? L.task.submit : L.task.submitFor} Size={size} Style={mine ? "Accent" : "Secondary"} onClick={() => setDialog("submit")} /> : null}
      {inHand && (mine || admin) ? <Button Label={mine ? L.task.release : L.task.reclaimToAll} Size={size} Style="Secondary" onClick={() => setDialog("release")} /> : null}
      {review?.ok ? (
        <Link to={`/review?task=${task.id}`} className="ui-button" data-style="Accent" data-size={size}>
          {L.task.goReview}
        </Link>
      ) : null}
      {admin && (task.status === "open" || task.status === "reclaimed") ? <Button Label={L.task.assign} Size={size} Style="Secondary" onClick={() => setDialog("assign")} /> : null}
      {admin && task.status === "reclaimed" ? (
        <Button
          Label={L.task.reopen}
          Size={size}
          Style="Ghost"
          onClick={() => {
            const r = dispatch("task.reopen", { taskId: task.id });
            run(r.ok, f(L.task.reopened, { label }));
          }}
        />
      ) : null}
      {admin && task.status !== "passed" && task.status !== "locked" && task.status !== "reclaimed" ? (
        <Button
          Label={L.task.reclaim}
          Size={size}
          Style="Ghost"
          onClick={() => {
            const r = dispatch("task.reclaim", { taskId: task.id });
            run(r.ok, f(L.task.reclaimed, { label }));
          }}
        />
      ) : null}
      {quest ? <SubmitDialog quest={quest} onClose={() => setDialog(null)} /> : null}
      {dialog === "release" ? <ReleaseDialog taskId={task.id} label={label} onClose={() => setDialog(null)} /> : null}
      {dialog === "assign" ? <AssignDialog view={view} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

export function AssignDialog({ view, onClose }: { view: TaskView; onClose: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, pt, err } = useI18n();
  const [who, setWho] = useState<string>("");
  const [outsourceName, setOutsourceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const r =
      who === "outsource"
        ? dispatch("task.assign", { taskId: view.task.id, outsourceName }, { quiet: true })
        : dispatch("task.assign", { taskId: view.task.id, memberId: who || null }, { quiet: true });
    if (!r.ok) {
      setError(err(r.error));
      return;
    }
    notify(f(L.task.assigned, { label: pt(view.labelP) }), "Neutral");
    onClose();
  };
  return (
    <Drawer
      Type="Dialog"
      Title={f(L.task.assignTitle, { label: pt(view.labelP) })}
      Body={L.task.assignBody}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.task.cancel} Style="Secondary" onClick={onClose} />
          <Button Label={L.task.assign} Style="Accent" onClick={save} />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <SelectField label={L.task.toWhom} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{L.task.pickOne}</option>
          {members(world).map((m) => (
            <option key={m.id} value={m.id} data-uc="">
              {m.nickname}
            </option>
          ))}
          <option value="outsource">{L.task.outsourceOpt}</option>
        </SelectField>
        {who === "outsource" ? <TextField label={L.task.outsourceName} value={outsourceName} onChange={(e) => setOutsourceName(e.target.value)} maxLength={24} /> : null}
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </Drawer>
  );
}

/** 一张任务的小面板（项目级的任务点开看这个）。 */
export function TaskDrawer({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const { world } = useGuild();
  const { L, f, r: rich, ph, pt, dateTime } = useI18n();
  const view = taskView(world, task);
  if (!view) return null;
  const subs = submissionsOf(world, task.id);
  const reviews = reviewsOf(world, task.id);
  return (
    <Drawer Type="Drawer" Title={pt(view.labelP)} open onClose={onClose} actions={<Button Label={L.task.close} Style="Secondary" onClick={onClose} />}>
      <div className="stack" data-gap="small" style={{ overflowY: "auto" }}>
        <div className="row">
          <StatusPill Status={task.status} />
          <span className="label">
            <U>{view.project.name}</U>
          </span>
        </div>
        <dl className="stack" data-gap="small" style={{ margin: 0 }}>
          <div className="row">
            <dt className="label">{L.task.who}</dt>
            <dd style={{ margin: 0 }}>{task.outsourced ? rich(L.task.outsourced, { name: <U>{task.outsourceName ?? ""}</U> }) : <MemberLink member={view.assignee} fallback={L.task.nobodyYet} />}</dd>
          </div>
          <div className="row">
            <dt className="label">{L.task.workload}</dt>
            <dd style={{ margin: 0 }}>{ph(view.workloadP)}</dd>
          </div>
          {task.dueAt && task.status !== "passed" ? (
            <div className="row">
              <dt className="label">{L.task.due}</dt>
              <dd style={{ margin: 0 }}>{dateTime(task.dueAt)}</dd>
            </div>
          ) : null}
        </dl>
        {task.extra ? (
          <div className="stack" data-gap="small">
            <span className="label">
              {task.extra.blocking ? L.task.blocks : L.task.noBlock}
              {task.extra.fixedPoints !== null ? f(L.task.fixedPoints, { n: task.extra.fixedPoints }) : ph(view.workloadP)}
              {f(L.task.deadlineHours, { n: task.extra.deadlineHours })}
            </span>
            {task.extra.description ? (
              <p className="break">
                <U>{task.extra.description}</U>
              </p>
            ) : null}
            {task.extra.fileIds.length ? <span className="label">{f(L.task.attachedImages, { n: task.extra.fileIds.length })}</span> : null}
          </div>
        ) : null}
        <TaskActions task={task} />
        <h3 className="t-body-14m">{L.task.versions}</h3>
        {subs.length === 0 ? (
          <p className="muted">{f(L.task.noVersions, { status: L.labels.taskStatus[task.status] })}</p>
        ) : (
          <ul className="list">
            {[...subs].reverse().map((s) => {
              const r = reviews.find((x) => x.submissionId === s.id);
              return (
                <li key={s.id}>
                  <div className="list-main">
                    <span className="t-body-14m">
                      v{String(s.versionNo).padStart(2, "0")} · <MemberLink member={world.members[s.byMemberId ?? ""]} fallback={L.task.outsourcer} />
                    </span>
                    <span className="label break">
                      <U>{s.fileName}</U>
                    </span>
                    <LinkList submission={s} compact />
                    {s.note ? (
                      <span className="label break">
                        <U>{s.note}</U>
                      </span>
                    ) : null}
                    {r ? (
                      <span className="label">
                        {L.labels.verdict[r.verdict]}
                        {r.quality !== null ? f(L.task.quality, { q: r.quality.toFixed(1) }) : ""}
                      </span>
                    ) : null}
                  </div>
                  <span className="list-meta">{dateTime(s.at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
