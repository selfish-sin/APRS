/** P9 成员页：Lv · 经验 · 活力点流水 · 准时率 · 做过的环节 · 和谁合作过 · 加入多久。外加成员名单。 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Empty, Level, MemberAvatar, Stat, Tag, TextField, XpBar } from "@/components/app/bits";
import { dateTimeZh, dateZh, localDate } from "@/domain/clock";
import { GROUP_LABEL, LEDGER_KIND_LABEL, ROLE_LABEL, formatNumber, formatPoints, skillLabel } from "@/domain/labels";
import { AVATAR_TONE, type AvatarToneName } from "@/domain/model";
import { accountOfMember, collaboratorsOf, enrollmentsOf, growthOf, memberRoles, members, memberById, taskViewById } from "@/domain/queries";
import { isAdmin } from "@/domain/commands/core";
import { SelectField } from "@/components/app/bits";
import type { Group } from "@/domain/model";
import { GROUPS } from "@/domain/templates";
import { makePasscode, passcodeProblem } from "@/lib/passcode";
import { Link, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NotFound } from "./NotFound";

export function MemberPage() {
  const { world, me } = useGuild();
  const route = useRoute();
  const id = route.path === "/me" ? me.id : route.segments[1];
  const member = memberById(world, id);
  const growth = useMemo(() => (member ? growthOf(world, member.id) : null), [world, member]);
  const collaborators = useMemo(() => (member ? collaboratorsOf(world, member.id) : []), [world, member]);
  const [editing, setEditing] = useState<"profile" | "passcode" | null>(null);
  if (!member || !growth) return <NotFound what="这个成员" />;
  const self = member.id === me.id;
  const enrollments = enrollmentsOf(world, member.id);
  const maxCount = Math.max(1, ...growth.stages.map((s) => s.count));

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/members">成员</Link>
            <span>/</span>
            <span>{member.nickname}</span>
          </div>
          <h1 className="t-title-32">{self ? "我的成长" : member.nickname}</h1>
        </div>
        {self ? (
          <div className="page-head-actions">
            <Button Label="改昵称和颜色" Style="Secondary" onClick={() => setEditing("profile")} />
            {accountOfMember(world, me.id) ? <Button Label="改口令" Style="Secondary" onClick={() => setEditing("passcode")} /> : null}
          </div>
        ) : null}
      </div>

      <div className="grid-2">
        <div className="stack">
          <section className="card" aria-label="等级和经验">
            <div className="me-card-top">
              <MemberAvatar member={member} size="64" />
              <div className="me-card-name">
                <h2 className="t-section-24">{member.nickname}</h2>
                <span className="label">
                  {ROLE_LABEL[member.role]} · {dateZh(localDate(member.joinedAt))}加入
                </span>
              </div>
              <Level level={growth.level.level} />
            </div>
            <XpBar points={growth.points} level={growth.level} />
            <div className="stats">
              <Stat label="累计活力点" value={formatPoints(growth.points)} testId="points" />
              <Stat label="本周" value={formatPoints(growth.weekPoints)} />
              <Stat label="准时率" value={growth.onTime.rate === null ? "—" : `${Math.round(growth.onTime.rate * 100)}%`} />
              <Stat label="加入" value={`${growth.joinedDays} 天`} />
              <Stat label="主环节" value={growth.mainStage?.name ?? "还没有"} zh />
              <Stat label="做过" value={`${growth.passedTasks} 张`} />
            </div>
            {growth.onTime.total ? (
              <p className="label">
                交过 {growth.onTime.total} 次，时限内交的 {growth.onTime.onTime} 次。
              </p>
            ) : null}
          </section>

          <section className="card" aria-labelledby="ledger-title">
            <h2 id="ledger-title" className="t-heading-18">
              活力点流水 <span className="count">{growth.ledger.length}</span>
            </h2>
            {growth.ledger.length === 0 ? (
              <Empty>还没有记过活力点。审核通过一张就有。</Empty>
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>任务</th>
                      <th className="num">工时 ×（掌控 + 熟练度）× 质量</th>
                      <th className="num">活力点</th>
                    </tr>
                  </thead>
                  <tbody>
                    {growth.ledger.slice(0, 80).map((l) => {
                      const v = taskViewById(world, l.taskId);
                      return (
                        <tr key={l.id}>
                          <td className="label">{dateTimeZh(l.at)}</td>
                          <td>
                            {v ? (
                              v.cut ? (
                                <Link to={`/cut/${v.cut.id}`}>
                                  {v.project.code} {v.label}
                                </Link>
                              ) : (
                                <Link to={`/project/${v.project.id}`}>
                                  {v.project.code} {v.label}
                                </Link>
                              )
                            ) : (
                              "—"
                            )}
                            {l.kind !== "task" ? <Tag tone={l.kind === "penalty" ? "danger" : "lilac"}>{LEDGER_KIND_LABEL[l.kind]}</Tag> : null}
                          </td>
                          <td className="num label">{l.kind === "penalty" ? l.note ?? "" : `${formatNumber(l.hours)} × ${formatNumber(l.factor)} × ${l.quality.toFixed(1)}`}</td>
                          <td className="num t-body-14m">{formatPoints(l.points, true)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {growth.ledger.length > 80 ? <p className="label">只列了最近 80 条。</p> : null}
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="stages-title">
            <h2 id="stages-title" className="t-heading-18">
              做过的环节
            </h2>
            {growth.stages.length === 0 ? (
              <Empty>还没有通过的任务。</Empty>
            ) : (
              <ul className="list">
                {growth.stages.map((s) => (
                  <li key={`${s.group}:${s.key}`} style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div className="row" data-justify="between">
                      <span className="t-body-14m">{s.name}</span>
                      <span className="label">
                        <span className="num">{s.count}</span> 张 · <span className="num">{formatPoints(s.points)}</span> 点
                      </span>
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
              和谁合作过
            </h2>
            {collaborators.length === 0 ? (
              <Empty>还没有和别人在同一卡上做过事。</Empty>
            ) : (
              <ul className="list">
                {collaborators.slice(0, 12).map((c) => (
                  <li key={c.member.id}>
                    <MemberAvatar member={c.member} />
                    <div className="list-main">
                      <Link to={`/member/${c.member.id}`} className="t-body-14m">
                        {c.member.nickname}
                      </Link>
                      <span className="label">{ROLE_LABEL[c.member.role]}</span>
                    </div>
                    <span className="list-meta">一起做过 {c.cuts} 卡</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <MemberRolesCard memberId={member.id} self={self} />
        </div>
      </div>
      {editing === "profile" ? <ProfileDialog onClose={() => setEditing(null)} /> : null}
      {editing === "passcode" ? <MyPasscodeDialog onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { me, dispatch, notify } = useGuild();
  const [nickname, setNickname] = useState(me.nickname);
  const [tone, setTone] = useState<AvatarToneName>(me.tone);
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer
      Type="Dialog"
      Title="改昵称和颜色"
      open
      onClose={onClose}
      actions={
        <>
          <Button Label="取消" Style="Secondary" onClick={onClose} />
          <Button
            Label="保存"
            Style="Accent"
            onClick={() => {
              const r = dispatch("member.update", { memberId: me.id, nickname, tone }, { quiet: true });
              if (!r.ok) return setError(r.error.message);
              notify("改好了", "Neutral");
              onClose();
            }}
          />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <TextField label="昵称" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={16} />
        <span className="label">头像颜色</span>
        <div className="chips">
          {AVATAR_TONE.map((t) => (
            <button key={t} type="button" className="ui-chip" aria-pressed={tone === t} onClick={() => setTone(t)}>
              <MemberAvatar member={{ ...me, tone: t }} size="20" />
              {{ peach: "桃", lilac: "丁香", sand: "沙", sage: "鼠尾草", slate: "石板" }[t]}
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
  const account = accountOfMember(world, me.id);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!account) return null;
  return (
    <Drawer
      Type="Dialog"
      Title="改我的口令"
      Body="口令只存成哈希。改完以后在这台设备上换人要用新口令。"
      open
      onClose={onClose}
      actions={
        <>
          <Button Label="取消" Style="Secondary" onClick={onClose} />
          <Button
            Label="保存"
            Style="Accent"
            onClick={async () => {
              const p = passcodeProblem(a, b);
              if (p) return setError(p);
              const { salt, hash } = await makePasscode(a);
              const r = dispatch("account.set_passcode", { accountId: account.id, salt, hash }, { quiet: true });
              if (!r.ok) return setError(r.error.message);
              notify("口令改好了");
              onClose();
            }}
          />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <TextField label="新口令" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} hint="至少 6 位" />
        <TextField label="再输一次" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </Drawer>
  );
}

export function MembersPage() {
  const { world } = useGuild();
  const list = members(world).map((m) => ({ m, g: growthOf(world, m.id)! }));
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">成员</span>
          <h1 className="t-title-32">
            成员 <span className="num">{list.length}</span>
          </h1>
        </div>
      </div>
      <div className="cards">
        {list.map(({ m, g }) => (
          <Link key={m.id} to={`/member/${m.id}`} className="card project-card" aria-label={m.nickname}>
            <div className="me-card-top">
              <MemberAvatar member={m} size="40" />
              <div className="me-card-name">
                <span className="t-heading-18">{m.nickname}</span>
                <span className="label">
                  {ROLE_LABEL[m.role]} · 主环节 {g.mainStage?.name ?? "还没有"}
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
  const roles = memberRoles(world, memberId);
  const admin = isAdmin(me);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const member = world.members[memberId];
  const options = (Object.keys(GROUPS) as Group[]).flatMap((g) => GROUPS[g].stages.map((s) => ({ value: `${g}:${s.key}`, label: `${GROUPS[g].name} · ${s.name}` })));
  return (
    <section className="card" aria-labelledby="roles-title" data-testid="member-roles">
      <h2 id="roles-title" className="t-heading-18">
        职位和报到
      </h2>
      <div className="stack" data-gap="small">
        <span className="label">指派的职位</span>
        {roles.assigned.length === 0 ? (
          <p className="muted">还没有被指派职位。</p>
        ) : (
          <ul className="list">
            {roles.assigned.map((r) => (
              <li key={r.enrollment.id} data-testid="role-assigned">
                <div className="list-main">
                  <span>
                    {r.name} <Tag tone="inverse">指派</Tag>
                  </span>
                  <span className="label">
                    {GROUP_LABEL[r.enrollment.group]} · 熟练度 {skillLabel(r.enrollment.skill)}
                  </span>
                </div>
                {admin ? (
                  <Button
                    Label="撤掉"
                    Size="Small"
                    Style="Ghost"
                    onClick={() => {
                      const res = dispatch("role.unassign", { memberId, group: r.enrollment.group, stageKey: r.enrollment.stageKey });
                      if (res.ok) notify(`撤掉了 ${member?.nickname ?? ""} 的「${r.name}」`, "Neutral");
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
              if (!res.ok) setError(res.error.message);
              else {
                setError(null);
                setPick("");
                notify(`给 ${member?.nickname ?? ""} 指派了职位，他自动报到这个环节`);
              }
            }}
          >
            <SelectField label="指派一个职位" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="role-pick">
              <option value="">选环节</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectField>
            <Button Label="指派" Size="Small" Style="Accent" type="submit" disabled={!pick} data-testid="role-assign" />
          </form>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
      </div>
      <div className="stack" data-gap="small">
        <span className="label">自己报到 / 自己认领做过的环节</span>
        {roles.own.length === 0 ? (
          <Empty action={self ? <Link to="/enroll">去报到</Link> : undefined}>还没有。</Empty>
        ) : (
          <ul className="list">
            {roles.own.map((r) => (
              <li key={r.enrollment.id} data-testid="role-own">
                <div className="list-main">
                  <span>
                    {r.name} {r.claimed ? <Tag tone="sky">自己认领</Tag> : null}
                  </span>
                  <span className="label">
                    {GROUP_LABEL[r.enrollment.group]} · 熟练度 {skillLabel(r.enrollment.skill)} · 做过 {r.done} 张
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
