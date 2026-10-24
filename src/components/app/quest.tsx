/**
 * 任务单（黑卡）：项目 / 卡 / 环节 / 工作量 / 时限倒计时 / 奖励 / 收什么 · 交到哪 · 文件名 / 交 · 放弃 · 提问。
 * 一屏最多一两张黑卡，给「现在这件事」。
 */
import { useState } from "react";
import { LinksEditor, emptyLink, type LinkDraft } from "./links";
import { DropZone } from "@/components/library/intake";
import { submissionLinks } from "@/domain/queries";
import { useFiles } from "@/lib/files/FilesProvider";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatPoints } from "@/domain/labels";
import { hoursOf, taskRate } from "@/domain/rules";
import { stageText } from "@/domain/templates";
import { Joined, U, useI18n } from "@/i18n/I18n";
import type { Id } from "@/domain/model";
import { members as membersOf, type Quest } from "@/domain/queries";
import { Link } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { SelectField, TextArea, TextField, copyText } from "./bits";

export function QuestCard({ quest, eyebrow, showCutLink = true, actions = true }: { quest: Quest; eyebrow?: string; showCutLink?: boolean; actions?: boolean }) {
  const { view, indicator } = quest;
  const { task, stage, project, cut } = view;
  const { notify } = useGuild();
  const { L, f, r: rich, ph, pt, lang, countdown: cd, num, tag, unit: unitOf, dateTime } = useI18n();
  const countdown = quest.remainingMs === null ? null : cd(quest.remainingMs);
  const st = stageText(project.group, stage, lang);
  const [dialog, setDialog] = useState<"submit" | "ask" | "release" | null>(null);
  const inHand = task.status === "claimed" || task.status === "returned";
  const urgent = !!quest.remainingMs && quest.remainingMs < 6 * 3600_000;
  const unit = unitOf(stage.unit, project.group, task.workload);
  const fixed = !!task.extra && task.extra.fixedPoints !== null && !task.workload;
  const hours = hoursOf(taskRate(stage, task), task.workload);
  const uc = (custom: boolean, text: string) => (custom ? <U>{text}</U> : text);
  return (
    <article className="quest" aria-label={f(L.quest.aria, { title: pt(view.titleP) })} data-testid="quest-card">
      <div className="quest-eyebrow">
        <span>
          {eyebrow ?? L.quest.current} · <U>{project.name}</U>
        </span>
        <StatusPill Status={task.status} Label={task.status === "submitted" && view.versionTag ? f(L.quest.inReviewV, { v: view.versionTag }) : undefined} />
      </div>
      <div className="quest-main">
        <div className="stack" data-gap="small">
          <h2 className="quest-title">{ph(view.labelP)}</h2>
          {quest.assignedBy ? (
            <p className="quest-assigned" data-testid="quest-assigned-by">
              {rich(L.quest.assignedBy, { name: <U>{quest.assignedBy.nickname}</U> })}
            </p>
          ) : null}
          {task.extra?.description ? (
            <p className="quest-sub break">
              <U>{task.extra.description}</U>
            </p>
          ) : null}
          <p className="quest-sub">
            {project.code} · {L.labels.phase[stage.phase]} · {L.labels.stageKind[stage.kind]}
            {stage.hub && stage.kind !== "hub" ? L.quest.hubSuffix : ""}
            {view.versionTag ? f(L.quest.latest, { v: view.versionTag }) : ""}
          </p>
        </div>
        <div className="quest-clock" data-urgent={urgent || countdown?.overdue ? "true" : "false"} data-testid="quest-clock">
          <div className="quest-clock-big num">
            {countdown ? countdown.big : task.status === "submitted" && view.versionTag ? view.versionTag : "—"}
            {countdown && !countdown.big.includes(":") ? <span className="quest-clock-unit">{countdown.unit}</span> : null}
          </div>
          <div className="quest-clock-small">
            {countdown ? countdown.text : task.status === "submitted" ? L.quest.submittedWaiting : L.quest.noDeadline}
            {countdown && quest.dueAt ? ` · ${f(L.quest.dueAt, { at: dateTime(quest.dueAt) })}` : ""}
          </div>
        </div>
      </div>
      <div className="quest-stats">
        <div className="quest-stat">
          <span>{L.quest.statWorkload}</span>
          <b>{fixed ? L.quest.fixedWork : `${num(task.workload)} ${unit}`}</b>
        </div>
        <div className="quest-stat">
          <span>{L.quest.statHours}</span>
          <b className="num">{fixed ? "—" : `${num(hours)}h`}</b>
        </div>
        <div className="quest-stat" data-kind="reward">
          <span>{L.quest.statReward}</span>
          <b>{f(L.quest.rewardPoints, { p: formatPoints(quest.reward, true) })}</b>
        </div>
      </div>

      {quest.lastReturn ? (
        <ul className="quest-notes" aria-label={L.quest.returnNotes}>
          {quest.lastReturn.comments.map((c, i) => (
            <li key={i}>
              <span className="label">
                {L.quest.returned} · <Joined parts={[c.layer ? f(L.labels.layer, { layer: c.layer }) : null, c.sheets ? rich(L.quest.sheetNo, { n: <U>{c.sheets}</U> }) : null, c.tag ? tag(c.tag) : null]} fallback={L.quest.comment} />
              </span>
              <span>
                <U>{c.text}</U>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {indicator.todos.length ? (
        <ul className="quest-notes" aria-label={L.quest.todos}>
          {indicator.todos.map((t) => (
            <li key={t.id}>
              <span className="label">{L.quest.todoAfterRuling}</span>
              <span>
                <U>{t.text.replace(/^要补：/, "")}</U>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="quest-rows">
        <div>
          <dt>{L.quest.receive}</dt>
          <dd>
            <span>{uc(st.uc.receive, st.receive)}</span>
            {indicator.receive.from.map((src) =>
              src.tasks.slice(0, 4).map((t) => (
                <span key={t.task.id} className="quest-sub">
                  {ph(t.labelP)}
                  {t.latest ? ` · v${String(t.latest.versionNo).padStart(2, "0")}` : ""}
                  {t.latest?.link ? (
                    <>
                      {" · "}
                      <a href={t.latest.link} target="_blank" rel="noreferrer noopener">
                        {L.quest.openLink}
                      </a>
                    </>
                  ) : (
                    rich(L.quest.inFolder, { folder: <U>{t.folder}</U> })
                  )}
                </span>
              ))
            )}
          </dd>
        </div>
        <div>
          <dt>{L.quest.deliverTo}</dt>
          <dd>
            <span className="quest-code" data-uc="">
              {indicator.deliver.folder}
            </span>
            {project.feishuRoot ? (
              <a href={project.feishuRoot} target="_blank" rel="noreferrer noopener">
                {L.quest.openRoot}
              </a>
            ) : (
              <span className="quest-sub">{L.quest.inProjectFolder}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{L.quest.fileName}</dt>
          <dd>
            <span className="quest-code">{indicator.deliver.fileName}</span>
            <button type="button" className="copy-button" onClick={async () => notify((await copyText(indicator.deliver.fileName)) ? L.quest.fileNameCopied : L.quest.copyBlocked, "Neutral")}>
              {L.quest.copyFileName}
            </button>
          </dd>
        </div>
        <div>
          <dt>{L.quest.deliver}</dt>
          <dd>
            <span>{uc(st.uc.deliver, st.deliver)}</span>
            <span className="quest-sub">
              {rich(L.quest.handTo, { to: uc(st.uc.handTo, st.handTo) })}
              {indicator.reviewer ? rich(L.quest.reviewerIs, { name: <U>{indicator.reviewer.nickname}</U> }) : ""}
            </span>
          </dd>
        </div>
      </dl>

      {actions ? (
        <div className="quest-actions">
          {inHand ? <Button Label={task.status === "returned" ? L.quest.resubmit : L.quest.submit} Style="Accent" onClick={() => setDialog("submit")} /> : null}
          <Button Label={L.quest.ask} Style="Secondary" onClick={() => setDialog("ask")} />
          {inHand ? <Button Label={L.quest.release} Style="Secondary" onClick={() => setDialog("release")} /> : null}
          {showCutLink && cut ? (
            <Link to={`/cut/${cut.id}`} className="ui-button" data-style="Secondary" data-size="Medium">
              {L.quest.viewCut}
            </Link>
          ) : null}
        </div>
      ) : null}
      {dialog === "submit" ? <SubmitDialog quest={quest} onClose={() => setDialog(null)} /> : null}
      {dialog === "ask" ? <AskDialog quest={quest} onClose={() => setDialog(null)} /> : null}
      {dialog === "release" ? <ReleaseDialog taskId={task.id} label={pt(view.labelP)} onClose={() => setDialog(null)} /> : null}
    </article>
  );
}

export function SubmitDialog({ quest, onClose }: { quest: Quest; onClose: () => void }) {
  const { dispatch, notify } = useGuild();
  const { L, f, pt, err } = useI18n();
  const files = useFiles();
  const [attached, setAttached] = useState<File[]>([]);
  const [links, setLinks] = useState<LinkDraft[]>(() => {
    const prev = quest.view.latest ? submissionLinks(quest.view.latest) : [];
    return prev.length ? prev.map((l) => ({ url: l.url, name: l.name, kind: l.kind })) : [emptyLink()];
  });
  const [note, setNote] = useState("");
  const [fileName, setFileName] = useState(quest.indicator.deliver.fileName);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const r = dispatch("task.submit", { taskId: quest.view.task.id, links: links.map((l) => ({ url: l.url, name: l.name || null, kind: l.kind || null })), note, fileName }, { quiet: true });
    if (!r.ok) {
      setError(err(r.error));
      return;
    }
    const params = { label: pt(quest.view.labelP), v: `v${String(quest.indicator.deliver.version).padStart(2, "0")}` };
    const submissionId = r.created.submissionId;
    onClose();
    if (attached.length && submissionId) {
      // 附的截图 / 胶片预览挂在这一版上。
      void files.addFiles(attached, { subjectType: "submission", subjectId: submissionId }).then((rep) => {
        if (rep.errors.length) notify(f(L.quest.submittedFileError, { ...params, why: pt(rep.errors[0]) }), "Error");
        else notify(f(L.quest.submittedFiles, { ...params, n: rep.fileIds.length + rep.existing.length }));
      });
    } else notify(f(L.quest.submitted, params));
  };
  return (
    <Drawer
      Type="Dialog"
      Title={f(L.quest.submitTitle, { label: pt(quest.view.labelP) })}
      Body={f(L.quest.submitBody, { v: `v${String(quest.indicator.deliver.version).padStart(2, "0")}` })}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.quest.cancel} Style="Secondary" onClick={onClose} />
          <Button Label={L.quest.submit} Style="Accent" onClick={submit} data-testid="submit-confirm" />
        </>
      }
    >
      <form
        className="stack"
        data-gap="small"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <LinksEditor value={links} onChange={setLinks} />
        <TextArea label={L.quest.note} placeholder={L.quest.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} hint={L.quest.noteHint} />
        <TextField label={L.quest.fileName} value={fileName} onChange={(e) => setFileName(e.target.value)} hint={L.quest.fileNameHint} />
        <DropZone testId="submit-drop" hint={L.quest.dropHint} onFiles={(fs) => setAttached((xs) => [...xs, ...fs])} />
        {attached.length ? (
          <div className="attach-row" aria-label={L.quest.attachments}>
            {attached.map((file, i) => (
              <span key={i} className="attach-chip" data-testid="submit-attached">
                <span className="break">{file.name ? <U>{file.name}</U> : L.quest.pastedShot}</span>
                <button type="button" className="inline-link" aria-label={f(L.quest.unattach, { name: file.name })} onClick={() => setAttached((xs) => xs.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

export function AskDialog({ quest, onClose }: { quest: Quest; onClose: () => void }) {
  const { dispatch, notify, world, me } = useGuild();
  const { L, f, pt, err, stageName } = useI18n();
  const upstream = quest.indicator.receive.from.map((src) => src.stage);
  const [target, setTarget] = useState<string>(upstream[0] ? `stage:${upstream[0].templateKey}` : "");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const people = membersOf(world).filter((m) => m.id !== me.id);
  const send = () => {
    const askStageKey = target.startsWith("stage:") ? target.slice(6) : null;
    const askMemberId = target.startsWith("member:") ? (target.slice(7) as Id) : null;
    const kind = target === "comment" ? "comment" : target === "setting" ? "setting" : "ask";
    const r = dispatch("thread.open", { subjectType: "task", subjectId: quest.view.task.id, kind, askStageKey, askMemberId, text }, { quiet: true });
    if (!r.ok) {
      setError(err(r.error));
      return;
    }
    notify(kind === "ask" ? L.quest.asked : L.quest.left);
    onClose();
  };
  return (
    <Drawer
      Type="Dialog"
      Title={f(L.quest.askTitle, { label: pt(quest.view.labelP) })}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.quest.cancel} Style="Secondary" onClick={onClose} />
          <Button Label={L.quest.send} Style="Accent" onClick={send} />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <SelectField label={L.quest.askWho} value={target} onChange={(e) => setTarget(e.target.value)}>
          {upstream.map((s) => (
            <option key={s.id} value={`stage:${s.templateKey}`}>
              {f(L.quest.upstreamOpt, { stage: stageName(quest.view.project.group, s) })}
            </option>
          ))}
          {people.map((m) => (
            <option key={m.id} value={`member:${m.id}`} data-uc="">
              {f(L.quest.askMember, { name: m.nickname })}
            </option>
          ))}
          <option value="setting">{L.quest.settingOpt}</option>
          <option value="comment">{L.quest.commentOpt}</option>
        </SelectField>
        <TextArea label={L.quest.question} placeholder={L.quest.questionPlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}

export function ReleaseDialog({ taskId, label, onClose }: { taskId: Id; label: string; onClose: () => void }) {
  const { dispatch, notify } = useGuild();
  const { L, f } = useI18n();
  return (
    <Drawer
      Type="Dialog"
      Title={f(L.quest.releaseTitle, { label })}
      Body={L.quest.releaseBody}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.quest.keep} Style="Secondary" onClick={onClose} />
          <Button
            Label={L.quest.release}
            onClick={() => {
              const r = dispatch("task.release", { taskId });
              if (r.ok) notify(f(L.quest.released, { label }), "Neutral");
              onClose();
            }}
          />
        </>
      }
    />
  );
}

/** 白色的小任务单（手上不止一张时）。 */
export function MiniQuest({ quest, selected, onSelect }: { quest: Quest; selected: boolean; onSelect: () => void }) {
  const { L, ph, countdown } = useI18n();
  return (
    <button type="button" className="mini-quest" aria-pressed={selected} onClick={onSelect} data-testid="mini-quest">
      <div className="list-main">
        <span className="t-body-14m">{ph(quest.view.labelP)}</span>
        <span className="label">
          <U>{quest.view.project.name}</U> · {quest.remainingMs !== null ? countdown(quest.remainingMs).text : L.quest.waitingReview}
        </span>
      </div>
      <StatusPill Status={quest.view.task.status} />
    </button>
  );
}
