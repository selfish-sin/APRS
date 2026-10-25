/**
 * 零日 · 开局向导（SPEC §17.4；排法照设计稿 v6-5a / 5b / 5c）：五步，每步一屏、一件事——① 介绍 ② 日期 ③ 结构 ④ 人员 ⑤ 开工。
 * 顶上是步骤条（做过的打勾、写「已存」）；左边是这一步的表，右边一张小卡说这一步会影响什么；
 * 底下一条：上一步 · 先跳过 ·（每一步存了就算数）· 下一步：xx ›。
 * 做到第几步存在项目上（project.set_setup_step），随时离开、回来接着做。「下一步」= 存这一步的表再往后走。
 */
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/app/bits";
import { isAdmin } from "@/domain/commands/core";
import type { ProjectRow } from "@/domain/model";
import { PROJECT_TEMPLATES } from "@/domain/positions";
import { startPreview, weekOf } from "@/domain/queries";
import { U, useI18n } from "@/i18n/I18n";
import { Link, navigate } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { CoverForm, CoverView, DatesForm, DatesView, StaffEditor, StaffView, StructureForm, StructureView } from "./ProjectProfile";
import { ProjectTimelineCard, StagesPreview, StartCheckCard } from "./ProjectSetup";

export const WIZARD_STEPS = ["intro", "dates", "structure", "staff", "start"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
const FORM_ID = "wizard-form";

export function wizardStepOf(project: ProjectRow): number {
  const n = project.setupStep ?? 1;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
}

export function ZeroWizard({ project }: { project: ProjectRow }) {
  const { me, dispatch, notify } = useGuild();
  const { L, f, err, dateTime } = useI18n();
  const admin = isAdmin(me);
  const step = wizardStepOf(project);
  const key = WIZARD_STEPS[step - 1];
  const go = (n: number) => {
    if (!admin) return;
    const r = dispatch("project.set_setup_step", { projectId: project.id, step: n }, { quiet: true });
    if (!r.ok) notify(err(r.error), "Error");
    window.scrollTo?.({ top: 0 });
  };
  const next = () => go(Math.min(5, step + 1));
  return (
    <>
      <div className="page-head wizard-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/projects">{L.common.projects}</Link>
            <span>›</span>
            <span className="num">{project.code}</span>
          </div>
          <h1 className="t-title-32 wizard-title">
            <span>{L.wizard.setup}</span> · <U>{project.name}</U> <Tag tone="inverse">{L.zero.short}</Tag>
          </h1>
          <p className="muted">{admin ? L.wizard.lead : L.zero.adminOnly}</p>
        </div>
        <div className="page-head-actions">
          <span className="label wizard-saved">{f(L.wizard.savedAt, { at: dateTime(project.updatedAt) })}</span>
          <Button Label={L.wizard.leave} Style="Secondary" onClick={() => navigate("/projects")} data-testid="wizard-leave" />
        </div>
      </div>

      <ol className="wizard-steps" aria-label={L.wizard.stepsAria} data-testid="wizard-steps">
        {WIZARD_STEPS.map((s, i) => {
          const n = i + 1;
          const state = n === step ? "current" : n < step ? "done" : "todo";
          return (
            <li key={s} data-state={state}>
              <button type="button" onClick={() => go(n)} disabled={!admin} aria-current={n === step ? "step" : undefined} data-testid={`wizard-step-${n}`}>
                <span className="wizard-no num" aria-hidden="true">
                  {n < step ? "✓" : n}
                </span>
                <span className="wizard-name">{L.wizard.steps[s]}</span>
                {state === "done" ? <span className="wizard-saved-tag">{L.wizard.saved}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="wizard-body">
        <section className="card wizard-card" aria-labelledby="wizard-title" data-testid={`wizard-${key}`} data-step={step}>
          <h2 id="wizard-title" className="t-heading-18">
            <span className="num">{f(L.wizard.stepNo, { n: step })}</span> {L.wizard.titles[key]}
          </h2>
          <p className="muted">{L.wizard.leads[key]}</p>
          {admin ? (
            <>
              {key === "intro" ? <CoverForm project={project} formId={FORM_ID} onSaved={next} /> : null}
              {key === "dates" ? <DatesForm project={project} formId={FORM_ID} onSaved={next} /> : null}
              {key === "structure" ? <StructureForm project={project} formId={FORM_ID} onSaved={next} /> : null}
              {key === "staff" ? <StaffEditor project={project} formId={FORM_ID} onSaved={next} keyFirst /> : null}
            </>
          ) : (
            <>
              {key === "intro" ? <CoverView project={project} /> : null}
              {key === "dates" ? <DatesView project={project} /> : null}
              {key === "structure" ? <StructureView project={project} /> : null}
              {key === "staff" ? <StaffView project={project} /> : null}
            </>
          )}
          {key === "start" ? <StartStep project={project} admin={admin} onJump={go} /> : null}
        </section>
        <aside className="card wizard-side" aria-label={L.wizard.sideAria} data-testid="wizard-side">
          <WizardSide project={project} step={key} />
        </aside>
      </div>

      {admin ? (
        <div className="card wizard-nav" data-testid="wizard-nav">
          <div className="row">
            {step > 1 ? <Button Label={`‹ ${L.wizard.prev}`} Style="Secondary" onClick={() => go(step - 1)} data-testid="wizard-prev" /> : null}
            {step < 5 ? <Button Label={L.wizard.skip} Style="Ghost" onClick={next} data-testid="wizard-skip" /> : null}
          </div>
          <div className="row">
            <span className="label">{L.wizard.counts}</span>
            {step < 5 ? <Button Label={f(L.wizard.nextTo, { name: L.wizard.steps[WIZARD_STEPS[step]] })} Style="Primary" type="submit" form={FORM_ID} data-testid="wizard-next" /> : null}
          </div>
        </div>
      ) : null}
      {key === "start" ? <ProjectTimelineCard projectId={project.id} /> : null}
    </>
  );
}

/** 右边那张小卡：这一步会影响什么。 */
function WizardSide({ project, step }: { project: ProjectRow; step: WizardStep }) {
  const { world } = useGuild();
  const { L, f, t2 } = useI18n();
  const pv = startPreview(world, project.id);
  const tpl = PROJECT_TEMPLATES[project.template ?? "anim_standard"];
  const planWeeks = Math.max(1, weekOf(project, project.planEndOn));
  const list = (items: ReactNode[]) => (
    <ul className="wizard-checks">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
  if (step === "intro")
    return (
      <>
        <span className="label">{L.wizard.sideIntroTitle}</span>
        <div className="wizard-preview">
          <span className="t-body-14m">
            <U>{project.name}</U> <Tag tone="inverse">{L.zero.short}</Tag>
          </span>
          <span className="label">
            <span className="num">{project.code}</span> · {f(L.wizard.atStep, { n: 1, total: 5, name: L.wizard.steps.intro })}
          </span>
        </div>
        <p className="label">{f(L.wizard.sideIntroCode, { file: pv?.sampleFile ?? `${project.code}_EP01_SC001_CUT001_v01` })}</p>
        <p className="label">{tpl.stages ? f(L.wizard.sideIntroTpl, { template: t2(tpl.name), n: pv?.stages ?? 0 }) : L.wizard.sideIntroBlank}</p>
      </>
    );
  if (step === "dates")
    return (
      <>
        <span className="label">{L.wizard.sideAffects}</span>
        {list([f(L.wizard.sideDates1, { n: project.cycleDays ?? 7, weeks: planWeeks }), L.wizard.sideDates2, L.wizard.sideDates3, L.wizard.sideDates4])}
      </>
    );
  if (step === "structure")
    return (
      <>
        <span className="label">{L.wizard.sideFileTitle}</span>
        <p className="wizard-file num" data-uc="">
          {pv?.sampleFile ?? "—"}
        </p>
        <p className="label">{f(L.wizard.sideStructure1, { cuts: pv?.cuts ?? 0 })}</p>
        <p className="label">{L.wizard.sideStructure2}</p>
      </>
    );
  if (step === "staff")
    return (
      <>
        <span className="label">{L.wizard.sideKeyTitle}</span>
        <p className="label">{L.wizard.sideKeyLead}</p>
        {pv ? (
          <div className="wizard-preview">
            <span className="t-heading-18 num">{f(L.wizard.sideKeyFilled, { filled: pv.keyPositions.filled, total: pv.keyPositions.total })}</span>
            {pv.keyPositions.empty.length ? (
              <span className="label" data-tone="warning">
                {f(L.wizard.sideKeyEmpty, { names: pv.keyPositions.empty.slice(0, 6).map((x) => (typeof x === "string" ? x : t2(x))).join(" · ") })}
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="label">{L.wizard.sideKeyLater}</p>
      </>
    );
  return (
    <>
      <span className="label">{L.wizard.sideStartTitle}</span>
      {pv ? (
        <dl className="wizard-stats">
          <div>
            <dt className="t-heading-18 num">{pv.stages}</dt>
            <dd className="label">{L.wizard.sideStartStages}</dd>
          </div>
          <div>
            <dt className="t-heading-18 num">≈{pv.tasks}</dt>
            <dd className="label">{L.wizard.sideStartTasks}</dd>
          </div>
          <div>
            <dt className="t-heading-18 num">{pv.autoEnroll}</dt>
            <dd className="label">{f(L.wizard.sideStartPeople, { n: pv.externals })}</dd>
          </div>
        </dl>
      ) : null}
      <p className="label">{L.wizard.afterStart}</p>
    </>
  );
}

/** ⑤ 开工：一条一条看（介绍 · 日期 · 结构 · 人员），缺的能「回去填」→ 开工。 */
function StartStep({ project, admin, onJump }: { project: ProjectRow; admin: boolean; onJump: (n: number) => void }) {
  const { world } = useGuild();
  const { L, f, date, t2 } = useI18n();
  const pv = startPreview(world, project.id);
  const s = project.structure;
  const rows: { key: string; ok: boolean; title: string; text: ReactNode; step: number }[] = [
    { key: "intro", ok: !!project.name, title: L.wizard.steps.intro, text: <>{<U>{project.name}</U>} · <span className="num">{project.code}</span> · {project.coverFileId ? L.wizard.hasCover : L.wizard.noCover}</>, step: 1 },
    { key: "dates", ok: !!project.planEndOn, title: L.wizard.steps.dates, text: f(L.wizard.checkDates, { a: date(project.startOn), b: date(project.planEndOn), n: (project.keyDates ?? []).length }), step: 2 },
    { key: "structure", ok: !!pv?.ready, title: L.wizard.steps.structure, text: s && pv?.ready ? f(L.wizard.checkStructure, { e: s.episodes, s: s.episodes * s.scenesPerEpisode, c: pv.cuts, l: s.layers.length }) : L.zero.readyNo, step: 3 },
    {
      key: "staff",
      ok: !pv?.keyPositions.empty.length,
      title: L.wizard.steps.staff,
      text: pv?.keyPositions.empty.length ? f(L.wizard.checkStaffMissing, { n: pv.keyPositions.empty.length, names: pv.keyPositions.empty.slice(0, 5).map((x) => (typeof x === "string" ? x : t2(x))).join(" · ") }) : L.wizard.keysFilled,
      step: 4,
    },
  ];
  return (
    <div className="stack" data-gap="small">
      <ul className="wizard-checklist" data-testid="start-checklist">
        {rows.map((r) => (
          <li key={r.key} data-ok={r.ok ? "yes" : "no"}>
            <span className="wizard-check-icon" aria-hidden="true">
              {r.ok ? "✓" : "!"}
            </span>
            <span className="t-body-14m">{r.title}</span>
            <span className="wizard-check-text">{r.text}</span>
            {!r.ok && admin ? <Button Label={L.wizard.goBack} Size="Small" Style="Secondary" onClick={() => onJump(r.step)} /> : null}
          </li>
        ))}
      </ul>
      <StartCheckCard project={project} admin={admin} />
      <StagesPreview project={project} />
    </div>
  );
}
