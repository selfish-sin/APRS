/** 一张任务能做的事（看你是谁）：接这张 · 交 · 放弃 · 去审核 · 管理员收回 / 重新放出 / 指派（含外包）。 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { StatusPill } from "@/components/ui/StatusPill";
import { dateTimeZh } from "@/domain/clock";
import { isAdmin } from "@/domain/commands/core";
import { TASK_STATUS_LABEL, VERDICT_LABEL } from "@/domain/labels";
import type { TaskRow } from "@/domain/model";
import { canReview, members, questOf, reviewsOf, submissionsOf, taskView, type TaskView } from "@/domain/queries";
import { Link } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { MemberLink, SelectField, TextField } from "./bits";
import { ReleaseDialog, SubmitDialog } from "./quest";
import { LinkList } from "./links";

export function TaskActions({ task, size = "Small" }: { task: TaskRow; size?: "Small" | "Medium" }) {
  const { world, me, dispatch, notify } = useGuild();
  const [dialog, setDialog] = useState<"submit" | "release" | "assign" | null>(null);
  const view = taskView(world, task);
  if (!view) return null;
  const mine = task.assigneeId === me.id;
  const admin = isAdmin(me);
  const inHand = task.status === "claimed" || task.status === "returned";
  const review = task.status === "submitted" ? canReview(world, me.id, task) : null;
  const quest = dialog === "submit" ? questOf(world, task, task.assigneeId) : null;
  const run = (ok: boolean, text: string) => ok && notify(text, "Neutral");
  return (
    <div className="form-actions">
      {task.status === "open" ? (
        <Button
          Label="认领"
          Size={size}
          Style="Accent"
          onClick={() => {
            const r = dispatch("task.claim", { taskId: task.id });
            run(r.ok, `接了 ${view.label}，去大厅看任务单`);
          }}
        />
      ) : null}
      {inHand && (mine || admin) ? <Button Label={mine ? "交" : "代交"} Size={size} Style={mine ? "Accent" : "Secondary"} onClick={() => setDialog("submit")} /> : null}
      {inHand && (mine || admin) ? <Button Label={mine ? "放弃" : "收回给大家"} Size={size} Style="Secondary" onClick={() => setDialog("release")} /> : null}
      {review?.ok ? (
        <Link to={`/review?task=${task.id}`} className="ui-button" data-style="Accent" data-size={size}>
          去审核
        </Link>
      ) : null}
      {admin && (task.status === "open" || task.status === "reclaimed") ? <Button Label="指派" Size={size} Style="Secondary" onClick={() => setDialog("assign")} /> : null}
      {admin && task.status === "reclaimed" ? (
        <Button
          Label="重新放出"
          Size={size}
          Style="Ghost"
          onClick={() => {
            const r = dispatch("task.reopen", { taskId: task.id });
            run(r.ok, `${view.label} 重新放出来了`);
          }}
        />
      ) : null}
      {admin && task.status !== "passed" && task.status !== "locked" && task.status !== "reclaimed" ? (
        <Button
          Label="收回"
          Size={size}
          Style="Ghost"
          onClick={() => {
            const r = dispatch("task.reclaim", { taskId: task.id });
            run(r.ok, `${view.label} 收回了，谁都不能接，直到重新放出或指派`);
          }}
        />
      ) : null}
      {quest ? <SubmitDialog quest={quest} onClose={() => setDialog(null)} /> : null}
      {dialog === "release" ? <ReleaseDialog taskId={task.id} label={view.label} onClose={() => setDialog(null)} /> : null}
      {dialog === "assign" ? <AssignDialog view={view} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

export function AssignDialog({ view, onClose }: { view: TaskView; onClose: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const [who, setWho] = useState<string>("");
  const [outsourceName, setOutsourceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const r =
      who === "outsource"
        ? dispatch("task.assign", { taskId: view.task.id, outsourceName }, { quiet: true })
        : dispatch("task.assign", { taskId: view.task.id, memberId: who || null }, { quiet: true });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    notify(`${view.label} 指派好了`, "Neutral");
    onClose();
  };
  return (
    <Drawer
      Type="Dialog"
      Title={`指派 ${view.label}`}
      Body="指派给成员 = 替他接下这张；外包 = 交的人不在工会里，由管理员代交，不记活力点。"
      open
      onClose={onClose}
      actions={
        <>
          <Button Label="取消" Style="Secondary" onClick={onClose} />
          <Button Label="指派" Style="Accent" onClick={save} />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <SelectField label="给谁" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">选一个</option>
          {members(world).map((m) => (
            <option key={m.id} value={m.id}>
              {m.nickname}
            </option>
          ))}
          <option value="outsource">外包（不在工会里的人）</option>
        </SelectField>
        {who === "outsource" ? <TextField label="外包的名字" value={outsourceName} onChange={(e) => setOutsourceName(e.target.value)} maxLength={24} /> : null}
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </Drawer>
  );
}

/** 一张任务的小面板（项目级的任务点开看这个）。 */
export function TaskDrawer({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const { world } = useGuild();
  const view = taskView(world, task);
  if (!view) return null;
  const subs = submissionsOf(world, task.id);
  const reviews = reviewsOf(world, task.id);
  return (
    <Drawer Type="Drawer" Title={view.label} open onClose={onClose} actions={<Button Label="关上" Style="Secondary" onClick={onClose} />}>
      <div className="stack" data-gap="small" style={{ overflowY: "auto" }}>
        <div className="row">
          <StatusPill Status={task.status} />
          <span className="label">{view.project.name}</span>
        </div>
        <dl className="stack" data-gap="small" style={{ margin: 0 }}>
          <div className="row">
            <dt className="label">谁在做</dt>
            <dd style={{ margin: 0 }}>{task.outsourced ? `外包（${task.outsourceName ?? ""}）` : <MemberLink member={view.assignee} fallback="还没人接" />}</dd>
          </div>
          <div className="row">
            <dt className="label">工作量</dt>
            <dd style={{ margin: 0 }}>{view.workloadLabel}</dd>
          </div>
          {task.dueAt && task.status !== "passed" ? (
            <div className="row">
              <dt className="label">时限</dt>
              <dd style={{ margin: 0 }}>{dateTimeZh(task.dueAt)}</dd>
            </div>
          ) : null}
        </dl>
        {task.extra ? (
          <div className="stack" data-gap="small">
            <span className="label">
              {task.extra.blocking ? "这一卡要等它做完 · " : "不挡流程 · "}
              {task.extra.fixedPoints !== null ? `固定 ${task.extra.fixedPoints} 活力点` : view.workloadLabel} · 时限 {task.extra.deadlineHours} 小时（从接的时候算）
            </span>
            {task.extra.description ? <p className="break">{task.extra.description}</p> : null}
            {task.extra.fileIds.length ? <span className="label">附了 {task.extra.fileIds.length} 张图（在资料库里）</span> : null}
          </div>
        ) : null}
        <TaskActions task={task} />
        <h3 className="t-body-14m">版本</h3>
        {subs.length === 0 ? (
          <p className="muted">还没交过。状态：{TASK_STATUS_LABEL[task.status]}。</p>
        ) : (
          <ul className="list">
            {[...subs].reverse().map((s) => {
              const r = reviews.find((x) => x.submissionId === s.id);
              return (
                <li key={s.id}>
                  <div className="list-main">
                    <span className="t-body-14m">
                      v{String(s.versionNo).padStart(2, "0")} · <MemberLink member={world.members[s.byMemberId ?? ""]} fallback="外包" />
                    </span>
                    <span className="label break">{s.fileName}</span>
                    <LinkList submission={s} compact />
                    {s.note ? <span className="label break">{s.note}</span> : null}
                    {r ? <span className="label">{VERDICT_LABEL[r.verdict]}{r.quality !== null ? ` · 质量 ${r.quality.toFixed(1)}` : ""}</span> : null}
                  </div>
                  <span className="list-meta">{dateTimeZh(s.at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
