/**
 * 零日与改项目（SPEC §12）：
 *   - NewProjectForm：选模板建项目（先进零日）
 *   - ZeroDayPage：零日页（项目的封面）：介绍 · 日期 · 关键日 · 结构 · 人员表 · 环节预览 · 开工
 *   - ProjectSettingsPage：开工以后「改项目」：介绍 · 日期 · 结构（加卡 / 改卡 / 停用）· 人员 · 环节（加 / 改 / 移 / 停用 / 删）
 *   - AcceptDialog（验收）· ExtendDialog（延期）· AddCutsForm（加卡）· ProjectTimelineCard（项目时间线）
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { StatusPill } from "@/components/ui/StatusPill";
import { Empty, MemberAvatar, SelectField, Tag, TextArea, TextField } from "@/components/app/bits";
import { LinkList } from "@/components/app/links";
import { FileImage } from "@/components/library/tiles";
import { isAdmin } from "@/domain/commands/core";
import { GRAIN, GROUP, PHASE, PROJECT_STATUS, STAGE_KIND, UNIT, type CutRow, type Group, type Id, type ProjectRow, type ProjectStatus, type StaffPerson, type StageRow, type TaskRow } from "@/domain/model";
import { cutCode } from "@/domain/naming";
import { POSITION_GROUPS, POSITION_GROUP_LABEL, PROJECT_TEMPLATES, PROJECT_TEMPLATE_KEYS, positionTemplate, type ProjectTemplateKey } from "@/domain/positions";
import { cutsOf, filesOn, startPreview, libraryOf, members, memberById, projectById, projectTimeline, reviewsOf, stagesOf, submissionsOf, taskView, tasksOf, todayOf } from "@/domain/queries";
import { groupTemplate, stageText } from "@/domain/templates";
import { addDays } from "@/domain/clock";
import { U, useI18n } from "@/i18n/I18n";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NotFound } from "./NotFound";

// ---------------------------------------------------------------------------
// 选模板建项目
// ---------------------------------------------------------------------------

export function NewProjectForm() {
  const { world, dispatch, notify } = useGuild();
  const { L, t2, err } = useI18n();
  const route = useRoute();
  const today = todayOf(world);
  const [template, setTemplate] = useState<ProjectTemplateKey>(route.query.get("group") === "video" ? "video_standard" : "anim_standard");
  const [group, setGroup] = useState<Group>("animation");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [startOn, setStartOn] = useState(today);
  const [planEndOn, setPlanEndOn] = useState(addDays(today, 7 * 12));
  const [error, setError] = useState<string | null>(null);
  const create = () => {
    const r = dispatch("project.draft", { template, name, code, startOn, planEndOn, group: template === "blank" ? group : undefined }, { quiet: true });
    if (!r.ok) {
      setError(err(r.error));
      return;
    }
    notify(L.zero.created);
    navigate(`/project/${r.created.projectId}`);
  };
  return (
    <section className="card" aria-label={L.zero.createTitle}>
      <h2 className="t-heading-18">{L.zero.createTitle}</h2>
      <p className="muted">{L.zero.createLead}</p>
      <span className="label">{L.zero.templateTitle}</span>
      <div className="roles" role="radiogroup" aria-label={L.zero.templateTitle}>
        {PROJECT_TEMPLATE_KEYS.map((k) => {
          const tpl = PROJECT_TEMPLATES[k];
          return (
            <button key={k} type="button" className="role-card" role="radio" aria-checked={template === k} aria-pressed={template === k} onClick={() => setTemplate(k)} data-testid={`template-${k}`}>
              <span className="role-card-name">{t2(tpl.name)}</span>
              <span className="muted label">{t2(tpl.desc)}</span>
            </button>
          );
        })}
      </div>
      {template === "blank" ? (
        <div className="chips" role="radiogroup" aria-label={L.zero.group}>
          {GROUP.map((g) => (
            <button key={g} type="button" className="ui-chip" aria-pressed={group === g} onClick={() => setGroup(g)}>
              {L.labels.group[g]}
            </button>
          ))}
        </div>
      ) : null}
      <div className="form-grid">
        <TextField label={L.zero.name} value={name} onChange={(e) => setName(e.target.value)} data-testid="new-name" />
        <TextField label={L.zero.code} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="new-code" />
        <TextField label={L.zero.startOn} type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
        <TextField label={L.zero.planEndOn} type="date" value={planEndOn} onChange={(e) => setPlanEndOn(e.target.value)} />
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={L.zero.createButton} Style="Accent" onClick={create} data-testid="new-create" />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 零日页
// ---------------------------------------------------------------------------

export function ZeroDayPage({ project }: { project: ProjectRow }) {
  const { me } = useGuild();
  const { L, t2 } = useI18n();
  const admin = isAdmin(me);
  const tpl = PROJECT_TEMPLATES[project.template ?? "anim_standard"];
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/projects">{L.common.projects}</Link>
            <span>/</span>
            <span>{project.code}</span>
          </div>
          <h1 className="t-title-32">
            <U>{project.name}</U>
          </h1>
          <div className="row">
            <Tag tone="warning">{L.zero.statusTag}</Tag>
            <span className="num t-body-14m">{project.code}</span>
            <span className="label">{t2(tpl.name)}</span>
          </div>
          <p className="muted">{L.zero.pageLead}</p>
        </div>
        <div className="page-head-actions">
          <Link to={`/library/${project.id}`} className="ui-button" data-style="Secondary" data-size="Medium">
            {L.common.library}
          </Link>
        </div>
      </div>
      {!admin ? <p className="label">{L.zero.adminOnly}</p> : null}
      <StartCheckCard project={project} admin={admin} />
      <CoverCard project={project} editable={admin} />
      <DatesCard project={project} editable={admin} />
      <ZeroStructureCard project={project} editable={admin} />
      <StaffCard project={project} editable={admin} />
      <StagesPreview project={project} />
      <ProjectTimelineCard projectId={project.id} />
    </>
  );
}

/** 零日页最上面：开工检查（还缺什么 · 开工会生成多少 · 谁会自动报到）+ 开工按钮。 */
function StartCheckCard({ project, admin }: { project: ProjectRow; admin: boolean }) {
  const { world } = useGuild();
  const { L, f, t2 } = useI18n();
  const pv = startPreview(world, project.id);
  if (!pv) return null;
  const shown = pv.unfilled.slice(0, 6);
  return (
    <section className="card start-card" aria-labelledby="start-title" data-testid="start-check">
      <div className="card-head">
        <h2 id="start-title" className="t-heading-18">
          {L.zero.startCard}
        </h2>
        <span className="label" data-testid="start-ready">
          {pv.ready ? L.zero.readyYes : L.zero.readyNo}
        </span>
      </div>
      {pv.unfilled.length ? (
        <p className="start-warn" data-testid="start-unfilled">
          {f(L.zero.unfilled, {
            n: pv.unfilled.length,
            names: shown.map((x) => (typeof x.name === "string" ? x.name : t2(x.name))).join(L.zero.listSep),
            more: pv.unfilled.length > shown.length ? f(L.zero.unfilledMore, { n: pv.unfilled.length, rest: pv.unfilled.length - shown.length }) : "",
          })}
        </p>
      ) : (
        <p className="start-ok">{L.zero.allFilled}</p>
      )}
      <div className="row start-row">
        {admin ? <StartButton project={project} /> : null}
        <span className="label">{f(L.zero.startSummary[project.group], { cuts: pv.cuts, tasks: pv.tasks, people: pv.autoEnroll })}</span>
      </div>
    </section>
  );
}

