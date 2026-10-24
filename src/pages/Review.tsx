/**
 * P7 审核台：待审队列（按等待时间）· 打开一版：链接、文件名、上一版的意见 →
 * 通过（选质量 0.5 / 1.0 / 1.2）/ 退回（加意见：层 · 张号 · 标签 · 文字）/ 自修（填新版本链接）后通过。
 */
import { useMemo, useState } from "react";
import { DropZone } from "@/components/library/intake";
import { LinkList } from "@/components/app/links";
import { FileTile } from "@/components/library/tiles";
import { Viewer } from "@/components/library/Viewer";
import { useFiles } from "@/lib/files/FilesProvider";
import { filesOfTask } from "@/domain/queries";
import { Button } from "@/components/ui/Button";
import { Empty, SelectField, Tag, TextArea, TextField } from "@/components/app/bits";
import { isReviewer } from "@/domain/commands/core";
import { formatPoints } from "@/domain/labels";
import { Joined, U, useI18n, type I18n } from "@/i18n/I18n";
import type { Id, Quality } from "@/domain/model";
import { fileNameFor } from "@/domain/naming";
import { reviewQueue, type ReviewItem } from "@/domain/queries";
import { QUALITY_OPTIONS, RETURN_TAGS } from "@/domain/rules";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";

function waited(i: I18n, ms: number): string {
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return i.L.review.justIn;
  if (h < 24) return i.f(i.L.review.waitedHours, { n: h });
  return i.f(i.L.review.waitedDays, { n: Math.floor(h / 24) });
}

export function ReviewPage() {
  const { world, me } = useGuild();
  const i18n = useI18n();
  const { L, r: rich, ph } = i18n;
  const route = useRoute();
  const queue = useMemo(() => (isReviewer(me) ? reviewQueue(world, me.id) : []), [world, me]);
  const wanted = route.query.get("task");
  const current = queue.find((i) => i.view.task.id === wanted) ?? queue[0] ?? null;
  if (!isReviewer(me)) {
    return (
      <section className="card">
        <h1 className="t-section-24">{L.review.notForYou}</h1>
        <p className="muted">{L.review.notForYouLead}</p>
        <div className="form-actions">
          <Link to="/hall" className="ui-button" data-style="Accent" data-size="Medium">
            {L.review.backToHall}
          </Link>
        </div>
      </section>
    );
  }
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">{L.review.title}</span>
          <h1 className="t-title-32">
            {L.review.waiting} <span className="num">{queue.length}</span>
          </h1>
        </div>
      </div>
      {queue.length === 0 ? (
        <section className="card">
          <Empty>{L.review.empty}</Empty>
        </section>
      ) : (
        <div className="review-layout">
          <div className="queue" aria-label={L.review.queue}>
            {queue.map((item) => (
              <button
                key={item.view.task.id}
                type="button"
                className="queue-item"
                aria-pressed={item.view.task.id === current?.view.task.id}
                onClick={() => navigate(`/review?task=${item.view.task.id}`, { replace: true })}
              >
                <span className="row" data-justify="between">
                  <span className="t-body-14m">{ph(item.view.labelP)}</span>
                  <span className="num label">v{String(item.submission.versionNo).padStart(2, "0")}</span>
                </span>
                <span className="label">
                  <U>{item.view.project.name}</U> · {item.submitter ? <U>{item.submitter.nickname}</U> : item.view.task.outsourced ? rich(L.review.outsourced, { name: <U>{item.view.task.outsourceName ?? ""}</U> }) : L.review.someone} · {waited(i18n, item.waitingMs)}
                </span>
              </button>
            ))}
          </div>
          {current ? <ReviewPanel key={`${current.view.task.id}:${current.submission.id}`} item={current} next={queue.find((i) => i !== current) ?? null} /> : null}
        </div>
      )}
    </>
  );
}

interface CommentDraft {
  layer: string;
  sheets: string;
  tag: string;
  text: string;
}

const blank = (): CommentDraft => ({ layer: "", sheets: "", tag: "", text: "" });

