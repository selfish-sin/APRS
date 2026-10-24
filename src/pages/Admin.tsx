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
import { formatNumber, GROUP_LABEL, ROLE_LABEL, UNIT_LABEL, rateLabel } from "@/domain/labels";
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
  todayOf,
} from "@/domain/queries";
import { GROUPS } from "@/domain/templates";
import { makePasscode, passcodeProblem } from "@/lib/passcode";
import { navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { addDays } from "@/domain/clock";

const TABS = [
  { id: "new", label: "开项目" },
  { id: "dispatch", label: "枢纽派发" },
  { id: "ruling", label: "拍板" },
  { id: "members", label: "成员和账号" },
  { id: "rates", label: "工时与系数" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export function AdminPage() {
  const { me } = useGuild();
  const route = useRoute();
  const tab = (TABS.find((t) => t.id === route.query.get("tab"))?.id ?? "new") as Tab;
  if (!isAdmin(me)) {
    return (
      <section className="card">
        <h1 className="t-section-24">管理页给管理员用</h1>
        <p className="muted">开项目、派发、拍板、改工时都在这里。要做这些请找管理员。</p>
      </section>
    );
  }
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">管理</span>
          <h1 className="t-title-32">管理</h1>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="管理">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => navigate(`/admin?tab=${t.id}`, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "new" ? <NewProject /> : null}
      {tab === "dispatch" ? <Dispatch /> : null}
      {tab === "ruling" ? <Rulings /> : null}
      {tab === "members" ? <Members /> : null}
      {tab === "rates" ? <Rates /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// 开项目
// ---------------------------------------------------------------------------

interface CutDraft {
  number: number;
  sheets: Record<string, number>;
  keySheets: number;
  seconds: number;
}

function NewProject() {
  const { world, dispatch, notify } = useGuild();
  const route = useRoute();
  const qg = route.query.get("group");
  const today = todayOf(world);
  const [group, setGroup] = useState<Group>(GROUP.includes(qg as Group) ? (qg as Group) : "animation");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [episode, setEpisode] = useState("EP01");
  const [scene, setScene] = useState("SC001");
  const [startOn, setStartOn] = useState(today);
  const [planEndOn, setPlanEndOn] = useState(addDays(today, 7 * 16));
  const [feishuRoot, setFeishuRoot] = useState("");
  const [count, setCount] = useState(14);
  const [layerNames, setLayerNames] = useState("A,B");
  const [sheets, setSheets] = useState(20);
  const [keySheets, setKeySheets] = useState(6);
  const [seconds, setSeconds] = useState(5);
  const [rows, setRows] = useState<CutDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tpl = GROUPS[group];
  const layers = tpl.hasLayers
    ? layerNames
        .split(/[,，\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : [];

  const build = () => {
    const n = Math.max(1, Math.min(200, Math.floor(count) || 1));
    setRows(Array.from({ length: n }, (_, i) => ({ number: i + 1, sheets: Object.fromEntries(layers.map((l) => [l, sheets])), keySheets, seconds })));
  };

  const create = () => {
    const draft = rows ?? Array.from({ length: Math.max(1, Math.floor(count) || 1) }, (_, i) => ({ number: i + 1, sheets: Object.fromEntries(layers.map((l) => [l, sheets])), keySheets, seconds }));
    const r = dispatch(
      "project.create",
      {
        group,
        name,
        code,
        episode,
        scene,
        startOn,
        planEndOn,
        feishuRoot: feishuRoot || null,
        cuts: draft.map((c) => ({ number: c.number, layers: layers.map((l) => ({ name: l, sheets: c.sheets[l] ?? sheets })), keySheets: tpl.hasLayers ? c.keySheets : 0, seconds: c.seconds })),
      },
      { quiet: true }
    );
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    notify(`开好了「${name}」，环节、${tpl.cutLabel}和任务都生成了`);
    navigate(`/project/${r.created.projectId}`);
  };

  return (
    <section className="card" aria-label="开项目">
      <h2 className="t-heading-18">开项目</h2>
      <div className="chips" role="radiogroup" aria-label="组">
        {GROUP.map((g) => (
          <button key={g} type="button" className="ui-chip" aria-pressed={group === g} onClick={() => { setGroup(g); setRows(null); }}>
            {GROUP_LABEL[g]}
            {GROUPS[g].draft ? "（草案）" : ""}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <TextField label="项目名字" value={name} onChange={(e) => setName(e.target.value)} data-testid="new-name" />
        <TextField label="代号（2–6 位大写）" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="例如 ANDLC" data-testid="new-code" />
        <TextField label="集" value={episode} onChange={(e) => setEpisode(e.target.value.toUpperCase())} />
        <TextField label="场" value={scene} onChange={(e) => setScene(e.target.value.toUpperCase())} />
        <TextField label="开始" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
        <TextField label="计划结束" type="date" value={planEndOn} onChange={(e) => setPlanEndOn(e.target.value)} />
        <TextField label="飞书根文件夹（可以以后再填）" type="url" placeholder="https://…" value={feishuRoot} onChange={(e) => setFeishuRoot(e.target.value)} />
      </div>
      <h3 className="t-body-14m">批量填</h3>
      <div className="form-grid">
        <TextField label={`${tpl.cutLabel}数`} type="number" min={1} max={200} value={count} onChange={(e) => { setCount(Number(e.target.value)); setRows(null); }} data-testid="new-count" />
        {tpl.hasLayers ? (
          <>
            <TextField label="层（用逗号分开）" value={layerNames} onChange={(e) => { setLayerNames(e.target.value); setRows(null); }} data-testid="new-layers" />
            <TextField label="每层张数" type="number" min={1} value={sheets} onChange={(e) => { setSheets(Number(e.target.value)); setRows(null); }} data-testid="new-sheets" />
            <TextField label="原画张数（每卡）" type="number" min={0} value={keySheets} onChange={(e) => { setKeySheets(Number(e.target.value)); setRows(null); }} />
          </>
        ) : null}
        <TextField label={`每${tpl.cutLabel}秒数`} type="number" min={0} value={seconds} onChange={(e) => { setSeconds(Number(e.target.value)); setRows(null); }} />
      </div>
      <p className="label">
        例如「14 卡，每卡 A / B 两层，各 20 张」。生成逐{tpl.cutLabel}表以后可以一{tpl.cutLabel}一{tpl.cutLabel}改。
      </p>
      <div className="form-actions">
        <Button Label={`生成逐${tpl.cutLabel}表`} Style="Secondary" onClick={build} />
      </div>
      {rows ? (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>{tpl.cutLabel}</th>
                {layers.map((l) => (
                  <th key={l}>{l} 层张数</th>
                ))}
                {tpl.hasLayers ? <th>原画张数</th> : null}
                <th>秒数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.number}>
                  <td className="num">{cutCode(r, group)}</td>
                  {layers.map((l) => (
                    <td key={l}>
                      <input className="field-control" type="number" min={1} aria-label={`${cutCode(r, group)} ${l} 层张数`} value={r.sheets[l] ?? sheets} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sheets: { ...x.sheets, [l]: Number(e.target.value) } } : x)))} />
                    </td>
                  ))}
                  {tpl.hasLayers ? (
                    <td>
                      <input className="field-control" type="number" min={0} aria-label={`${cutCode(r, group)} 原画张数`} value={r.keySheets} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, keySheets: Number(e.target.value) } : x)))} />
                    </td>
                  ) : null}
                  <td>
                    <input className="field-control" type="number" min={0} aria-label={`${cutCode(r, group)} 秒数`} value={r.seconds} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, seconds: Number(e.target.value) } : x)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label="开项目" Style="Accent" onClick={create} data-testid="new-create" />
        <span className="label">会照{tpl.name}的流程生成 {tpl.stages.length} 个环节和每{tpl.cutLabel}的任务；没有上游的马上可接。</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 枢纽派发
// ---------------------------------------------------------------------------

function Dispatch() {
  const { world, dispatch, notify } = useGuild();
  const route = useRoute();
  const all = projects(world);
  const [projectId, setProjectId] = useState<Id>(route.query.get("project") ?? all[0]?.id ?? "");
  const hubs = projectId ? hubStages(world, projectId) : [];
  const [hubId, setHubId] = useState<Id>(route.query.get("hub") ?? "");
  const hub = hubs.find((h) => h.id === hubId) ?? hubs[0] ?? null;
  const plan = useMemo(() => (hub ? dispatchPlan(world, hub.id) : null), [world, hub]);
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [loads, setLoads] = useState<Record<string, number>>({});
  const [release, setRelease] = useState<"ready" | "all">("ready");
  const [bulk, setBulk] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  if (!all.length) return <section className="card"><Empty>还没有项目。先开一个。</Empty></section>;

  const isIn = (stageId: Id, direct: boolean) => included[stageId] ?? direct;
  const loadOf = (taskId: Id, fallback: number) => loads[taskId] ?? fallback;

  const send = () => {
    if (!plan) return;
    const rows = plan.scopes
      .filter((s) => isIn(s.stage.id, s.direct))
      .flatMap((s) => s.rows.filter((r) => r.editable).map((r) => ({ taskId: r.task.id, workload: loadOf(r.task.id, r.task.workload) })));
    const r = dispatch("hub.dispatch", { hubStageId: plan.hub.id, rows, release }, { quiet: true });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError(null);
    setLoads({});
    notify(`在「${plan.hub.name}」派发了 ${rows.length} 张任务${release === "all" ? "，全部放出来了" : ""}`);
  };

  return (
    <section className="card" aria-label="枢纽派发">
      <h2 className="t-heading-18">枢纽派发</h2>
      <p className="muted">在枢纽环节算出下游要多少工作量，一键生成 / 改好任务、放出来。一次派发记一条。</p>
      <div className="form-grid">
        <SelectField label="项目" value={projectId} onChange={(e) => { setProjectId(e.target.value); setHubId(""); setIncluded({}); setLoads({}); }}>
          {all.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.code}）
            </option>
          ))}
        </SelectField>
        <SelectField label="枢纽环节" value={hub?.id ?? ""} onChange={(e) => { setHubId(e.target.value); setIncluded({}); setLoads({}); }} data-testid="dispatch-hub">
          {hubs.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </SelectField>
      </div>
      {!plan ? (
        <Empty>这个项目没有枢纽环节。</Empty>
      ) : plan.scopes.length === 0 ? (
        <Empty>「{plan.hub.name}」后面没有要派发的环节（它是最后一步）。</Empty>
      ) : (
        <>
          {plan.scopes.map((scope) => {
            const on = isIn(scope.stage.id, scope.direct);
            const editable = scope.rows.filter((r) => r.editable);
            const hours = editable.reduce((n, r) => n + stageHours(scope.stage, loadOf(r.task.id, r.task.workload)), 0);
            const est = estimateOf(hours, scope.enrolled, plan.daysLeft);
            const unit = UNIT_LABEL[scope.stage.unit];
            return (
              <div key={scope.stage.id} className="card" data-tone="muted" data-size="compact">
                <div className="card-head">
                  <label className="check">
                    <input type="checkbox" checked={on} onChange={(e) => setIncluded({ ...included, [scope.stage.id]: e.target.checked })} data-testid={`dispatch-include-${scope.stage.templateKey}`} />
                    <span className="t-body-14m">{scope.stage.name}</span>
                    <span className="label">{rateLabel(scope.stage)}</span>
                  </label>
                  <span className="label">
                    能改 {editable.length} / {scope.rows.length} 张
                  </span>
                </div>
                {on ? (
                  <>
                    <div className="row">
                      <TextField label={`都填成（${unit}）`} type="number" min={0.5} value={bulk[scope.stage.id] ?? ""} onChange={(e) => setBulk({ ...bulk, [scope.stage.id]: e.target.value })} style={{ maxWidth: 120 }} />
                      <Button
                        Label="填进去"
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
                            <th>任务</th>
                            <th>状态</th>
                            <th>工作量（{unit}）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scope.rows.map((r) => (
                            <tr key={r.task.id}>
                              <td>{r.label}</td>
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
                                    aria-label={`${r.label} 的工作量`}
                                    value={loadOf(r.task.id, r.task.workload)}
                                    onChange={(e) => setLoads({ ...loads, [r.task.id]: Number(e.target.value) })}
                                  />
                                ) : (
                                  <span className="num">{formatNumber(r.task.workload)}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="label">
                      这些一共 <span className="num">{formatNumber(est.hours)}</span> 小时 · 报到了 <span className="num">{scope.enrolled}</span> 人 · 按每人每天 4 小时大概 <span className="num">{est.days}</span> 天
                      {est.peopleByPlan !== null ? (
                        <>
                          {" "}
                          · 要在计划结束前做完，大概要 <span className="num">{est.peopleByPlan}</span> 个人
                        </>
                      ) : (
                        " · 已经过了计划结束"
                      )}
                    </p>
                  </>
                ) : null}
              </div>
            );
          })}
          <div className="stack" data-gap="small" role="radiogroup" aria-label="怎么放出来">
            <label className="check">
              <input type="radio" name="release" checked={release === "ready"} onChange={() => setRelease("ready")} />
              上游通过的才放出来（推荐；其余的等上游通过自动放）
            </label>
            <label className="check">
              <input type="radio" name="release" checked={release === "all"} onChange={() => setRelease("all")} data-testid="dispatch-release-all" />
              全部马上放出来（不等上游）
            </label>
          </div>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <Button Label="派发" Style="Accent" onClick={send} data-testid="dispatch-submit" />
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 拍板
// ---------------------------------------------------------------------------

function RulingForm({ projectId, threadId, onDone }: { projectId: Id; threadId?: Id; onDone?: () => void }) {
  const { world, dispatch, notify } = useGuild();
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
      setError(r.error.message);
      return;
    }
    notify(picked.size ? `拍板了，${picked.size} ${tpl.cutLabel}各留了一条「要补」` : "拍板了");
    setDecision("");
    setQuestion("");
    setPicked(new Set());
    setError(null);
    onDone?.();
  };
  return (
    <div className="stack" data-gap="small">
      {threadId ? null : <TextArea label="问题" value={question} onChange={(e) => setQuestion(e.target.value)} />}
      <TextArea label="结论" placeholder="例如：照设定补耳饰、皇冠的宝石" value={decision} onChange={(e) => setDecision(e.target.value)} />
      <span className="label">要补的{tpl.cutLabel}（每{tpl.cutLabel}会留一条「要补」）</span>
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
            {cutCode(c, project?.group)}
          </button>
        ))}
      </div>
      <SelectField label="要补的是哪个环节（可以不选）" value={stageKey} onChange={(e) => setStageKey(e.target.value)}>
        <option value="">不限</option>
        {tpl.stages.map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}
          </option>
        ))}
      </SelectField>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="form-actions">
        <Button Label="拍板" Style="Accent" onClick={send} />
      </div>
    </div>
  );
}