/** 日期一块上面的小时间轴：开始 · 各关键日 · 计划结束（按日子摆位置）。 */
function KeyDateTimeline({ project }: { project: ProjectRow }) {
  const { L, monthDay } = useI18n();
  const start = Date.parse(project.startOn);
  const end = Date.parse(project.planEndOn);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const pos = (d: string) => Math.min(100, Math.max(0, ((Date.parse(d) - start) / (end - start)) * 100));
  const keys = (project.keyDates ?? []).filter((k) => k.name.trim() && k.date && Number.isFinite(Date.parse(k.date))).sort((a, b) => a.date.localeCompare(b.date));
  // 关键日正好是开始 / 计划结束那天：合成一个点，用关键日的名字。
  const atStart = keys.find((k) => k.date === project.startOn);
  const atEnd = keys.find((k) => k.date === project.planEndOn);
  const points = [
    { id: "start", name: atStart?.name ?? L.zero.tlStart, date: project.startOn, edge: true, uc: !!atStart },
    ...keys.filter((k) => k !== atStart && k !== atEnd).map((k) => ({ id: k.id, name: k.name, date: k.date, edge: false, uc: true })),
    { id: "end", name: atEnd?.name ?? L.zero.tlEnd, date: project.planEndOn, edge: true, uc: !!atEnd },
  ];
  // 挨得太近的关键日，名字放到线的上面，免得叠在一起。
  let last = -100;
  let lastRow = "a";
  const rows = points.map((p, i) => {
    const at = pos(p.date);
    const near = at - last < 16 || (i === points.length - 1 ? false : pos(points[i + 1].date) - at < 16);
    const row = p.edge ? "a" : near && lastRow === "a" ? "b" : "a";
    last = at;
    lastRow = row;
    return row;
  });
  return (
    <ol className="key-timeline" aria-label={L.zero.timeline} data-testid="key-timeline" data-stagger={rows.includes("b") ? "yes" : undefined}>
      {points.map((p, i) => (
        <li key={p.id} style={{ ["--at" as string]: `${pos(p.date)}%` }} data-edge={p.edge ? "yes" : undefined} data-row={rows[i]}>
          <span className="key-timeline-dot" aria-hidden="true" />
          <span className="key-timeline-name">{p.uc ? <U>{p.name}</U> : p.name}</span>
          <span className="key-timeline-date num">{monthDay(p.date)}</span>
        </li>
      ))}
    </ol>
  );
}

function StartButton({ project }: { project: ProjectRow }) {
  const { dispatch, notify } = useGuild();
  const { L, f, err } = useI18n();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = project.cutsPlan?.length ?? 0;
  return (
    <>
      <Button Label={L.zero.start} Style="Accent" onClick={() => setOpen(true)} data-testid="zero-start" />
      {open ? (
        <Drawer
          Type="Dialog"
          Title={L.zero.startConfirmTitle}
          Body={f(L.zero.startConfirmBody, { n })}
          open
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button Label={L.common.cancel} Style="Secondary" onClick={() => setOpen(false)} />
              <Button
                Label={L.zero.start}
                Style="Accent"
                data-testid="zero-start-confirm"
                onClick={() => {
                  const r = dispatch("project.start", { projectId: project.id }, { quiet: true });
                  if (!r.ok) setError(err(r.error));
                  else {
                    setOpen(false);
                    notify(f(L.zero.started, { name: project.name }));
                  }
                }}
              />
            </>
          }
        >
          {error ? <p className="error-text">{error}</p> : null}
        </Drawer>
      ) : null}
    </>
  );
}

