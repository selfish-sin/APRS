/** P3 报到：选组 → 选环节（几张可接、Tn、说明）→ 选熟练度 → 报到 → 弹任务单。像选职业。 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Tag } from "@/components/app/bits";
import { QuestCard } from "@/components/app/quest";
import { skillLabel } from "@/domain/labels";
import { stageText } from "@/domain/templates";
import { U, useI18n } from "@/i18n/I18n";
import { GROUP, PHASE, type Group, type Skill } from "@/domain/model";
import { enrollOptions, enrollmentsOf, questOf, taskById, type EnrollOption } from "@/domain/queries";
import { DEFAULT_MAX_ACTIVE, SKILL_OPTIONS } from "@/domain/rules";
import { GROUPS } from "@/domain/templates";
import { navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";

export function EnrollPage() {
  const { world, me, dispatch, notify } = useGuild();
  const { L, f, r: rich, lang, stageName, stage: stageEl, rate } = useI18n();
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
    else notify(f(picked.open ? L.enroll.enrolledFull : L.enroll.enrolledNone, { stage: stageName(group, { templateKey: picked.template.key, name: picked.template.name }) }), "Neutral");
  };

  const gotTask = gotTaskId ? taskById(world, gotTaskId) : undefined;
  const gotQuest = gotTask ? questOf(world, gotTask, me.id) : null;

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">{L.enroll.title}</span>
          <h1 className="t-title-32">{L.enroll.heading}</h1>
          <p className="muted">{L.enroll.lead}</p>
        </div>
      </div>

      {mine.length ? (
        <section className="card" aria-labelledby="mine-title" data-testid="enroll-mine">
          <div className="card-head">
            <h2 id="mine-title" className="t-heading-18">
              {L.enroll.mine}
            </h2>
            <span className="label">{f(L.enroll.mineCount, { n: mine.length })}</span>
          </div>
          <div className="chips">
            {mine.map((e) => {
              const t = GROUPS[e.group].stages.find((s) => s.key === e.stageKey);
              const custom = !t ? Object.values(world.stages).find((s) => s.templateKey === e.stageKey && !s.archivedAt) : undefined;
              const stageLike = t ? { templateKey: t.key, name: t.name } : custom ?? { templateKey: e.stageKey, name: e.stageKey };
              return (
                <span key={e.id} className="mine-chip" data-testid="enroll-mine-chip">
                  <span>
                    {rich(L.enroll.mineChip, { group: L.labels.group[e.group], stage: stageEl(e.group, stageLike), skill: skillLabel(e.skill), n: e.maxActive })}
                    {e.assigned ? L.enroll.mineAssigned : (e.origin ?? "self") === "claimed" ? L.enroll.mineClaimed : ""}
                  </span>
                  <button
                    type="button"
                    className="inline-link label"
                    onClick={() => {
                      const r = dispatch("enroll.remove", { enrollmentId: e.id });
                      if (r.ok) notify(f(L.enroll.cancelled, { stage: stageName(e.group, stageLike) }), "Neutral");
                    }}
                  >
                    {L.enroll.leave}
                  </button>
                </span>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="stack" data-gap="small" aria-label={L.enroll.step1}>
        <h2 className="t-heading-18">{L.enroll.step1Title}</h2>
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
                <span className="role-card-name">{L.labels.group[g]}</span>
                {GROUPS[g].draft ? <Tag tone="lilac">{L.enroll.draft}</Tag> : null}
              </span>
              <span className="muted label">{f(L.enroll.groupStats, { n: GROUPS[g].stages.length, how: GROUPS[g].hasLayers ? L.enroll.byLayers : f(L.enroll.byUnit, { unit: L.labels.cutLabel[g] }) })}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="stack" data-gap="small" aria-label={L.enroll.step2}>
        <h2 className="t-heading-18">{L.enroll.step2Title}</h2>
        {PHASE.map((phase) => {
          const list = options.filter((o) => o.template.phase === phase);
          if (!list.length) return null;
          return (
            <div key={phase} className="stack" data-gap="small">
              <span className="label">
                {L.labels.phaseLevel[phase]} · {L.labels.phase[phase]}
              </span>
              <div className="enroll-grid">
                {list.map((o) => {
                  const st = stageText(group, { templateKey: o.template.key, name: o.template.name, indicator: { receive: o.template.receive, deliver: o.template.deliver, handTo: o.template.handTo }, note: o.template.note ?? null }, lang);
                  return (
                    <button key={o.template.key} type="button" className="ecard" aria-pressed={stageKey === o.template.key} data-locked={o.lockedForMe ? "yes" : undefined} onClick={() => pick(o.template.key)} data-testid={`role-${o.template.key}`}>
                      <span className="ecard-top">
                        <span className="ecard-code">{o.template.code ?? L.enroll.projectCode}</span>
                        <span className="kind-tag">
                          {L.labels.stageKind[o.template.kind]}
                          {o.template.hub && o.template.kind !== "hub" ? L.enroll.hubSuffix : ""}
                        </span>
                        {o.locked ? <span className="lock-tag">{L.enroll.lockedTag}</span> : null}
                      </span>
                      {o.mine ? (
                        <span className="ecard-badge done-tag">
                          {o.mine.assigned ? L.enroll.assigned : (o.mine.origin ?? "self") === "claimed" ? L.enroll.claimed : L.enroll.enrolled} {skillLabel(o.mine.skill)}
                        </span>
                      ) : null}
                      <span className="ecard-name">{st.name}</span>
                      <span className="ecard-desc">{st.deliver}</span>
                      <span className="ecard-foot">
                        <span className="ecard-open">
                          <span className="num">{o.open}</span>
                          <small>{L.enroll.openCount}</small>
                        </span>
                        <span className="ecard-meta">
                          {o.template.adminSet ? `${L.labels.adminSet.trim().replace(/^[（(]|[）)]$/g, "")} · ` : ""}
                          {rate({ tn: o.tn, per: o.per, unit: o.template.unit }, group)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <section className="card enroll-detail" aria-label={L.enroll.step3} data-testid="enroll-detail">
        {picked ? <PickedStage group={group} option={picked} /> : <p className="muted">{L.enroll.chosenNone}</p>}
        <h2 className="t-heading-18">{f(L.enroll.step3Title, { what: picked ? f(L.enroll.howGood, { stage: stageName(group, { templateKey: picked.template.key, name: picked.template.name }) }) : L.enroll.pickFirst })}</h2>
        <div className="skill-options" role="radiogroup" aria-label={L.enroll.skill}>
          {SKILL_OPTIONS.map((s) => (
            <button key={s.value} type="button" className="option" role="radio" aria-checked={skill === s.value} aria-pressed={skill === s.value} disabled={!picked} onClick={() => setSkill(s.value)}>
              <span className="t-body-14m">{L.enroll.skillOpt[String(s.value) as "0.5" | "0.2" | "0" | "-0.2"]}</span>
              <span className="muted label">{L.enroll.skillHint[String(s.value) as "0.5" | "0.2" | "0" | "-0.2"]}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <span className="label">{L.enroll.maxActive}</span>
          <div className="chips">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" className="ui-chip" aria-pressed={maxActive === n} onClick={() => setMaxActive(n)} disabled={!picked}>
                {f(L.enroll.nTasks, { n })}
              </button>
            ))}
          </div>
        </div>
        <p className="label">{L.enroll.skillNote}</p>
        <div className="form-actions">
          <Button Label={picked?.mine ? L.enroll.update : L.enroll.enroll} Style="Accent" disabled={!picked} onClick={enroll} data-testid="enroll-submit" />
          {picked && !picked.mine && picked.open ? (
            <Button
              Label={f(L.enroll.claimOne, { stage: stageName(group, { templateKey: picked.template.key, name: picked.template.name }) })}
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
        {picked?.lockedForMe ? <p className="label">{L.enroll.lockedForMe}</p> : null}
      </section>

      {gotQuest ? (
        <Drawer
          Type="Dialog"
          Title={L.enroll.gotTitle}
          open
          onClose={() => setGotTaskId(null)}
          actions={
            <>
              <Button Label={L.enroll.stay} Style="Secondary" onClick={() => setGotTaskId(null)} />
              <Button Label={L.enroll.goHall} Style="Accent" onClick={() => navigate(`/hall?task=${gotTaskId}`)} data-testid="goto-hall" />
            </>
          }
        >
          <QuestCard quest={gotQuest} eyebrow={L.enroll.newQuest} actions={false} />
        </Drawer>
      ) : null}
    </>
  );
}

/** 选中的环节：名字 · 类型 · 几张可接 · Tn · 几人报到，收什么 / 交什么 / 说明（不丢）。 */
function PickedStage({ group, option: o }: { group: Group; option: EnrollOption }) {
  const { L, f, lang, rate } = useI18n();
  const st = stageText(group, { templateKey: o.template.key, name: o.template.name, indicator: { receive: o.template.receive, deliver: o.template.deliver, handTo: o.template.handTo }, note: o.template.note ?? null }, lang);
  const kind = `${L.labels.stageKind[o.template.kind]}${o.template.hub && o.template.kind !== "hub" ? L.enroll.hubSuffix : ""}`;
  return (
    <div className="stack" data-gap="small" data-testid="enroll-picked">
      <div className="row" data-justify="between">
        <strong className="t-body-14m">{f(L.enroll.chosen, { stage: st.name, kind })}</strong>
        {o.locked ? <span className="lock-tag">{L.enroll.lockedTag}</span> : null}
      </div>
      <span className="label">
        {f(L.enroll.chosenMeta, { open: o.open, rate: rate({ tn: o.tn, per: o.per, unit: o.template.unit }, group), n: o.enrolled })}
        {o.template.adminSet ? L.labels.adminSet : ""}
      </span>
      <span className="muted label break">{f(L.enroll.receiveDeliver, { receive: st.receive, deliver: st.deliver })}</span>
      {st.note ? <span className="label">{st.note}</span> : null}
    </div>
  );
}