function ReviewPanel({ item, next }: { item: ReviewItem; next: ReviewItem | null }) {
  const { dispatch, notify } = useGuild();
  const { L, f, r: rich, ph, pt, err, dateTime, tag } = useI18n();
  const { view, submission } = item;
  const [mode, setMode] = useState<"pass" | "return" | "fix_pass">("pass");
  const [quality, setQuality] = useState<Quality>(1);
  const [comments, setComments] = useState<CommentDraft[]>([blank()]);
  const [fixLink, setFixLink] = useState(submission.link ?? "");
  const [fixNote, setFixNote] = useState("");
  const [fixName, setFixName] = useState(fileNameFor(view.project, view.stage, view.cut, view.task.layer, submission.versionNo + 1));
  const [error, setError] = useState<string | null>(null);
  const layers = view.cut?.layers.map((l) => l.name) ?? [];
  const lastReview = item.history.length ? item.history[item.history.length - 1].review : null;

  const done = (text: string) => {
    notify(text);
    navigate(next ? `/review?task=${next.view.task.id}` : "/review", { replace: true });
  };

  const send = () => {
    const filled = comments.filter((c) => c.text.trim() || c.sheets.trim() || c.tag);
    const payload = filled.map((c) => ({ layer: c.layer || null, sheets: c.sheets || null, tag: c.tag || null, text: c.text || c.tag }));
    if (mode === "return") {
      const r = dispatch("task.review", { taskId: view.task.id, verdict: "return", comments: payload }, { quiet: true });
      if (!r.ok) return setError(err(r.error));
      return done(f(L.review.returned, { label: pt(view.labelP), name: item.submitter?.nickname ?? L.review.submitter }));
    }
    const r = dispatch(
      "task.review",
      { taskId: view.task.id, verdict: mode, quality, comments: payload, ...(mode === "fix_pass" ? { fix: { link: fixLink, note: fixNote, fileName: fixName } } : {}) },
      { quiet: true }
    );
    if (!r.ok) return setError(err(r.error));
    const led = r.created.ledgerId ? r.state.ledger[r.created.ledgerId] : undefined;
    const who = item.submitter?.nickname;
    done(led && who ? f(L.review.passedPoints, { label: pt(view.labelP), name: who, points: formatPoints(led.points, true) }) : f(L.review.passed, { label: pt(view.labelP) }));
  };

  return (
    <section className="card" aria-label={f(L.review.reviewAria, { title: pt(view.titleP) })}>
      <div className="card-head">
        <div className="stack" data-gap="small">
          <span className="label">
            <U>{view.project.name}</U> · {view.project.code}
          </span>
          <h2 className="t-section-24">{ph(view.labelP)}</h2>
        </div>
        <Tag tone="warning">{f(L.review.inReview, { v: `v${String(submission.versionNo).padStart(2, "0")}` })}</Tag>
      </div>
      <dl className="stack" data-gap="small" style={{ margin: 0 }}>
        <div>
          <dt className="label">{L.review.fileName}</dt>
          <dd className="num break" style={{ margin: 0 }}>
            <U>{submission.fileName}</U>
          </dd>
        </div>
        <div>
          <dt className="label">{L.review.links}</dt>
          <dd style={{ margin: 0 }}>
            <LinkList submission={submission} />
          </dd>
        </div>
        {submission.note ? (
          <div>
            <dt className="label">{L.review.note}</dt>
            <dd className="break" style={{ margin: 0 }}>
              <U>{submission.note}</U>
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="label">{L.review.byWhen}</dt>
          <dd style={{ margin: 0 }}>
            {item.submitter ? <U>{item.submitter.nickname}</U> : view.task.outsourced ? rich(L.review.outsourced, { name: <U>{view.task.outsourceName ?? ""}</U> }) : "—"} · {dateTime(submission.at)}
            {submission.onTime ? "" : L.review.late}
            {submission.recordedById ? L.review.byAdmin : ""}
          </dd>
        </div>
      </dl>
      <ReviewImages taskId={view.task.id} submissionId={submission.id} />
      {lastReview && lastReview.comments.length ? (
        <div className="stack" data-gap="small">
          <span className="label">{f(L.review.lastNotes, { v: `v${String(item.history[item.history.length - 1].submission.versionNo).padStart(2, "0")}`, verdict: L.labels.verdict[lastReview.verdict] })}</span>
          <ul className="comments">
            {lastReview.comments.map((c, i) => (
              <li key={i}>
                <span className="label"><Joined parts={[c.layer ? f(L.review.layerOpt, { layer: c.layer }) : null, c.sheets ? rich(L.review.sheetNo, { n: <U>{c.sheets}</U> }) : null, c.tag ? tag(c.tag) : null]} fallback={L.review.comment} /></span>
                <span className="break">
                  <U>{c.text}</U>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="tabs" role="tablist" aria-label={L.review.verdict}>
        {(
          [
            ["pass", L.review.pass],
            ["return", L.review.return],
            ["fix_pass", L.review.fixPass],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={mode === k}
            onClick={() => {
              setMode(k);
              setError(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode !== "return" ? (
        <div className="stack" data-gap="small">
          <span className="label">{L.review.quality}</span>
          <div className="skill-options" role="radiogroup" aria-label={L.review.quality} style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            {QUALITY_OPTIONS.map((q) => (
              <button key={q.value} type="button" className="option" role="radio" aria-checked={quality === q.value} aria-pressed={quality === q.value} onClick={() => setQuality(q.value)} data-testid={`quality-${q.label}`}>
                <span className="num t-body-14m">{q.label}</span>
                <span className="muted label">{L.review.qualityHint[q.label as "0.5" | "1.0" | "1.2"] ?? q.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "fix_pass" ? (
        <div className="stack" data-gap="small">
          <p className="label">{L.review.fixLead}</p>
          <TextField label={L.review.fixLink} type="url" placeholder="https://…" value={fixLink} onChange={(e) => setFixLink(e.target.value)} />
          <TextArea label={L.review.fixNote} value={fixNote} onChange={(e) => setFixNote(e.target.value)} />
          <TextField label={L.review.fileName} value={fixName} onChange={(e) => setFixName(e.target.value)} />
        </div>
      ) : null}

      <div className="stack" data-gap="small">
        <span className="label">{mode === "return" ? L.review.returnNotes : L.review.notesOptional}</span>
        {comments.map((c, i) => (
          <div key={i} className="comment-row">
            <SelectField label={L.review.layer} value={c.layer} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, layer: e.target.value } : x)))}>
              <option value="">—</option>
              {layers.map((l) => (
                <option key={l} value={l}>
                  {f(L.review.layerOpt, { layer: l })}
                </option>
              ))}
            </SelectField>
            <TextField label={L.review.sheets} placeholder={L.review.sheetsPlaceholder} value={c.sheets} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, sheets: e.target.value } : x)))} />
            <SelectField label={L.review.tag} value={c.tag} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, tag: e.target.value } : x)))}>
              <option value="">—</option>
              {RETURN_TAGS.map((t) => (
                <option key={t} value={t}>
                  {tag(t)}
                </option>
              ))}
            </SelectField>
            <TextField label={L.review.say} placeholder={L.review.sayPlaceholder} value={c.text} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} data-testid={`comment-text-${i}`} />
            <Button Label={L.review.remove} Size="Small" Style="Ghost" onClick={() => setComments(comments.length > 1 ? comments.filter((_, j) => j !== i) : [blank()])} />
          </div>
        ))}
        <div className="form-actions">
          <Button Label={L.review.addNote} Size="Small" Style="Secondary" onClick={() => setComments([...comments, blank()])} />
        </div>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={mode === "pass" ? f(L.review.passGo, { q: quality.toFixed(1) }) : mode === "return" ? L.review.returnGo : f(L.review.fixPassGo, { q: quality.toFixed(1) })} Style={mode === "return" ? "Primary" : "Accent"} onClick={send} data-testid="review-submit" />
        {view.cut ? (
          <Link to={`/cut/${view.cut.id}`} className="label">
            {L.review.cutTimeline}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** 交的版本上的图；审核员能附截图、在图上钉（就是群里「截图 + 红圈」那一步），钉的算审核意见。 */
function ReviewImages({ taskId, submissionId }: { taskId: Id; submissionId: Id }) {
  const { world, notify } = useGuild();
  const { L, f } = useI18n();
  const files = useFiles();
  const [open, setOpen] = useState<Id | null>(null);
  const list = filesOfTask(world, taskId).filter((f) => !f.archivedAt);
  const current = list.filter((f) => f.subjectType === "submission" && f.subjectId === submissionId);
  return (
    <div className="stack" data-gap="small" data-testid="review-images">
      <span className="label">
        {L.review.images}
        {current.length ? f(L.review.imagesThis, { n: current.length }) : L.review.imagesNone}
        {list.length > current.length ? f(L.review.imagesEarlier, { n: list.length - current.length }) : ""}
        {L.review.imagesLead}
      </span>
      {list.length ? (
        <div className="file-grid">
          {list.map((f) => (
            <FileTile key={f.id} file={f} onOpen={() => setOpen(f.id)} />
          ))}
        </div>
      ) : null}
      <DropZone
        testId="review-drop"
        hint={L.review.dropHint}
        onFiles={(picked) =>
          void files.addFiles(picked, { subjectType: "submission", subjectId: submissionId }).then((r) => {
            if (r.errors.length) notify(r.errors[0], "Error");
            else if (r.fileIds.length) {
              notify(f(L.review.attached, { n: r.fileIds.length }));
              setOpen(r.fileIds[0]);
            }
          })
        }
      />
      {open ? <Viewer files={list} startId={open} forReview onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
