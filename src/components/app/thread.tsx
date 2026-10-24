/** 意见 / 提问 / 设定问题 / 要补：一条和它的回复、回复框、关掉。 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { relativeZh } from "@/domain/clock";
import { THREAD_KIND_LABEL, THREAD_STATUS_LABEL } from "@/domain/labels";
import type { ThreadRow } from "@/domain/model";
import { memberById } from "@/domain/queries";
import { groupTemplate } from "@/domain/templates";
import { useGuild } from "@/lib/store";
import { isReviewer } from "@/domain/commands/core";
import { MemberLink, Tag } from "./bits";

export function ThreadBody({ thread, compact = false }: { thread: ThreadRow; compact?: boolean }) {
  const { world, now, dispatch, me, notify } = useGuild();
  const [reply, setReply] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = world.projects[thread.projectId];
  const askStage = thread.askStageKey ? groupTemplate(project?.group ?? "animation").stages.find((s) => s.key === thread.askStageKey) : null;
  const askMember = memberById(world, thread.askMemberId);
  const canClose = thread.status !== "done" && !(thread.kind === "setting" && thread.status === "open") && (thread.kind === "todo" || thread.byMemberId === me.id || isReviewer(me));
  const send = () => {
    const r = dispatch("thread.reply", { threadId: thread.id, text: reply }, { quiet: true });
    if (!r.ok) setError(r.error.message);
    else {
      setReply("");
      setError(null);
      setOpen(false);
    }
  };
  return (
    <div className="stack" data-gap="small">
      <div className="row">
        <Tag tone={thread.kind === "todo" ? "warning" : thread.kind === "setting" ? "lilac" : thread.kind === "ask" ? "info" : undefined}>{THREAD_KIND_LABEL[thread.kind]}</Tag>
        <Tag tone={thread.status === "open" ? undefined : "success"}>{THREAD_STATUS_LABEL[thread.status]}</Tag>
        {askStage ? <span className="label">问「{askStage.name}」</span> : null}
        {askMember ? <span className="label">问 {askMember.nickname}</span> : null}
        {thread.stageKey && thread.kind !== "ask" ? <span className="label">{groupTemplate(project?.group ?? "animation").stages.find((s) => s.key === thread.stageKey)?.name}</span> : null}
      </div>
      <p className="break">{thread.text}</p>
      <span className="label">
        <MemberLink member={memberById(world, thread.byMemberId)} /> · {relativeZh(thread.at, now)}
      </span>
      {thread.replies.length ? (
        <ul className="replies">
          {thread.replies.map((r, i) => (
            <li key={i} className="stack" data-gap="small">
              <span className="break">{r.text}</span>
              <span className="label">
                <MemberLink member={memberById(world, r.byMemberId)} /> · {relativeZh(r.at, now)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {compact ? null : open ? (
        <div className="stack" data-gap="small">
          <textarea className="field-control" aria-label="回复" placeholder="写回复" value={reply} onChange={(e) => setReply(e.target.value)} />
          {error ? <p className="error-text">{error}</p> : null}
          <div className="form-actions">
            <Button Label="回复" Size="Small" Style="Accent" onClick={send} />
            <Button Label="算了" Size="Small" Style="Ghost" onClick={() => setOpen(false)} />
          </div>
        </div>
      ) : (
        <div className="form-actions">
          <Button Label="回复" Size="Small" Style="Secondary" onClick={() => setOpen(true)} />
          {canClose ? (
            <Button
              Label={thread.kind === "todo" ? "补好了" : "关掉"}
              Size="Small"
              Style="Ghost"
              onClick={() => {
                const r = dispatch("thread.resolve", { threadId: thread.id });
                if (r.ok) notify(thread.kind === "todo" ? "标成已补" : "关掉了", "Neutral");
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
