/**
 * P8 管理（管理员）：开项目 · 枢纽派发 · 设定问题拍板 · 成员和角色 · 工时与系数。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { StatusPill } from "@/components/ui/StatusPill";
import { Empty, MemberAvatar, MemberLink, SelectField, Tag, TextArea, TextField } from "@/components/app/bits";
import { ThreadBody } from "@/components/app/thread";
import { isAdmin } from "@/domain/commands/core";
import { GROUP, ROLE, type Group, type Id, type Role } from "@/domain/model";
import { cutCode } from "@/domain/naming";
import {
  accountOfMember,
  cutsOf,
  deadlineFactor,
  dispatchPlan,
  estimateOf,
  hubStages,
  members,
  openSettingQuestions,
  projects,
  rateTable,
  stageHours,
  theWorld,
} from "@/domain/queries";
import { GROUPS } from "@/domain/templates";
import { U, useI18n } from "@/i18n/I18n";
import type { Say } from "@/domain/text";
import { makePasscode, passcodeProblem } from "@/lib/passcode";
import { navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NewProjectForm } from "./ProjectSetup";

const TABS = ["new", "dispatch", "ruling", "members", "rates"] as const;

type Tab = (typeof TABS)[number];

export function AdminPage() {
  const { me } = useGuild();
  const { L } = useI18n();
  const route = useRoute();
  const tab = (TABS.find((t) => t === route.query.get("tab")) ?? "new") as Tab;
  const label: Record<Tab, string> = { new: L.admin.tabNew, dispatch: L.admin.tabDispatch, ruling: L.admin.tabRuling, members: L.admin.tabMembers, rates: L.admin.tabRates };
  if (!isAdmin(me)) {
    return (
      <section className="card">
        <h1 className="t-section-24">{L.admin.onlyAdmins}</h1>
        <p className="muted">{L.admin.onlyAdminsLead}</p>
      </section>
    );
  }
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">{L.admin.title}</span>
          <h1 className="t-title-32">{L.admin.title}</h1>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label={L.admin.title}>
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => navigate(`/admin?tab=${t}`, { replace: true })}>
            {label[t]}
          </button>
        ))}
      </div>
      {tab === "new" ? <NewProjectForm /> : null}
      {tab === "dispatch" ? <Dispatch /> : null}
      {tab === "ruling" ? <Rulings /> : null}
      {tab === "members" ? <Members /> : null}
      {tab === "rates" ? <Rates /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// 枢纽派发
// ---------------------------------------------------------------------------

function Dispatch() {
  const { world } = useGuild();
  const { L, stageName } = useI18n();
  const route = useRoute();
  const all = projects(world);
  const [projectId, setProjectId] = useState<Id>(route.query.get("project") ?? all[0]?.id ?? "");
  const hubs = projectId ? hubStages(world, projectId) : [];
  const [hubId, setHubId] = useState<Id>(route.query.get("hub") ?? "");
  const hub = hubs.find((h) => h.id === hubId) ?? hubs[0] ?? null;

  if (!all.length)
    return (
      <section className="card">
        <Empty>{L.admin.noProjects}</Empty>
      </section>
    );

  return (
    <section className="card" aria-label={L.admin.dispatchTitle}>
      <h2 className="t-heading-18">{L.admin.dispatchTitle}</h2>
      <p className="muted">{L.admin.dispatchLead}</p>
      <div className="form-grid">
        <SelectField label={L.admin.project} value={projectId} onChange={(e) => { setProjectId(e.target.value); setHubId(""); }}>
          {all.map((p) => (
            <option key={p.id} value={p.id} data-uc="">
              {p.name}（{p.code}）
            </option>
          ))}
        </SelectField>
        <SelectField label={L.admin.hub} value={hub?.id ?? ""} onChange={(e) => setHubId(e.target.value)} data-testid="dispatch-hub">
          {hubs.map((h) => (
            <option key={h.id} value={h.id}>
              {stageName(world.projects[h.projectId]?.group ?? "animation", h)}
            </option>
          ))}
        </SelectField>
      </div>
      {hub ? <HubDispatchForm key={hub.id} hubId={hub.id} /> : <Empty>{L.admin.noHub}</Empty>}
    </section>
  );
}

/** 枢纽派发下游（管理页和环节页共用）：填工作量 → 生成 / 解锁下游任务，显示大概要几个人、几天。 */
export function HubDispatchForm({ hubId }: { hubId: Id }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, r: rich, err, lang, stageName, stage: stageEl, rate, unit: unitOf, num } = useI18n();
  const plan = useMemo(() => dispatchPlan(world, hubId), [world, hubId]);
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [loads, setLoads] = useState<Record<string, number>>({});
  const [release, setRelease] = useState<"ready" | "all">("ready");
  const [bulk, setBulk] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const isIn = (stageId: Id, direct: boolean) => included[stageId] ?? direct;
  const loadOf = (taskId: Id, fallback: number) => loads[taskId] ?? fallback;

  const send = () => {
    if (!plan) return;
    const rows = plan.scopes
      .filter((s) => isIn(s.stage.id, s.direct))
      .flatMap((s) => s.rows.filter((r) => r.editable).map((r) => ({ taskId: r.task.id, workload: loadOf(r.task.id, r.task.workload) })));
    const r = dispatch("hub.dispatch", { hubStageId: plan.hub.id, rows, release }, { quiet: true });
    if (!r.ok) {
      setError(err(r.error));
      return;
    }
    setError(null);
    setLoads({});
    notify(f(release === "all" ? L.admin.dispatchedAll : L.admin.dispatched, { stage: stageName(plan.project.group, plan.hub), n: rows.length }));
  };

  if (!plan) return <Empty>{L.admin.noHub}</Empty>;
  if (plan.scopes.length === 0) return <Empty>{rich(L.admin.hubLast, { stage: stageEl(plan.project.group, plan.hub) })}</Empty>;
  return (
    <div className="stack" data-gap="small" data-testid="hub-dispatch">
      {plan.scopes.map((scope) => {
        const on = isIn(scope.stage.id, scope.direct);
        const editable = scope.rows.filter((r) => r.editable);
        const hours = editable.reduce((n, r) => n + stageHours(scope.stage, loadOf(r.task.id, r.task.workload)), 0);
        const est = estimateOf(hours, scope.enrolled, plan.daysLeft);
        const unit = unitOf(scope.stage.unit, plan.project.group, 2);
        return (
          <div key={scope.stage.id} className="card" data-tone="muted" data-size="compact">
            <div className="card-head">
              <label className="check">
                <input type="checkbox" checked={on} onChange={(e) => setIncluded({ ...included, [scope.stage.id]: e.target.checked })} data-testid={`dispatch-include-${scope.stage.templateKey}`} />
                <span className="t-body-14m">{stageEl(plan.project.group, scope.stage)}</span>
                <span className="label">{rate(scope.stage, plan.project.group)}</span>
              </label>
              <span className="label">{f(L.admin.editable, { n: editable.length, total: scope.rows.length })}</span>
            </div>
            {on ? (
              <>
                <div className="row">
                  <TextField label={f(L.admin.fillAll, { unit })} type="number" min={0.5} value={bulk[scope.stage.id] ?? ""} onChange={(e) => setBulk({ ...bulk, [scope.stage.id]: e.target.value })} style={{ maxWidth: 120 }} />
                  <Button
                    Label={L.admin.fillIn}
                    Size="Small"
                    Style="Secondary"
                    onClick={() => {
                      const v = Number(bulk[scope.stage.id]);
                      if (!Number.isFinite(v) || v <= 0) return;
                      const next = { ...loads };
                      for (const r of editable) next[r.task.id] = v;
                      setLoads(next);
                    }}
                  />
                </div>
                <div className="table-scroll">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{f("{^u}", { u: L.labels.cutLabel[plan.project.group] })}</th>
                        <th>{L.admin.status}</th>
                        <th>{f(L.admin.workloadCol, { unit })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scope.rows.map((r) => (
                        <tr key={r.task.id}>
                          <td className="num">
                            {r.cut ? cutCode(r.cut, plan.project.group, lang) : L.admin.wholeProject}
                            {r.task.layer ? ` · ${f(L.labels.layer, { layer: r.task.layer })}` : ""}
                          </td>
                          <td>
                            <StatusPill Status={r.task.status} />
                          </td>
                          <td>
                            {r.editable ? (
                              <input
                                className="field-control"
                                type="number"
                                min={0.5}
                                step={0.5}
                                aria-label={f(L.admin.workloadAria, { label: r.label })}
                                value={loadOf(r.task.id, r.task.workload)}
                                onChange={(e) => setLoads({ ...loads, [r.task.id]: Number(e.target.value) })}
                              />
                            ) : (
                              <span className="num">{num(r.task.workload)}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="label">
                  {rich(L.admin.estimate, { hours: <span className="num">{num(est.hours)}</span>, people: <span className="num">{scope.enrolled}</span>, days: <span className="num">{est.days}</span> })}
                  {est.peopleByPlan !== null ? rich(L.admin.estimatePeople, { n: <span className="num">{est.peopleByPlan}</span> }) : L.admin.estimateLate}
                </p>
              </>
            ) : null}
          </div>
        );
      })}
      <div className="stack" data-gap="small" role="radiogroup" aria-label={L.admin.howRelease}>
        <label className="check">
          <input type="radio" name="release" checked={release === "ready"} onChange={() => setRelease("ready")} />
          {L.admin.releaseReady}
        </label>
        <label className="check">
          <input type="radio" name="release" checked={release === "all"} onChange={() => setRelease("all")} data-testid="dispatch-release-all" />
          {L.admin.releaseAll}
        </label>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={L.admin.dispatchGo} Style="Accent" onClick={send} data-testid="dispatch-submit" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 拍板
// ---------------------------------------------------------------------------

function RulingForm({ projectId, threadId, onDone }: { projectId: Id; threadId?: Id; onDone?: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, lang, stageName } = useI18n();
  const project = world.projects[projectId];
  const cuts = cutsOf(world, projectId);
  const [question, setQuestion] = useState("");
  const [decision, setDecision] = useState("");
  const [picked, setPicked] = useState<Set<Id>>(new Set());
  const [stageKey, setStageKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const tpl = GROUPS[project?.group ?? "animation"];
  const send = () => {
    const r = dispatch("ruling.make", { threadId: threadId ?? null, projectId, question: threadId ? null : question, decision, cutIds: Array.from(picked), stageKey: stageKey || null }, { quiet: true });
    if (!r.ok) {
      setError(err(r.error));
      return;
    }
    notify(picked.size ? f(L.admin.ruledTodos, { n: picked.size, unit: L.labels.cutLabel[project?.group ?? "animation"] }) : L.admin.ruled);
    setDecision("");
    setQuestion("");
    setPicked(new Set());
    setError(null);
    onDone?.();
  };
  return (
    <div className="stack" data-gap="small">
      {threadId ? null : <TextArea label={L.admin.question} value={question} onChange={(e) => setQuestion(e.target.value)} />}
      <TextArea label={L.admin.ruling} placeholder={L.admin.rulingPlaceholder} value={decision} onChange={(e) => setDecision(e.target.value)} />
      <span className="label">{f(L.admin.fixCuts, { unit: lang === "en" ? L.labels.cutLabel[project?.group ?? "animation"].replace(/^./, (c) => c.toUpperCase()) : L.labels.cutLabel[project?.group ?? "animation"] })}</span>
      <div className="chips">
        {cuts.map((c) => (
          <button
            key={c.id}
            type="button"
            className="ui-chip"
            aria-pressed={picked.has(c.id)}
            onClick={() => {
              const next = new Set(picked);
              if (next.has(c.id)) next.delete(c.id);
              else next.add(c.id);
              setPicked(next);
            }}
          >
            {cutCode(c, project?.group, lang)}
          </button>
        ))}
      </div>
      <SelectField label={L.admin.fixStage} value={stageKey} onChange={(e) => setStageKey(e.target.value)}>
        <option value="">{L.admin.any}</option>
        {tpl.stages.map((s) => (
          <option key={s.key} value={s.key}>
            {stageName(project?.group ?? "animation", { templateKey: s.key, name: s.name })}
          </option>
        ))}
      </SelectField>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="form-actions">
        <Button Label={L.admin.rule} Style="Accent" onClick={send} />
      </div>
    </div>
  );
}

function Rulings() {
  const { world } = useGuild();
  const { L, ph } = useI18n();
  const open = openSettingQuestions(world);
  const all = projects(world);
  const [freeProject, setFreeProject] = useState<Id>(all[0]?.id ?? "");
  return (
    <div className="stack">
      <section className="card" aria-label={L.admin.openQuestions}>
        <h2 className="t-heading-18">
          {L.admin.openQuestions} <span className="count">{open.length}</span>
        </h2>
        {open.length === 0 ? (
          <Empty>{L.admin.noOpenQuestions}</Empty>
        ) : (
          <ul className="list">
            {open.map((v) => (
              <li key={v.thread.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                <span className="label">{ph(v.whereP)}</span>
                <ThreadBody thread={v.thread} compact />
                <RulingForm projectId={v.thread.projectId} threadId={v.thread.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {all.length ? (
        <section className="card" aria-label={L.admin.freeRuling}>
          <h2 className="t-heading-18">{L.admin.freeRuling}</h2>
          <SelectField label={L.admin.project} value={freeProject} onChange={(e) => setFreeProject(e.target.value)}>
            {all.map((p) => (
              <option key={p.id} value={p.id} data-uc="">
                {p.name}
              </option>
            ))}
          </SelectField>
          {freeProject ? <RulingForm key={freeProject} projectId={freeProject} /> : null}
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 成员和账号
// ---------------------------------------------------------------------------

function PasscodeDialog({ title, onSave, onClose }: { title: string; onSave: (salt: string, hash: string) => string | null; onClose: () => void }) {
  const { L, t2 } = useI18n();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const p = passcodeProblem(a, b);
    if (p) return setError(t2(p));
    const { salt, hash } = await makePasscode(a);
    const err = onSave(salt, hash);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Drawer
      Type="Dialog"
      Title={title}
      Body={L.admin.passcodeBody}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.admin.cancel} Style="Secondary" onClick={onClose} />
          <Button Label={L.admin.save} Style="Accent" onClick={() => void save()} />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <TextField label={L.admin.newPasscode} type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} hint={L.admin.passcodeHint} />
        <TextField label={L.admin.again} type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </Drawer>
  );
}

function Members() {
  const { world, me, dispatch, notify } = useGuild();
  const { L, f, t2, err } = useI18n();
  const list = members(world);
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [login, setLogin] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<{ accountId: Id; name: string } | null>(null);
  const [accountFor, setAccountFor] = useState<{ memberId: Id; name: string } | null>(null);
  const [accountLogin, setAccountLogin] = useState("");

  const add = async () => {
    const problem = login ? passcodeProblem(passcode) : null;
    if (problem) return setError(t2(problem));
    const r = dispatch("member.join", { nickname, role }, { quiet: true });
    if (!r.ok) return setError(err(r.error));
    if (login) {
      const { salt, hash } = await makePasscode(passcode);
      const a = dispatch("account.create", { memberId: r.created.memberId, login, salt, hash }, { quiet: true });
      if (!a.ok) return setError(f(L.admin.accountFailed, { why: err(a.error) }));
    }
    notify(login ? f(L.admin.addedLogin, { name: nickname, login: login.toLowerCase() }) : f(L.admin.added, { name: nickname }));
    setNickname("");
    setLogin("");
    setPasscode("");
    setError(null);
  };

  return (
    <div className="stack">
      <section className="card" aria-label={L.admin.members}>
        <h2 className="t-heading-18">
          {L.admin.members} <span className="count">{list.length}</span>
        </h2>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>{L.admin.members}</th>
                <th>{L.admin.role}</th>
                <th>{L.admin.account}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => {
                const acc = accountOfMember(world, m.id);
                return (
                  <tr key={m.id}>
                    <td>
                      <span className="row">
                        <MemberAvatar member={m} />
                        <MemberLink member={m} />
                        {m.id === me.id ? <Tag>{L.admin.me}</Tag> : null}
                      </span>
                    </td>
                    <td>
                      <select
                        className="field-control"
                        aria-label={f(L.admin.roleAria, { name: m.nickname })}
                        value={m.role}
                        onChange={(e) => {
                          const r = dispatch("member.set_role", { memberId: m.id, role: e.target.value as Role });
                          if (r.ok) notify(f(L.admin.roleChanged, { name: m.nickname, role: L.labels.role[e.target.value as Role] }), "Neutral");
                        }}
                      >
                        {ROLE.map((r) => (
                          <option key={r} value={r}>
                            {L.labels.role[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{acc ? <span className="num">{acc.login}</span> : <span className="muted">{L.admin.noAccount}</span>}</td>
                    <td>
                      {acc ? (
                        <Button Label={m.id === me.id ? L.admin.changeMyPasscode : L.admin.resetPasscode} Size="Small" Style="Ghost" onClick={() => setResetFor({ accountId: acc.id, name: m.id === me.id ? L.admin.changeMyPasscode : f(L.admin.resetPasscodeFor, { name: m.nickname }) })} />
                      ) : (
                        <Button Label={L.admin.createAccount} Size="Small" Style="Secondary" onClick={() => { setAccountFor({ memberId: m.id, name: m.nickname }); setAccountLogin(""); }} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" aria-label={L.admin.addMember}>
        <h2 className="t-heading-18">{L.admin.addMember}</h2>
        <div className="form-grid">
          <TextField label={L.admin.nickname} value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={16} />
          <SelectField label={L.admin.role} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLE.map((r) => (
              <option key={r} value={r}>
                {L.labels.role[r]}
              </option>
            ))}
          </SelectField>
          <TextField label={L.admin.loginOptional} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
          {login ? <TextField label={L.admin.passcode} type="password" autoComplete="new-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} hint={L.admin.passcodeHint} /> : null}
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <Button Label={L.admin.addGo} Style="Accent" onClick={() => void add()} />
          <span className="label">{L.admin.addNote}</span>
        </div>
      </section>
      {resetFor ? (
        <PasscodeDialog
          title={resetFor.name}
          onClose={() => setResetFor(null)}
          onSave={(salt, hash) => {
            const r = dispatch("account.set_passcode", { accountId: resetFor.accountId, salt, hash }, { quiet: true });
            if (!r.ok) return err(r.error);
            notify(L.admin.passcodeChanged);
            return null;
          }}
        />
      ) : null}
      {accountFor ? (
        <AccountDialog
          name={accountFor.name}
          login={accountLogin}
          setLogin={setAccountLogin}
          onClose={() => setAccountFor(null)}
          onSave={async (passcode) => {
            const { salt, hash } = await makePasscode(passcode);
            const r = dispatch("account.create", { memberId: accountFor.memberId, login: accountLogin, salt, hash }, { quiet: true });
            if (!r.ok) return err(r.error);
            notify(f(L.admin.accountCreated, { name: accountFor.name }));
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

function AccountDialog({ name, login, setLogin, onSave, onClose }: { name: string; login: string; setLogin: (v: string) => void; onSave: (passcode: string) => Promise<string | null>; onClose: () => void }) {
  const { L, f, t2 } = useI18n();
  const [a, setA] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer
      Type="Dialog"
      Title={f(L.admin.accountTitle, { name })}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.admin.cancel} Style="Secondary" onClick={onClose} />
          <Button
            Label={L.admin.createGo}
            Style="Accent"
            onClick={async () => {
              const p = passcodeProblem(a);
              if (p) return setError(t2(p));
              const err = await onSave(a);
              if (err) setError(err);
              else onClose();
            }}
          />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <TextField label={L.admin.loginName} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
        <TextField label={L.admin.passcode} type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} hint={L.admin.passcodeHint} />
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// 工时与系数
// ---------------------------------------------------------------------------

function Rates() {
  const { world, dispatch, notify } = useGuild();
  const { L, f, stageName, stage: stageEl, rate } = useI18n();
  const [group, setGroup] = useState<Group>("animation");
  const table = rateTable(world, group);
  const [edits, setEdits] = useState<Record<string, { tn?: string; per?: string; control?: string }>>({});
  const rules = theWorld(world)?.rules;
  const [factor, setFactor] = useState(String(deadlineFactor(world)));
  return (
    <div className="stack">
      <section className="card" aria-label={L.admin.rules}>
        <h2 className="t-heading-18">{L.admin.rules}</h2>
        <div className="form-grid">
          <TextField label={L.admin.deadlineFactor} type="number" step={0.1} min={0.5} max={5} value={factor} onChange={(e) => setFactor(e.target.value)} />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={!!rules?.expiryPenalty}
            onChange={(e) => {
              const r = dispatch("rules.set", { expiryPenalty: e.target.checked });
              if (r.ok) notify(e.target.checked ? L.admin.penaltyOn : L.admin.penaltyOff, "Neutral");
            }}
          />
          {L.admin.penalty}
        </label>
        <div className="form-actions">
          <Button
            Label={L.admin.saveFactor}
            Style="Secondary"
            onClick={() => {
              const r = dispatch("rules.set", { deadlineFactor: Number(factor) });
              if (r.ok) notify(L.admin.factorSaved, "Neutral");
            }}
          />
        </div>
      </section>
      <section className="card" aria-label={L.admin.ratesTitle}>
        <div className="card-head">
          <h2 className="t-heading-18">{L.admin.ratesTitle}</h2>
          <div className="chips">
            {GROUP.map((g) => (
              <button key={g} type="button" className="ui-chip" aria-pressed={group === g} onClick={() => setGroup(g)}>
                {L.labels.group[g]}
              </button>
            ))}
          </div>
        </div>
        <p className="label">{L.admin.ratesLead}</p>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>{L.admin.stage}</th>
                <th>{L.admin.now}</th>
                <th>{L.admin.tnHours}</th>
                <th>{group === "video" ? L.admin.perEpisodes : L.admin.perUnits}</th>
                <th>{L.admin.control}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {table.map((row) => {
                const e = edits[row.template.key] ?? {};
                const sn = stageName(group, { templateKey: row.template.key, name: row.template.name });
                return (
                  <tr key={row.template.key}>
                    <td>
                      {stageEl(group, { templateKey: row.template.key, name: row.template.name })}
                      {row.template.adminSet ? <span className="label">{L.labels.adminSet}</span> : null}
                    </td>
                    <td className="label">{rate({ tn: row.tn, per: row.per, unit: row.template.unit }, group)}</td>
                    <td>
                      <input className="field-control" type="number" step={0.1} min={0} aria-label={f(L.admin.tnAria, { stage: sn })} value={e.tn ?? String(row.tn)} onChange={(ev) => setEdits({ ...edits, [row.template.key]: { ...e, tn: ev.target.value } })} />
                    </td>
                    <td>
                      <input className="field-control" type="number" step={1} min={1} aria-label={f(L.admin.perAria, { stage: sn })} value={e.per ?? String(row.per)} onChange={(ev) => setEdits({ ...edits, [row.template.key]: { ...e, per: ev.target.value } })} />
                    </td>
                    <td>
                      <input className="field-control" type="number" step={0.1} min={0} aria-label={f(L.admin.controlAria, { stage: sn })} value={e.control ?? String(row.control)} onChange={(ev) => setEdits({ ...edits, [row.template.key]: { ...e, control: ev.target.value } })} />
                    </td>
                    <td>
                      <Button
                        Label={L.admin.save}
                        Size="Small"
                        Style="Secondary"
                        onClick={() => {
                          const r = dispatch("template.set_rate", { group, stageKey: row.template.key, tn: Number(e.tn ?? row.tn), per: Number(e.per ?? row.per), control: Number(e.control ?? row.control) });
                          if (r.ok) {
                            notify(f(L.admin.rateSaved, { stage: sn }), "Neutral");
                            const next = { ...edits };
                            delete next[row.template.key];
                            setEdits(next);
                          }
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
