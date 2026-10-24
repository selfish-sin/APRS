/** P9 成员页：Lv · 经验 · 活力点流水 · 准时率 · 做过的环节 · 和谁合作过 · 加入多久。外加成员名单。 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Empty, Level, MemberAvatar, Stat, Tag, TextField, XpBar } from "@/components/app/bits";
import { localDate } from "@/domain/clock";
import { formatPoints, skillLabel } from "@/domain/labels";
import { U, useI18n } from "@/i18n/I18n";
import { AVATAR_TONE, type AvatarToneName } from "@/domain/model";
import { accountOfMember, collaboratorsOf, enrollmentsOf, growthOf, memberRoles, members, memberById, taskViewById } from "@/domain/queries";
import { isAdmin } from "@/domain/commands/core";
import { ExportMyRecord } from "@/components/app/report";
import { SelectField } from "@/components/app/bits";
import type { Group } from "@/domain/model";
import { GROUPS } from "@/domain/templates";
import { makePasscode, passcodeProblem } from "@/lib/passcode";
import { Link, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NotFound } from "./NotFound";

export function MemberPage() {
  const { world, me } = useGuild();
  const { L, f, r: rich, ph, date, dateTime, num, stage: stageEl } = useI18n();
  const route = useRoute();
  const id = route.path === "/me" ? me.id : route.segments[1];
  const member = memberById(world, id);
  const growth = useMemo(() => (member ? growthOf(world, member.id) : null), [world, member]);
  const collaborators = useMemo(() => (member ? collaboratorsOf(world, member.id) : []), [world, member]);
  const [editing, setEditing] = useState<"profile" | "passcode" | null>(null);
  if (!member || !growth) return <NotFound what="member" />;
  const self = member.id === me.id;
  const enrollments = enrollmentsOf(world, member.id);
  const maxCount = Math.max(1, ...growth.stages.map((s) => s.count));

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/members">{L.member.members}</Link>
            <span>/</span>
            <span>
              <U>{member.nickname}</U>
            </span>
          </div>
          <h1 className="t-title-32">{self ? L.member.me : <U>{member.nickname}</U>}</h1>
        </div>
        {self ? (
          <div className="page-head-actions">
            <Button Label={L.member.editProfile} Style="Secondary" onClick={() => setEditing("profile")} />
            {accountOfMember(world, me.id) ? <Button Label={L.member.changePasscode} Style="Secondary" onClick={() => setEditing("passcode")} /> : null}
          </div>
        ) : null}
      </div>

      <div className="grid-2">
        <div className="stack">
          <section className="card" aria-label={L.member.levelAria}>
            <div className="me-card-top">
              <MemberAvatar member={member} size="64" />
              <div className="me-card-name">
                <h2 className="t-section-24">
                  <U>{member.nickname}</U>
                </h2>
                <span className="label">
                  {L.labels.role[member.role]} · {f(L.member.joined, { date: date(localDate(member.joinedAt)) })}
                </span>
              </div>
              <Level level={growth.level.level} />
            </div>
            <XpBar points={growth.points} level={growth.level} />
            <div className="stats">
              <Stat label={L.member.totalPoints} value={formatPoints(growth.points)} testId="points" />
              <Stat label={L.member.thisWeek} value={formatPoints(growth.weekPoints)} />
              <Stat label={L.member.onTime} value={growth.onTime.rate === null ? "—" : `${Math.round(growth.onTime.rate * 100)}%`} />
              <Stat label={L.member.joinedFor} value={f(L.member.days, { n: growth.joinedDays })} />
              <Stat label={L.member.mainStage} value={growth.mainStage ? stageEl(growth.mainStage.group, { templateKey: growth.mainStage.key, name: growth.mainStage.name }) : L.member.none} zh />
              <Stat label={L.member.done} value={f(L.member.tasksN, { n: growth.passedTasks })} />
            </div>
            {growth.onTime.total ? <p className="label">{f(L.member.onTimeNote, { total: growth.onTime.total, n: growth.onTime.onTime })}</p> : null}
          </section>

          <section className="card" aria-labelledby="ledger-title">
            <h2 id="ledger-title" className="t-heading-18">
              {L.member.ledger} <span className="count">{growth.ledger.length}</span>
            </h2>
            {growth.ledger.length === 0 ? (
              <Empty>{L.member.ledgerEmpty}</Empty>
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{L.member.when}</th>
                      <th>{L.member.task}</th>
                      <th className="num">{L.member.formula}</th>
                      <th className="num">{L.member.points}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {growth.ledger.slice(0, 80).map((l) => {
                      const v = taskViewById(world, l.taskId);
                      return (
                        <tr key={l.id}>
                          <td className="label">{dateTime(l.at)}</td>
                          <td>
                            {v ? (
                              v.cut ? (
                                <Link to={`/cut/${v.cut.id}`}>
                                  {v.project.code} {ph(v.labelP)}
                                </Link>
                              ) : (
                                <Link to={`/project/${v.project.id}`}>
                                  {v.project.code} {ph(v.labelP)}
                                </Link>
                              )
                            ) : (
                              "—"
                            )}
                            {l.kind !== "task" ? <Tag tone={l.kind === "penalty" ? "danger" : "lilac"}>{L.labels.ledgerKind[l.kind]}</Tag> : null}
                          </td>
                          <td className="num label">{l.kind === "penalty" ? (v ? rich(L.member.penaltyNote, { label: v.labelP }) : l.note ? <U>{l.note}</U> : "") : `${num(l.hours)} × ${num(l.factor)} × ${l.quality.toFixed(1)}`}</td>
                          <td className="num t-body-14m">{formatPoints(l.points, true)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {growth.ledger.length > 80 ? <p className="label">{L.member.ledgerMore}</p> : null}
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="stages-title">
            <h2 id="stages-title" className="t-heading-18">
              {L.member.stagesDone}
            </h2>
            {growth.stages.length === 0 ? (
              <Empty>{L.member.stagesEmpty}</Empty>
            ) : (
              <ul className="list">
                {growth.stages.map((s) => (
                  <li key={`${s.group}:${s.key}`} style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div className="row" data-justify="between">
                      <span className="t-body-14m">{stageEl(s.group, { templateKey: s.key, name: s.name })}</span>
                      <span className="label">{rich(L.member.stageCount, { n: s.count, points: <span className="num">{formatPoints(s.points)}</span> })}</span>
                    </div>
                    <div className="xp-bar" aria-hidden="true">
                      <div className="xp-fill" style={{ width: `${Math.round((s.count / maxCount) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="collab-title">
            <h2 id="collab-title" className="t-heading-18">
              {L.member.collaborators}
            </h2>
            {collaborators.length === 0 ? (
              <Empty>{L.member.collaboratorsEmpty}</Empty>
            ) : (
              <ul className="list">
                {collaborators.slice(0, 12).map((c) => (
                  <li key={c.member.id}>
                    <MemberAvatar member={c.member} />
                    <div className="list-main">
                      <Link to={`/member/${c.member.id}`} className="t-body-14m">
                        <U>{c.member.nickname}</U>
                      </Link>
                      <span className="label">{L.labels.role[c.member.role]}</span>
                    </div>
                    <span className="list-meta">{f(L.member.togetherCuts, { n: c.cuts })}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <MemberRolesCard memberId={member.id} self={self} />
          {self || isAdmin(me) ? (
            <section className="card" aria-label={L.member.exportTitle}>
              <h2 className="t-heading-18">{L.member.exportTitle}</h2>
              <p className="muted">{L.member.exportLead}</p>
              <div className="form-actions">
                <ExportMyRecord memberId={member.id} />
              </div>
            </section>
          ) : null}
        </div>
      </div>
      {editing === "profile" ? <ProfileDialog onClose={() => setEditing(null)} /> : null}
      {editing === "passcode" ? <MyPasscodeDialog onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { me, dispatch, notify } = useGuild();
  const { L, err } = useI18n();
  const [nickname, setNickname] = useState(me.nickname);
  const [tone, setTone] = useState<AvatarToneName>(me.tone);
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer
      Type="Dialog"
      Title={L.member.editProfile}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.member.cancel} Style="Secondary" onClick={onClose} />
          <Button
            Label={L.member.save}
            Style="Accent"
            onClick={() => {
              const r = dispatch("member.update", { memberId: me.id, nickname, tone }, { quiet: true });
              if (!r.ok) return setError(err(r.error));
              notify(L.member.saved, "Neutral");
              onClose();
            }}
          />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <TextField label={L.member.nickname} value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={16} />
        <span className="label">{L.member.avatarColor}</span>
        <div className="chips">
          {AVATAR_TONE.map((t) => (
            <button key={t} type="button" className="ui-chip" aria-pressed={tone === t} onClick={() => setTone(t)}>
              <MemberAvatar member={{ ...me, tone: t }} size="20" />
              {L.member.tone[t]}
            </button>
          ))}
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </Drawer>
  );
}

function MyPasscodeDialog({ onClose }: { onClose: () => void }) {
  const { world, me, dispatch, notify } = useGuild();
  const { L, t2, err } = useI18n();
  const account = accountOfMember(world, me.id);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!account) return null;
  return (
    <Drawer
      Type="Dialog"
      Title={L.member.myPasscode}
      Body={L.member.myPasscodeBody}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.member.cancel} Style="Secondary" onClick={onClose} />
          <Button
            Label={L.member.save}
            Style="Accent"
            onClick={async () => {
              const p = passcodeProblem(a, b);
              if (p) return setError(t2(p));
              const { salt, hash } = await makePasscode(a);
              const r = dispatch("account.set_passcode", { accountId: account.id, salt, hash }, { quiet: true });
              if (!r.ok) return setError(err(r.error));
              notify(L.member.passcodeChanged);
              onClose();
            }}
          />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <TextField label={L.member.newPasscode} type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} hint={L.member.passcodeHint} />
        <TextField label={L.member.again} type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </Drawer>
  );
}

export function MembersPage() {
  const { world } = useGuild();
  const { L, r: rich, stage: stageEl } = useI18n();
  const list = members(world).map((m) => ({ m, g: growthOf(world, m.id)! }));
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">{L.member.members}</span>
          <h1 className="t-title-32">
            {L.member.members} <span className="num">{list.length}</span>
          </h1>
        </div>
      </div>
      <div className="cards">
        {list.map(({ m, g }) => (
          <Link key={m.id} to={`/member/${m.id}`} className="card project-card" aria-label={m.nickname}>
            <div className="me-card-top">
              <MemberAvatar member={m} size="40" />
              <div className="me-card-name">
                <span className="t-heading-18">
                  <U>{m.nickname}</U>
                </span>
                <span className="label">
                  {L.labels.role[m.role]} · {rich(L.member.mainStageOf, { stage: g.mainStage ? stageEl(g.mainStage.group, { templateKey: g.mainStage.key, name: g.mainStage.name }) : L.member.none })}
                </span>
              </div>
              <Level level={g.level.level} />
            </div>
            <XpBar points={g.points} level={g.level} />
          </Link>
        ))}
      </div>
    </>
  );
}

/** 成员的两部分（SPEC §13.1）：指派的职位 · 自己报到 / 认领做过的环节。管理员能在这里指派、撤掉职位。 */
function MemberRolesCard({ memberId, self }: { memberId: string; self: boolean }) {
  const { world, me, dispatch, notify } = useGuild();
  const { L, f, err, stageName, stage: stageEl } = useI18n();
  const roles = memberRoles(world, memberId);
  const admin = isAdmin(me);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const member = world.members[memberId];
  const options = (Object.keys(GROUPS) as Group[]).flatMap((g) => GROUPS[g].stages.map((s) => ({ value: `${g}:${s.key}`, label: `${L.labels.group[g]} · ${stageName(g, { templateKey: s.key, name: s.name })}` })));
  return (
    <section className="card" aria-labelledby="roles-title" data-testid="member-roles">
      <h2 id="roles-title" className="t-heading-18">
        {L.member.rolesTitle}
      </h2>
      <div className="stack" data-gap="small">
        <span className="label">{L.member.assignedRoles}</span>
        {roles.assigned.length === 0 ? (
          <p className="muted">{L.member.noAssigned}</p>
        ) : (
          <ul className="list">
            {roles.assigned.map((r) => (
              <li key={r.enrollment.id} data-testid="role-assigned">
                <div className="list-main">
                  <span>
                    {stageEl(r.enrollment.group, { templateKey: r.enrollment.stageKey, name: r.name })} <Tag tone="inverse">{L.member.assignedTag}</Tag>
                  </span>
                  <span className="label">
                    {L.labels.group[r.enrollment.group]} · {f(L.member.skill, { skill: skillLabel(r.enrollment.skill) })}
                  </span>
                </div>
                {admin ? (
                  <Button
                    Label={L.member.remove}
                    Size="Small"
                    Style="Ghost"
                    onClick={() => {
                      const res = dispatch("role.unassign", { memberId, group: r.enrollment.group, stageKey: r.enrollment.stageKey });
                      if (res.ok) notify(f(L.member.removed, { name: member?.nickname ?? "", stage: stageName(r.enrollment.group, { templateKey: r.enrollment.stageKey, name: r.name }) }), "Neutral");
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {admin ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const [group, stageKey] = pick.split(":");
              const res = dispatch("role.assign", { memberId, group: group as Group, stageKey }, { quiet: true });
              if (!res.ok) setError(err(res.error));
              else {
                setError(null);
                setPick("");
                notify(f(L.member.assigned, { name: member?.nickname ?? "" }));
              }
            }}
          >
            <SelectField label={L.member.pickRole} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="role-pick">
              <option value="">{L.member.pickStage}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectField>
            <Button Label={L.member.assign} Size="Small" Style="Accent" type="submit" disabled={!pick} data-testid="role-assign" />
          </form>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
      </div>
      <div className="stack" data-gap="small">
        <span className="label">{L.member.ownRoles}</span>
        {roles.own.length === 0 ? (
          <Empty action={self ? <Link to="/enroll">{L.member.goEnroll}</Link> : undefined}>{L.member.noneYet}</Empty>
        ) : (
          <ul className="list">
            {roles.own.map((r) => (
              <li key={r.enrollment.id} data-testid="role-own">
                <div className="list-main">
                  <span>
                    {stageEl(r.enrollment.group, { templateKey: r.enrollment.stageKey, name: r.name })} {r.claimed ? <Tag tone="sky">{L.member.claimedTag}</Tag> : null}
                  </span>
                  <span className="label">
                    {L.labels.group[r.enrollment.group]} · {f(L.member.skill, { skill: skillLabel(r.enrollment.skill) })} · {f(L.member.doneN, { n: r.done })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
