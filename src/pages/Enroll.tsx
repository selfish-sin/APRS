/** P3 报到：选组 → 选环节（几张可接、Tn、说明）→ 选熟练度 → 报到 → 弹任务单。像选职业。 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Empty, Tag } from "@/components/app/bits";
import { QuestCard } from "@/components/app/quest";
import { StageShape } from "@/components/app/stage";
import { PHASE_LABEL, PHASE_LEVEL, STAGE_KIND_LABEL, rateLabel, skillLabel } from "@/domain/labels";
import { GROUP, PHASE, type Group, type Skill } from "@/domain/model";
import { enrollOptions, enrollmentsOf, questOf, taskById } from "@/domain/queries";
import { DEFAULT_MAX_ACTIVE, SKILL_OPTIONS } from "@/domain/rules";
import { GROUPS } from "@/domain/templates";
import { navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";

export function EnrollPage() {
  const { world, me, dispatch, notify } = useGuild();
  const route = useRoute();
  const qGroup = route.query.get("group");
  const [group, setGroup] = useState<Group>(GROUP.includes(qGroup as Group) ? (qGroup as Group) : "animation");
  const [stageKey, setStageKey] = useState<string | null>(route.query.get("stage"));
  const options = useMemo(() => enrollOptions(world, me.id, group), [world, me.id, group]);
  const picked = options.find((o) => o.template.key === stageKey) ?? null;
  const [skill, setSkill] = useState<Skill>(picked?.mine?.skill ?? 0);
  const [maxActive, setMaxActive] = useState<number>(picked?.mine?.maxActive ?? DEFAULT_MAX_ACTIVE);
  const [gotTaskId, setGotTaskId] = useState<string | null>(null);
  const mine = enrollmentsOf(world, me.id);

  const pick = (key: string) => {
    setStageKey(key);
    const o = options.find((x) => x.template.key === key);
    setSkill(o?.mine?.skill ?? 0);
    setMaxActive(o?.mine?.maxActive ?? DEFAULT_MAX_ACTIVE);
  };

  const enroll = () => {
    if (!picked) return;
    const r = dispatch("enroll.add", { group, stageKey: picked.template.key, skill, maxActive });
    if (!r.ok) return;
    if (r.created.taskId) setGotTaskId(r.created.taskId);
    else notify(picked.open ? `报到好了。你手上的「${picked.template.name}」已经到上限，交掉一张再接。` : `报到好了。「${picked.template.name}」现在没有可接的，放出来以后点「接任务」。`, "Neutral");
  };

  const gotTask = gotTaskId ? taskById(world, gotTaskId) : undefined;
  const gotQuest = gotTask ? questOf(world, gotTask, me.id) : null;

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">报到</span>
          <h1 className="t-title-32">选一个你要做的环节</h1>
          <p className="muted">报到完马上按卡号顺序给你配一张任务单；一次最多拿几张自己定。</p>
        </div>
      </div>

      <section className="stack" data-gap="small" aria-label="第一步：选组">
        <h2 className="t-heading-18">1 · 选组</h2>
        <div className="group-tiles">
          {GROUP.map((g) => (
            <button
              key={g}
              type="button"
              className="role-card"
              aria-pressed={group === g}
              onClick={() => {
                setGroup(g);
                setStageKey(null);
              }}
            >
              <span className="role-card-top">
                <span className="role-card-name">{GROUPS[g].name}</span>
                {GROUPS[g].draft ? <Tag tone="lilac">草案</Tag> : null}
              </span>
              <span className="muted label">
                {GROUPS[g].stages.length} 个环节 · {GROUPS[g].hasLayers ? "按卡、分 A / B 层" : `按${GROUPS[g].cutLabel}`}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="stack" data-gap="small" aria-label="第二步：选环节">
        <h2 className="t-heading-18">2 · 选环节</h2>
        {PHASE.map((phase) => {
          const list = options.filter((o) => o.template.phase === phase);
          if (!list.length) return null;
          return (
            <div key={phase} className="stack" data-gap="small">
              <span className="label">
                {PHASE_LEVEL[phase]} · {PHASE_LABEL[phase]}
              </span>
              <div className="roles">
                {list.map((o) => (
                  <button key={o.template.key} type="button" className="role-card" aria-pressed={stageKey === o.template.key} onClick={() => pick(o.template.key)} data-testid={`role-${o.template.key}`}>
                    <span className="role-card-top">
                      <StageShape kind={o.template.kind} hub={o.template.hub} state={o.open ? "open" : "locked"} size={28} />
                      <span className="role-card-name">{o.template.name}</span>
                      {o.mine ? <Tag tone="inverse">{o.mine.assigned ? "指派" : (o.mine.origin ?? "self") === "claimed" ? "自己认领" : "已报到"} {skillLabel(o.mine.skill)}</Tag> : null}
                      {o.locked ? <Tag tone="warning">只给指派的人</Tag> : null}
                    </span>
                    <span className="role-card-numbers">
                      <span>
                        <span className="num">{o.open}</span> <span className="label">张可接</span>
                      </span>
                      <span>
                        <span className="num">{o.enrolled}</span> <span className="label">人报到</span>
                      </span>
                    </span>
                    <span className="label">
                      {STAGE_KIND_LABEL[o.template.kind]}
                      {o.template.hub && o.template.kind !== "hub" ? " · 枢纽" : ""} · {rateLabel({ tn: o.tn, per: o.per, unit: o.template.unit, unitLabel: o.template.unitLabel })}
                      {o.template.adminSet ? "（管理员定）" : ""}
                    </span>
                    <span className="muted label break">
                      收：{o.template.receive} → 交：{o.template.deliver}
                    </span>
                    {o.template.note ? <span className="label">{o.template.note}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="card" aria-label="第三步：熟练度">
        <h2 className="t-heading-18">3 · {picked ? `「${picked.template.name}」你做得怎么样` : "先选一个环节"}</h2>
        <div className="skill-options" role="radiogroup" aria-label="熟练度">
          {SKILL_OPTIONS.map((s) => (
            <button key={s.value} type="button" className="option" role="radio" aria-checked={skill === s.value} aria-pressed={skill === s.value} disabled={!picked} onClick={() => setSkill(s.value)}>
              <span className="t-body-14m">{s.label}</span>
              <span className="muted label">{s.hint}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <span className="label">同时最多拿</span>
          <div className="chips">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" className="ui-chip" aria-pressed={maxActive === n} onClick={() => setMaxActive(n)} disabled={!picked}>
                {n} 张
              </button>
            ))}
          </div>
        </div>
        <p className="label">熟练度会算进活力点：活力点 = 工时 ×（掌控系数 + 熟练度）× 质量。</p>
        <div className="form-actions">
          <Button Label={picked?.mine ? "更新报到，再配一张" : "报到"} Style="Accent" disabled={!picked} onClick={enroll} data-testid="enroll-submit" />
          {picked && !picked.mine && picked.open ? (
            <Button
              Label={`直接认领一张「${picked.template.name}」`}
              Style="Secondary"
              data-testid="enroll-claim"
              onClick={() => {
                // 不是自己职位的环节也能认领：第一次认领自动报到（熟练度 0，标「自己认领」）。
                const r = dispatch("task.claim", { group, stageKey: picked.template.key });
                if (r.ok && r.created.taskId) setGotTaskId(r.created.taskId);
              }}
            />
          ) : null}
        </div>
        {picked?.lockedForMe ? <p className="label">这个环节只给指派的人，找管理员。</p> : null}
      </section>

      <section className="card" aria-labelledby="mine-title">
        <h2 id="mine-title" className="t-heading-18">
          我报到的环节 <span className="count">{mine.length}</span>
        </h2>
        {mine.length === 0 ? (
          <Empty>还没有报到。</Empty>
        ) : (
          <ul className="list">
            {mine.map((e) => {
              const t = GROUPS[e.group].stages.find((s) => s.key === e.stageKey);
              return (
                <li key={e.id}>
                  <div className="list-main">
                    <span className="t-body-14m">{t?.name ?? e.stageKey}</span>
                    <span className="label">
                      {GROUPS[e.group].name} · 熟练度 {skillLabel(e.skill)} · 同时最多 {e.maxActive} 张
                      {e.assigned ? " · 指派" : (e.origin ?? "self") === "claimed" ? " · 自己认领" : ""}
                    </span>
                  </div>
                  <Button
                    Label="取消报到"
                    Size="Small"
                    Style="Ghost"
                    onClick={() => {
                      const r = dispatch("enroll.remove", { enrollmentId: e.id });
                      if (r.ok) notify(`取消了「${t?.name ?? ""}」的报到，手上的任务不动`, "Neutral");
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {gotQuest ? (
        <Drawer
          Type="Dialog"
          Title="拿到一张任务单"
          open
          onClose={() => setGotTaskId(null)}
          actions={
            <>
              <Button Label="留在这里" Style="Secondary" onClick={() => setGotTaskId(null)} />
              <Button Label="去大厅交" Style="Accent" onClick={() => navigate(`/hall?task=${gotTaskId}`)} data-testid="goto-hall" />
            </>
          }
        >
          <QuestCard quest={gotQuest} eyebrow="新任务单" actions={false} />
        </Drawer>
      ) : null}
    </>
  );
}
