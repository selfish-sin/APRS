/**
 * 交付物盘点（SPEC §18）：项目页的「盘点」标签 `#/project/<id>/audit`。
 *   顶上「还差多少」+ 历次盘点 +「开始一次盘点」；一次盘点四步：① 放进来 → ② 自动查 → ③ 人工复查 → ④ 写回项目（能离开再回来接着做）。
 * 自动的只提示；写回项目一定是人点了「写回」以后，并且整批能撤销。
 */
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Empty, Tag } from "@/components/app/bits";
import { AuditBadge, Thumb } from "@/components/audit/parts";
import { DeliveryWall, RemainingTable, useDeliveries, WallViewer, type WallPick } from "@/components/audit/wall";
import { isAdmin, isReviewer } from "@/domain/commands/core";
import { undoPreviewOf } from "@/domain/commands/audit";
import { auditInputs, checkAudit, QUEUE_BUCKETS, type AuditCheck, type AuditEntry, type AuditIssue } from "@/domain/audit/check";
import { auditsOfProject, type DeliveryMark } from "@/domain/audit/deliveries";
import { localDate } from "@/domain/clock";
import { normalizeLink, recognizeLink } from "@/domain/links";
import type { AuditRow, Id, ProjectRow, StageRow } from "@/domain/model";
import { memberById, sizeLabel } from "@/domain/queries";
import { memoryReadModel } from "@/domain/readmodel";
import { U, useI18n } from "@/i18n/I18n";
import { filesFromDrop, filesFromInput, pasteItems, readAll, type IntakeFile, type IntakeLine } from "@/lib/audit/intake";
import type { AuditItemInput } from "@/domain/commands/audit";
import { useFiles } from "@/lib/files/FilesProvider";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { ReviewStep, WriteStep } from "./AuditSteps";

export const AUDIT_STEPS = ["intake", "check", "review", "write"] as const;
export type AuditStepKey = (typeof AUDIT_STEPS)[number];

export function useAuditCheck(auditId: Id | null): AuditCheck | null {
  const { world } = useGuild();
  return useMemo(() => {
    if (!auditId) return null;
    const inputs = auditInputs(memoryReadModel(world), auditId);
    return inputs ? checkAudit(inputs) : null;
  }, [world, auditId]);
}

/** 复查到第几条（有结论的 / 队列一共几条）。 */
export function reviewProgress(c: AuditCheck): { done: number; total: number } {
  return { done: c.queue.filter((q) => q.reviewed).length, total: c.queue.length };
}

export function AuditTab({ project, auditId }: { project: ProjectRow; auditId: Id | null }) {
  if (auditId) return <AuditRun project={project} auditId={auditId} />;
  return <AuditOverview project={project} />;
}

// ---------------------------------------------------------------------------
// 盘点页：还差多少 · 开始一次盘点 · 历次盘点
// ---------------------------------------------------------------------------