export function CoverCard({ project, editable }: { project: ProjectRow; editable: boolean }) {
  const { world, dispatch, notify } = useGuild();
  const { L, err } = useI18n();
  const [name, setName] = useState(project.name);
  const [code, setCode] = useState(project.code);
  const [intro, setIntro] = useState(project.intro ?? "");
  const [cover, setCover] = useState(project.coverFileId ?? "");
  const [feishuRoot, setFeishuRoot] = useState(project.feishuRoot ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [error, setError] = useState<string | null>(null);
  const started = project.status !== "zero";
  const images = libraryOf(world, project.id).filter((v) => v.kind === "image");
  const coverFile = project.coverFileId ? world.files[project.coverFileId] : undefined;
  return (
    <section className="card" aria-labelledby="cover-title" data-testid="cover-card">
      <h2 id="cover-title" className="t-heading-18">
        {L.zero.coverTitle}
      </h2>
      <div className="cover-layout">
        <div className="cover-image">{coverFile ? <FileImage file={coverFile} className="cover-img" /> : <span className="label">{L.zero.coverNone}</span>}</div>
        {editable ? (
          <form
            className="stack"
            data-gap="small"
            onSubmit={(e) => {
              e.preventDefault();
              const r = dispatch(
                "project.update",
                { projectId: project.id, name, code, intro: intro || null, coverFileId: cover || null, feishuRoot: feishuRoot || null, ...(started && status !== project.status ? { status } : {}) },
                { quiet: true }
              );
              if (!r.ok) setError(err(r.error));
              else {
                setError(null);
                notify(L.common.saved, "Neutral");
              }
            }}
          >
            <div className="form-grid">
              <TextField label={L.zero.name} value={name} onChange={(e) => setName(e.target.value)} />
              <TextField label={L.zero.code} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </div>
            <TextArea label={L.zero.intro} hint={L.zero.introHint} placeholder={L.zero.introPlaceholder} value={intro} onChange={(e) => setIntro(e.target.value)} data-testid="zero-intro" />
            <SelectField label={L.zero.cover} hint={L.zero.coverHint} value={cover} onChange={(e) => setCover(e.target.value)} data-testid="zero-cover">
              <option value="">{L.zero.coverNone}</option>
              {images.map((v) => (
                <option key={v.file.id} value={v.file.id} data-uc="">
                  {v.file.name}
                </option>
              ))}
            </SelectField>
            {!images.length ? (
              <Link to={`/library/${project.id}`} className="label">
                {L.zero.coverGoLibrary}
              </Link>
            ) : null}
            <TextField label={L.zero.feishuRoot} type="url" placeholder="https://…" value={feishuRoot} onChange={(e) => setFeishuRoot(e.target.value)} />
            {started ? (
              <SelectField label={L.zero.status} value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
                {PROJECT_STATUS.filter((s) => s !== "zero").map((s) => (
                  <option key={s} value={s}>
                    {L.labels.projectStatus[s]}
                  </option>
                ))}
              </SelectField>
            ) : null}
            {error ? <p className="error-text">{error}</p> : null}
            <div className="form-actions">
              <Button Label={L.common.save} Size="Small" Style="Accent" type="submit" data-testid="zero-cover-save" />
            </div>
          </form>
        ) : (
          <p className="break">{project.intro ? <U>{project.intro}</U> : <span className="muted">{L.zero.noIntro}</span>}</p>
        )}
      </div>
    </section>
  );
}

export function DatesCard({ project, editable }: { project: ProjectRow; editable: boolean }) {
  const { dispatch, notify } = useGuild();
  const { L, f, err, date } = useI18n();
  const [startOn, setStartOn] = useState(project.startOn);
  const [planEndOn, setPlanEndOn] = useState(project.planEndOn);
  const [cycle, setCycle] = useState(String(project.cycleDays ?? 7));
  const [keys, setKeys] = useState(project.keyDates?.length ? project.keyDates.map((k) => ({ ...k })) : [{ id: "k1", name: "", date: "" }]);
  const [error, setError] = useState<string | null>(null);
  if (!editable) {
    return (
      <section className="card" aria-labelledby="dates-title">
        <h2 id="dates-title" className="t-heading-18">
          {L.zero.datesTitle}
        </h2>
        <KeyDateTimeline project={project} />
        <p>
          {date(project.startOn)} → {date(project.planEndOn)} · {L.zero.cycleDays} {project.cycleDays ?? 7}
        </p>
        <ul className="list">
          {(project.keyDates ?? []).map((k) => (
            <li key={k.id}>
              <U>{k.name}</U>
              <span className="label">{date(k.date)}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const save = () => {
    const keyDates = keys.filter((k) => k.name.trim() || k.date);
    const r = dispatch("project.update", { projectId: project.id, startOn, planEndOn, cycleDays: Number(cycle) || 7, keyDates }, { quiet: true });
    if (!r.ok) setError(err(r.error));
    else {
      setError(null);
      notify(L.common.saved, "Neutral");
    }
  };
  return (
    <section className="card" aria-labelledby="dates-title" data-testid="dates-card">
      <div className="card-head">
        <h2 id="dates-title" className="t-heading-18">
          {L.zero.datesTitle}
        </h2>
        <span className="label num">{f(L.zero.datesMeta, { start: date(project.startOn), end: date(project.planEndOn), n: project.cycleDays ?? 7 })}</span>
      </div>
      <KeyDateTimeline project={project} />
      <div className="form-grid">
        <TextField label={L.zero.startOn} type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} data-testid="zero-start-on" disabled={project.status !== "zero"} />
        <TextField label={L.zero.planEndOn} type="date" value={planEndOn} onChange={(e) => setPlanEndOn(e.target.value)} data-testid="zero-plan-end" />
        <TextField label={L.zero.cycleDays} type="number" min={1} max={31} value={cycle} onChange={(e) => setCycle(e.target.value)} />
      </div>
      <span className="label">{L.zero.keyDates}</span>
      {keys.map((k, i) => (
        <div key={i} className="form-grid key-date-row">
          <TextField label={L.zero.keyDateName} placeholder={L.zero.keyDatePlaceholder} value={k.name} onChange={(e) => setKeys(keys.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} data-testid={`key-date-name-${i}`} />
          <TextField label={L.zero.keyDateDate} type="date" value={k.date} onChange={(e) => setKeys(keys.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} data-testid={`key-date-date-${i}`} />
          <div className="form-actions">
            <Button Label={L.common.remove} Size="Small" Style="Ghost" onClick={() => setKeys(keys.filter((_, j) => j !== i))} />
          </div>
        </div>
      ))}
      <div className="form-actions">
        <Button Label={L.zero.keyDateAdd} Size="Small" Style="Secondary" onClick={() => setKeys([...keys, { id: `k${keys.length + 1}`, name: "", date: "" }])} data-testid="key-date-add" />
        <Button Label={L.common.save} Size="Small" Style="Accent" onClick={save} data-testid="zero-dates-save" />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

function ZeroStructureCard({ project, editable }: { project: ProjectRow; editable: boolean }) {
  const { dispatch, notify } = useGuild();
  const { L, f, err, cut: cutOf } = useI18n();
  const s = project.structure ?? { episodes: 1, scenesPerEpisode: 1, cutsPerScene: 3, layers: ["A", "B"], sheetsPerLayer: 12, secondsPerCut: 4 };
  const hasLayers = groupTemplate(project.group).hasLayers;
  const [form, setForm] = useState({ episodes: String(s.episodes), scenes: String(s.scenesPerEpisode), cuts: String(s.cutsPerScene), layers: s.layers.join(", "), sheets: String(s.sheetsPerLayer), seconds: String(s.secondsPerCut) });
  const [rows, setRows] = useState(project.cutsPlan ?? []);
  const [error, setError] = useState<string | null>(null);
  const plan = project.cutsPlan ?? [];
  const send = (cuts?: typeof rows) => {
    const r = dispatch(
      "project.set_structure",
      {
        projectId: project.id,
        structure: {
          episodes: Number(form.episodes),
          scenesPerEpisode: Number(form.scenes),
          cutsPerScene: Number(form.cuts),
          layers: hasLayers ? form.layers.split(/[,，\s]+/).filter(Boolean) : [],
          sheetsPerLayer: Number(form.sheets),
          secondsPerCut: Number(form.seconds),
        },
        cuts: cuts?.map((c) => ({ number: c.number, layers: c.layers, seconds: c.seconds })),
      },
      { quiet: true }
    );
    if (!r.ok) setError(err(r.error));
    else {
      setError(null);
      setRows(r.state.projects[project.id].cutsPlan ?? []);
      notify(L.common.saved, "Neutral");
    }
  };
  const layerNames = Array.from(new Set(rows.flatMap((c) => c.layers.map((l) => l.name))));
  return (
    <section className="card" aria-labelledby="structure-title" data-testid="structure-card">
      <h2 id="structure-title" className="t-heading-18">
        {L.zero.structureTitle} <span className="count">{f(L.zero.cutsTotal, { n: plan.length })}</span>
      </h2>
      <p className="muted">{L.zero.structureLead}</p>
      {editable ? (
        <>
          <div className="form-grid">
            <TextField label={L.zero.episodes} type="number" min={1} value={form.episodes} onChange={(e) => setForm({ ...form, episodes: e.target.value })} data-testid="zero-episodes" />
            <TextField label={L.zero.scenesPerEpisode} type="number" min={1} value={form.scenes} onChange={(e) => setForm({ ...form, scenes: e.target.value })} data-testid="zero-scenes" />
            <TextField label={L.zero.cutsPerScene} type="number" min={1} value={form.cuts} onChange={(e) => setForm({ ...form, cuts: e.target.value })} data-testid="zero-cuts" />
            {hasLayers ? <TextField label={L.zero.layers} value={form.layers} onChange={(e) => setForm({ ...form, layers: e.target.value.toUpperCase() })} data-testid="zero-layers" /> : null}
            {hasLayers ? <TextField label={L.zero.sheetsPerLayer} type="number" min={0} value={form.sheets} onChange={(e) => setForm({ ...form, sheets: e.target.value })} data-testid="zero-sheets" /> : null}
            <TextField label={L.zero.secondsPerCut} type="number" min={0} value={form.seconds} onChange={(e) => setForm({ ...form, seconds: e.target.value })} data-testid="zero-seconds" />
          </div>
          <div className="form-actions">
            <Button Label={L.zero.structureSave} Size="Small" Style="Accent" onClick={() => send()} data-testid="zero-structure-save" />
          </div>
        </>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {rows.length ? (
        <details className="stack" data-gap="small">
          <summary className="t-body-14m">{L.zero.perCutTitle}</summary>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>{L.zero.cutCol}</th>
                  <th>{L.zero.sceneCol}</th>
                  {layerNames.map((l) => (
                    <th key={l}>{f(L.zero.sheetsCol, { layer: l })}</th>
                  ))}
                  <th>{L.zero.secondsCol}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c.number}>
                    <td className="num">{cutOf(c, project.group)}</td>
                    <td className="num">{c.scene}</td>
                    {layerNames.map((l) => {
                      const layer = c.layers.find((x) => x.name === l);
                      return (
                        <td key={l}>
                          {layer ? (
                            <input className="field-control" type="number" min={1} disabled={!editable} aria-label={`${cutOf(c, project.group)} ${l}`} value={layer.sheets} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, layers: x.layers.map((y) => (y.name === l ? { ...y, sheets: Number(e.target.value) } : y)) } : x)))} />
                          ) : null}
                        </td>
                      );
                    })}
                    <td>
                      <input className="field-control" type="number" min={0} disabled={!editable} aria-label={`${cutOf(c, project.group)} ${L.zero.secondsCol}`} value={c.seconds} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, seconds: Number(e.target.value) } : x)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable ? (
            <div className="form-actions">
              <Button Label={L.zero.perCutSave} Size="Small" Style="Secondary" onClick={() => send(rows)} />
            </div>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

export function StaffCard({ project, editable }: { project: ProjectRow; editable: boolean }) {
  const { L, t2 } = useI18n();
  const staff = project.staff ?? [];
  const [adding, setAdding] = useState(false);
  return (
    <section className="card" aria-labelledby="staff-title" data-testid="staff-card">
      <h2 id="staff-title" className="t-heading-18">
        {L.zero.staffTitle}
      </h2>
      <p className="muted">{L.zero.staffLead}</p>
      {[...POSITION_GROUPS, "custom" as const].map((g) => {
        const list = staff.filter((p) => (positionTemplate(project.template, p.key)?.group ?? "custom") === g);
        if (!list.length) return null;
        return (
          <div key={g} className="stack" data-gap="small">
            <span className="label">{g === "custom" ? L.zero.customGroup : t2(POSITION_GROUP_LABEL[g])}</span>
            <ul className="staff-list">
              {list.map((pos) => (
                <StaffRowView key={pos.key} project={project} positionKey={pos.key} editable={editable} />
              ))}
            </ul>
          </div>
        );
      })}
      {editable ? (
        adding ? (
          <AddPositionForm projectId={project.id} onDone={() => setAdding(false)} />
        ) : (
          <div className="form-actions">
            <Button Label={L.zero.addPosition} Size="Small" Style="Secondary" onClick={() => setAdding(true)} />
          </div>
        )
      ) : null}
      {!staff.length ? <Empty>{L.zero.staffEmpty}</Empty> : null}
    </section>
  );
}

function StaffRowView({ project, positionKey, editable }: { project: ProjectRow; positionKey: string; editable: boolean }) {
  const { world, dispatch, notify } = useGuild();
  const { L, t2, f, err, lang } = useI18n();
  const pos = (project.staff ?? []).find((p) => p.key === positionKey)!;
  const tpl = positionTemplate(project.template, positionKey);
  const [external, setExternal] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = pos.custom ? pos.custom.name : tpl ? t2(tpl.name) : positionKey;
  const desc = pos.custom ? pos.custom.desc : tpl ? t2(tpl.desc) : null;
  const stageNames = pos.stageKeys.map((k) => {
    const st = stagesOf(world, project.id).find((s) => s.templateKey === k);
    const gt = groupTemplate(project.group).stages.find((s) => s.key === k);
    return st ? stageText(project.group, st, lang).name : gt ? stageText(project.group, { templateKey: gt.key, name: gt.name }, lang).name : k;
  });
  const set = (people: StaffPerson[]) => {
    const r = dispatch("staff.set", { projectId: project.id, positionKey, people }, { quiet: true });
    if (!r.ok) setError(err(r.error));
    else {
      setError(null);
      notify(L.zero.staffSaved, "Neutral");
    }
  };
  const taken = new Set(pos.people.flatMap((x) => ("memberId" in x ? [x.memberId] : [])));
  const remove = (i: number) =>
    editable ? (
      <button type="button" className="staff-x" aria-label={L.common.remove} onClick={() => set(pos.people.filter((_, j) => j !== i))}>
        ✕
      </button>
    ) : null;
  return (
    <li className="staff-row" data-testid="staff-row" data-position={positionKey}>
      <div className="staff-pos">
        <span className="t-body-14m">{pos.custom ? <U>{name}</U> : name}</span>
        {desc ? <span className="label">{pos.custom ? <U>{desc}</U> : desc}</span> : null}
        <span className="label staff-stages">{pos.stageKeys.length ? f(L.zero.stages, { names: stageNames.join(" · ") }) : L.zero.noStages}</span>
      </div>
      <div className="staff-people">
        {pos.people.map((x, i) =>
          "memberId" in x ? (
            <span key={i} className="staff-person" data-testid="staff-person">
              <MemberAvatar member={memberById(world, x.memberId)} size="20" />
              <U>{memberById(world, x.memberId)?.nickname ?? "?"}</U>
              {remove(i)}
            </span>
          ) : (
            <span key={i} className="staff-person" data-testid="staff-person" data-external="">
              <U>{x.name}</U>
              <span className="staff-ext">{L.common.external}</span>
              {remove(i)}
            </span>
          )
        )}
        {!pos.people.length ? <Tag tone="warning">{L.zero.missing}</Tag> : null}
        {editable ? (
          <button type="button" className="staff-open" aria-expanded={adding} onClick={() => setAdding(!adding)} data-testid={`staff-open-${positionKey}`}>
            {adding ? L.common.close : L.zero.addPerson}
          </button>
        ) : null}
      </div>
      {editable && adding ? (
        <div className="staff-add">
          <SelectField
            label={L.zero.addMember}
            value=""
            onChange={(e) => e.target.value && set([...pos.people, { memberId: e.target.value }])}
            data-testid={`staff-add-member-${positionKey}`}
          >
            <option value="">—</option>
            {members(world)
              .filter((m) => !taken.has(m.id))
              .map((m) => (
                <option key={m.id} value={m.id} data-uc="">
                  {m.nickname}
                </option>
              ))}
          </SelectField>
          <form
            className="staff-ext-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!external.trim()) return;
              set([...pos.people, { name: external }]);
              setExternal("");
            }}
          >
            <TextField label={L.zero.addExternal} value={external} onChange={(e) => setExternal(e.target.value)} data-testid={`staff-add-external-${positionKey}`} />
            <Button Label={L.zero.addExternalButton} Size="Small" Style="Secondary" type="submit" data-testid={`staff-add-external-go-${positionKey}`} />
          </form>
        </div>
      ) : null}
      {error ? <p className="error-text staff-error">{error}</p> : null}
    </li>
  );
}

function AddPositionForm({ projectId, onDone }: { projectId: Id; onDone: () => void }) {
  const { dispatch } = useGuild();
  const { L, err } = useI18n();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const r = dispatch("staff.add_position", { projectId, name, desc }, { quiet: true });
        if (!r.ok) setError(err(r.error));
        else onDone();
      }}
    >
      <TextField label={L.zero.positionName} value={name} onChange={(e) => setName(e.target.value)} />
      <TextField label={L.zero.positionDesc} value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="form-actions">
        <Button Label={L.common.add} Size="Small" Style="Accent" type="submit" />
        <Button Label={L.common.cancel} Size="Small" Style="Ghost" onClick={onDone} />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </form>
  );
}

function StagesPreview({ project }: { project: ProjectRow }) {
  const { L, t2, f, lang } = useI18n();
  const tpl = PROJECT_TEMPLATES[project.template ?? "anim_standard"];
  const stages = tpl.stages ? groupTemplate(project.group).stages : [];
  return (
    <section className="card" aria-labelledby="stages-preview-title">
      <h2 id="stages-preview-title" className="t-heading-18">
        {L.zero.stagesTitle} <span className="count">{stages.length}</span>
      </h2>
      <p className="muted">{tpl.stages ? f(L.zero.stagesLead, { template: t2(tpl.name) }) : L.zero.stagesBlank}</p>
      {PHASE.map((ph) => {
        const list = stages.filter((s) => s.phase === ph);
        if (!list.length) return null;
        return (
          <div key={ph} className="row">
            <span className="label">{L.labels.phase[ph]}{L.common.colon}</span>
            {list.map((s) => (
              <Tag key={s.key}>{stageText(project.group, { templateKey: s.key, name: s.name }, lang).name}</Tag>
            ))}
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 开工以后：改项目
// ---------------------------------------------------------------------------

const SETTINGS_TABS = ["cover", "dates", "structure", "staff", "stages"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export function ProjectSettingsPage() {
  const { world, me } = useGuild();
  const { L } = useI18n();
  const route = useRoute();
  const project = projectById(world, route.segments[1]);
  const tab = (SETTINGS_TABS.find((t) => t === route.query.get("tab")) ?? "cover") as SettingsTab;
  if (!project) return <NotFound what="project" />;
  const admin = isAdmin(me);
  const label: Record<SettingsTab, string> = { cover: L.edit.tabCover, dates: L.edit.tabDates, structure: L.edit.tabStructure, staff: L.edit.tabStaff, stages: L.edit.tabStages };
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to={`/project/${project.id}`}>
              <U>{project.name}</U>
            </Link>
            <span>/</span>
            <span>{L.edit.settingsTitle}</span>
          </div>
          <h1 className="t-title-32">{L.edit.settingsTitle}</h1>
          <p className="muted">{L.edit.settingsLead}</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label={L.edit.settingsTitle}>
        {SETTINGS_TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => navigate(`/project/${project.id}/settings?tab=${t}`, { replace: true })} data-testid={`settings-tab-${t}`}>
            {label[t]}
          </button>
        ))}
      </div>
      {tab === "cover" ? <CoverCard project={project} editable={admin} /> : null}
      {tab === "dates" ? (
        <>
          <DatesCard project={project} editable={admin} />
          {admin ? <ProjectExtendCard project={project} /> : null}
        </>
      ) : null}
      {tab === "structure" ? <CutsCard project={project} editable={admin} /> : null}
      {tab === "staff" ? <StaffCard project={project} editable={admin} /> : null}
      {tab === "stages" ? <StagesCard project={project} editable={admin} /> : null}
      <ProjectTimelineCard projectId={project.id} />
    </>
  );
}

function ProjectExtendCard({ project }: { project: ProjectRow }) {
  const { dispatch, notify } = useGuild();
  const { L, f, err } = useI18n();
  const [until, setUntil] = useState(project.planEndOn);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card" aria-label={L.edit.projectExtend}>
      <h2 className="t-heading-18">{L.edit.projectExtend}</h2>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const r = dispatch("project.extend", { projectId: project.id, until, reason }, { quiet: true });
          if (!r.ok) setError(err(r.error));
          else {
            setError(null);
            setReason("");
            notify(f(L.edit.projectExtended, { date: until }));
          }
        }}
      >
        <TextField label={L.edit.projectExtendUntil} type="date" value={until} onChange={(e) => setUntil(e.target.value)} data-testid="project-extend-until" />
        <TextField label={L.common.reason} hint={L.common.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="project-extend-reason" />
        <div className="form-actions">
          <Button Label={L.edit.extendGo} Size="Small" Style="Accent" type="submit" data-testid="project-extend-go" />
        </div>
      </form>
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}

function CutsCard({ project, editable }: { project: ProjectRow; editable: boolean }) {
  const { world } = useGuild();
  const { L, f, cut: cutOf } = useI18n();
  const cuts = cutsOf(world, project.id);
  const [editing, setEditing] = useState<Id | null>(null);
  return (
    <>
      {editable ? <AddCutsForm projectId={project.id} /> : null}
      <section className="card" aria-labelledby="cuts-title" data-testid="cuts-card">
        <h2 id="cuts-title" className="t-heading-18">
          {L.edit.cutsTitle} <span className="count">{f(L.zero.cutsTotal, { n: cuts.filter((c) => !c.disabled).length })}</span>
        </h2>
        <ul className="list">
          {cuts.map((c) => (
            <li key={c.id} style={{ flexDirection: "column", alignItems: "stretch" }} data-testid="cut-row">
              <div className="row" data-justify="between">
                <div className="list-main">
                  <Link to={`/cut/${c.id}`} className="t-body-14m num">
                    {cutOf(c, project.group)}
                  </Link>
                  <span className="label">
                    {c.scene} · {c.layers.map((l) => `${l.name} ${l.sheets}`).join(" / ")} · {c.seconds}s
                  </span>
                </div>
                {c.disabled ? <Tag>{L.edit.disabledTag}</Tag> : editable ? <Button Label={L.edit.editCut} Size="Small" Style="Ghost" onClick={() => setEditing(editing === c.id ? null : c.id)} /> : null}
              </div>
              {editing === c.id ? <CutEditForm cut={c} onDone={() => setEditing(null)} /> : null}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function AddCutsForm({ projectId, onDone }: { projectId: Id; onDone?: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, cut: cutOf } = useI18n();
  const project = world.projects[projectId];
  const cuts = cutsOf(world, projectId);
  const [count, setCount] = useState("1");
  const [after, setAfter] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card" aria-label={L.edit.addCuts} data-testid="add-cuts">
      <h2 className="t-heading-18">{L.edit.addCuts}</h2>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(count);
          const r = dispatch("cut.add", { projectId, count: n, afterCutId: after || null, reason: reason || null }, { quiet: true });
          if (!r.ok) setError(err(r.error));
          else {
            setError(null);
            setReason("");
            notify(f(L.edit.cutsAdded, { n }));
            onDone?.();
          }
        }}
      >
        <TextField label={L.edit.addCount} type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} data-testid="add-cuts-count" />
        <SelectField label={L.edit.addAfter} value={after} onChange={(e) => setAfter(e.target.value)} data-testid="add-cuts-after">
          <option value="">{L.edit.addAtEnd}</option>
          {cuts.map((c) => (
            <option key={c.id} value={c.id}>
              {f(L.edit.addAfterCut, { cut: cutOf(c, project.group) })}
            </option>
          ))}
        </SelectField>
        <TextField label={L.common.reason} hint={L.common.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="add-cuts-reason" />
        <div className="form-actions">
          <Button Label={L.edit.addCuts} Size="Small" Style="Accent" type="submit" data-testid="add-cuts-go" />
        </div>
      </form>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function CutEditForm({ cut, onDone }: { cut: CutRow; onDone: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, cut: cutOf } = useI18n();
  const group = world.projects[cut.projectId].group;
  const [layers, setLayers] = useState(cut.layers.map((l) => `${l.name}:${l.sheets}`).join(", "));
  const [seconds, setSeconds] = useState(String(cut.seconds));
  const [reason, setReason] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = cutOf(cut, group);
  return (
    <div className="stack flex-box" data-gap="small">
      <div className="form-grid">
        {groupTemplate(group).hasLayers ? <TextField label={L.edit.cutLayers} value={layers} onChange={(e) => setLayers(e.target.value.toUpperCase())} /> : null}
        <TextField label={L.edit.cutSeconds} type="number" min={0} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
        <TextField label={L.common.reason} hint={L.common.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="form-actions">
        <Button
          Label={L.common.save}
          Size="Small"
          Style="Accent"
          onClick={() => {
            const parsed = groupTemplate(group).hasLayers
              ? layers
                  .split(/[,，]+/)
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .map((x) => {
                    const [name, sheets] = x.split(/[:：\s]+/);
                    return { name, sheets: Number(sheets) };
                  })
              : undefined;
            const r = dispatch("cut.update", { cutId: cut.id, layers: parsed, seconds: Number(seconds), reason: reason || null }, { quiet: true });
            if (!r.ok) setError(err(r.error));
            else {
              notify(f(L.edit.cutUpdated, { cut: code }));
              onDone();
            }
          }}
        />
        <Button Label={L.edit.archiveCut} Size="Small" Style="Ghost" onClick={() => setConfirmArchive(true)} />
      </div>
      {confirmArchive ? <ArchiveCutDialog cut={cut} onClose={() => setConfirmArchive(false)} /> : null}
    </div>
  );
}

export function ArchiveCutDialog({ cut, onClose }: { cut: CutRow; onClose: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, cut: cutOf } = useI18n();
  const code = cutOf(cut, world.projects[cut.projectId].group);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer
      Type="Dialog"
      Title={L.edit.archiveCut}
      Body={f(L.edit.archiveCutConfirm, { cut: code })}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.common.cancel} Style="Secondary" onClick={onClose} />
          <Button
            Label={L.edit.archiveCut}
            data-testid="archive-cut-go"
            onClick={() => {
              const r = dispatch("cut.archive", { cutId: cut.id, reason }, { quiet: true });
              if (!r.ok) setError(err(r.error));
              else {
                notify(f(L.edit.cutArchived, { cut: code }), "Neutral");
                onClose();
              }
            }}
          />
        </>
      }
    >
      <TextField label={L.common.reason} hint={L.common.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="archive-cut-reason" />
      {error ? <p className="error-text">{error}</p> : null}
    </Drawer>
  );
}

function StagesCard({ project, editable }: { project: ProjectRow; editable: boolean }) {
  const { world } = useGuild();
  const { L, lang } = useI18n();
  const stages = stagesOf(world, project.id);
  const [editing, setEditing] = useState<Id | null>(null);
  return (
    <>
      {editable ? <AddStageForm project={project} /> : null}
      <section className="card" aria-labelledby="stages-edit-title" data-testid="stages-card">
        <h2 id="stages-edit-title" className="t-heading-18">
          {L.edit.tabStages} <span className="count">{stages.length}</span>
        </h2>
        <ul className="list">
          {stages.map((s, i) => {
            const text = stageText(project.group, s, lang);
            return (
              <li key={s.id} style={{ flexDirection: "column", alignItems: "stretch" }} data-testid="stage-row">
                <div className="row" data-justify="between">
                  <div className="list-main">
                    <span className="t-body-14m">{text.custom ? <U>{text.name}</U> : text.name}</span>
                    <span className="label">
                      {L.labels.phase[s.phase]} · {L.labels.stageKind[s.kind]} · {L.labels.grain[s.grain]}
                    </span>
                  </div>
                  <div className="row">
                    {s.disabled ? <Tag>{L.edit.disabledTag}</Tag> : null}
                    {s.acceptedAt ? <Tag tone="success">{L.edit.acceptedTag}</Tag> : null}
                    {editable ? <StageRowActions stage={s} first={i === 0} last={i === stages.length - 1} onEdit={() => setEditing(editing === s.id ? null : s.id)} /> : null}
                  </div>
                </div>
                {editing === s.id ? <StageEditForm stage={s} onDone={() => setEditing(null)} /> : null}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function StageRowActions({ stage, first, last, onEdit }: { stage: StageRow; first: boolean; last: boolean; onEdit: () => void }) {
  const { world } = useGuild();
  const groupOf = (st: StageRow) => world.projects[st.projectId]?.group ?? "animation";
  const { dispatch, notify } = useGuild();
  const { L, f, err, stageName } = useI18n();
  const run = (name: "stage.move" | "stage.disable" | "stage.remove", input: Record<string, unknown>, ok: string) => {
    const r = dispatch(name, input as never, { quiet: true });
    if (!r.ok) notify(err(r.error), "Error");
    else if (ok) notify(ok, "Neutral");
  };
  return (
    <>
      <button type="button" className="inline-link label" disabled={first} onClick={() => run("stage.move", { stageId: stage.id, direction: "up" }, "")}>
        {L.common.up}
      </button>
      <button type="button" className="inline-link label" disabled={last} onClick={() => run("stage.move", { stageId: stage.id, direction: "down" }, "")}>
        {L.common.down}
      </button>
      <button type="button" className="inline-link label" onClick={onEdit}>
        {L.common.edit}
      </button>
      <button type="button" className="inline-link label" onClick={() => run("stage.disable", { stageId: stage.id, disabled: !stage.disabled }, f(stage.disabled ? L.edit.stageEnabled : L.edit.stageDisabled, { name: stageName(groupOf(stage), stage) }))} data-testid="stage-disable">
        {stage.disabled ? L.edit.stageEnable : L.edit.stageDisable}
      </button>
      <button type="button" className="inline-link label" onClick={() => run("stage.remove", { stageId: stage.id }, f(L.edit.stageRemoved, { name: stageName(groupOf(stage), stage) }))} data-testid="stage-remove">
        {L.edit.stageRemove}
      </button>
    </>
  );
}

function StageEditForm({ stage, onDone }: { stage: StageRow; onDone: () => void }) {
  const { dispatch, notify } = useGuild();
  const { L, f, err } = useI18n();
  const [name, setName] = useState(stage.name);
  const [phase, setPhase] = useState(stage.phase);
  const [kind, setKind] = useState(stage.kind);
  const [tn, setTn] = useState(String(stage.tn));
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="form-grid flex-box"
      onSubmit={(e) => {
        e.preventDefault();
        const r = dispatch("stage.update", { stageId: stage.id, name, phase, kind, tn: Number(tn) }, { quiet: true });
        if (!r.ok) setError(err(r.error));
        else {
          notify(f(L.edit.stageSaved, { name }), "Neutral");
          onDone();
        }
      }}
    >
      <TextField label={L.edit.stageName} value={name} onChange={(e) => setName(e.target.value)} />
      <SelectField label={L.edit.stagePhase} value={phase} onChange={(e) => setPhase(e.target.value as StageRow["phase"])}>
        {PHASE.map((p) => (
          <option key={p} value={p}>
            {L.labels.phase[p]}
          </option>
        ))}
      </SelectField>
      <SelectField label={L.edit.stageKind} value={kind} onChange={(e) => setKind(e.target.value as StageRow["kind"])}>
        {STAGE_KIND.map((k) => (
          <option key={k} value={k}>
            {L.labels.stageKind[k]}
          </option>
        ))}
      </SelectField>
      <TextField label={L.edit.stageTn} type="number" step="0.1" value={tn} onChange={(e) => setTn(e.target.value)} />
      <div className="form-actions">
        <Button Label={L.edit.stageSave} Size="Small" Style="Accent" type="submit" />
        <Button Label={L.common.cancel} Size="Small" Style="Ghost" onClick={onDone} />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </form>
  );
}

function AddStageForm({ project }: { project: ProjectRow }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, lang } = useI18n();
  const stages = stagesOf(world, project.id);
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<StageRow["phase"]>("pre");
  const [kind, setKind] = useState<StageRow["kind"]>("review");
  const [grain, setGrain] = useState<StageRow["grain"]>("project");
  const [unit, setUnit] = useState<StageRow["unit"]>("item");
  const [tn, setTn] = useState("2");
  const [after, setAfter] = useState("");
  const [insert, setInsert] = useState(true);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card" aria-label={L.edit.stageAdd} data-testid="add-stage">
      <h2 className="t-heading-18">{L.edit.stageAdd}</h2>
      <form
        className="stack"
        data-gap="small"
        onSubmit={(e) => {
          e.preventDefault();
          const r = dispatch("stage.add", { projectId: project.id, name, phase, kind, grain, unit, tn: Number(tn), afterKey: after || null, insertBetween: insert }, { quiet: true });
          if (!r.ok) setError(err(r.error));
          else {
            setError(null);
            notify(f(L.edit.stageAdded, { name }));
            setName("");
          }
        }}
      >
        <div className="form-grid">
          <TextField label={L.edit.stageName} value={name} onChange={(e) => setName(e.target.value)} data-testid="add-stage-name" />
          <SelectField label={L.edit.stageAfter} value={after} onChange={(e) => setAfter(e.target.value)} data-testid="add-stage-after">
            <option value="">{L.edit.stageAfterNone}</option>
            {stages.map((s) => (
              <option key={s.id} value={s.templateKey}>
                {stageText(project.group, s, lang).name}
              </option>
            ))}
          </SelectField>
          <SelectField label={L.edit.stagePhase} value={phase} onChange={(e) => setPhase(e.target.value as StageRow["phase"])} data-testid="add-stage-phase">
            {PHASE.map((p) => (
              <option key={p} value={p}>
                {L.labels.phase[p]}
              </option>
            ))}
          </SelectField>
          <SelectField label={L.edit.stageKind} value={kind} onChange={(e) => setKind(e.target.value as StageRow["kind"])}>
            {STAGE_KIND.map((k) => (
              <option key={k} value={k}>
                {L.labels.stageKind[k]}
              </option>
            ))}
          </SelectField>
          <SelectField label={L.edit.stageGrain} value={grain} onChange={(e) => setGrain(e.target.value as StageRow["grain"])} data-testid="add-stage-grain">
            {GRAIN.map((g) => (
              <option key={g} value={g}>
                {L.labels.grain[g]}
              </option>
            ))}
          </SelectField>
          <SelectField label={L.edit.stageUnit} value={unit} onChange={(e) => setUnit(e.target.value as StageRow["unit"])}>
            {UNIT.map((u) => (
              <option key={u} value={u}>
                {L.labels.unit[u]}
              </option>
            ))}
          </SelectField>
          <TextField label={L.edit.stageTn} type="number" step="0.1" min={0} value={tn} onChange={(e) => setTn(e.target.value)} />
        </div>
        <label className="check-row">
          <input type="checkbox" checked={insert} onChange={(e) => setInsert(e.target.checked)} />
          <span>{L.edit.stageInsert}</span>
        </label>
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <Button Label={L.edit.stageAdd} Size="Small" Style="Accent" type="submit" data-testid="add-stage-go" />
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 验收 · 延期
// ---------------------------------------------------------------------------

export function AcceptDialog({ stage, onClose }: { stage: StageRow; onClose: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, lang, num } = useI18n();
  const project = world.projects[stage.projectId];
  const tasks = useMemo(() => tasksOf(world, stage.projectId).filter((t) => t.stageId === stage.id), [world, stage]);
  const [error, setError] = useState<string | null>(null);
  const name = stageText(project.group, stage, lang).name;
  const redo = tasks.filter((t) => t.redo).length;
  return (
    <Drawer
      Type="Drawer"
      Title={f(L.edit.acceptTitle, { stage: name })}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.common.close} Style="Secondary" onClick={onClose} />
          {!stage.acceptedAt ? (
            <Button
              Label={L.edit.acceptAll}
              Style="Accent"
              data-testid="accept-all"
              onClick={() => {
                const r = dispatch("stage.accept", { stageId: stage.id }, { quiet: true });
                if (!r.ok) setError(err(r.error));
                else {
                  setError(null);
                  notify(f(L.edit.accepted, { stage: name }));
                }
              }}
            />
          ) : null}
        </>
      }
    >
      <div className="stack" data-gap="small" style={{ overflowY: "auto" }} data-testid="accept-view">
        <p className="muted">{L.edit.acceptLead}</p>
        {stage.acceptedAt ? <Tag tone="success">{L.edit.acceptedTag}</Tag> : null}
        {redo ? <Tag tone="warning">{f(L.edit.redoCount, { n: redo })}</Tag> : null}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="list">
          {tasks.map((t) => (
            <AcceptRow key={t.id} task={t} />
          ))}
        </ul>
      </div>
    </Drawer>
  );
  void num;
}

function AcceptRow({ task }: { task: TaskRow }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, r: rich, ph, pt } = useI18n();
  const v = taskView(world, task);
  const subs = submissionsOf(world, task.id);
  const last = subs[subs.length - 1];
  const review = reviewsOf(world, task.id).filter((r) => r.verdict !== "return").pop();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!v) return null;
  const images = last ? filesOn(world, "submission", last.id).filter((x) => !!x.width) : [];
  return (
    <li style={{ flexDirection: "column", alignItems: "stretch" }} data-testid="accept-row">
      <div className="row" data-justify="between">
        <span className="t-body-14m">{ph(v.labelP)}</span>
        <StatusPill Status={task.status} />
      </div>
      {last ? (
        <>
          <span className="label num break">
            <U>{last.fileName}</U>
          </span>
          <LinkList submission={last} compact />
          {images.length ? (
            <div className="row">
              {images.slice(0, 4).map((img) => (
                <FileImage key={img.id} file={img} className="accept-thumb" />
              ))}
            </div>
          ) : null}
          <span className="label">
            {rich(L.edit.finalBy, {
              who: <U>{memberById(world, last.byMemberId)?.nickname ?? task.outsourceName ?? "—"}</U>,
              reviewer: <U>{review ? memberById(world, review.byMemberId)?.nickname ?? "—" : "—"}</U>,
              q: review?.quality ?? "—",
            })}
          </span>
        </>
      ) : (
        <span className="label">{L.edit.noFinal}</span>
      )}
      {task.status === "passed" ? (
        open ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const r = dispatch("task.reopen", { taskId: task.id, comments: [{ text }] }, { quiet: true });
              if (!r.ok) setError(err(r.error));
              else {
                notify(f(L.edit.redone, { label: pt(v.labelP) }), "Neutral");
                setOpen(false);
              }
            }}
          >
            <TextField label={L.edit.redoComment} value={text} onChange={(e) => setText(e.target.value)} data-testid="redo-comment" />
            <Button Label={L.edit.redoGo} Size="Small" Style="Primary" type="submit" data-testid="redo-go" />
          </form>
        ) : (
          <div className="form-actions">
            <Button Label={L.edit.redo} Size="Small" Style="Ghost" onClick={() => setOpen(true)} data-testid="redo-open" />
          </div>
        )
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
    </li>
  );
}

/** 延期：一张任务（选一张在做的）或者一个环节所有在做的。 */
export function ExtendDialog({ target, tasks, onClose }: { target: { kind: "stage"; stage: StageRow } | { kind: "task" }; tasks?: TaskRow[]; onClose: () => void }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, lang, pt } = useI18n();
  const running = (tasks ?? []).filter((t) => (t.status === "claimed" || t.status === "returned") && t.dueAt);
  const [taskId, setTaskId] = useState(running[0]?.id ?? "");
  const [hours, setHours] = useState("");
  const [days, setDays] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const what = target.kind === "stage" ? stageText(world.projects[target.stage.projectId].group, target.stage, lang).name : taskView(world, world.tasks[taskId])?.label ?? "";
  const go = () => {
    const amount = { hours: hours ? Number(hours) : null, days: days ? Number(days) : null, until: until || null, reason };
    const r = target.kind === "stage" ? dispatch("stage.extend", { stageId: target.stage.id, ...amount }, { quiet: true }) : dispatch("task.extend", { taskId, ...amount }, { quiet: true });
    if (!r.ok) setError(err(r.error));
    else {
      notify(L.edit.extended);
      onClose();
    }
  };
  return (
    <Drawer
      Type="Dialog"
      Title={f(L.edit.extendTitle, { what })}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.common.cancel} Style="Secondary" onClick={onClose} />
          <Button Label={L.edit.extendGo} Style="Accent" onClick={go} data-testid="extend-go" />
        </>
      }
    >
      <div className="stack" data-gap="small">
        {target.kind === "task" ? (
          <SelectField label={L.edit.extendTask} value={taskId} onChange={(e) => setTaskId(e.target.value)} data-testid="extend-task">
            {running.map((t) => (
              <option key={t.id} value={t.id}>
                {pt(taskView(world, t)?.labelP)}
              </option>
            ))}
          </SelectField>
        ) : null}
        <div className="form-grid">
          <TextField label={L.edit.extendHours} type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} data-testid="extend-hours" />
          <TextField label={L.edit.extendDays} type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} />
          <TextField label={L.edit.extendUntil} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
        <TextField label={L.common.reason} hint={L.common.reasonHint} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="extend-reason" />
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// 项目时间线
// ---------------------------------------------------------------------------

export function ProjectTimelineCard({ projectId }: { projectId: Id }) {
  const { world } = useGuild();
  const { L, f, dateTime, ph } = useI18n();
  const items = projectTimeline(world, projectId);
  return (
    <section className="card" aria-labelledby="ptl-title" data-testid="project-timeline">
      <h2 id="ptl-title" className="t-heading-18">
        {L.edit.timelineTitle} <span className="count">{items.length}</span>
      </h2>
      <p className="label">{L.edit.timelineLead}</p>
      {items.length === 0 ? (
        <Empty>{L.edit.timelineEmpty}</Empty>
      ) : (
        <ol className="timeline">
          {items.slice(0, 60).map((i) => (
            <li key={i.key} data-testid="project-timeline-item" data-command={i.command}>
              <span className="dot" data-kind="other" aria-hidden="true">
                ·
              </span>
              <div className="timeline-body">
                <div className="timeline-head">
                  <span className="break">{ph(i.phrase)}</span>
                  <span className="label">{dateTime(i.at)}</span>
                </div>
                {i.reason ? (
                  <span className="label break">
                    {f(L.edit.because, { reason: "" })}
                    <U>{i.reason}</U>
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 卡详情里管理员的：延期 · 打回重做 · 停用这一卡
// ---------------------------------------------------------------------------

export function CutAdminCard({ cut }: { cut: CutRow }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err, pt } = useI18n();
  const tasks = Object.values(world.tasks).filter((t) => t.cutId === cut.id && !t.archivedAt && !t.extra);
  const passed = tasks.filter((t) => t.status === "passed");
  const running = tasks.filter((t) => (t.status === "claimed" || t.status === "returned") && t.dueAt);
  const [sub, setSub] = useState<"extend" | "redo" | "archive" | null>(null);
  const [taskId, setTaskId] = useState(passed[0]?.id ?? "");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (cut.disabled)
    return (
      <section className="card" data-tone="muted" aria-label={L.edit.cutAdmin}>
        <Tag>{L.edit.disabledTag}</Tag>
      </section>
    );
  return (
    <section className="card" aria-labelledby="cut-admin-title" data-testid="cut-admin">
      <h2 id="cut-admin-title" className="t-heading-18">
        {L.edit.cutAdmin}
      </h2>
      <div className="form-actions">
        <Button Label={L.edit.extendOpen} Size="Small" Style="Secondary" disabled={!running.length} onClick={() => setSub("extend")} data-testid="cut-extend-open" />
        <Button Label={L.edit.redo} Size="Small" Style="Secondary" disabled={!passed.length} onClick={() => setSub(sub === "redo" ? null : "redo")} data-testid="cut-redo-open" />
        <Button Label={L.edit.archiveCut} Size="Small" Style="Ghost" onClick={() => setSub("archive")} data-testid="cut-archive-open" />
      </div>
      {!running.length ? <span className="label">{L.edit.noRunning}</span> : null}
      {sub === "redo" ? (
        <form
          className="stack"
          data-gap="small"
          onSubmit={(e) => {
            e.preventDefault();
            const r = dispatch("task.reopen", { taskId, comments: [{ text }] }, { quiet: true });
            if (!r.ok) setError(err(r.error));
            else {
              setError(null);
              setText("");
              setSub(null);
              notify(f(L.edit.redone, { label: pt(taskView(world, world.tasks[taskId])?.labelP) }), "Neutral");
            }
          }}
        >
          <SelectField label={L.edit.extendTask} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            {passed.map((t) => (
              <option key={t.id} value={t.id}>
                {pt(taskView(world, t)?.labelP)}
              </option>
            ))}
          </SelectField>
          <TextField label={L.edit.redoComment} value={text} onChange={(e) => setText(e.target.value)} data-testid="cut-redo-comment" />
          <div className="form-actions">
            <Button Label={L.edit.redoGo} Size="Small" Style="Primary" type="submit" data-testid="cut-redo-go" />
          </div>
        </form>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
      {sub === "extend" ? <ExtendDialog target={{ kind: "task" }} tasks={running} onClose={() => setSub(null)} /> : null}
      {sub === "archive" ? <ArchiveCutDialog cut={cut} onClose={() => setSub(null)} /> : null}
    </section>
  );
}
