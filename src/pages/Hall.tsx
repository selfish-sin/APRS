/** P2 大厅：身份卡 · 当前任务单（黑卡）· 接任务 · 等我处理 · 工会动态。 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Empty, Level, MemberAvatar, Stat, Tag, XpBar } from "@/components/app/bits";
import { MiniQuest, QuestCard } from "@/components/app/quest";
import { relativeZh } from "@/domain/clock";
import { isReviewer } from "@/domain/commands/core";
import { formatPoints, ROLE_LABEL } from "@/domain/labels";
import { enrollmentsOf, feedOf, growthOf, inboxOf, pendingReviewCount, questFor, reviewQueue, taskViewById } from "@/domain/queries";
import { Link } from "@/lib/router";
import { useGuild } from "@/lib/store";

export function HallPage() {
  const { world, me, now, dispatch, notify } = useGuild();
  const growth = useMemo(() => growthOf(world, me.id), [world, me.id]);
  const quests = useMemo(() => questFor(world, me.id), [world, me.id]);
  const inbox = useMemo(() => inboxOf(world, me.id), [world, me.id]);
  const feed = useMemo(() => feedOf(world, 10), [world]);
  const enrolled = enrollmentsOf(world, me.id).length;
  const [picked, setPicked] = useState<string | null>(null);
  const current = quests.find((q) => q.view.task.id === picked) ?? quests[0] ?? null;
  const canReview = isReviewer(me);
  const myQueue = canReview ? reviewQueue(world, me.id).length : 0;

  const claim = () => {
    const r = dispatch("task.claim", {});
    if (r.ok && r.created.taskId) {
      setPicked(r.created.taskId);
      const v = taskViewById(r.state, r.created.taskId);
      notify(`拿到一张任务单：${v ? v.label : "新任务"}`);
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">大厅</span>
          <h1 className="t-title-32">你好，{me.nickname}</h1>
        </div>
        <div className="page-head-actions">
          {canReview ? <Link to="/review" className="ui-button" data-style="Secondary" data-size="Medium">{`审核台 · ${myQueue} 张等你审`}</Link> : null}
          {enrolled ? <Button Label="接任务" Style="Accent" onClick={claim} data-testid="claim" /> : <Link to="/enroll" className="ui-button" data-style="Accent" data-size="Medium">去报到</Link>}
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          {current ? (
            <QuestCard quest={current} />
          ) : (
            <section className="card" aria-label="当前任务单">
              <h2 className="t-heading-18">手上没有任务单</h2>
              <Empty
                action={
                  enrolled ? <Button Label="接任务" Style="Accent" onClick={claim} /> : <Link to="/enroll" className="ui-button" data-style="Accent" data-size="Medium">去报到一个环节</Link>
                }
              >
                {enrolled ? "点「接任务」，从你报到的环节里按卡号配一张。" : "先报到一个环节（选你会做的、选熟练度），系统马上给你配一张。"}
              </Empty>
            </section>
          )}
          {quests.length > 1 ? (
            <section className="stack" data-gap="small" aria-label="手上的其他任务">
              <h2 className="t-heading-18">
                手上的任务 <span className="count">{quests.length}</span>
              </h2>
              {quests.map((q) => (
                <MiniQuest key={q.view.task.id} quest={q} selected={q.view.task.id === current?.view.task.id} onSelect={() => setPicked(q.view.task.id)} />
              ))}
            </section>
          ) : null}

          <section className="card" aria-labelledby="inbox-title">
            <div className="card-head">
              <h2 id="inbox-title" className="t-heading-18">
                等我处理 <span className="count">{inbox.total}</span>
              </h2>
            </div>
            {inbox.total === 0 ? (
              <Empty>没有退回的、没人问你、也没有要补的。</Empty>
            ) : (
              <ul className="list">
                {inbox.returned.map((q) => (
                  <li key={q.view.task.id}>
                    <Tag tone="danger">退回的</Tag>
                    <div className="list-main">
                      <button type="button" className="inline-link t-body-14m" style={{ textAlign: "left", textDecoration: "none" }} onClick={() => setPicked(q.view.task.id)}>
                        {q.view.title}
                      </button>
                      <span className="label break">{q.lastReturn?.comments.map((c) => c.text).join("；") ?? "看审核意见"}</span>
                    </div>
                  </li>
                ))}
                {inbox.asked.map((t) => (
                  <li key={t.thread.id}>
                    <Tag tone="info">被问到的</Tag>
                    <div className="list-main">
                      <Link to={t.cut ? `/cut/${t.cut.id}` : `/project/${t.thread.projectId}`} className="t-body-14m">
                        {t.where}
                      </Link>
                      <span className="label break">
                        {t.by?.nickname ?? "有人"}：{t.thread.text}
                      </span>
                    </div>
                  </li>
                ))}
                {inbox.todos.map((t) => (
                  <li key={t.thread.id}>
                    <Tag tone="warning">要补的</Tag>
                    <div className="list-main">
                      <Link to={t.cut ? `/cut/${t.cut.id}` : `/project/${t.thread.projectId}`} className="t-body-14m">
                        {t.where}
                      </Link>
                      <span className="label break">{t.thread.text.replace(/^要补：/, "")}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="stack">
          {growth ? (
            <section className="card" aria-label="我的身份卡">
              <div className="me-card-top">
                <MemberAvatar member={me} size="64" />
                <div className="me-card-name">
                  <h2 className="t-section-24">{me.nickname}</h2>
                  <span className="label">
                    {ROLE_LABEL[me.role]} · 加入 {growth.joinedDays} 天
                  </span>
                </div>
                <Level level={growth.level.level} />
              </div>
              <XpBar points={growth.points} level={growth.level} />
              <div className="stats">
                <Stat label="本周活力点" value={formatPoints(growth.weekPoints)} />
                <Stat label="主环节" value={growth.mainStage?.name ?? "还没有"} zh />
                <Stat label="准时率" value={growth.onTime.rate === null ? "—" : `${Math.round(growth.onTime.rate * 100)}%`} />
              </div>
              <Link to="/me" className="label">
                看我的成长 →
              </Link>
            </section>
          ) : null}

          {canReview && pendingReviewCount(world) > 0 ? (
            <section className="card" data-size="compact" data-tone="muted" aria-label="待审">
              <div className="row" data-justify="between">
                <span>
                  全工会在等审核的 <span className="num t-body-14m">{pendingReviewCount(world)}</span> 张，你能审的 <span className="num t-body-14m">{myQueue}</span> 张
                </span>
                <Link to="/review">去审核台</Link>
              </div>
            </section>
          ) : null}

          <section className="card" aria-labelledby="feed-title">
            <h2 id="feed-title" className="t-heading-18">
              工会动态
            </h2>
            {feed.length === 0 ? (
              <Empty>还没有动静。</Empty>
            ) : (
              <ul className="list">
                {feed.map((f) => (
                  <li key={f.entry.id}>
                    <div className="list-main">
                      <span className="break">{f.text}</span>
                    </div>
                    <span className="list-meta">{relativeZh(f.at, now)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