function AuditOverview({ project }: { project: ProjectRow }) {
  const { world, me, dispatch, notify } = useGuild();
  const { L, f, err, monthDay, stageName } = useI18n();
  const route = useRoute();
  const d = useDeliveries(project.id);
  const audits = useMemo(() => auditsOfProject(memoryReadModel(world), project.id), [world, project.id]);
  const [pick, setPick] = useState<{ stage: StageRow | null; mark: DeliveryMark } | null>(null);
  const [viewer, setViewer] = useState<WallPick | null>(null);
  const wallRef = useRef<HTMLDivElement>(null);
  const stageKey = route.query.get("stage");
  const fromStage = stageKey ? d?.facts.stageByKey.get(stageKey) ?? null : null;
  const can = isReviewer(me) && project.status !== "zero";
  if (!d) return null;
  const latest = audits[0] ?? null;
  const openOne = audits.find((a) => a.status === "open") ?? null;
  const progressOf = (a: AuditRow) => {
    const inputs = auditInputs(memoryReadModel(world), a.id);
    return inputs ? reviewProgress(checkAudit(inputs)) : { done: 0, total: 0 };
  };
  const latestP = latest ? progressOf(latest) : null;
  const start = () => {
    const r = dispatch("audit.start", { projectId: project.id, stageKey: fromStage?.templateKey ?? null }, { quiet: true });
    if (!r.ok) return notify(err(r.error), "Error");
    navigate(`/project/${project.id}/audit/${r.created.auditId}`);
  };
  return (
    <>
      <div className="audit-overview">
        <section className="card" aria-labelledby="remaining-title">
          <div className="card-head">
            <div className="stack" data-gap="tight">
              <h2 id="remaining-title" className="t-section-24">
                {L.audit.remainingTitle}
              </h2>
              <span className="label">{L.audit.remainingLead}</span>
            </div>
            <span className="label" data-testid="remaining-latest">
              {latest && latestP ? (latest.status === "written" ? f(L.audit.latestWritten, { date: monthDay(localDate(latest.at)) }) : f(L.audit.latest, { date: monthDay(localDate(latest.at)), done: latestP.done, total: latestP.total })) : L.audit.noAuditYet}
            </span>
          </div>
          <RemainingTable
            d={d}
            group={project.group}
            current={pick?.stage?.id ?? null}
            onPick={(stage, mark) => {
              setPick({ stage, mark });
              setTimeout(() => wallRef.current?.scrollIntoView({ block: "start" }), 0);
            }}
          />
        </section>
        <div className="stack">
          <section className="card" aria-labelledby="audit-start-title" data-testid="audit-start-card">
            <h2 id="audit-start-title" className="t-heading-18">
              {L.audit.startTitle}
            </h2>
            <p className="label">{L.audit.startLead}</p>
            {can ? (
              <div className="stack" data-gap="small">
                <Button Label={fromStage ? f(L.audit.startStage, { stage: stageName(project.group, fromStage) }) : L.audit.start} onClick={start} data-testid="audit-start" />
                {openOne ? (
                  <Link to={`/project/${project.id}/audit/${openOne.id}`} className="ui-button" data-style="Secondary" data-size="Medium" data-testid="audit-continue">
                    {f(L.audit.continueRun, { date: monthDay(localDate(openOne.at)), ...progressOf(openOne) })}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </section>
          <section className="card" aria-labelledby="audit-history-title" data-testid="audit-history">
            <h2 id="audit-history-title" className="t-heading-18">
              {L.audit.history}
            </h2>
            {audits.length ? (
              <ul className="audit-history">
                {audits.map((a) => {
                  const who = memberById(world, a.byMemberId);
                  const p = progressOf(a);
                  const read = Object.values(world.auditItems).filter((i) => i.auditId === a.id && i.origin !== "cell" && !i.archivedAt).length;
                  const kinds = Array.from(new Set(a.sources.map((s) => s.kind)));
                  const undo = a.status === "written" ? undoPreviewOf(memoryReadModel(world), a.id) : null;
                  return (
                    <li key={a.id} className="audit-history-item" data-testid="audit-history-item" data-status={a.status}>
                      <div className="row" data-justify="between">
                        <span className="t-body-14m">
                          <span className="num">{monthDay(localDate(a.at))}</span> <span className="label">{who ? <U>{who.nickname}</U> : null}</span> {a.demo ? <Tag>{L.audit.demo}</Tag> : null}
                        </span>
                        <span className="row">
                          {a.status === "open" ? (
                            <Link to={`/project/${project.id}/audit/${a.id}`} className="ui-button" data-style="Secondary" data-size="Small" data-testid="history-continue">
                              {L.audit.continueShort}
                            </Link>
                          ) : (
                            <Link to={`/project/${project.id}/audit/${a.id}?step=4`} className="ui-button" data-style="Ghost" data-size="Small" data-testid="history-open">
                              {L.audit.open}
                            </Link>
                          )}
                          {undo && isAdmin(me) && undo.revert.length ? (
                            // 撤销要先看清楚退回哪些、留着哪些：到第 4 步的撤销那一块再点
                            <Link to={`/project/${project.id}/audit/${a.id}?step=4`} className="ui-button" data-style="Ghost" data-size="Small" data-testid="history-undo">
                              {L.audit.undo}
                            </Link>
                          ) : null}
                        </span>
                      </div>
                      <span className="label">{f(L.audit.histRead, { source: kinds.map((k) => L.audit.source[k]).join(" · "), n: read })}</span>
                      <span className="label">{a.status === "written" && a.written ? f(L.audit.histWritten, a.written.counts) : f(L.audit.histChecked, p)}</span>
                      {undo?.kept.length ? <span className="label">{f(L.audit.histKept, { n: undo.kept.length })}</span> : null}
                      {a.undone.length ? <span className="label">{f(L.audit.histUndone, { n: a.undone.length })}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="label">{L.audit.historyEmpty}</p>
            )}
          </section>
        </div>
      </div>
      {pick ? (
        <div ref={wallRef}>
          <DeliveryWall d={d} group={project.group} filter={pick.mark} onFilter={(m) => setPick(m === "all" ? { stage: null, mark: "verified" } : { stage: pick.stage, mark: m })} onOpen={setViewer} testId="overview-wall" />
        </div>
      ) : null}
      {viewer ? <WallViewer d={d} group={project.group} pick={viewer} onClose={() => setViewer(null)} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// 一次盘点：步骤条 + 四步
// ---------------------------------------------------------------------------

function StepBar({ step, done, onPick }: { step: number; done: (n: number) => boolean; onPick: (n: number) => void }) {
  const { L } = useI18n();
  return (
    <ol className="audit-steps" aria-label={L.audit.stepsAria} data-testid="audit-steps">
      {AUDIT_STEPS.map((k, i) => {
        const n = i + 1;
        return (
          <li key={k}>
            <button type="button" className="audit-step" aria-current={n === step ? "step" : undefined} data-done={done(n) && n !== step ? "yes" : undefined} onClick={() => onPick(n)} data-testid={`audit-step-${n}`}>
              <span className="audit-step-no num">{done(n) && n !== step ? "✓" : n}</span>
              <span>{L.audit.steps[k]}</span>
              {done(n) && n !== step ? <span className="label" data-tone="success">{L.audit.stepDone}</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function AuditRun({ project, auditId }: { project: ProjectRow; auditId: Id }) {
  const { world, me, dispatch } = useGuild();
  const { L, f, r: rich, monthDay, stageName } = useI18n();
  const route = useRoute();
  const audit = world.audits[auditId];
  const c = useAuditCheck(auditId);
  if (!audit || audit.archivedAt || audit.projectId !== project.id || !c) {
    return (
      <section className="card">
        <Empty action={<Link to={`/project/${project.id}/audit`}>{L.audit.tab}</Link>}>{L.audit.historyEmpty}</Empty>
      </section>
    );
  }
  const q = Number(route.query.get("step"));
  const step = audit.status === "written" ? 4 : q >= 1 && q <= 4 ? q : audit.step;
  const can = isReviewer(me);
  const go = (n: number) => {
    if (can && audit.status === "open" && n !== audit.step) dispatch("audit.step", { auditId, step: n }, { quiet: true });
    navigate(`/project/${project.id}/audit/${auditId}?step=${n}`, { replace: true });
  };
  const read = c.summary.read;
  const p = reviewProgress(c);
  const done = (n: number) => (n === 1 ? read > 0 && audit.step > 1 : n === 2 ? audit.step > 2 : n === 3 ? audit.status === "written" || (p.total > 0 && p.done === p.total) : audit.status === "written");
  const who = memberById(world, audit.byMemberId);
  const key = AUDIT_STEPS[step - 1];
  const queueAt = Math.min(p.total, p.done + 1);
  const stage = audit.stageKey ? c.facts.stageByKey.get(audit.stageKey) : undefined;
  return (
    <section className="stack audit-run" data-testid="audit-run" data-step={step}>
      <div className="audit-run-head">
        <div className="stack" data-gap="tight">
          <span className="label">
            {rich(L.audit.crumbs, { project: <U>{project.name}</U>, date: monthDay(localDate(audit.at)), who: who ? <U>{who.nickname}</U> : "—" })}
            {audit.demo ? ` · ${L.audit.demo}` : ""}
          </span>
          <h2 className="t-heading-18" data-testid="audit-step-title">
            {key === "review" ? f(L.audit.stepTitle.review, { n: queueAt, total: p.total }) : L.audit.stepTitle[key]}
          </h2>
          {stage ? <span className="label">{f(L.audit.onlyStage, { stage: stageName(project.group, stage) })}</span> : null}
        </div>
        <StepBar step={step} done={done} onPick={go} />
      </div>
      {key === "intake" ? <IntakeStep audit={audit} /> : null}
      {key === "check" ? <CheckStep project={project} c={c} onReview={() => go(3)} /> : null}
      {key === "review" ? <ReviewStep project={project} audit={audit} c={c} onWrite={() => go(4)} /> : null}
      {key === "write" ? <WriteStep project={project} audit={audit} c={c} onBack={() => go(3)} /> : null}
      {step < 3 ? (
        <div className="card audit-nav" data-testid="audit-nav">
          <Link to={`/project/${project.id}/audit`} className="ui-button" data-style="Secondary" data-size="Medium" data-testid="audit-leave">
            {L.audit.leave}
          </Link>
          <span className="row">
            {step === 1 ? <span className="label">{L.audit.nextHint1}</span> : null}
            {step > 1 ? <Button Label={L.audit.prev} Style="Ghost" onClick={() => go(step - 1)} data-testid="audit-prev" /> : null}
            <Button Label={f(L.audit.next, { name: L.audit.steps[AUDIT_STEPS[step]] })} onClick={() => go(step + 1)} disabled={step === 1 && read === 0} data-testid="audit-next" />
          </span>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ① 放进来
// ---------------------------------------------------------------------------

function lineText(line: IntakeLine, L: ReturnType<typeof useI18n>["L"], f: ReturnType<typeof useI18n>["f"]): string {
  if (line.state === "reading") return L.audit.line.reading;
  if (line.state === "archive") return L.audit.line.archive;
  if (line.state === "zip") return f(L.audit.line.zip, { n: line.info?.entries ?? 0 });
  if (line.state === "unknown") return L.audit.line.unknown;
  if (line.state === "nameOnly") return L.audit.line.nameOnly;
  const info = line.info;
  const parts: string[] = [];
  if (line.thumb) parts.push(`✓ ${f(L.audit.info.preview, { w: line.thumb.width, h: line.thumb.height })}`);
  if (info?.canvas && info.kind !== "image") parts.push(f(L.audit.info.canvas, { w: info.canvas.width, h: info.canvas.height }));
  if (info?.fps) parts.push(f(L.audit.info.fps, { fps: info.fps }));
  if (info?.seconds != null) parts.push(f(L.audit.info.seconds, { s: info.seconds.toFixed(1) }));
  if (info?.folders?.length) parts.push(f(L.audit.info.folders, { names: info.folders.join(" · ") }));
  return parts.join(" · ");
}

function IntakeStep({ audit }: { audit: AuditRow }) {
  const { dispatch, notify, me } = useGuild();
  const { L, f, r: rich, err, t2 } = useI18n();
  const files = useFiles();
  const [lines, setLines] = useState<IntakeLine[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState("");
  const [link, setLink] = useState(audit.link ?? "");
  const cancel = useRef(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const can = isReviewer(me) && audit.status === "open";
  const pasted = useMemo(() => pasteItems(paste), [paste]);
  const pasteLines = paste.split(/\r?\n/).filter((x) => x.trim()).length;
  const reading = !!progress && progress.done < progress.total;

  const add = (items: AuditItemInput[], kind: "folder" | "files" | "paste" | "zip", label: string | null) => {
    let added = 0;
    let skipped = 0;
    for (let i = 0; i < Math.max(1, items.length); i += 2000) {
      const chunk = items.slice(i, i + 2000);
      const r = dispatch("audit.add", { auditId: audit.id, source: { kind, label }, items: chunk }, { quiet: true });
      if (!r.ok) {
        notify(err(r.error), "Error");
        return;
      }
      const n = r.entry ? r.entry.changes.filter((ch) => ch.op === "insert" && ch.table === "auditItems").length : 0;
      added += n;
      skipped += chunk.length - n;
    }
    notify(skipped ? `${f(L.audit.addedToast, { n: added })} · ${f(L.audit.dupSkipped, { n: skipped })}` : f(L.audit.addedToast, { n: added }), added ? "Success" : "Neutral");
  };

  const readFiles = async (list: IntakeFile[]) => {
    if (!list.length || !can) return;
    if (!files.ready) return notify(L.audit.storeNotReady, "Error");
    cancel.current = false;
    setProgress({ done: 0, total: list.length });
    setLines([]);
    const res = await readAll(list, {
      store: { put: files.putBytes },
      keep: audit.keep,
      cancelled: () => cancel.current,
      onProgress: (done, total, line) => {
        setProgress({ done, total });
        if (line) setLines((prev) => [line, ...prev].slice(0, 8));
      },
    });
    const folder = list.find((x) => x.path && x.path.includes("/"))?.path?.split("/")[0] ?? null;
    const zipOnly = list.every((x) => x.file.name.toLowerCase().endsWith(".zip"));
    add(res.items, folder ? "folder" : zipOnly ? "zip" : "files", folder ?? (zipOnly ? list[0].file.name : null));
    if (res.cancelled) notify(f(L.audit.cancelled, { n: res.lines.length }), "Neutral");
    setProgress((p) => (p ? { done: p.total, total: p.total } : p));
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!can) return;
    readFiles(await filesFromDrop(e.dataTransfer));
  };

  const saveLink = () => {
    const v = link.trim();
    if ((audit.link ?? "") === v) return;
    const r = dispatch("audit.step", { auditId: audit.id, step: audit.step, link: v || null }, { quiet: true });
    if (!r.ok) notify(err(r.error), "Error");
  };
  const norm = link.trim() ? normalizeLink(link.trim()) : null;
  const linkInfo = norm?.ok ? recognizeLink(norm.url) : null;

  return (
    <div className="audit-intake">
      <div className="stack">
        <div
          className="card audit-drop"
          data-over={over ? "yes" : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          data-testid="audit-drop"
        >
          <svg width="28" height="28" viewBox="0 0 16 16" aria-hidden="true" className="audit-drop-icon">
            <path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <h3 className="t-section-24">{L.audit.dropTitle}</h3>
          <p className="label">{L.audit.dropLead}</p>
          <div className="row" data-justify="center">
            <Button Label={L.audit.pickFolder} onClick={() => folderInput.current?.click()} disabled={!can || reading} data-testid="pick-folder" />
            <Button Label={L.audit.pickFiles} Style="Secondary" onClick={() => fileInput.current?.click()} disabled={!can || reading} data-testid="pick-files" />
          </div>
          <input
            ref={folderInput}
            type="file"
            className="sr-only"
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            multiple
            onChange={(e) => {
              readFiles(filesFromInput(e.target.files));
              e.target.value = "";
            }}
            data-testid="intake-folder"
            tabIndex={-1}
            aria-hidden="true"
          />
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            multiple
            onChange={(e) => {
              readFiles(filesFromInput(e.target.files));
              e.target.value = "";
            }}
            data-testid="intake-files"
            tabIndex={-1}
            aria-hidden="true"
          />
          <p className="label">{L.audit.dropNote}</p>
        </div>
        {progress ? (
          <section className="card" data-testid="intake-progress" data-reading={reading ? "yes" : "no"}>
            <div className="card-head">
              <h3 className="t-heading-18">
                {reading ? f(L.audit.reading, { done: progress.done, total: progress.total }) : f(L.audit.readDone, { total: progress.total, n: progress.total })} <span className="label">{L.audit.readingNote}</span>
              </h3>
              {reading ? <Button Label={L.audit.cancel} Style="Secondary" Size="Small" onClick={() => (cancel.current = true)} data-testid="intake-cancel" /> : null}
            </div>
            <span className="audit-progress" aria-hidden="true">
              <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </span>
            <ul className="audit-lines">
              {lines.map((line, i) => (
                <li key={`${line.name}-${i}`} className="audit-line" data-state={line.state} data-testid="intake-line">
                  <Thumb thumb={line.thumb} alt={line.name} caption="" />
                  <span className="stack" data-gap="tight">
                    <span className="t-body-14m" data-uc="">
                      {line.name}
                    </span>
                    <span className="label" data-tone={line.state === "done" ? "success" : undefined}>
                      {lineText(line, L, f)}
                    </span>
                  </span>
                  <span className="label num">{sizeLabel(line.size)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="card audit-batches" data-testid="audit-batches">
          <span className="label">{L.audit.batches}</span>
          {audit.sources.length ? (
            <ul>
              {audit.sources.map((s) => (
                <li key={s.batch} className="t-body-14" data-testid="audit-batch">
                  {s.kind === "paste" ? f(L.audit.batch.paste, { n: s.count }) : s.kind === "files" ? f(L.audit.batch.files, { n: s.count }) : rich(s.kind === "folder" ? L.audit.batch.folder : L.audit.batch.zip, { label: <U>{s.label ?? ""}</U>, n: s.count })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="label">{L.audit.nothingYet}</p>
          )}
        </section>
      </div>
      <div className="stack">
        <section className="card" aria-labelledby="paste-title" data-testid="paste-card">
          <h3 id="paste-title" className="t-heading-18">
            {L.audit.pasteTitle}
          </h3>
          <p className="label">{L.audit.pasteLead}</p>
          <textarea className="field-control audit-paste" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="ANDLC_EP01_SC001_CUT006_B_ANI_v02.clip  18.2MB  10-20" aria-label={L.audit.pasteTitle} data-testid="paste-text" disabled={!can} />
          <div className="row" data-justify="between">
            <span className="label" data-tone={pasted.length ? "success" : undefined} data-testid="paste-count">
              {f(L.audit.pasteCount, { n: pasted.length, lines: pasteLines })}
              {pasteLines > pasted.length ? ` · ${f(L.audit.pasteNot, { n: pasteLines - pasted.length })}` : ""}
            </span>
            <Button
              Label={L.audit.pasteAdd}
              Style="Secondary"
              Size="Small"
              disabled={!can || !pasted.length}
              onClick={() => {
                add(pasted, "paste", null);
                setPaste("");
              }}
              data-testid="paste-add"
            />
          </div>
        </section>
        <section className="card" aria-labelledby="where-title">
          <h3 id="where-title" className="t-heading-18">
            {L.audit.whereTitle} <span className="label">{L.audit.optional}</span>
          </h3>
          <input className="field-control" value={link} onChange={(e) => setLink(e.target.value)} onBlur={saveLink} placeholder="https://" aria-label={L.audit.whereTitle} data-testid="audit-link" disabled={!can} />
          {linkInfo ? <span className="label">{linkInfo.platform === "other" ? L.audit.whereUnknown : f(L.audit.whereKnown, { platform: `${t2(linkInfo.platformLabel)} · ${t2(linkInfo.typeLabel)}` })}</span> : null}
        </section>
        <section className="card" aria-labelledby="keep-title">
          <h3 id="keep-title" className="t-heading-18">
            {L.audit.keepTitle}
          </h3>
          {(["thumbs", "full"] as const).map((k) => (
            <label key={k} className="audit-radio" data-on={audit.keep === k ? "yes" : undefined}>
              <input type="radio" name="audit-keep" checked={audit.keep === k} disabled={!can} onChange={() => dispatch("audit.step", { auditId: audit.id, step: audit.step, keep: k }, { quiet: true })} data-testid={`keep-${k}`} />
              <span className="stack" data-gap="tight">
                <span className="t-body-14m">{k === "thumbs" ? L.audit.keepThumbs : L.audit.keepFull}</span>
                <span className="label">{k === "thumbs" ? L.audit.keepThumbsLead : f(L.audit.keepFullLead, { used: sizeLabel(files.usage.storedBytes) })}</span>
              </span>
            </label>
          ))}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ② 自动查
// ---------------------------------------------------------------------------

/** 一条问题的一句话。参数里的字（文件名的一段 · 文件夹 · 几个文件名）是用户的东西，原样显示、不翻译：包一层 <U>。 */
export function issueText(x: AuditIssue, i18n: ReturnType<typeof useI18n>): ReactNode {
  const { L, f, r: rich } = i18n;
  if (x.code === "missing") return f(L.audit.issue.missing.text, { what: L.audit.what[String(x.params.what) as keyof typeof L.audit.what] ?? String(x.params.what) });
  const params: Record<string, ReactNode> = {};
  for (const [k, v] of Object.entries(x.params)) params[k] = typeof v === "string" ? <U>{v}</U> : v;
  if (x.code === "unknown_code" && !x.params.want) return rich(L.audit.unknownCodeNone, params);
  return rich(L.audit.issue[x.code].text, params);
}

type SumKey = "read" | "recognized" | "matched" | "unrecorded" | "nofile" | "newer" | "issues" | "foreign" | "unknown";
const SUM_KEYS: SumKey[] = ["read", "recognized", "matched", "unrecorded", "nofile", "newer", "issues", "foreign", "unknown"];

function CheckStep({ project, c, onReview }: { project: ProjectRow; c: AuditCheck; onReview: () => void }) {
  const i18n = useI18n();
  const { L, f } = i18n;
  const d = useDeliveries(project.id);
  const [filter, setFilter] = useState<SumKey>("read");
  const [mark, setMark] = useState<DeliveryMark | "all">("all");
  const [viewer, setViewer] = useState<WallPick | null>(null);
  const s = c.summary;
  // 有问题的按种类分组
  const groups = new Map<string, AuditEntry[]>();
  for (const e of c.entries) {
    if (!(e.kind === "cut" || e.kind === "project") || e.superseded) continue;
    for (const code of Array.from(new Set(e.issues.map((x) => x.code)))) {
      const key = code === "wrong_folder_code" ? "wrong_folder" : code;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
  }
  const listFor = (k: SumKey): AuditEntry[] => {
    if (k === "foreign") return c.foreign;
    if (k === "unknown") return c.unknown;
    if (k === "issues") return c.entries.filter((e) => e.issues.length && !e.superseded && (e.kind === "cut" || e.kind === "project"));
    if (k === "matched" || k === "unrecorded" || k === "newer") return c.cells.filter((x) => x.inScope && x.outcome === k && x.top).map((x) => x.top!);
    if (k === "recognized") return c.entries.filter((e) => e.kind === "cut" || e.kind === "project");
    return c.entries;
  };
  const nofileCells = c.cells.filter((x) => x.inScope && x.outcome === "nofile" && !x.top);
  return (
    <>
      <section className="card audit-summary" data-testid="audit-summary">
        <div className="row" data-justify="between">
          <span className="t-body-14m" data-testid="audit-sum-line">
            {f(L.audit.sumLine, { ...s })}
          </span>
          <span className="label">{L.audit.autoNote}</span>
        </div>
        <div className="audit-sum-tiles">
          {SUM_KEYS.map((k) => (
            <button key={k} type="button" className="audit-sum-tile" aria-pressed={filter === k} data-kind={k} onClick={() => setFilter(k)} data-testid={`sum-${k}`} aria-label={f(L.audit.sumFilterAria, { name: L.audit.sum[k] })}>
              <span className="audit-sum-n num">{s[k]}</span>
              <span className="label">{L.audit.sum[k]}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="audit-check">
        <div className="stack">
          {filter !== "read" ? (
            <section className="card" data-testid="sum-list" data-kind={filter}>
              <h3 className="t-heading-18">
                {L.audit.sum[filter]} <span className="num">{s[filter]}</span>
              </h3>
              <ul className="audit-entry-list">
                {filter === "nofile"
                  ? nofileCells.slice(0, 60).map((x) => (
                      <li key={x.task.id} className="t-body-14" data-testid="sum-item">
                        <AuditBadge mark="nofile" compact /> {x.cut ? i18n.cut(x.cut, project.group) : ""} · {i18n.stageName(project.group, x.stage)}
                        {x.layer ? ` · ${f(L.audit.layerTab, { layer: x.layer })}` : ""}
                      </li>
                    ))
                  : listFor(filter)
                      .slice(0, 60)
                      .map((e) => (
                        <li key={e.key} className="t-body-14" data-testid="sum-item">
                          <span data-uc="">{e.primary.name}</span>
                          {e.formats.length > 1 ? <span className="label"> · {e.formats.join(" + ")}</span> : null}
                        </li>
                      ))}
              </ul>
              {(filter === "nofile" ? nofileCells.length : listFor(filter).length) > 60 ? <span className="label">{f(L.audit.more, { n: (filter === "nofile" ? nofileCells.length : listFor(filter).length) - 60 })}</span> : null}
            </section>
          ) : null}
          {d ? <DeliveryWall d={d} group={project.group} filter={mark} onFilter={setMark} onOpen={setViewer} testId="check-wall" /> : null}
        </div>
        <section className="card audit-issues" data-testid="audit-issues">
          <h3 className="t-heading-18">
            {f(L.audit.issuesTitle, { n: s.issues })} <AuditBadge mark="issue" />
          </h3>
          {groups.size ? (
            <ul className="audit-issue-groups">
              {Array.from(groups.entries()).map(([code, list]) => (
                <li key={code} className="audit-issue-group" data-testid="issue-group" data-code={code}>
                  <div className="row" data-justify="between">
                    <span className="t-body-14m">{L.audit.issue[code as AuditIssue["code"]].title}</span>
                    <span className="num" data-tone="danger">
                      {list.length}
                    </span>
                  </div>
                  {list.slice(0, 3).map((e) => {
                    const x = e.issues.find((i) => (i.code === "wrong_folder_code" ? "wrong_folder" : i.code) === code)!;
                    return (
                      <span key={e.key} className="stack" data-gap="tight">
                        <span className="label" data-uc="">
                          {e.primary.name}
                        </span>
                        <span className="label">→ {issueText(x, i18n)}</span>
                      </span>
                    );
                  })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="label">{L.audit.issuesNone}</p>
          )}
          <p className="label">{f(L.audit.issuesMore, { foreign: s.foreign, unknown: s.unknown })}</p>
          <Button Label={f(L.audit.toReview, { n: c.queue.length })} onClick={onReview} data-testid="to-review" />
        </section>
      </div>
      {viewer && d ? <WallViewer d={d} group={project.group} pick={viewer} onClose={() => setViewer(null)} /> : null}
    </>
  );
}

export { QUEUE_BUCKETS };
