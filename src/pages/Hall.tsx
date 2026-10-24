/** P2 大厅：身份卡 · 当前任务单（黑卡）· 接任务 · 等我处理 · 工会动态。 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Empty, Level, MemberAvatar, Stat, Tag, XpBar } from "@/components/app/bits";
import { MiniQuest, QuestCard } from "@/components/app/quest";
import { isReviewer } from "@/domain/commands/core";
import { formatPoints } from "@/domain/labels";
import { U, useI18n } from "@/i18n/I18n";
import { enrollmentsOf, feedOf, growthOf, inboxOf, pendingReviewCount, questFor, reviewQueue, taskViewById } from "@/domain/queries";
import { Viewer } from "@/components/library/Viewer";
import { LinkList } from "@/components/app/links";
import { Link, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";

export function HallPage() {
  const { world, me, now, dispatch, notify } = useGuild();
  const { L, f, r: rich, ph, relative, say, stage: stageEl } = useI18n();
  const growth = useMemo(() => growthOf(world, me.id), [world, me.id]);
  const quests = useMemo(() => questFor(world, me.id), [world, me.id]);
  const inbox = useMemo(() => inboxOf(world, me.id), [world, me.id]);
  const feed = useMemo(() => feedOf(world, 10), [world]);
  const enrolled = enrollmentsOf(world, me.id).length;
  const route = useRoute();
  const [picked, setPicked] = useState<string | null>(route.query.get("task"));
  const [pinOpen, setPinOpen] = useState<{ fileId: string; pinId: string } | null>(null);
  const current = quests.find((q) => q.view.task.id === picked) ?? quests[0] ?? null;
  const canReview = isReviewer(me);
  const myQueue = canReview ? reviewQueue(world, me.id).length : 0;

  const claim = () => {
    const r = dispatch("task.claim", {});
    if (r.ok && r.created.taskId) {
      setPicked(r.created.taskId);
      const v = taskViewById(r.state, r.created.taskId);
      notify(say((d) => d.hall.gotQuest, { label: v ? v.labelP : say((d) => d.hall.newTask) }));
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">{L.hall.title}</span>
          <h1 className="t-title-32">{rich(L.hall.hello, { name: <U>{me.nickname}</U> })}</h1>
        </div>
        <div className="page-head-actions">
          {canReview ? (
            <Link to="/review" className="ui-button" data-style="Secondary" data-size="Medium">
              {f(L.hall.reviewDesk, { n: myQueue })}
            </Link>
          ) : null}
          {enrolled ? (
            <Button Label={L.hall.claim} Style="Accent" onClick={claim} data-testid="claim" />
          ) : (
            <Link to="/enroll" className="ui-button" data-style="Accent" data-size="Medium">
              {L.hall.goEnroll}
            </Link>
          )}
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

          <section className="card" aria-labelledby="inbox-title">
            <div className="card-head">
              <h2 id="inbox-title" className="t-heading-18">
                {L.hall.inbox} <span className="count">{inbox.total}</span>
              </h2>
            </div>
            {inbox.total === 0 ? (
              <Empty>{L.hall.inboxEmpty}</Empty>
            ) : (
              <ul className="list">
                {inbox.returned.map((q) => (
                  <li key={q.view.task.id}>
                    <Tag tone="danger">{L.hall.returnedTag}</Tag>
                    <div className="list-main">
                      <button type="button" className="inline-link t-body-14m" style={{ textAlign: "left", textDecoration: "none" }} onClick={() => setPicked(q.view.task.id)}>
                        {ph(q.view.titleP)}
                      </button>
                      <span className="label break">{q.lastReturn ? <U>{q.lastReturn.comments.map((c) => c.text).join("；")}</U> : L.hall.seeReview}</span>
                    </div>
                  </li>
                ))}
                {inbox.asked.map((t) => (
                  <li key={t.thread.id}>
                    <Tag tone="info">{L.hall.askedTag}</Tag>
                    <div className="list-main">
                      <Link to={t.cut ? `/cut/${t.cut.id}` : `/project/${t.thread.projectId}`} className="t-body-14m">
                        {ph(t.whereP)}
                      </Link>
                      <span className="label break">{rich(L.hall.saidColon, { who: t.by ? <U>{t.by.nickname}</U> : L.hall.someone, text: <U>{t.thread.text}</U> })}</span>
                    </div>
                  </li>
                ))}
                {inbox.links.map((x) => (
                  <li key={`${x.submission.id}:${x.link.id}`} data-testid="inbox-broken-link" style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div className="row">
                      <Tag tone="danger">{L.hall.brokenLinkTag}</Tag>
                      <span className="t-body-14m break">
                        {ph(x.view.titleP)} v{String(x.submission.versionNo).padStart(2, "0")}
                      </span>
                    </div>
                    <span className="label">{rich(L.hall.brokenBy, { who: x.by ? <U>{x.by.nickname}</U> : L.hall.reviewer })}</span>
                    <LinkList submission={x.submission} compact />
                  </li>
                ))}
                {inbox.pins.map((v) => (
                  <li key={v.pin.id} data-testid="inbox-pin">
                    <Tag tone="danger">{L.hall.pinTag}</Tag>
                    <div className="list-main">
                      <button type="button" className="inline-link t-body-14m" style={{ textAlign: "left", textDecoration: "none" }} onClick={() => setPinOpen({ fileId: v.file.id, pinId: v.pin.id })}>
                        {rich(L.hall.pinNo, { where: v.whereP, n: v.pin.number })}
                      </button>
                      <span className="label break">{rich(L.hall.saidColon, { who: v.by ? <U>{v.by.nickname}</U> : L.hall.someone, text: <U>{v.pin.text}</U> })}</span>
                    </div>
                  </li>
                ))}
                {inbox.todos.map((t) => (
                  <li key={t.thread.id}>
                    <Tag tone="warning">{L.hall.todoTag}</Tag>
                    <div className="list-main">
                      <Link to={t.cut ? `/cut/${t.cut.id}` : `/project/${t.thread.projectId}`} className="t-body-14m">
                        {ph(t.whereP)}
                      </Link>
                      <span className="label break">
                        <U>{t.thread.text.replace(/^要补：/, "")}</U>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
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
    </>
  );
}