function Rulings() {
  const { world } = useGuild();
  const open = openSettingQuestions(world);
  const all = projects(world);
  const [freeProject, setFreeProject] = useState<Id>(all[0]?.id ?? "");
  return (
    <div className="stack">
      <section className="card" aria-label="等拍板的设定问题">
        <h2 className="t-heading-18">
          等拍板的设定问题 <span className="count">{open.length}</span>
        </h2>
        {open.length === 0 ? (
          <Empty>没有开着的设定问题。</Empty>
        ) : (
          <ul className="list">
            {open.map((v) => (
              <li key={v.thread.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                <span className="label">{v.where}</span>
                <ThreadBody thread={v.thread} compact />
                <RulingForm projectId={v.thread.projectId} threadId={v.thread.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {all.length ? (
        <section className="card" aria-label="直接拍板">
          <h2 className="t-heading-18">直接拍板（不挂在问题上）</h2>
          <SelectField label="项目" value={freeProject} onChange={(e) => setFreeProject(e.target.value)}>
            {all.map((p) => (
              <option key={p.id} value={p.id}>
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
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const p = passcodeProblem(a, b);
    if (p) return setError(p);
    const { salt, hash } = await makePasscode(a);
    const err = onSave(salt, hash);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Drawer
      Type="Dialog"
      Title={title}
      Body="口令只存成哈希，谁都看不到原文。"
      open
      onClose={onClose}
      actions={
        <>
          <Button Label="取消" Style="Secondary" onClick={onClose} />
          <Button Label="保存" Style="Accent" onClick={() => void save()} />
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

function Members() {
  const { world, me, dispatch, notify } = useGuild();
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
    if (login && passcodeProblem(passcode)) return setError(passcodeProblem(passcode));
    const r = dispatch("member.join", { nickname, role }, { quiet: true });
    if (!r.ok) return setError(r.error.message);
    if (login) {
      const { salt, hash } = await makePasscode(passcode);
      const a = dispatch("account.create", { memberId: r.created.memberId, login, salt, hash }, { quiet: true });
      if (!a.ok) return setError(`成员加好了，但账号没建上：${a.error.message}`);
    }
    notify(`加了 ${nickname}${login ? `（登录名 ${login.toLowerCase()}）` : ""}`);
    setNickname("");
    setLogin("");
    setPasscode("");
    setError(null);
  };

  return (
    <div className="stack">
      <section className="card" aria-label="成员">
        <h2 className="t-heading-18">
          成员 <span className="count">{list.length}</span>
        </h2>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>成员</th>
                <th>角色</th>
                <th>账号</th>
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
                        {m.id === me.id ? <Tag>我</Tag> : null}
                      </span>
                    </td>
                    <td>
                      <select
                        className="field-control"
                        aria-label={`${m.nickname} 的角色`}
                        value={m.role}
                        onChange={(e) => {
                          const r = dispatch("member.set_role", { memberId: m.id, role: e.target.value as Role });
                          if (r.ok) notify(`${m.nickname} 现在是${ROLE_LABEL[e.target.value as Role]}`, "Neutral");
                        }}
                      >
                        {ROLE.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{acc ? <span className="num">{acc.login}</span> : <span className="muted">没有账号</span>}</td>
                    <td>
                      {acc ? (
                        <Button Label={m.id === me.id ? "改我的口令" : "重置口令"} Size="Small" Style="Ghost" onClick={() => setResetFor({ accountId: acc.id, name: m.id === me.id ? "改我的口令" : `重置 ${m.nickname} 的口令` })} />
                      ) : (
                        <Button Label="建账号" Size="Small" Style="Secondary" onClick={() => { setAccountFor({ memberId: m.id, name: m.nickname }); setAccountLogin(""); }} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" aria-label="加成员">
        <h2 className="t-heading-18">加成员</h2>
        <div className="form-grid">
          <TextField label="昵称" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={16} />
          <SelectField label="角色" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLE.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </SelectField>
          <TextField label="登录名（可以不建账号）" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
          {login ? <TextField label="口令" type="password" autoComplete="new-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} hint="至少 6 位" /> : null}
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <Button Label="加进来" Style="Accent" onClick={() => void add()} />
          <span className="label">第一版是一台设备跑通：没有账号的成员，可以由管理员代录。</span>
        </div>
      </section>
      {resetFor ? (
        <PasscodeDialog
          title={resetFor.name}
          onClose={() => setResetFor(null)}
          onSave={(salt, hash) => {
            const r = dispatch("account.set_passcode", { accountId: resetFor.accountId, salt, hash }, { quiet: true });
            if (!r.ok) return r.error.message;
            notify("口令改好了");
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
            if (!r.ok) return r.error.message;
            notify(`给 ${accountFor.name} 建好了账号`);
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

function AccountDialog({ name, login, setLogin, onSave, onClose }: { name: string; login: string; setLogin: (v: string) => void; onSave: (passcode: string) => Promise<string | null>; onClose: () => void }) {
  const [a, setA] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer
      Type="Dialog"
      Title={`给 ${name} 建账号`}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label="取消" Style="Secondary" onClick={onClose} />
          <Button
            Label="建好"
            Style="Accent"
            onClick={async () => {
              const p = passcodeProblem(a);
              if (p) return setError(p);
              const err = await onSave(a);
              if (err) setError(err);
              else onClose();
            }}
          />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <TextField label="登录名" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
        <TextField label="口令" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} hint="至少 6 位" />
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
  const [group, setGroup] = useState<Group>("animation");
  const table = rateTable(world, group);
  const [edits, setEdits] = useState<Record<string, { tn?: string; per?: string; control?: string }>>({});
  const rules = theWorld(world)?.rules;
  const [factor, setFactor] = useState(String(deadlineFactor(world)));
  return (
    <div className="stack">
      <section className="card" aria-label="规则">
        <h2 className="t-heading-18">规则</h2>
        <div className="form-grid">
          <TextField label="时限系数（时限 = 工作量 × Tn × 这个数）" type="number" step={0.1} min={0.5} max={5} value={factor} onChange={(e) => setFactor(e.target.value)} />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={!!rules?.expiryPenalty}
            onChange={(e) => {
              const r = dispatch("rules.set", { expiryPenalty: e.target.checked });
              if (r.ok) notify(e.target.checked ? "超时收回会扣 2 点活力点" : "超时收回不扣分", "Neutral");
            }}
          />
          超时收回时扣活力点（默认不扣）
        </label>
        <div className="form-actions">
          <Button
            Label="保存时限系数"
            Style="Secondary"
            onClick={() => {
              const r = dispatch("rules.set", { deadlineFactor: Number(factor) });
              if (r.ok) notify("时限系数改好了；只影响以后接的任务", "Neutral");
            }}
          />
        </div>
      </section>
      <section className="card" aria-label="工时与系数表">
        <div className="card-head">
          <h2 className="t-heading-18">工时与系数</h2>
          <div className="chips">
            {GROUP.map((g) => (
              <button key={g} type="button" className="ui-chip" aria-pressed={group === g} onClick={() => setGroup(g)}>
                {GROUP_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
        <p className="label">活力点 = Tn × 工作量 ×（掌控系数 + 熟练度）× 质量。改了以后开的项目照新的；进行中的项目也跟着改，已经记下的活力点不变。</p>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>环节</th>
                <th>现在</th>
                <th>Tn（小时）</th>
                <th>每多少{group === "video" ? "期" : "单位"}</th>
                <th>掌控系数</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {table.map((row) => {
                const e = edits[row.template.key] ?? {};
                return (
                  <tr key={row.template.key}>
                    <td>
                      {row.template.name}
                      {row.template.adminSet ? <span className="label">（管理员定）</span> : null}
                    </td>
                    <td className="label">{rateLabel({ tn: row.tn, per: row.per, unit: row.template.unit, unitLabel: row.template.unitLabel })}</td>
                    <td>
                      <input className="field-control" type="number" step={0.1} min={0} aria-label={`${row.template.name} 的 Tn`} value={e.tn ?? String(row.tn)} onChange={(ev) => setEdits({ ...edits, [row.template.key]: { ...e, tn: ev.target.value } })} />
                    </td>
                    <td>
                      <input className="field-control" type="number" step={1} min={1} aria-label={`${row.template.name} 每多少单位`} value={e.per ?? String(row.per)} onChange={(ev) => setEdits({ ...edits, [row.template.key]: { ...e, per: ev.target.value } })} />
                    </td>
                    <td>
                      <input className="field-control" type="number" step={0.1} min={0} aria-label={`${row.template.name} 的掌控系数`} value={e.control ?? String(row.control)} onChange={(ev) => setEdits({ ...edits, [row.template.key]: { ...e, control: ev.target.value } })} />
                    </td>
                    <td>
                      <Button
                        Label="保存"
                        Size="Small"
                        Style="Secondary"
                        onClick={() => {
                          const r = dispatch("template.set_rate", { group, stageKey: row.template.key, tn: Number(e.tn ?? row.tn), per: Number(e.per ?? row.per), control: Number(e.control ?? row.control) });
                          if (r.ok) {
                            notify(`「${row.template.name}」改好了`, "Neutral");
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
