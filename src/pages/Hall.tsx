/** P2 大厅：概要一行 · 身份卡 · 当前任务单（黑卡）· 手上的任务 · 交上去等审的 · 等我处理（按种类分组，每行带动作）· 工会动态。 */
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { StatusPill } from "@/components/ui/StatusPill";
import { Empty, Level, MemberAvatar, Stat, Tag, TextArea, XpBar } from "@/components/app/bits";
import { MiniQuest, QuestCard } from "@/components/app/quest";
import { isReviewer } from "@/domain/commands/core";
import { formatPoints } from "@/domain/labels";
import { U, useI18n } from "@/i18n/I18n";
import type { Id } from "@/domain/model";
import { enrollmentsOf, feedOf, growthOf, inboxOf, pendingReviewCount, questFor, reviewQueue, taskViewById, todayOf, type ThreadView } from "@/domain/queries";
import { Viewer } from "@/components/library/Viewer";
import { FileImage } from "@/components/library/tiles";
import { LinkList } from "@/components/app/links";
import { Link, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";

const msSince = (then: string, now: string) => Math.max(0, Date.parse(now) - Date.parse(then));

export function HallPage() {
  const { world, me, now, dispatch, notify } = useGuild();
  const { L, f, r: rich, ph, relative, say, day, waited, lang, stage: stageEl } = useI18n();
  const growth = useMemo(() => growthOf(world, me.id), [world, me.id]);
  const quests = useMemo(() => questFor(world, me.id), [world, me.id]);
  const inbox = useMemo(() => inboxOf(world, me.id), [world, me.id]);
  const feed = useMemo(() => feedOf(world, 10), [world]);
  const enrolled = enrollmentsOf(world, me.id).length;
  const route = useRoute();
  const [picked, setPicked] = useState<string | null>(route.query.get("task"));
  const [pinOpen, setPinOpen] = useState<{ fileId: string; pinId: string } | null>(null);
  const [replyTo, setReplyTo] = useState<ThreadView | null>(null);
  const current = quests.find((q) => q.view.task.id === picked) ?? quests[0] ?? null;
  const canReview = isReviewer(me);
  const myQueue = canReview ? reviewQueue(world, me.id).length : 0;
  const inHand = quests.filter((q) => q.view.task.status === "claimed" || q.view.task.status === "returned");
  const waiting = quests.filter((q) => q.view.task.status === "submitted");

  const claim = () => {
    const r = dispatch("task.claim", {});
    if (r.ok && r.created.taskId) {
      setPicked(r.created.taskId);
      const v = taskViewById(r.state, r.created.taskId);
      notify(say((d) => d.hall.gotQuest, { label: v ? v.labelP : say((d) => d.hall.newTask) }));
    }
  };

  const goFix = (taskId: Id) => {
    setPicked(taskId);
    requestAnimationFrame(() => document.querySelector('[data-testid="quest-card"]')?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">{L.hall.title}</span>
          <h1 className="t-title-32">{rich(L.hall.hello, { name: <U>{me.nickname}</U> })}</h1>
          <span className="muted" data-testid="hall-summary">
            {f(L.hall.summary, { day: day(todayOf(world)), hand: inHand.length })}
            {waiting.length ? f(L.hall.summaryWaiting, { n: waiting.length }) : ""}
          </span>
        </div>
        <div className="page-head-actions">
          {canReview ? (
            <Link to="/review" className="ui-button" data-style="Secondary" data-size="Medium">
              {f(L.hall.reviewDesk, { n: myQueue })}
            </Link>
          ) : null}
          <Link to="/enroll" className="ui-button" data-style={enrolled ? "Secondary" : "Accent"} data-size="Medium" data-testid="hall-enroll">
            {L.hall.goEnroll}
          </Link>
          {enrolled ? <Button Label={L.hall.claim} Style="Accent" onClick={claim} data-testid="claim" /> : null}
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          {current ? (
            <QuestCard quest={current} />
          ) : (
            <section className="card" aria-label={L.hall.currentQuest}>
              <h2 className="t-heading-18">{L.hall.noQuest}</h2>
              <Empty
                action={
                  enrolled ? (
                    <Button Label={L.hall.claim} Style="Accent" onClick={claim} />
                  ) : (
                    <Link to="/enroll" className="ui-button" data-style="Accent" data-size="Medium">
                      {L.hall.goEnrollStage}
                    </Link>
                  )
                }
              >
                {enrolled ? L.hall.noQuestEnrolled : L.hall.noQuestNotEnrolled}
              </Empty>
            </section>
          )}
          {quests.length > 1 ? (
            <section className="stack" data-gap="small" aria-label={L.hall.otherQuests}>
              <h2 className="t-heading-18">
                {L.hall.myQuests} <span className="count">{quests.length}</span>
              </h2>
              {quests.map((q) => (
                <MiniQuest key={q.view.task.id} quest={q} selected={q.view.task.id === current?.view.task.id} onSelect={() => setPicked(q.view.task.id)} />
              ))}
            </section>
          ) : null}

          {waiting.length ? (
            <section className="card" aria-labelledby="waiting-title" data-testid="hall-waiting">
              <div className="card-head">
                <h2 id="waiting-title" className="t-heading-18">
                  {L.hall.waitingTitle}
                </h2>
                <span className="label num">{waiting.length}</span>
              </div>
              <ul className="list">
                {waiting.map((q) => (
                  <li key={q.view.task.id}>
                    <StatusPill Status="submitted" />
                    <div className="list-main">
                      <span className="t-body-14m">
                        {ph(q.view.labelP)}
                        {q.view.versionTag ? ` · ${q.view.versionTag}` : ""}
                      </span>
                      <span className="label break">
                        <U>{q.view.project.name}</U> · {q.indicator.reviewer ? rich(L.hall.waitingFor, { who: <U>{q.indicator.reviewer.nickname}</U> }) : L.hall.waitingAdmin}
                        {q.view.latest ? ` · ${waited(msSince(q.view.latest.at, now))}` : ""}
                      </span>
                    </div>
                    {q.view.cut ? (
                      <Link to={`/cut/${q.view.cut.id}`} className="label">
                        {L.hall.view}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card" aria-labelledby="inbox-title" data-testid="hall-inbox">
            <div className="card-head">
              <h2 id="inbox-title" className="t-heading-18">
                {L.hall.inbox}
              </h2>
              <span className="label num">{f(L.hall.inboxCount, { n: inbox.total })}</span>
            </div>
            {inbox.total === 0 ? <Empty>{L.hall.inboxEmpty}</Empty> : null}

            <InboxGroup title={L.hall.groupLinks} n={inbox.links.length} testId="inbox-group-links">
              {inbox.links.map((x) => (
                <li key={`${x.submission.id}:${x.link.id}`} data-testid="inbox-broken-link" className="inbox-row" data-kind="link">
                  <Tag tone="danger">{L.hall.brokenLinkTag}</Tag>
                  <div className="list-main">
                    <span className="t-body-14m break">
                      {ph(x.view.titleP)} v{String(x.submission.versionNo).padStart(2, "0")}
                    </span>
                    <span className="label">{rich(L.hall.brokenBy, { who: x.by ? <U>{x.by.nickname}</U> : L.hall.reviewer })}</span>
                    <LinkList submission={x.submission} compact />
                  </div>
                </li>
              ))}
            </InboxGroup>

            <InboxGroup title={L.hall.groupPins} n={inbox.pins.length} testId="inbox-group-pins">
              {inbox.pins.map((v) => (
                <li key={v.pin.id} data-testid="inbox-pin" className="inbox-row">
                  <button type="button" className="inbox-thumb" onClick={() => setPinOpen({ fileId: v.file.id, pinId: v.pin.id })} aria-label={L.hall.viewImage}>
                    <FileImage file={v.file} className="inbox-thumb-img" alt="" />
                    <span className="pin-num" data-status="open" aria-hidden="true">
                      {v.pin.number}
                    </span>
                  </button>
                  <div className="list-main">
                    <span className="t-body-14m break">
                      <U>{v.pin.text}</U>
                    </span>
                    <span className="label break">
                      {rich(v.pin.cell ? L.hall.cellMeta : v.pin.kind === "box" ? L.hall.boxMeta : L.hall.pinMeta, { who: v.by ? <U>{v.by.nickname}</U> : L.hall.someone })} · {ph(v.whereP)} · {waited(msSince(v.pin.at, now))}
                    </span>
                  </div>
                  <Button Label={L.hall.viewImage} Size="Small" Style="Secondary" onClick={() => setPinOpen({ fileId: v.file.id, pinId: v.pin.id })} data-testid="inbox-pin-open" />
                </li>
              ))}
            </InboxGroup>

            <InboxGroup title={L.hall.groupAsked} n={inbox.asked.length} testId="inbox-group-asked">
              {inbox.asked.map((t) => (
                <li key={t.thread.id} className="inbox-row" data-testid="inbox-asked">
                  {t.by ? <MemberAvatar member={t.by} size="28" /> : <Tag tone="info">{L.hall.askedTag}</Tag>}
                  <div className="list-main">
                    <span className="t-body-14m break">
                      <U>{t.thread.text}</U>
                    </span>
                    <span className="label break">
                      {rich(L.hall.askedMeta, { who: t.by ? <U>{t.by.nickname}</U> : L.hall.someone })} · {t.cut ? <Link to={`/cut/${t.cut.id}`}>{ph(t.whereP)}</Link> : ph(t.whereP)} · {waited(msSince(t.thread.at, now))}
                    </span>
                  </div>
                  <Button Label={L.hall.reply} Size="Small" Style="Secondary" onClick={() => setReplyTo(t)} data-testid="inbox-reply" />
                </li>
              ))}
            </InboxGroup>

            <InboxGroup title={L.hall.groupTodos} n={inbox.todos.length} testId="inbox-group-todos">
              {inbox.todos.map((t) => (
                <li key={t.thread.id} className="inbox-row" data-testid="inbox-todo">
                  <Tag tone="warning">{L.hall.todoTag}</Tag>
                  <div className="list-main">
                    <span className="t-body-14m break">
                      {t.cut ? <Link to={`/cut/${t.cut.id}`}>{ph(t.whereP)}</Link> : ph(t.whereP)} · <U>{t.thread.text.replace(/^要补：/, "")}</U>
                    </span>
                    <span className="label">{f(L.hall.ruledAt, { at: relative(t.thread.at, now) })}</span>
                  </div>
                  <Button
                    Label={L.hall.fixed}
                    Size="Small"
                    Style="Secondary"
                    data-testid="inbox-todo-fixed"
                    onClick={() => {
                      const r = dispatch("thread.resolve", { threadId: t.thread.id }, { quiet: true });
                      if (r.ok) notify(say((d) => d.hall.markedFixed), "Neutral");
                    }}
                  />
                </li>
              ))}
            </InboxGroup>

            <InboxGroup title={L.hall.groupReturned} n={inbox.returned.length} testId="inbox-group-returned">
              {inbox.returned.map((q) => (
                <li key={q.view.task.id} className="inbox-row" data-testid="inbox-returned">
                  <StatusPill Status="returned" />
                  <div className="list-main">
                    <span className="t-body-14m">{ph(q.view.titleP)}</span>
                    <span className="label break">
                      {q.lastReturn && q.lastReturn.comments.length ? <U>{q.lastReturn.comments.map((c) => c.text).join(lang === "en" ? "; " : "；")}</U> : f(L.hall.returnedMeta, { v: q.view.versionTag ?? "" })}
                    </span>
                  </div>
                  <Button Label={L.hall.goFix} Size="Small" Style="Secondary" onClick={() => goFix(q.view.task.id)} data-testid="inbox-go-fix" />
                </li>
              ))}
            </InboxGroup>
          </section>
        </div>

        <div className="stack">
          {growth ? (
            <section className="card" aria-label={L.hall.idCard}>
              <div className="me-card-top">
                <MemberAvatar member={me} size="64" />
                <div className="me-card-name">
                  <h2 className="t-section-24">
                    <U>{me.nickname}</U>
                  </h2>
                  <span className="label">
                    {L.labels.role[me.role]} · {f(L.hall.joinedDays, { n: growth.joinedDays })}
                  </span>
                </div>
                <Level level={growth.level.level} />
              </div>
              <XpBar points={growth.points} level={growth.level} />
              <div className="stats">
                <Stat label={L.hall.weekPoints} value={formatPoints(growth.weekPoints)} />
                <Stat label={L.hall.mainStage} value={growth.mainStage ? stageEl(growth.mainStage.group, { templateKey: growth.mainStage.key, name: growth.mainStage.name }) : L.hall.none} zh />
                <Stat label={L.hall.onTime} value={growth.onTime.rate === null ? "—" : `${Math.round(growth.onTime.rate * 100)}%`} />
              </div>
              <Link to="/me" className="label">
                {L.hall.myGrowth}
              </Link>
            </section>
          ) : null}

          {canReview && pendingReviewCount(world) > 0 ? (
            <section className="card" data-size="compact" data-tone="muted" aria-label={L.hall.pending}>
              <div className="row" data-justify="between">
                <span>{rich(L.hall.pendingLine, { all: <span className="num t-body-14m">{pendingReviewCount(world)}</span>, mine: <span className="num t-body-14m">{myQueue}</span> })}</span>
                <Link to="/review">{L.hall.goReview}</Link>
              </div>
            </section>
          ) : null}

          <section className="card" aria-labelledby="feed-title">
            <h2 id="feed-title" className="t-heading-18">
              {L.hall.feed}
            </h2>
            {feed.length === 0 ? (
              <Empty>{L.hall.feedEmpty}</Empty>
            ) : (
              <ul className="list">
                {feed.map((item) => (
                  <li key={item.entry.id}>
                    <div className="list-main">
                      <span className="break">{ph(item.phrase)}</span>
                    </div>
                    <span className="list-meta">{relative(item.at, now)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      {pinOpen && world.files[pinOpen.fileId] ? <Viewer files={[world.files[pinOpen.fileId]]} startId={pinOpen.fileId} focusPinId={pinOpen.pinId} onClose={() => setPinOpen(null)} /> : null}
      {replyTo ? <ReplyDialog view={replyTo} onClose={() => setReplyTo(null)} /> : null}
    </>
  );
}

/** 「等我处理」的一组：小标题「链接打不开 · 1」+ 列表；没有就不显示。 */
function InboxGroup({ title, n, testId, children }: { title: string; n: number; testId: string; children: ReactNode }) {
  if (!n) return null;
  return (
    <div className="inbox-group" data-testid={testId}>
      <p className="inbox-group-title label">
        {title} · <span className="num">{n}</span>
      </p>
      <ul className="list">{children}</ul>
    </div>
  );
}

/** 被问到的：在大厅里直接回复。 */
function ReplyDialog({ view, onClose }: { view: ThreadView; onClose: () => void }) {
  const { dispatch, notify } = useGuild();
  const { L, r: rich, err, say, ph } = useI18n();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = () => {
    const r = dispatch("thread.reply", { threadId: view.thread.id, text }, { quiet: true });
    if (!r.ok) return setError(err(r.error));
    notify(say((d) => d.hall.replied));
    onClose();
  };
  return (
    <Drawer
      Type="Dialog"
      Title={rich(L.hall.replyTitle, { who: view.by ? <U>{view.by.nickname}</U> : L.hall.someone })}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.hall.cancel} Style="Secondary" onClick={onClose} />
          <Button Label={L.hall.reply} Style="Accent" onClick={send} data-testid="inbox-reply-send" />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <div className="quote">
          <span className="label">{ph(view.whereP)}</span>
          <p className="break">
            <U>{view.thread.text}</U>
          </p>
        </div>
        <TextArea label={L.hall.replyLabel} placeholder={L.hall.replyPlaceholder} value={text} onChange={(e) => setText(e.target.value)} data-testid="inbox-reply-text" />
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
