/**
 * P7 审核台：待审队列（按等待时间）· 打开一版：链接、文件名、上一版的意见 →
 * 通过（选质量 0.5 / 1.0 / 1.2）/ 退回（加意见：层 · 张号 · 标签 · 文字）/ 自修（填新版本链接）后通过。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Empty, SelectField, Tag, TextArea, TextField } from "@/components/app/bits";
import { dateTimeZh } from "@/domain/clock";
import { isReviewer } from "@/domain/commands/core";
import { VERDICT_LABEL, formatPoints } from "@/domain/labels";
import type { Quality } from "@/domain/model";
import { fileNameFor } from "@/domain/naming";
import { reviewQueue, type ReviewItem } from "@/domain/queries";
import { QUALITY_OPTIONS, RETURN_TAGS } from "@/domain/rules";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";

function waited(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return "刚交";
  if (h < 24) return `等了 ${h} 小时`;
  return `等了 ${Math.floor(h / 24)} 天`;
}

export function ReviewPage() {
  const { world, me } = useGuild();
  const route = useRoute();
  const queue = useMemo(() => (isReviewer(me) ? reviewQueue(world, me.id) : []), [world, me]);
  const wanted = route.query.get("task");
  const current = queue.find((i) => i.view.task.id === wanted) ?? queue[0] ?? null;
  if (!isReviewer(me)) {
    return (
      <section className="card">
        <h1 className="t-section-24">审核台给审核员和管理员用</h1>
        <p className="muted">你交的版本会在这里排队，审完会出现在你的大厅里。</p>
        <div className="form-actions">
          <Link to="/hall" className="ui-button" data-style="Accent" data-size="Medium">
            回大厅
          </Link>
        </div>
      </section>
    );
  }
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">审核台</span>
          <h1 className="t-title-32">
            等你审的 <span className="num">{queue.length}</span>
          </h1>
        </div>
      </div>
      {queue.length === 0 ? (
        <section className="card">
          <Empty>现在没有等你审的。有人交了会排在这里，等得最久的在最上面。</Empty>
        </section>
      ) : (
        <div className="review-layout">
          <div className="queue" aria-label="待审队列">
            {queue.map((item) => (
              <button
                key={item.view.task.id}
                type="button"
                className="queue-item"
                aria-pressed={item.view.task.id === current?.view.task.id}
                onClick={() => navigate(`/review?task=${item.view.task.id}`, { replace: true })}
              >
                <span className="row" data-justify="between">
                  <span className="t-body-14m">{item.view.label}</span>
                  <span className="num label">v{String(item.submission.versionNo).padStart(2, "0")}</span>
                </span>
                <span className="label">
                  {item.view.project.name} · {item.submitter?.nickname ?? (item.view.task.outsourced ? `外包（${item.view.task.outsourceName ?? ""}）` : "有人")} · {waited(item.waitingMs)}
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
      if (!r.ok) return setError(r.error.message);
      return done(`退回了 ${view.label}，回到 ${item.submitter?.nickname ?? "交的人"} 手上`);
    }
    const r = dispatch(
      "task.review",
      { taskId: view.task.id, verdict: mode, quality, comments: payload, ...(mode === "fix_pass" ? { fix: { link: fixLink, note: fixNote, fileName: fixName } } : {}) },
      { quiet: true }
    );
    if (!r.ok) return setError(r.error.message);
    const led = r.created.ledgerId ? r.state.ledger[r.created.ledgerId] : undefined;
    const who = item.submitter?.nickname;
    done(`通过了 ${view.label}${led && who ? ` · ${who} ${formatPoints(led.points, true)} 活力点` : ""}`);
  };

  return (
    <section className="card" aria-label={`审 ${view.title}`}>
      <div className="card-head">
        <div className="stack" data-gap="small">
          <span className="label">
            {view.project.name} · {view.project.code}
          </span>
          <h2 className="t-section-24">{view.label}</h2>
        </div>
        <Tag tone="warning">待审 v{String(submission.versionNo).padStart(2, "0")}</Tag>
      </div>
      <dl className="stack" data-gap="small" style={{ margin: 0 }}>
        <div>
          <dt className="label">文件名</dt>
          <dd className="num break" style={{ margin: 0 }}>
            {submission.fileName}
          </dd>
        </div>
        <div>
          <dt className="label">链接</dt>
          <dd style={{ margin: 0 }}>
            {submission.link ? (
              <a href={submission.link} target="_blank" rel="noreferrer noopener" className="break">
                打开飞书链接
              </a>
            ) : (
              <span className="muted">没贴链接</span>
            )}
          </dd>
        </div>
        {submission.note ? (
          <div>
            <dt className="label">说明</dt>
            <dd className="break" style={{ margin: 0 }}>
              {submission.note}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="label">交的人 · 时间</dt>
          <dd style={{ margin: 0 }}>
            {item.submitter?.nickname ?? (view.task.outsourced ? `外包（${view.task.outsourceName ?? ""}）` : "—")} · {dateTimeZh(submission.at)}
            {submission.onTime ? "" : " · 超时交的"}
            {submission.recordedById ? " · 管理员代交" : ""}
          </dd>
        </div>
      </dl>
      {lastReview && lastReview.comments.length ? (
        <div className="stack" data-gap="small">
          <span className="label">上一版（v{String(item.history[item.history.length - 1].submission.versionNo).padStart(2, "0")}）{VERDICT_LABEL[lastReview.verdict]}的意见</span>
          <ul className="comments">
            {lastReview.comments.map((c, i) => (
              <li key={i}>
                <span className="label">{[c.layer ? `${c.layer} 层` : null, c.sheets ? `第 ${c.sheets} 张` : null, c.tag].filter(Boolean).join(" · ") || "意见"}</span>
                <span className="break">{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="tabs" role="tablist" aria-label="审核结论">
        {(
          [
            ["pass", "通过"],
            ["return", "退回"],
            ["fix_pass", "自修后通过"],
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
          <span className="label">质量系数</span>
          <div className="skill-options" role="radiogroup" aria-label="质量系数" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            {QUALITY_OPTIONS.map((q) => (
              <button key={q.value} type="button" className="option" role="radio" aria-checked={quality === q.value} aria-pressed={quality === q.value} onClick={() => setQuality(q.value)} data-testid={`quality-${q.label}`}>
                <span className="num t-body-14m">{q.label}</span>
                <span className="muted label">{q.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "fix_pass" ? (
        <div className="stack" data-gap="small">
          <p className="label">你自己改掉小问题、出一版新的。这一版算在你名下（另记 0.5 小时），交的人照样按质量记活力点。</p>
          <TextField label="自修版的飞书链接" type="url" placeholder="https://…" value={fixLink} onChange={(e) => setFixLink(e.target.value)} />
          <TextArea label="改了什么" value={fixNote} onChange={(e) => setFixNote(e.target.value)} />
          <TextField label="文件名" value={fixName} onChange={(e) => setFixName(e.target.value)} />
        </div>
      ) : null}

      <div className="stack" data-gap="small">
        <span className="label">{mode === "return" ? "退回意见（至少一条）" : "意见（可以不写）"}</span>
        {comments.map((c, i) => (
          <div key={i} className="comment-row">
            <SelectField label="层" value={c.layer} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, layer: e.target.value } : x)))}>
              <option value="">—</option>
              {layers.map((l) => (
                <option key={l} value={l}>
                  {l} 层
                </option>
              ))}
            </SelectField>
            <TextField label="张号" placeholder="6、7" value={c.sheets} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, sheets: e.target.value } : x)))} />
            <SelectField label="标签" value={c.tag} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, tag: e.target.value } : x)))}>
              <option value="">—</option>
              {RETURN_TAGS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </SelectField>
            <TextField label="说什么" placeholder="例如：第 18 张下巴漏色" value={c.text} onChange={(e) => setComments(comments.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} data-testid={`comment-text-${i}`} />
            <Button Label="去掉" Size="Small" Style="Ghost" onClick={() => setComments(comments.length > 1 ? comments.filter((_, j) => j !== i) : [blank()])} />
          </div>
        ))}
        <div className="form-actions">
          <Button Label="再加一条" Size="Small" Style="Secondary" onClick={() => setComments([...comments, blank()])} />
        </div>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={mode === "pass" ? `通过（质量 ${quality.toFixed(1)}）` : mode === "return" ? "退回" : `自修后通过（质量 ${quality.toFixed(1)}）`} Style={mode === "return" ? "Primary" : "Accent"} onClick={send} data-testid="review-submit" />
        {view.cut ? (
          <Link to={`/cut/${view.cut.id}`} className="label">
            看这一卡的时间线 →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
