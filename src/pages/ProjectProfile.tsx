/**
 * 项目档案（SPEC §17.3，取代原来的「改项目」大表；排法照设计组 v6-4a / v6-4b）：一页四块——介绍 · 日期 · 结构 · 人员表。
 * 每块默认是「看」的样子，右上「改」→ 只这一块变成表单（黑描边 ·「正在改这一块」· 底下 存 / 取消），其余几块的「改」先变灰。
 * 改了什么照旧记进项目动态。这里的表单开局向导（§17.4）也用：向导里「下一步」= 存这一步的表单。
 */
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Empty, MemberAvatar, SelectField, Tag, TextArea, TextField } from "@/components/app/bits";
import { FileImage } from "@/components/library/tiles";
import { isAdmin } from "@/domain/commands/core";
import { PROJECT_STATUS, type CutRow, type Id, type ProjectRow, type ProjectStatus, type StaffPerson, type StaffPosition } from "@/domain/model";
import { cutCode } from "@/domain/naming";
import { POSITION_GROUPS, POSITION_GROUP_LABEL, positionTemplate } from "@/domain/positions";
import { cutsOf, libraryOf, memberById, members, stagesOf, todayOf, weekOf } from "@/domain/queries";
import { groupTemplate, stageText } from "@/domain/templates";
import { U, useI18n } from "@/i18n/I18n";
import { Link } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { AddCutsForm, AddPositionForm, ArchiveCutDialog, CutEditForm, KeyDateTimeline, ProjectExtendCard } from "./ProjectSetup";

// ---------------------------------------------------------------------------
// 档案页
// ---------------------------------------------------------------------------

type BlockId = "intro" | "dates" | "structure" | "staff";

export function ProjectProfile({ project }: { project: ProjectRow }) {
  const { me } = useGuild();
  const { L, f, t2 } = useI18n();
  const admin = isAdmin(me);
  const zero = project.status === "zero";
  const [editing, setEditing] = useState<BlockId | null>(null);
  const done = () => setEditing(null);
  const missing = (project.staff ?? []).filter((p) => !p.people.length).length;
  const block = (id: BlockId, title: string, hint: string, view: ReactNode, form: ReactNode) => (
    <ProfileBlock id={id} title={title} hint={hint} admin={admin} editing={editing} onEdit={() => setEditing(id)} view={view} form={form} />
  );
  void t2;
  return (
    <div className="profile-layout" data-testid="project-profile">
      <p className="label profile-lead">{admin ? L.profile.leadAdmin : L.profile.lead}</p>
      <div className="profile-col">
        {block("intro", L.zero.coverTitle, L.profile.introHint, <CoverView project={project} />, <CoverForm project={project} onSaved={done} onCancel={done} />)}
        {block(
          "dates",
          L.zero.datesTitle,
          L.profile.datesHint,
          <DatesView project={project} />,
          <>
            <DatesForm project={project} onSaved={done} onCancel={done} />
            {!zero ? <ProjectExtendCard project={project} /> : null}
          </>
        )}
        {block(
          "structure",
          L.zero.structureTitle,
          L.profile.structureHint,
          zero ? <StructureView project={project} /> : <CutsView project={project} />,
          zero ? <StructureForm project={project} onSaved={done} onCancel={done} /> : <CutsEditor project={project} onDone={done} />
        )}
      </div>
      <div className="profile-col">
        {block("staff", L.zero.staffTitle, missing ? f(L.profile.staffHintMissing, { n: missing }) : L.profile.staffHint, <StaffView project={project} />, <StaffEditor project={project} onSaved={done} onCancel={done} />)}
      </div>
    </div>
  );
}

function ProfileBlock({ id, title, hint, admin, editing, onEdit, view, form }: { id: BlockId; title: string; hint: string; admin: boolean; editing: BlockId | null; onEdit: () => void; view: ReactNode; form: ReactNode }) {
  const { L, f } = useI18n();
  const mine = editing === id;
  return (
    <section className="card profile-block" aria-labelledby={`pf-${id}`} data-testid={`profile-${id}`} data-mode={mine ? "edit" : "view"}>
      <div className="card-head">
        <h2 id={`pf-${id}`} className="t-heading-18">
          {title} <span className="label">{hint}</span>
        </h2>
        {mine ? (
          <span className="now-tag">{L.profile.editing}</span>
        ) : admin ? (
          <button type="button" className="profile-edit" disabled={!!editing} onClick={onEdit} aria-label={f(L.profile.editAria, { what: title })} data-testid={`profile-${id}-edit`}>
            {L.profile.edit}
          </button>
        ) : null}
      </div>
      {mine ? form : view}
    </section>
  );
}

