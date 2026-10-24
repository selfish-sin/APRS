/** 意见 / 提问 / 设定问题 / 要补：一条和它的回复、回复框、关掉。 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { U, useI18n } from "@/i18n/I18n";
import type { ThreadRow } from "@/domain/model";
import { memberById } from "@/domain/queries";
import { groupTemplate } from "@/domain/templates";
import { useGuild } from "@/lib/store";
import { isReviewer } from "@/domain/commands/core";
import { MemberLink, Tag } from "./bits";

export function ThreadBody({ thread, compact = false }: { thread: ThreadRow; compact?: boolean }) {
  const { world, now, dispatch, me, notify } = useGuild();
  const { L, r: rich, err, relative, stage: stageEl } = useI18n();
  const [reply, setReply] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = world.projects[thread.projectId];
  const askStage = thread.askStageKey ? groupTemplate(project?.group ?? "animation").stages.find((s) => s.key === thread.askStageKey) : null;
  const askMember = memberById(world, thread.askMemberId);
  const canClose = thread.status !== "done" && !(thread.kind === "setting" && thread.status === "open") && (thread.kind === "todo" || thread.byMemberId === me.id || isReviewer(me));
  const send = () => {
    const r = dispatch("thread.reply", { threadId: thread.id, text: reply }, { quiet: true });
    if (!r.ok) setError(err(r.error));
    else {
      setReply("");
      setError(null);
      setOpen(false);
    }
  };
  return (
    <div className="stack" data-gap="small">
      <div className="row">
        <Tag tone={thread.kind === "todo" ? "warning" : thread.kind === "setting" ? "lilac" : thread.kind === "ask" ? "info" : undefined}>{L.labels.threadKind[thread.kind]}</Tag>
        <Tag tone={thread.status === "open" ? undefined : "success"}>{L.labels.threadStatus[thread.status]}</Tag>
        {askStage ? <span className="label">{rich(L.thread.askStage, { stage: stageEl(project?.group ?? "animation", { templateKey: askStage.key, name: askStage.name }) })}</span> : null}
        {askMember ? <span className="label">{rich(L.thread.askMember, { name: <U>{askMember.nickname}</U> })}</span> : null}
        {thread.stageKey && thread.kind !== "ask" ? <span className="label">{stageEl(project?.group ?? "animation", { templateKey: thread.stageKey, name: groupTemplate(project?.group ?? "animation").stages.find((s) => s.key === thread.stageKey)?.name ?? thread.stageKey })}</span> : null}
      </div>
      <p className="break">
        <U>{thread.kind === "todo" ? thread.text.replace(/^要补：/, "") : thread.text}</U>
      </p>
      <span className="label">
        <MemberLink member={memberById(world, thread.byMemberId)} /> · {relative(thread.at, now)}
      </span>
      {thread.replies.length ? (
        <ul className="replies">
          {thread.replies.map((r, i) => (
            <li key={i} className="stack" data-gap="small">
              <span className="break">
                {r.ruling || r.text.startsWith("拍板：") ? (
                  <>
                    <strong>{L.thread.rulingPrefix}</strong>
                    <U>{r.text.replace(/^拍板：/, "")}</U>
                  </>
                ) : (
                  <U>{r.text}</U>
                )}
              </span>
              <span className="label">
                <MemberLink member={memberById(world, r.byMemberId)} /> · {relative(r.at, now)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {compact ? null : open ? (
        <div className="stack" data-gap="small">
          <textarea className="field-control" aria-label={L.thread.reply} placeholder={L.thread.replyPlaceholder} value={reply} onChange={(e) => setReply(e.target.value)} />
          {error ? <p className="error-text">{error}</p> : null}
          <div className="form-actions">
            <Button Label={L.thread.reply} Size="Small" Style="Accent" onClick={send} />
            <Button Label={L.thread.never} Size="Small" Style="Ghost" onClick={() => setOpen(false)} />
          </div>
        </div>
      ) : (
        <div className="form-actions">
          <Button Label={L.thread.reply} Size="Small" Style="Secondary" onClick={() => setOpen(true)} />
          {canClose ? (
            <Button
              Label={thread.kind === "todo" ? L.thread.fixed : L.thread.close}
              Size="Small"
              Style="Ghost"
              onClick={() => {
                const r = dispatch("thread.resolve", { threadId: thread.id });
                if (r.ok) notify(thread.kind === "todo" ? L.thread.markedFixed : L.thread.closed, "Neutral");
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