/** 表单底下：存 / 取消（向导里用自己的「上一步 / 下一步」，不显示这一排）。 */
function FormFooter({ onCancel }: { onCancel?: () => void }) {
  const { L } = useI18n();
  if (!onCancel) return null;
  return (
    <div className="form-actions profile-footer">
      <Button Label={L.common.save} Size="Small" Style="Primary" type="submit" data-testid="profile-save" />
      <Button Label={L.common.cancel} Size="Small" Style="Ghost" onClick={onCancel} data-testid="profile-cancel" />
      <span className="label">{L.profile.onlyThis}</span>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="error-text" role="alert">
      {error}
    </p>
  ) : null;
}

function Tile({ big, small, tone }: { big: ReactNode; small: ReactNode; tone?: "danger" }) {
  return (
    <div className="profile-tile" data-tone={tone}>
      <span className="profile-tile-big num">{big}</span>
      <span className="label">{small}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 介绍
// ---------------------------------------------------------------------------

export function CoverView({ project }: { project: ProjectRow }) {
  const { world } = useGuild();
  const { L, date } = useI18n();
  const coverFile = project.coverFileId ? world.files[project.coverFileId] : undefined;
  return (
    <div className="cover-layout" data-testid="cover-view">
      <div className="cover-image">
        {coverFile ? (
          <FileImage file={coverFile} className="cover-img" />
        ) : (
          <svg viewBox="0 0 96 64" aria-hidden="true" className="cover-ph">
            <circle cx="64" cy="22" r="9" />
            <path d="M12 52h72M18 52l14-18 13 16" />
          </svg>
        )}
      </div>
      <div className="stack" data-gap="small">
        <span className="t-section-24">
          <U>{project.name}</U>
        </span>
        <span className="label">
          <span className="num">{project.code}</span> · {L.labels.group[project.group]} · {date(project.startOn)} · {L.labels.projectStatus[project.status]}
        </span>
        <p className="break" data-testid="cover-intro">
          {project.intro ? <U>{project.intro}</U> : <span className="muted">{L.zero.noIntro}</span>}
        </p>
        {project.feishuRoot ? (
          <a href={project.feishuRoot} target="_blank" rel="noreferrer noopener" className="label break">
            {L.project.feishuRoot}
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function CoverForm({ project, formId, onSaved, onCancel }: { project: ProjectRow; formId?: string; onSaved: () => void; onCancel?: () => void }) {
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
  return (
    <form
      id={formId}
      className="stack"
      data-gap="small"
      data-testid="cover-form"
      onSubmit={(e) => {
        e.preventDefault();
        const r = dispatch(
          "project.update",
          { projectId: project.id, name, code, intro: intro || null, coverFileId: cover || null, feishuRoot: feishuRoot || null, ...(started && status !== project.status ? { status } : {}) },
          { quiet: true }
        );
        if (!r.ok) return setError(err(r.error));
        setError(null);
        notify(L.common.saved, "Neutral");
        onSaved();
      }}
    >
      <div className="form-grid profile-name-grid">
        <TextField label={L.zero.name} value={name} onChange={(e) => setName(e.target.value)} data-testid="cover-name" />
        <TextField label={L.zero.code} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="cover-code" />
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
      <ErrorLine error={error} />
      <FormFooter onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// 日期
// ---------------------------------------------------------------------------

export function DatesView({ project }: { project: ProjectRow }) {
  const { world } = useGuild();
  const { L, f, date, monthDay } = useI18n();
  const cycle = project.cycleDays ?? 7;
  const planWeeks = Math.max(1, weekOf(project, project.planEndOn));
  const today = todayOf(world);
  const todayWeek = weekOf(project, today);
  const over = today > project.planEndOn ? todayWeek - planWeeks : 0;
  const started = today >= project.startOn;
  return (
    <div className="stack" data-gap="small" data-testid="dates-view">
      <div className="profile-tiles">
        <Tile big={monthDay(project.startOn)} small={f(L.profile.tileStart, { y: project.startOn.slice(0, 4) })} />
        <Tile big={monthDay(project.planEndOn)} small={L.profile.tileEnd} />
        <Tile big={f(L.profile.tileCycle, { n: cycle })} small={f(L.profile.tileCycleSmall, { n: planWeeks })} />
        {started ? <Tile big={f(L.profile.tileWeek, { n: todayWeek })} small={over > 0 ? f(L.profile.tileOver, { n: over }) : L.profile.tileToday} tone={over > 0 ? "danger" : undefined} /> : <Tile big={date(project.startOn)} small={L.profile.tileNotStarted} />}
      </div>
      <KeyDateTimeline project={project} />
      {!(project.keyDates ?? []).length ? <p className="label">{L.profile.noKeyDates}</p> : null}
    </div>
  );
}

export function DatesForm({ project, formId, onSaved, onCancel }: { project: ProjectRow; formId?: string; onSaved: () => void; onCancel?: () => void }) {
  const { dispatch, notify } = useGuild();
  const { L, f, err } = useI18n();
  const [startOn, setStartOn] = useState(project.startOn);
  const [planEndOn, setPlanEndOn] = useState(project.planEndOn);
  const [cycle, setCycle] = useState(String(project.cycleDays ?? 7));
  const [keys, setKeys] = useState(project.keyDates?.length ? project.keyDates.map((k) => ({ ...k })) : [{ id: "k1", name: "", date: "" }]);
  const [error, setError] = useState<string | null>(null);
  // 时间轴照正在填的日子实时画。
  const live = useMemo(() => ({ ...project, startOn, planEndOn, cycleDays: Number(cycle) || 7, keyDates: keys.filter((k) => k.name.trim() && k.date) }), [project, startOn, planEndOn, cycle, keys]);
  const weeks = startOn && planEndOn && planEndOn >= startOn ? weekOf(live, planEndOn) : null;
  return (
    <form
      id={formId}
      className="stack"
      data-gap="small"
      data-testid="dates-form"
      onSubmit={(e) => {
        e.preventDefault();
        const keyDates = keys.filter((k) => k.name.trim() || k.date);
        const r = dispatch("project.update", { projectId: project.id, startOn, planEndOn, cycleDays: Number(cycle) || 7, keyDates }, { quiet: true });
        if (!r.ok) return setError(err(r.error));
        setError(null);
        notify(L.common.saved, "Neutral");
        onSaved();
      }}
    >
      <div className="form-grid profile-dates-grid">
        <TextField label={L.zero.startOn} type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} data-testid="zero-start-on" disabled={project.status !== "zero"} />
        <TextField label={L.zero.planEndOn} type="date" value={planEndOn} onChange={(e) => setPlanEndOn(e.target.value)} data-testid="zero-plan-end" />
        <TextField label={L.zero.cycleDays} hint={weeks ? f(L.profile.equalsWeeks, { n: weeks }) : undefined} type="number" min={1} max={31} value={cycle} onChange={(e) => setCycle(e.target.value)} data-testid="zero-cycle" />
      </div>
      <span className="field-label">{L.zero.keyDates}</span>
      {keys.map((k, i) => (
        <div key={i} className="key-date-row">
          <TextField label={L.zero.keyDateName} placeholder={L.zero.keyDatePlaceholder} value={k.name} onChange={(e) => setKeys(keys.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} data-testid={`key-date-name-${i}`} />
          <TextField label={L.zero.keyDateDate} type="date" value={k.date} onChange={(e) => setKeys(keys.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} data-testid={`key-date-date-${i}`} />
          <button type="button" className="staff-x key-date-x" aria-label={L.common.remove} onClick={() => setKeys(keys.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="form-actions" data-justify="start">
        <button type="button" className="inline-link t-body-14m" onClick={() => setKeys([...keys, { id: `k${keys.length + 1}`, name: "", date: "" }])} data-testid="key-date-add">
          + {L.zero.keyDateAdd}
        </button>
      </div>
      <KeyDateTimeline project={live} />
      <ErrorLine error={error} />
      <FormFooter onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// 结构
// ---------------------------------------------------------------------------

function structureOf(project: ProjectRow) {
  return project.structure ?? { episodes: 1, scenesPerEpisode: 1, cutsPerScene: 3, layers: ["A", "B"], sheetsPerLayer: 12, secondsPerCut: 4 };
}

/** 卡按 集 › 场 分行排的小块（零日的计划 · 开工以后的卡都用）。 */
function CutChips({ cuts, max = 60, onPick, picked }: { cuts: { key: string; code: string; episode: string; scene: string; disabled?: boolean }[]; max?: number; onPick?: (key: string) => void; picked?: string | null }) {
  const { L, f } = useI18n();
  if (!cuts.length) return <p className="label">{L.profile.noCuts}</p>;
  const shown = cuts.slice(0, max);
  const groups: { head: string; items: typeof shown }[] = [];
  for (const c of shown) {
    const head = `${c.episode} › ${c.scene} ›`;
    const last = groups[groups.length - 1];
    if (last && last.head === head) last.items.push(c);
    else groups.push({ head, items: [c] });
  }
  return (
    <div className="cut-chips" data-testid="cut-preview" data-count={cuts.length}>
      {groups.map((g) => (
        <div key={g.head} className="cut-chip-row">
          <span className="label num">{g.head}</span>
          {g.items.map((c) =>
            onPick ? (
              <button key={c.key} type="button" className="cut-chip num" aria-pressed={picked === c.key} data-disabled={c.disabled ? "yes" : undefined} onClick={() => onPick(c.key)} data-testid="cut-chip">
                {c.code}
              </button>
            ) : (
              <span key={c.key} className="cut-chip num" data-disabled={c.disabled ? "yes" : undefined}>
                {c.code}
              </span>
            )
          )}
        </div>
      ))}
      {cuts.length > max ? <span className="label">{f(L.profile.moreCuts, { n: cuts.length - max })}</span> : null}
    </div>
  );
}

/** 零日：会生成哪些卡（按结构算，还没开工）。 */
export function StructureView({ project }: { project: ProjectRow }) {
  const { L, f, lang } = useI18n();
  const s = structureOf(project);
  const plan = project.cutsPlan ?? [];
  const hasLayers = groupTemplate(project.group).hasLayers;
  return (
    <div className="stack" data-gap="small" data-testid="structure-view">
      <div className="profile-tiles">
        <Tile big={s.episodes} small={L.profile.tileEpisodes} />
        <Tile big={s.episodes * s.scenesPerEpisode} small={L.profile.tileScenes} />
        <Tile big={plan.length} small={f(L.profile.tileCuts, { n: 0 })} />
        {hasLayers ? <Tile big={s.layers.length} small={f(L.profile.tileLayers, { names: s.layers.join(" / ") })} /> : null}
        <Tile big={f(L.profile.tileSeconds, { n: s.secondsPerCut })} small={L.profile.tileSecondsSmall} />
      </div>
      <CutChips cuts={plan.map((c) => ({ key: String(c.number), code: cutCode({ number: c.number }, project.group, lang), episode: c.episode, scene: c.scene }))} />
    </div>
  );
}

export function StructureForm({ project, formId, onSaved, onCancel }: { project: ProjectRow; formId?: string; onSaved: () => void; onCancel?: () => void }) {
  const { dispatch, notify } = useGuild();
  const { L, f, err, lang, cut: cutOf } = useI18n();
  const s = structureOf(project);
  const hasLayers = groupTemplate(project.group).hasLayers;
  const [form, setForm] = useState({ episodes: String(s.episodes), scenes: String(s.scenesPerEpisode), cuts: String(s.cutsPerScene), layers: s.layers.join(", "), sheets: String(s.sheetsPerLayer), seconds: String(s.secondsPerCut) });
  const [rows, setRows] = useState(project.cutsPlan ?? []);
  const [perCut, setPerCut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const layers = hasLayers ? form.layers.split(/[,，\s]+/).filter(Boolean) : [];
  const eps = Math.max(0, Math.floor(Number(form.episodes) || 0));
  const scs = Math.max(0, Math.floor(Number(form.scenes) || 0));
  const per = Math.max(0, Math.floor(Number(form.cuts) || 0));
  const total = eps * scs * per;
  // 下面实时预览会生成哪些卡（批量填的时候跟着变）：集 › 场 › 卡。
  const preview = useMemo(() => {
    const out: { key: string; code: string; episode: string; scene: string }[] = [];
    let n = 0;
    for (let e = 1; e <= Math.min(eps, 20); e++)
      for (let sc = 1; sc <= Math.min(scs, 50); sc++)
        for (let c = 1; c <= Math.min(per, 200) && out.length < 400; c++) {
          n += 1;
          out.push({ key: String(n), code: cutCode({ number: n }, project.group, lang), episode: `EP${String(e).padStart(2, "0")}`, scene: `SC${String(sc).padStart(3, "0")}` });
        }
    return out;
  }, [eps, scs, per, project.group, lang]);
  const layerNames = Array.from(new Set(rows.flatMap((c) => c.layers.map((l) => l.name))));
  return (
    <form
      id={formId}
      className="stack"
      data-gap="small"
      data-testid="structure-form"
      onSubmit={(e) => {
        e.preventDefault();
        const r = dispatch(
          "project.set_structure",
          {
            projectId: project.id,
            structure: { episodes: Number(form.episodes), scenesPerEpisode: Number(form.scenes), cutsPerScene: Number(form.cuts), layers, sheetsPerLayer: Number(form.sheets), secondsPerCut: Number(form.seconds) },
            cuts: perCut ? rows.map((c) => ({ number: c.number, layers: c.layers, seconds: c.seconds })) : undefined,
          },
          { quiet: true }
        );
        if (!r.ok) return setError(err(r.error));
        setError(null);
        setRows(r.state.projects[project.id].cutsPlan ?? []);
        notify(L.common.saved, "Neutral");
        onSaved();
      }}
    >
      <div className="form-grid profile-structure-grid">
        <TextField label={L.zero.episodes} type="number" min={1} value={form.episodes} onChange={(e) => setForm({ ...form, episodes: e.target.value })} data-testid="zero-episodes" />
        <TextField label={L.zero.scenesPerEpisode} type="number" min={1} value={form.scenes} onChange={(e) => setForm({ ...form, scenes: e.target.value })} data-testid="zero-scenes" />
        <TextField label={L.zero.cutsPerScene} type="number" min={1} value={form.cuts} onChange={(e) => setForm({ ...form, cuts: e.target.value })} data-testid="zero-cuts" />
        {hasLayers ? <TextField label={L.zero.layers} value={form.layers} onChange={(e) => setForm({ ...form, layers: e.target.value.toUpperCase() })} data-testid="zero-layers" /> : null}
        {hasLayers ? <TextField label={L.zero.sheetsPerLayer} type="number" min={0} value={form.sheets} onChange={(e) => setForm({ ...form, sheets: e.target.value })} data-testid="zero-sheets" /> : null}
        <TextField label={L.zero.secondsPerCut} type="number" min={0} value={form.seconds} onChange={(e) => setForm({ ...form, seconds: e.target.value })} data-testid="zero-seconds" />
      </div>
      <div className="structure-preview" aria-live="polite">
        <span>
          <span className="t-body-14m">{f(L.profile.willMake, { n: total })}</span>{" "}
          <span className="label">
            {hasLayers && layers.length ? f(L.profile.layersLine, { n: layers.length, sheets: Number(form.sheets) || 0 }) + " · " : ""}
            {f(L.profile.secondsAbout, { n: total * (Number(form.seconds) || 0) })}
          </span>
        </span>
        <CutChips cuts={preview} max={60} />
      </div>
      {rows.length ? (
        <details className="stack" data-gap="small" open={perCut} onToggle={(e) => setPerCut((e.target as HTMLDetailsElement).open)}>
          <summary className="t-body-14m">{L.zero.perCutTitle}</summary>
          <p className="label">{L.profile.perCutNote}</p>
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
                            <input className="field-control" type="number" min={1} aria-label={`${cutOf(c, project.group)} ${l}`} value={layer.sheets} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, layers: x.layers.map((y) => (y.name === l ? { ...y, sheets: Number(e.target.value) } : y)) } : x)))} />
                          ) : null}
                        </td>
                      );
                    })}
                    <td>
                      <input className="field-control" type="number" min={0} aria-label={`${cutOf(c, project.group)} ${L.zero.secondsCol}`} value={c.seconds} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, seconds: Number(e.target.value) } : x)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      <ErrorLine error={error} />
      <FormFooter onCancel={onCancel} />
    </form>
  );
}

function cutChipsOf(cuts: CutRow[], group: ProjectRow["group"], lang: "zh" | "en") {
  return cuts.map((c) => ({ key: c.id, code: cutCode(c, group, lang), episode: c.episode, scene: c.scene, disabled: !!c.disabled }));
}

/** 开工以后的结构：集 · 场 · 卡 · 层 · 每卡平均秒数 + 卡（停用的灰掉）。 */
function CutsView({ project }: { project: ProjectRow }) {
  const { world } = useGuild();
  const { L, f, lang, num } = useI18n();
  const cuts = cutsOf(world, project.id);
  const live = cuts.filter((c) => !c.disabled);
  const eps = new Set(live.map((c) => c.episode)).size;
  const scenes = new Set(live.map((c) => `${c.episode}/${c.scene}`)).size;
  const layers = Array.from(new Set(live.flatMap((c) => c.layers.map((l) => l.name))));
  const avg = live.length ? live.reduce((n, c) => n + c.seconds, 0) / live.length : 0;
  return (
    <div className="stack" data-gap="small" data-testid="cuts-list">
      <div className="profile-tiles">
        <Tile big={eps} small={f(L.profile.tileEpisodesOf, { names: Array.from(new Set(live.map((c) => c.episode))).slice(0, 2).join(" ") })} />
        <Tile big={scenes} small={f(L.profile.tileScenesOf, { names: Array.from(new Set(live.map((c) => c.scene))).slice(0, 2).join(" ") })} />
        <Tile big={live.length} small={f(L.profile.tileCuts, { n: cuts.length - live.length })} />
        {layers.length ? <Tile big={layers.length} small={f(L.profile.tileLayers, { names: layers.join(" / ") })} /> : null}
        <Tile big={f(L.profile.tileSecondsAbout, { n: num(avg) })} small={L.profile.tileSecondsSmall} />
      </div>
      <p className="label">{f(L.zero.cutsTotal, { n: live.length })}</p>
      <CutChips cuts={cutChipsOf(cuts, project.group, lang)} />
      <p className="label">{L.profile.cutsWhere}</p>
    </div>
  );
}

function CutsEditor({ project, onDone }: { project: ProjectRow; onDone: () => void }) {
  const { world } = useGuild();
  const { L, f, lang, cut: cutOf } = useI18n();
  const cuts = cutsOf(world, project.id);
  const [picked, setPicked] = useState<Id | null>(null);
  const [archiving, setArchiving] = useState(false);
  const cut = picked ? world.cuts[picked] : undefined;
  return (
    <div className="stack" data-gap="small">
      <span className="label">{L.profile.cutsPickHint}</span>
      <CutChips cuts={cutChipsOf(cuts, project.group, lang)} onPick={(k) => setPicked(picked === k ? null : k)} picked={picked} />
      {cut && !cut.disabled ? (
        <div className="profile-cut-box" data-testid="cut-box">
          <span className="t-body-14m">{f(L.profile.cutBoxTitle, { cut: cutOf(cut, project.group) })}</span>
          <CutEditForm cut={cut} onDone={() => setPicked(null)} />
          <div className="row">
            <Button Label={f(L.profile.archiveCut, { cut: cutOf(cut, project.group) })} Size="Small" Style="Secondary" onClick={() => setArchiving(true)} data-testid="cut-archive-open" />
          </div>
        </div>
      ) : cut ? (
        <p className="label">{L.edit.disabledTag}</p>
      ) : null}
      {archiving && cut ? (
        <ArchiveCutDialog
          cut={cut}
          onClose={() => {
            setArchiving(false);
            setPicked(null);
          }}
        />
      ) : null}
      <AddCutsForm projectId={project.id} />
      <p className="label">{L.profile.cutsNow}</p>
      <div className="form-actions profile-footer">
        <Button Label={L.profile.done} Size="Small" Style="Primary" onClick={onDone} data-testid="profile-done" />
        <span className="label">{L.profile.onlyThis}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 人员表
// ---------------------------------------------------------------------------

/** 关键职位：每个环节对应的第一个职位（开局向导先显示这些，其余收起）。 */
function keyPositionKeys(staff: StaffPosition[]): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  for (const pos of staff) {
    for (const k of pos.stageKeys) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.add(pos.key);
    }
  }
  return out;
}

type GroupKey = (typeof POSITION_GROUPS)[number] | "custom";

function groupedPositions(project: ProjectRow, list: StaffPosition[]): { group: GroupKey; positions: StaffPosition[] }[] {
  return ([...POSITION_GROUPS, "custom"] as GroupKey[])
    .map((g) => ({ group: g, positions: list.filter((p) => (positionTemplate(project.template, p.key)?.group ?? "custom") === g) }))
    .filter((x) => x.positions.length);
}

function usePositionText(project: ProjectRow) {
  const { world } = useGuild();
  const { L, f, t2, lang } = useI18n();
  return (pos: StaffPosition) => {
    const tpl = positionTemplate(project.template, pos.key);
    const name = pos.custom ? pos.custom.name : tpl ? t2(tpl.name) : pos.key;
    const desc = pos.custom ? pos.custom.desc : tpl ? t2(tpl.desc) : null;
    const stageNames = pos.stageKeys.map((k) => {
      const st = stagesOf(world, project.id).find((s) => s.templateKey === k);
      const gt = groupTemplate(project.group).stages.find((s) => s.key === k);
      return st ? stageText(project.group, st, lang).name : gt ? stageText(project.group, { templateKey: gt.key, name: gt.name }, lang).name : k;
    });
    return {
      name: pos.custom ? <U>{name}</U> : name,
      desc: desc ? pos.custom ? <U>{desc}</U> : desc : null,
      stages: pos.stageKeys.length ? f(L.zero.stages, { names: stageNames.join(" · ") }) : L.zero.noStages,
    };
  };
}

function PersonChip({ person, onRemove }: { person: StaffPerson; onRemove?: () => void }) {
  const { world } = useGuild();
  const { L } = useI18n();
  const x = onRemove ? (
    <button type="button" className="staff-x" aria-label={L.common.remove} onClick={onRemove}>
      ✕
    </button>
  ) : null;
  if ("memberId" in person) {
    const m = memberById(world, person.memberId);
    return (
      <span className="staff-person" data-testid="staff-person">
        <MemberAvatar member={m} size="20" />
        <U>{m?.nickname ?? "?"}</U>
        {x}
      </span>
    );
  }
  return (
    <span className="staff-person" data-testid="staff-person" data-external="">
      <U>{person.name}</U>
      <span className="staff-ext">{L.common.external}</span>
      {x}
    </span>
  );
}

export function StaffView({ project }: { project: ProjectRow }) {
  const { L, t2 } = useI18n();
  const staff = project.staff ?? [];
  const text = usePositionText(project);
  if (!staff.length) return <Empty>{L.zero.staffEmpty}</Empty>;
  return (
    <div className="staff-view" data-testid="staff-view">
      {groupedPositions(project, staff).map(({ group, positions }) => (
        <div key={group} className="staff-view-group">
          <span className="label staff-view-head">{group === "custom" ? L.zero.customGroup : t2(POSITION_GROUP_LABEL[group])}</span>
          <ul className="staff-view-list">
            {positions.map((pos) => (
              <li key={pos.key} className="staff-view-row" data-testid="staff-row" data-position={pos.key}>
                <span className="staff-view-pos" title={typeof text(pos).stages === "string" ? (text(pos).stages as string) : undefined}>
                  {text(pos).name}
                </span>
                <span className="staff-people">
                  {pos.people.map((x, i) => (
                    <PersonChip key={i} person={x} />
                  ))}
                  {!pos.people.length ? <Tag tone="danger">{L.zero.missing}</Tag> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * 人员表的表单：先改在手上（草稿），「存」的时候一个职位一条 staff.set。
 * keyFirst（开局向导）：每组先显示关键职位，其余收起。
 */
export function StaffEditor({ project, formId, onSaved, onCancel, keyFirst = false }: { project: ProjectRow; formId?: string; onSaved: () => void; onCancel?: () => void; keyFirst?: boolean }) {
  const { dispatch, notify } = useGuild();
  const { L, f, t2, err } = useI18n();
  const staff = project.staff ?? [];
  const [draft, setDraft] = useState<Record<string, StaffPerson[]>>({});
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = keyPositionKeys(staff);
  const peopleOf = (pos: StaffPosition) => draft[pos.key] ?? pos.people;
  const setPeople = (key: string, people: StaffPerson[]) => setDraft({ ...draft, [key]: people });
  const rows = (list: StaffPosition[]) => (
    <ul className="staff-list">
      {list.map((pos) => (
        <StaffEditRow key={pos.key} project={project} position={pos} people={peopleOf(pos)} onChange={(people) => setPeople(pos.key, people)} />
      ))}
    </ul>
  );
  const main = keyFirst ? staff.filter((p) => keys.has(p.key)) : staff;
  const rest = keyFirst ? staff.filter((p) => !keys.has(p.key)) : [];
  return (
    <>
      <form
        id={formId}
        className="stack"
        data-gap="small"
        data-testid="staff-form"
        onSubmit={(e) => {
          e.preventDefault();
          for (const pos of staff) {
            const next = draft[pos.key];
            if (!next || JSON.stringify(next) === JSON.stringify(pos.people)) continue;
            const r = dispatch("staff.set", { projectId: project.id, positionKey: pos.key, people: next }, { quiet: true });
            if (!r.ok) return setError(err(r.error));
          }
          setError(null);
          setDraft({});
          notify(L.zero.staffSaved, "Neutral");
          onSaved();
        }}
      >
        {keyFirst && main.length ? <p className="label">{L.profile.keyFirst}</p> : <p className="muted">{L.zero.staffLead}</p>}
        <div className="staff-groups">
          {groupedPositions(project, main).map(({ group, positions }) => (
            <div key={group} className="stack" data-gap="small" data-testid={`staff-group-${group}`}>
              <span className="label staff-view-head">{group === "custom" ? L.zero.customGroup : t2(POSITION_GROUP_LABEL[group])}</span>
              {rows(positions)}
            </div>
          ))}
        </div>
        {rest.length ? (
          <details className="stack staff-rest" data-gap="small" data-testid="staff-rest">
            <summary className="t-body-14m">{f(L.profile.otherPositions, { n: rest.length })}</summary>
            {groupedPositions(project, rest).map(({ group, positions }) => (
              <div key={group} className="stack" data-gap="small">
                <span className="label staff-view-head">{group === "custom" ? L.zero.customGroup : t2(POSITION_GROUP_LABEL[group])}</span>
                {rows(positions)}
              </div>
            ))}
          </details>
        ) : null}
        {!staff.length ? <Empty>{L.zero.staffEmpty}</Empty> : null}
        {Object.keys(draft).length ? <p className="label">{L.profile.unsaved}</p> : null}
        <ErrorLine error={error} />
        <FormFooter onCancel={onCancel} />
      </form>
      {adding ? (
        <AddPositionForm projectId={project.id} onDone={() => setAdding(false)} />
      ) : (
        <div className="form-actions" data-justify="start">
          <button type="button" className="inline-link t-body-14m" onClick={() => setAdding(true)} data-testid="add-position-open">
            + {L.zero.addPosition}
          </button>
        </div>
      )}
    </>
  );
}

function StaffEditRow({ project, position, people, onChange }: { project: ProjectRow; position: StaffPosition; people: StaffPerson[]; onChange: (people: StaffPerson[]) => void }) {
  const { world } = useGuild();
  const { L } = useI18n();
  const [external, setExternal] = useState("");
  const [adding, setAdding] = useState(false);
  const t = usePositionText(project)(position);
  const key = position.key;
  const taken = new Set(people.flatMap((x) => ("memberId" in x ? [x.memberId] : [])));
  const addExternal = () => {
    const name = external.trim();
    if (!name || people.some((x) => "name" in x && x.name === name)) return;
    onChange([...people, { name }]);
    setExternal("");
  };
  return (
    <li className="staff-row" data-testid="staff-row" data-position={key}>
      <div className="staff-pos">
        <span className="t-body-14m">{t.name}</span>
        <span className="label staff-stages">{t.stages}</span>
      </div>
      <div className="staff-people">
        {people.map((x, i) => (
          <PersonChip key={i} person={x} onRemove={() => onChange(people.filter((_, j) => j !== i))} />
        ))}
        {!people.length ? <Tag tone="danger">{L.zero.missing}</Tag> : null}
        <button type="button" className="staff-open" aria-expanded={adding} onClick={() => setAdding(!adding)} data-testid={`staff-open-${key}`}>
          {adding ? L.common.close : L.zero.addPerson}
        </button>
      </div>
      {adding ? (
        <div className="staff-add">
          <SelectField label={L.zero.addMember} value="" onChange={(e) => e.target.value && onChange([...people, { memberId: e.target.value }])} data-testid={`staff-add-member-${key}`}>
            <option value="">—</option>
            {members(world)
              .filter((m) => !taken.has(m.id))
              .map((m) => (
                <option key={m.id} value={m.id} data-uc="">
                  {m.nickname}
                </option>
              ))}
          </SelectField>
          <div className="staff-ext-form">
            <TextField
              label={L.zero.addExternal}
              value={external}
              onChange={(e) => setExternal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addExternal();
                }
              }}
              data-testid={`staff-add-external-${key}`}
            />
            <Button Label={L.zero.addExternalButton} Size="Small" Style="Secondary" onClick={addExternal} data-testid={`staff-add-external-go-${key}`} />
          </div>
        </div>
      ) : null}
    </li>
  );
}
