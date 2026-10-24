/**
 * 盘点的 ③ 人工复查 · ④ 写回项目（SPEC §18.7 · §18.8）。
 *   复查：一屏一条——大缩略图 + 同一卡上一个有图的环节并排 · 文件名切开 · 问题一句话 · 系统里现在记的 · 建议归属；
 *        动作 确认 1 · 不对 2 · 改归属 3 · 跳过 →；「对上了」能一次全确认；「系统说交了没找到」：文件在别处 / 确实没交。
 *   写回：先列清单（核实 · 补录 · 打回 · 加卡 · 不动），点「写回」才改项目；写回以后能整批撤销、能和上一次比。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/app/bits";
import { AuditBadge, NameSegs, Thumb } from "@/components/audit/parts";
import { useDeliveries } from "@/components/audit/wall";
import { isAdmin, isReviewer } from "@/domain/commands/core";
import { undoPreviewOf } from "@/domain/commands/audit";
import { previousWithPicture, stagesForCode, type AuditCheck, type AuditEntry, type QueueBucket, type QueueItem } from "@/domain/audit/check";
import { compareAudits } from "@/domain/audit/compare";
import { wallCell, type DeliveryCell } from "@/domain/audit/deliveries";
import { writePlan, type PlanBackfill } from "@/domain/audit/plan";
import { localDate } from "@/domain/clock";
import { AUDIT_WRONG, type AuditRow, type AuditWrong, type Id, type ProjectRow, type Quality, type StageRow } from "@/domain/model";
import { memberById, members } from "@/domain/queries";
import { memoryReadModel } from "@/domain/readmodel";
import { QUALITY_OPTIONS, taskPoints, taskRate } from "@/domain/rules";
import { U, useI18n } from "@/i18n/I18n";
import { useGuild } from "@/lib/store";
import { useRoute } from "@/lib/router";
import { issueText, QUEUE_BUCKETS } from "./Audit";

const vTag = (v: number | null | undefined, note?: string | null) => (v == null ? "" : `v${String(v).padStart(2, "0")}${note ?? ""}`);

type I18n = ReturnType<typeof useI18n>;

function whereOf(i18n: I18n, group: ProjectRow["group"], stage: StageRow | null, cut: { number: number; suffix?: string | null } | null, layer: string | null): string {
  return [cut ? i18n.cut(cut, group) : null, stage ? i18n.stageName(group, stage) : null, layer ? i18n.f(i18n.L.audit.layerTab, { layer }) : null].filter(Boolean).join(" · ");
}

/** 一条在队列里的一句话（「接下来」那一栏）。 */
function reasonOf(q: QueueItem, i18n: I18n): ReactNode {
  const { L } = i18n;
  if (q.entry?.issues.length) return issueText(q.entry.issues[0], i18n);
  if (q.entry && q.entry.kind === "none") return L.audit.unknownTitle;
  if (q.bucket === "nofile") return L.audit.markLong.nofile;
  return L.audit.bucket[q.bucket].replace(/\s*\{n\}.*$/, "").replace(/\s*[\d]+.*$/, "");
}

export function ReviewStep({ project, audit, c, onWrite }: { project: ProjectRow; audit: AuditRow; c: AuditCheck; onWrite: () => void }) {
  const { world, me, dispatch, notify } = useGuild();
  const i18n = useI18n();
  const { L, f, err } = i18n;
  const d = useDeliveries(project.id);
  const group = project.group;
  const queue = c.queue;
  // ?item=<id> 直接打开某一条（从别处点进来 · 测试用）
  const route = useRoute();
  const itemQ = route.query.get("item");
  const [cur, setCur] = useState<string | null>(itemQ);
  useEffect(() => {
    if (itemQ) setCur(itemQ);
  }, [itemQ]);
  const [mode, setMode] = useState<null | "wrong" | "reassign" | "elsewhere" | "missing">(null);
  const [bulk, setBulk] = useState(false);
  const readOnly = audit.status === "written" || !isReviewer(me);
  const firstOpen = queue.find((q) => !q.reviewed && q.bucket !== "matched") ?? queue.find((q) => !q.reviewed) ?? queue[0] ?? null;
  const item = queue.find((q) => q.id === cur) ?? firstOpen;
  const idx = item ? queue.indexOf(item) : -1;
  const nextOpen = (from: number) => queue.slice(from + 1).find((q) => !q.reviewed) ?? queue.slice(0, Math.max(0, from)).find((q) => !q.reviewed) ?? null;
  const counts = new Map<QueueBucket, { all: number; open: number }>();
  for (const q of queue) {
    const x = counts.get(q.bucket) ?? { all: 0, open: 0 };
    x.all += 1;
    if (!q.reviewed) x.open += 1;
    counts.set(q.bucket, x);
  }
  const matchedOpen = queue.filter((q) => q.bucket === "matched" && !q.reviewed);
  const done = queue.filter((q) => q.reviewed).length;

  const afterAct = () => {
    setMode(null);
    const n = nextOpen(idx);
    setCur(n?.id ?? null);
  };
  const review = (verdict: "ok" | "wrong" | "skip" | "add_cut" | "drop" | "clear", extra: { reason?: AuditWrong; text?: string | null; redo?: boolean; place?: { cutId?: Id | null; stageKey?: string | null; layer?: string | null; version?: number | null } } = {}, entry: AuditEntry | null = item?.entry ?? null) => {
    if (!entry || readOnly) return;
    const r = dispatch("audit.review", { auditId: audit.id, itemIds: entry.items.map((i) => i.id), verdict, ...extra }, { quiet: true });
    if (!r.ok) return notify(err(r.error), "Error");
    if (verdict === "clear") setMode(null);
    else afterAct();
  };
  const decide = (verdict: "elsewhere" | "missing" | "skip" | "clear", extra: { link?: string | null; text?: string | null } = {}) => {
    if (!item?.cell || readOnly) return;
    const r = dispatch("audit.decide", { auditId: audit.id, taskId: item.cell.task.id, verdict, ...extra }, { quiet: true });
    if (!r.ok) return notify(err(r.error), "Error");
    if (verdict === "clear") setMode(null);
    else afterAct();
  };

  // 键盘：1 确认 · 2 不对 · 3 改归属 · → 跳过 · ← 上一条
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (bulk || !item || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "1" && item.entry && item.entry.kind !== "none") review("ok");
      else if (e.key === "2" && item.entry) setMode("wrong");
      else if (e.key === "3" && item.entry) setMode("reassign");
      else if (e.key === "ArrowRight") (item.entry ? review("skip") : decide("skip"));
      else if (e.key === "ArrowLeft" && idx > 0) setCur(queue[idx - 1].id);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!queue.length) return <section className="card"><p className="label">{L.audit.allDone}</p></section>;

  const bar = (
    <div className="card audit-buckets" data-testid="review-buckets">
      <span className="label">{L.audit.first}</span>
      {QUEUE_BUCKETS.filter((b) => counts.get(b)?.all).map((b) => (
        <button
          key={b}
          type="button"
          className="ui-chip"
          aria-pressed={item?.bucket === b && !bulk}
          onClick={() => {
            setBulk(false);
            setMode(null);
            setCur((queue.find((q) => q.bucket === b && !q.reviewed) ?? queue.find((q) => q.bucket === b))!.id);
          }}
          data-testid={`bucket-${b}`}
        >
          {f(L.audit.bucket[b], { n: counts.get(b)!.all })}
        </button>
      ))}
      <span className="label audit-checker">
        {i18n.r(L.audit.checking, { name: <U>{me.nickname}</U> })} · {f(L.audit.progress, { done, total: queue.length })}
      </span>
    </div>
  );

  if (bulk) return (
    <>
      {bar}
      <BulkConfirm c={c} items={matchedOpen} onDone={() => setBulk(false)} audit={audit} group={group} />
    </>
  );

  const e = item?.entry ?? null;
  const cell = item?.cell ?? null;
  const stage = e?.stage ?? cell?.stage ?? null;
  const cut = e?.cut ?? cell?.cut ?? null;
  const layer = e ? e.place.layer : cell?.layer ?? null;
  const where = e && !e.stage && e.place.cutNumber !== null ? `CUT${String(e.place.cutNumber).padStart(3, "0")}${e.place.cutSuffix}` : whereOf(i18n, group, stage, cut, layer);
  // 同一卡上一个有图的环节（往前找，写明是哪个环节）
  const prev =
    d && stage && cut
      ? previousWithPicture(c.facts, stage, cut.id, (s): DeliveryCell | null => {
          // 分层的环节只看同一层（不借别的层的图）；这一条本身不分层就看 A 层（和墙上一样）；不分层的环节就是它那一格
          const wc = wallCell(d, s, cut);
          const perLayer = wc.layers.some((l) => l.layer);
          const same = perLayer ? (layer ? wc.layers.find((l) => l.layer === layer) : wc.shown) : wc.layers[0];
          return same?.thumb ? same : null;
        })
      : null;
  const sys = cell?.sysSub ?? null;
  const passReview = sys ? Object.values(world.reviews).filter((r) => r.taskId === cell!.task.id && r.verdict !== "return" && !r.archivedAt).sort((a, b) => a.at.localeCompare(b.at)).pop() : undefined;
  const sysWho = sys ? memberById(world, sys.byMemberId)?.nickname ?? cell!.task.outsourceName ?? null : null;
  const passer = passReview ? memberById(world, passReview.byMemberId)?.nickname ?? null : null;
  const cands = e ? stagesForCode(c.facts, e.parsed) : [];
  const dups = e && cell ? cell.entries.filter((x) => x.issues.some((i) => i.code === "duplicate") || (x.superseded && x.place.version === e.place.version)) : [];
  const review0 = e?.review ?? cell?.decision?.review ?? null;
  const upNext = queue.filter((q, i) => i > idx && !q.reviewed).slice(0, 7);
  const thumbOf = (x: AuditEntry) => x.items.find((i) => i.thumb)?.thumb ?? null;

  return (
    <>
      {bar}
      <div className="audit-review">
        <section className="card audit-item" data-testid="review-item" data-bucket={item?.bucket} data-id={item?.id}>
          <div className="audit-item-pics">
            <div className="stack" data-gap="tight">
              <span className="label">{f(L.audit.thisItem, { where })}</span>
              {e ? <Thumb thumb={thumbOf(e)} alt={e.primary.name} className="audit-item-big" /> : <div className="audit-item-big audit-tile-empty" data-mark="nofile"><AuditBadge mark="nofile" /><span className="label">{L.audit.noFileFound}</span></div>}
            </div>
            <div className="stack" data-gap="tight" data-testid="review-prev">
              {prev ? (
                <>
                  <span className="label">
                    {f(L.audit.prevPicture, { stage: [i18n.stageName(group, prev.stage), prev.picture.layer ? f(L.audit.layerTab, { layer: prev.picture.layer }) : null].filter(Boolean).join(" · "), version: vTag(prev.picture.version, prev.picture.note) })}
                    {prev.skipped.length ? ` ${f(L.audit.prevSkipped, { names: prev.skipped.map((s) => i18n.stageName(group, s)).join(" · ") })}` : ""}
                  </span>
                  <Thumb thumb={prev.picture.thumb} alt={i18n.stageName(group, prev.stage)} className="audit-item-prev" />
                  <span className="row">
                    <AuditBadge mark={prev.picture.mark} /> <span className="label">{L.audit.markLong[prev.picture.mark]}</span>
                  </span>
                </>
              ) : (
                <span className="label">{L.audit.noPrev}</span>
              )}
              {e?.hints.length ? (
                <span className="label">
                  {L.audit.fileRead}{" "}
                  {e.hints.map((h, i) => (
                    <span key={i}>
                      {i ? " · " : ""}
                      {h.code === "folders" ? i18n.r(L.audit.hint.folders, { names: <U>{String(h.params.names)}</U> }) : f(L.audit.hint[h.code], h.params)}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          </div>
          {e ? (
            <div className="stack" data-gap="small">
              <span className="t-body-14m audit-file-name" data-uc="" data-testid="review-name">
                {e.primary.name}
                {e.formats.length > 1 ? <span className="label"> · {e.formats.join(" + ")}</span> : null}
              </span>
              <NameSegs entry={e} codeStage={e.stage ? `${i18n.stageName(group, e.stage)}${cands.length > 1 ? "?" : ""}` : null} />
            </div>
          ) : null}
          {e?.issues.length ? (
            <div className="audit-problem" data-testid="review-issues">
              <AuditBadge mark="issue" />
              <ul>
                {e.issues.map((x, i) => (
                  <li key={i} data-code={x.code}>
                    {issueText(x, i18n)}
                  </li>
                ))}
              </ul>
              {dups.length > 1 && !readOnly ? (
                <div className="stack" data-gap="small">
                  <span className="label">{f(L.audit.dupLead, { names: dups.map((x) => x.parsed.base).join(" · ") })}</span>
                  <div className="row">
                    {dups.map((x) => (
                      <button key={x.key} type="button" className="audit-dup" aria-pressed={x.review?.verdict === "ok"} onClick={() => review("ok", {}, x)} data-testid="review-dup">
                        <Thumb thumb={thumbOf(x)} alt={x.primary.name} caption="" />
                        <span className="stack" data-gap="tight">
                          <span className="t-body-14m">{f(L.audit.dupPick, { name: vTag(x.place.version, x.parsed.note) })}</span>
                          <span className="label num">{x.primary.mtime ? i18n.dateTime(x.primary.mtime) : ""}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {e && e.kind === "none" ? <p className="label">{L.audit.noSuggest}</p> : null}
          {!e && cell ? (
            <div className="audit-problem" data-tone="warning">
              <span className="t-body-14m">{L.audit.nofileTitle}</span>
              <span className="label">{L.audit.nofileLead}</span>
            </div>
          ) : null}
          <div className="audit-item-facts">
            <div className="audit-fact">
              <span className="label">{L.audit.sysNow}</span>
              <span className="t-body-14m" data-testid="review-sys">
                {cell ? f(L.audit.sysLine, { where: whereOf(i18n, group, cell.stage, cell.cut, cell.layer), status: L.labels.taskStatus[cell.task.status] }) : L.audit.sysNone}
              </span>
              {sys ? (
                <span className="label">
                  {i18n.r(L.audit.sysBy, { version: vTag(sys.versionNo), who: <U>{sysWho ?? "—"}</U> })}
                  {passReview ? i18n.r(L.audit.sysReviewed, { reviewer: <U>{passer ?? "—"}</U>, date: i18n.monthDay(localDate(passReview.at)) }) : null}
                  {sys.backfill ? ` · ${L.audit.backfilled}` : ""}
                </span>
              ) : cell ? (
                <span className="label">{L.audit.sysNone}</span>
              ) : null}
            </div>
            <div className="audit-fact">
              <span className="label">{L.audit.suggest}</span>
              {e && e.stage ? (
                <>
                  <span className="t-body-14m" data-testid="review-suggest">
                    {[where, vTag(e.place.version)].filter(Boolean).join(" · ")}
                    {e.parsed.note ? ` (${L.audit.part.note}: ` : ""}
                    {e.parsed.note ? <U>{e.parsed.note}</U> : null}
                    {e.parsed.note ? ")" : ""}
                  </span>
                  <span className="label">
                    {cands.length > 1 ? f(L.audit.alsoMaybe, { code: e.parsed.code ?? "", others: cands.filter((s) => s.id !== e.stage!.id).map((s) => i18n.stageName(group, s)).join(" / ") }) : ""}
                    {e.place.rule ? f(L.audit.why[e.place.rule], { version: vTag(e.place.rule === "continue" ? cell?.sysVersion : e.place.version), stage: i18n.stageName(group, e.stage), code: e.parsed.code ?? "" }) : null}
                  </span>
                </>
              ) : cell ? (
                <span className="t-body-14m">{whereOf(i18n, group, cell.stage, cell.cut, cell.layer)}</span>
              ) : (
                <span className="label">{L.audit.noSuggest}</span>
              )}
            </div>
          </div>
          {review0 ? (
            <div className="row audit-reviewed" data-testid="review-result">
              <Tag tone={review0.verdict === "ok" || review0.verdict === "elsewhere" ? "success" : review0.verdict === "wrong" || review0.verdict === "missing" ? "danger" : undefined}>
                {i18n.r(L.audit.reviewedBy, { verdict: L.audit.reviewedAs[review0.verdict], who: <U>{memberById(world, review0.byMemberId)?.nickname ?? "—"}</U>, time: i18n.dateTime(review0.at) })}
              </Tag>
              {!readOnly ? <Button Label={L.audit.actions.clear} Style="Ghost" Size="Small" onClick={() => (e ? review("clear") : decide("clear"))} data-testid="review-clear" /> : null}
            </div>
          ) : null}
          {mode === "wrong" && e ? <WrongForm e={e} onGo={(reason, text, redo) => review("wrong", { reason, text, redo })} onCancel={() => setMode(null)} /> : null}
          {mode === "reassign" && e ? <ReassignForm c={c} e={e} group={group} onGo={(place) => review("ok", { place })} onCancel={() => setMode(null)} /> : null}
          {mode === "elsewhere" && cell ? <TextForm placeholder={L.audit.elsewherePh} go={L.audit.elsewhereGo} initial="" onGo={(v) => decide("elsewhere", /^https?:\/\//i.test(v.trim()) ? { link: v.trim() } : { text: v })} onCancel={() => setMode(null)} testId="elsewhere" /> : null}
          {mode === "missing" && cell ? <TextForm placeholder="" go={L.audit.missingGo} initial={L.audit.missingDefault} onGo={(v) => decide("missing", { text: v })} onCancel={() => setMode(null)} testId="missing" area /> : null}
          {!readOnly ? (
            <div className="audit-actions" data-testid="review-actions">
              {e ? (
                <>
                  {e.kind !== "none" ? <ActionKey label={L.audit.actions.confirm} k="1" primary onClick={() => review("ok")} testId="review-ok" /> : null}
                  <ActionKey label={L.audit.actions.wrong} k="2" onClick={() => setMode("wrong")} testId="review-wrong" />
                  <ActionKey label={L.audit.actions.reassign} k="3" onClick={() => setMode("reassign")} testId="review-reassign" />
                  {e.issues.some((x) => x.code === "no_cut") ? <Button Label={L.audit.addCut} Style="Secondary" Size="Small" onClick={() => review("add_cut")} data-testid="review-addcut" /> : null}
                  {e.kind === "none" || e.issues.some((x) => x.code === "no_cut") ? <Button Label={L.audit.drop} Style="Ghost" Size="Small" onClick={() => review("drop")} data-testid="review-drop" /> : null}
                  <ActionKey label={L.audit.actions.skip} k="→" ghost onClick={() => review("skip")} testId="review-skip" />
                </>
              ) : (
                <>
                  <Button Label={L.audit.elsewhere} Style="Secondary" Size="Small" onClick={() => setMode("elsewhere")} data-testid="review-elsewhere" />
                  <Button Label={L.audit.missingBtn} Style="Secondary" Size="Small" onClick={() => setMode("missing")} data-testid="review-missing" />
                  <ActionKey label={L.audit.actions.skip} k="→" ghost onClick={() => decide("skip")} testId="review-skip" />
                </>
              )}
              <span className="audit-actions-end">
                {idx > 0 ? <Button Label={L.audit.actions.previous} Style="Ghost" Size="Small" onClick={() => setCur(queue[idx - 1].id)} data-testid="review-prev-item" /> : null}
              </span>
            </div>
          ) : null}
          <span className="label audit-keys">{L.audit.keys}</span>
        </section>
        <aside className="card audit-next" data-testid="review-next">
          <h3 className="t-heading-18">{L.audit.upNext}</h3>
          {upNext.length ? (
            <ul>
              {upNext.map((q) => (
                <li key={q.id}>
                  <button type="button" className="audit-next-item" onClick={() => setCur(q.id)} data-testid="next-item">
                    <Thumb thumb={q.entry ? thumbOf(q.entry) : null} alt="" caption="" />
                    <span className="stack" data-gap="tight">
                      <span className="t-body-14m">{q.entry ? (q.entry.stage || q.entry.cut ? whereOf(i18n, group, q.entry.stage, q.entry.cut, q.entry.place.layer) : q.entry.primary.name) : whereOf(i18n, group, q.cell!.stage, q.cell!.cut, q.cell!.layer)}</span>
                      <span className="label">{reasonOf(q, i18n)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="label">{L.audit.bucketDone}</p>
          )}
          <p className="label">{f(L.audit.moreLeft, { n: Math.max(0, queue.length - done - 1) })}</p>
          {matchedOpen.length && !readOnly ? <Button Label={f(L.audit.bulkOpen, { n: matchedOpen.length })} Style="Secondary" onClick={() => setBulk(true)} data-testid="bulk-open" /> : null}
          <Button Label={L.audit.toWrite} Style={done === queue.length ? "Primary" : "Ghost"} onClick={onWrite} data-testid="to-write" />
        </aside>
      </div>
    </>
  );
}

function ActionKey({ label, k, onClick, primary, ghost, testId }: { label: string; k: string; onClick: () => void; primary?: boolean; ghost?: boolean; testId: string }) {
  return (
    <span className="audit-action">
      <Button Label={label} Style={primary ? "Primary" : ghost ? "Ghost" : "Secondary"} Size="Small" onClick={onClick} data-testid={testId} />
      <kbd className="audit-kbd num" aria-hidden="true">
        {k}
      </kbd>
    </span>
  );
}

function WrongForm({ e, onGo, onCancel }: { e: AuditEntry; onGo: (reason: AuditWrong, text: string | null, redo: boolean) => void; onCancel: () => void }) {
  const { L } = useI18n();
  const [reason, setReason] = useState<AuditWrong>("not_stage");
  const [text, setText] = useState("");
  const [redo, setRedo] = useState(false);
  const passed = e.task?.status === "passed";
  return (
    <div className="audit-form" data-testid="wrong-form">
      <div className="chips" role="radiogroup">
        {AUDIT_WRONG.map((r) => (
          <button key={r} type="button" className="ui-chip" role="radio" aria-checked={reason === r} aria-pressed={reason === r} onClick={() => setReason(r)} data-testid={`wrong-${r}`}>
            {L.audit.wrongReason[r]}
          </button>
        ))}
      </div>
      <input className="field-control" value={text} onChange={(ev) => setText(ev.target.value)} placeholder={L.audit.wrongText} aria-label={L.audit.wrongText} data-testid="wrong-text" />
      {reason === "unfinished" && passed ? (
        <label className="audit-check-row">
          <input type="checkbox" checked={redo} onChange={(ev) => setRedo(ev.target.checked)} data-testid="wrong-redo" />
          <span className="stack" data-gap="tight">
            <span className="label">{L.audit.redoAsk}</span>
            <span className="t-body-14m">{L.audit.redoYes}</span>
          </span>
        </label>
      ) : null}
      <div className="row">
        <Button Label={L.audit.wrongGo} Size="Small" onClick={() => onGo(reason, text.trim() || null, redo)} data-testid="wrong-go" />
        <Button Label={L.audit.cancel} Style="Ghost" Size="Small" onClick={onCancel} />
      </div>
    </div>
  );
}

function ReassignForm({ c, e, group, onGo, onCancel }: { c: AuditCheck; e: AuditEntry; group: ProjectRow["group"]; onGo: (p: { cutId: Id | null; stageKey: string | null; layer: string | null; version: number | null }) => void; onCancel: () => void }) {
  const i18n = useI18n();
  const { L } = i18n;
  const f0 = c.facts;
  const [cutId, setCutId] = useState<Id | "">(e.cut?.id ?? "");
  const [stageKey, setStageKey] = useState<string>(e.stage?.templateKey ?? "");
  const [layer, setLayer] = useState<string>(e.place.layer ?? "");
  const [version, setVersion] = useState<string>(e.place.version != null ? String(e.place.version) : "");
  const stage = stageKey ? f0.stageByKey.get(stageKey) ?? null : null;
  const cut = cutId ? f0.cutById.get(cutId) ?? null : null;
  const stages = f0.stages.filter((s) => (cut ? s.grain !== "project" : true));
  return (
    <div className="audit-form" data-testid="reassign-form">
      <div className="audit-form-grid">
        <label className="field">
          <span className="field-label">{L.audit.place.cut}</span>
          <select className="field-control" value={cutId} onChange={(ev) => setCutId(ev.target.value)} data-testid="reassign-cut">
            <option value="">—</option>
            {f0.cuts.map((x) => (
              <option key={x.id} value={x.id}>
                {i18n.cut(x, group)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{L.audit.place.stage}</span>
          <select className="field-control" value={stageKey} onChange={(ev) => setStageKey(ev.target.value)} data-testid="reassign-stage">
            <option value="">—</option>
            {stages.map((s) => (
              <option key={s.id} value={s.templateKey}>
                {i18n.stageName(group, s)}
              </option>
            ))}
          </select>
        </label>
        {stage?.grain === "layer" ? (
          <label className="field">
            <span className="field-label">{L.audit.place.layer}</span>
            <select className="field-control" value={layer} onChange={(ev) => setLayer(ev.target.value)} data-testid="reassign-layer">
              <option value="">—</option>
              {(cut?.layers ?? []).map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">{L.audit.place.version}</span>
          <input className="field-control" type="number" min={1} max={999} value={version} onChange={(ev) => setVersion(ev.target.value)} data-testid="reassign-version" />
        </label>
      </div>
      <div className="row">
        <Button Label={L.audit.place.go} Size="Small" disabled={!stageKey} onClick={() => onGo({ cutId: cutId || null, stageKey: stageKey || null, layer: stage?.grain === "layer" ? layer || null : null, version: version ? Number(version) : null })} data-testid="reassign-go" />
        <Button Label={L.audit.cancel} Style="Ghost" Size="Small" onClick={onCancel} />
      </div>
    </div>
  );
}

function TextForm({ placeholder, go, initial, onGo, onCancel, testId, area }: { placeholder: string; go: string; initial: string; onGo: (v: string) => void; onCancel: () => void; testId: string; area?: boolean }) {
  const { L } = useI18n();
  const [v, setV] = useState(initial);
  return (
    <div className="audit-form" data-testid={`${testId}-form`}>
      {area ? <textarea className="field-control" rows={2} value={v} onChange={(ev) => setV(ev.target.value)} aria-label={go} data-testid={`${testId}-text`} /> : <input className="field-control" value={v} onChange={(ev) => setV(ev.target.value)} placeholder={placeholder} aria-label={placeholder || go} data-testid={`${testId}-text`} />}
      <div className="row">
        <Button Label={go} Size="Small" disabled={!v.trim()} onClick={() => onGo(v.trim())} data-testid={`${testId}-go`} />
        <Button Label={L.audit.cancel} Style="Ghost" Size="Small" onClick={onCancel} />
      </div>
    </div>
  );
}

/** 「对上了」的一次全确认：先看一眼缩略图墙，点掉不对的（变灰、标「不算」），再一次确认剩下的。 */
function BulkConfirm({ c, items, onDone, audit, group }: { c: AuditCheck; items: QueueItem[]; onDone: () => void; audit: AuditRow; group: ProjectRow["group"] }) {
  const { dispatch, notify } = useGuild();
  const i18n = useI18n();
  const { L, f, err } = i18n;
  const [off, setOff] = useState<Set<string>>(new Set());
  const keep = items.filter((q) => !off.has(q.id));
  void c;
  return (
    <section className="card" data-testid="bulk-confirm">
      <h3 className="t-section-24">{f(L.audit.bulkTitle, { n: items.length })}</h3>
      <p className="label">{L.audit.bulkLead}</p>
      <div className="audit-bulk-grid">
        {items.map((q) => {
          const e = q.entry!;
          const out = off.has(q.id);
          return (
            <button
              key={q.id}
              type="button"
              className="audit-bulk-cell"
              aria-pressed={!out}
              onClick={() =>
                setOff((prev) => {
                  const next = new Set(prev);
                  if (next.has(q.id)) next.delete(q.id);
                  else next.add(q.id);
                  return next;
                })
              }
              data-testid="bulk-cell"
            >
              <Thumb thumb={e.items.find((i) => i.thumb)?.thumb ?? null} alt={e.primary.name} caption="" />
              <span className="audit-bulk-check" aria-hidden="true">
                {out ? "" : "✓"}
              </span>
              {out ? <span className="tag audit-bulk-off">{L.audit.notCounted}</span> : null}
              <span className="label">{whereOf(i18n, group, e.stage, e.cut, e.place.layer)}</span>
            </button>
          );
        })}
      </div>
      <div className="row" data-justify="between">
        <span className="row">
          <Button
            Label={f(L.audit.bulkGo, { n: keep.length })}
            disabled={!keep.length}
            onClick={() => {
              const ids = keep.flatMap((q) => q.entry!.items.map((i) => i.id));
              const r = dispatch("audit.review", { auditId: audit.id, itemIds: ids, verdict: "ok" }, { quiet: true });
              if (!r.ok) return notify(err(r.error), "Error");
              onDone();
            }}
            data-testid="bulk-go"
          />
          <Button Label={L.audit.cancel} Style="Ghost" onClick={onDone} data-testid="bulk-cancel" />
        </span>
        <span className="label">{f(L.audit.bulkNote, { n: off.size })}</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ④ 写回项目
// ---------------------------------------------------------------------------

function cutsSummary(i18n: I18n, group: ProjectRow["group"], list: PlanBackfill[]): string {
  const cuts = Array.from(new Set(list.map((b) => (b.cut ? i18n.cut(b.cut, group) : i18n.L.audit.projectRow))));
  const layers = Array.from(new Set(list.map((b) => b.task.layer).filter(Boolean)));
  return `${cuts.slice(0, 6).join(" · ")}${cuts.length > 6 ? " …" : ""}${layers.length ? ` · ${layers.join(" / ")}` : ""}`;
}

export function WriteStep({ project, audit, c, onBack }: { project: ProjectRow; audit: AuditRow; c: AuditCheck; onBack: () => void }) {
  const { world, me, dispatch, notify } = useGuild();
  const i18n = useI18n();
  const { L, f, err, monthDay } = i18n;
  const group = project.group;
  const [newer, setNewer] = useState<"record" | "ignore">("record");
  const [whoMode, setWhoMode] = useState<"none" | "pick">("none");
  const [people, setPeople] = useState<Record<string, string>>({});
  const [outside, setOutside] = useState<Record<string, string>>({});
  const [points, setPoints] = useState(false);
  const [quality, setQuality] = useState<Quality>(1);
  const plan = useMemo(() => writePlan(c, { newer }), [c, newer]);
  const rm = memoryReadModel(world);
  const compare = useMemo(() => compareAudits(memoryReadModel(world), audit.id), [world, audit.id]);
  const admin = isAdmin(me);
  const allMembers = members(world);
  if (audit.status === "written" && audit.written) return <WrittenView project={project} audit={audit} compare={compare} />;

  const groups = new Map<Id, { stage: StageRow; list: PlanBackfill[] }>();
  for (const b of plan.backfill) {
    const g = groups.get(b.stage.id) ?? { stage: b.stage, list: [] };
    g.list.push(b);
    groups.set(b.stage.id, g);
  }
  const lastCut = Math.max(0, ...c.facts.cuts.map((x) => x.number));
  const personOf = (stageKey: string) => {
    if (whoMode !== "pick") return null;
    const v = people[stageKey] ?? "";
    if (v.startsWith("m:")) return { memberId: v.slice(2) };
    if (v === "outside" && outside[stageKey]?.trim()) return { name: outside[stageKey].trim() };
    return null;
  };
  const write = () => {
    const personByStage: Record<string, { memberId: Id } | { name: string } | null> = {};
    for (const g of Array.from(groups.values())) personByStage[g.stage.templateKey] = personOf(g.stage.templateKey);
    const r = dispatch("audit.write", { auditId: audit.id, newer, person: null, personByStage, points, quality }, { quiet: true });
    if (!r.ok) return notify(err(r.error), "Error");
    const w = r.state.audits[audit.id].written!.counts;
    notify(f(L.audit.writtenToast, w));
  };
  const u = plan.untouched;
  return (
    <>
      <div className="audit-tiles" data-testid="write-tiles">
        <Tile n={plan.verify.length} tone="success" title={L.audit.tile.verify} lead={L.audit.tile.verifyLead} testId="tile-verify" />
        <Tile n={plan.backfill.length} tone="info" title={L.audit.tile.backfill} lead={f(L.audit.tile.backfillLead, { n: plan.backfill.length })} testId="tile-backfill" />
        <Tile n={plan.redo.length} tone="danger" title={L.audit.tile.redo} lead={L.audit.tile.redoLead} testId="tile-redo" />
        <Tile n={plan.addCuts.length} title={L.audit.tile.addCut} lead={plan.addCuts.length ? plan.addCuts.map((a, i) => f(L.audit.tile.addCutLead, { from: `CUT${String(a.number).padStart(3, "0")}${a.suffix}`, to: i18n.cut({ number: lastCut + i + 1 }, group) })).join(" · ") : L.audit.tile.addCutNone} testId="tile-addcut" />
        <Tile n={u.total} title={L.audit.tile.untouched} lead={f(L.audit.tile.untouchedLead, u)} testId="tile-untouched" />
      </div>
      <div className="audit-write">
        <div className="stack">
          <section className="card" data-testid="write-backfill">
            <div className="card-head">
              <h3 className="t-heading-18">
                {f(L.audit.backfillTitle, { n: plan.backfill.length })} <span className="label">{L.audit.backfillSub}</span>
              </h3>
              <span className="label">{L.audit.backfillMark}</span>
            </div>
            {groups.size ? (
              <ul className="audit-groups">
                {Array.from(groups.values()).map((g) => (
                  <li key={g.stage.id} className="audit-group" data-testid="backfill-group" data-stage={g.stage.templateKey}>
                    <span className="audit-group-thumbs">
                      {g.list.slice(0, 4).map((b) => (
                        <Thumb key={b.task.id} thumb={b.entry.items.find((i) => i.thumb)?.thumb ?? null} alt={b.entry.primary.name} caption="" />
                      ))}
                    </span>
                    <span className="stack" data-gap="tight">
                      <span className="t-body-14m">{f(L.audit.groupLine, { stage: i18n.stageName(group, g.stage), n: g.list.length })}</span>
                      <span className="label">{f(L.audit.groupCuts, { cuts: cutsSummary(i18n, group, g.list) })}</span>
                    </span>
                    {whoMode === "pick" ? (
                      <span className="stack" data-gap="tight">
                        <select className="field-control" value={people[g.stage.templateKey] ?? ""} onChange={(ev) => setPeople((p) => ({ ...p, [g.stage.templateKey]: ev.target.value }))} aria-label={L.audit.whoTitle} data-testid="backfill-who">
                          <option value="">{L.audit.whoNobody}</option>
                          {allMembers.map((m) => (
                            <option key={m.id} value={`m:${m.id}`} data-uc="">
                              {m.nickname}
                            </option>
                          ))}
                          <option value="outside">{L.audit.whoOutside}</option>
                        </select>
                        {people[g.stage.templateKey] === "outside" ? <input className="field-control" value={outside[g.stage.templateKey] ?? ""} onChange={(ev) => setOutside((p) => ({ ...p, [g.stage.templateKey]: ev.target.value }))} placeholder={L.audit.whoOutsidePh} aria-label={L.audit.whoOutsidePh} data-testid="backfill-outside" /> : null}
                      </span>
                    ) : (
                      <Tag>{L.audit.whoNobody}</Tag>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="label">{L.audit.noBackfill}</p>
            )}
          </section>
          <div className="audit-write-opts">
            <section className="card">
              <h3 className="t-heading-18">{L.audit.whoTitle}</h3>
              {(["none", "pick"] as const).map((k) => (
                <label key={k} className="audit-radio" data-on={whoMode === k ? "yes" : undefined}>
                  <input type="radio" name="audit-who" checked={whoMode === k} onChange={() => setWhoMode(k)} data-testid={`who-${k}`} />
                  <span className="stack" data-gap="tight">
                    <span className="t-body-14m">{k === "none" ? L.audit.whoNone : L.audit.whoPick}</span>
                    <span className="label">{k === "none" ? L.audit.whoNoneLead : L.audit.whoPickLead}</span>
                  </span>
                </label>
              ))}
            </section>
            <section className="card">
              <h3 className="t-heading-18">{L.audit.pointsTitle}</h3>
              <label className="audit-check-row">
                <input type="checkbox" checked={points} onChange={(ev) => setPoints(ev.target.checked)} data-testid="write-points" />
                <span className="stack" data-gap="tight">
                  <span className="t-body-14m">{L.audit.points}</span>
                  <span className="label">{L.audit.pointsLead}</span>
                </span>
              </label>
              {points ? (
                <div className="stack" data-gap="small">
                  <div className="chips" role="radiogroup" aria-label={L.audit.quality}>
                    {QUALITY_OPTIONS.map((q) => (
                      <button key={q.value} type="button" className="ui-chip" role="radio" aria-checked={quality === q.value} aria-pressed={quality === q.value} onClick={() => setQuality(q.value)} data-testid={`write-quality-${q.label}`}>
                        {L.audit.quality} {q.label}
                      </button>
                    ))}
                  </div>
                  <span className="label">{L.audit.pointsFormula}</span>
                  <ul className="audit-formula">
                    {plan.backfill.slice(0, 6).map((b) => {
                      const who = personOf(b.stage.templateKey);
                      const m = who && "memberId" in who ? memberById(world, who.memberId) : undefined;
                      const enr = m ? rm.where("enrollments", { memberId: m.id, group, stageKey: b.stage.templateKey })[0] : undefined;
                      const rate = taskRate(b.stage, b.task);
                      return (
                        <li key={b.task.id} className="label num">
                          {i18n.r(L.audit.pointsLine, { stage: i18n.stageName(group, b.stage), tn: rate.tn, workload: b.task.workload, q: quality, points: m ? taskPoints(b.stage, b.task, enr?.skill ?? 0, quality) : 0, who: m ? <U>{m.nickname}</U> : L.audit.whoNobody })}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </section>
          </div>
          {plan.newer.length ? (
            <section className="card" data-testid="write-newer">
              <h3 className="t-heading-18">
                {f(L.audit.newerTitle, { n: plan.newer.length })} <span className="label">{L.audit.newerEg}</span>
              </h3>
              <div className="row">
                {(["record", "ignore"] as const).map((k) => (
                  <label key={k} className="audit-radio" data-on={newer === k ? "yes" : undefined}>
                    <input type="radio" name="audit-newer" checked={newer === k} onChange={() => setNewer(k)} data-testid={`newer-${k}`} />
                    <span className="t-body-14m">{k === "record" ? L.audit.newerRecord : L.audit.newerIgnore}</span>
                  </label>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <div className="stack">
          <section className="card" data-testid="write-redo">
            <h3 className="t-heading-18">{f(L.audit.redoTitle, { n: plan.redo.length, m: plan.addCuts.length })}</h3>
            {plan.redo.length || plan.addCuts.length ? (
              <ul className="audit-redo">
                {plan.redo.map((r) => (
                  <li key={r.task.id} data-testid="redo-item">
                    <span className="t-body-14m" data-tone="danger">
                      {whereOf(i18n, group, r.stage, r.cut, r.task.layer)}
                    </span>
                    <span className="label">{L.audit.redoWhy[r.why]}</span>
                  </li>
                ))}
                {plan.addCuts.map((a, i) => (
                  <li key={`${a.number}${a.suffix}`} data-testid="addcut-item">
                    <span className="t-body-14m">{f(L.audit.addCutLine, { to: i18n.cut({ number: lastCut + i + 1 }, group) })}</span>
                    <span className="label">{f(L.audit.addCutWhy, { from: `CUT${String(a.number).padStart(3, "0")}${a.suffix}` })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="label">{L.audit.noRedo}</p>
            )}
          </section>
          <section className="card" data-testid="write-after">
            <h3 className="t-heading-18">{L.audit.afterTitle}</h3>
            <p className="label">{f(L.audit.afterLead, { date: monthDay(localDate(audit.at)), verify: plan.verify.length, backfill: plan.backfill.length, redo: plan.redo.length })}</p>
            <p className="label">{L.audit.afterUndo}</p>
            {admin ? <Button Label={L.audit.writeGo} onClick={write} disabled={!plan.verify.length && !plan.backfill.length && !plan.redo.length && !plan.addCuts.length} data-testid="write-go" /> : null}
            <Button Label={L.audit.notYet} Style="Secondary" onClick={onBack} data-testid="write-back" />
          </section>
          <CompareCard compare={compare} />
        </div>
      </div>
    </>
  );
}

function Tile({ n, title, lead, tone, testId }: { n: number; title: string; lead: string; tone?: "success" | "info" | "danger"; testId: string }) {
  return (
    <div className="card audit-tile-stat" data-tone={tone} data-testid={testId}>
      <span className="row">
        <span className="audit-tile-n num" data-testid={`${testId}-n`}>
          {n}
        </span>
        <span className="t-body-14m">{title}</span>
      </span>
      <span className="label">{lead}</span>
    </div>
  );
}

function CompareCard({ compare }: { compare: ReturnType<typeof compareAudits> }) {
  const { L, f, monthDay } = useI18n();
  return (
    <section className="card" data-testid="audit-compare">
      <h3 className="t-heading-18">{L.audit.compareTitle}</h3>
      <p className="label" data-testid="audit-compare-line">
        {compare ? f(L.audit.compareLine, { date: monthDay(localDate(compare.prev.at)), added: compare.added, gone: compare.gone, updated: compare.updated }) : L.audit.compareNone}
      </p>
    </section>
  );
}

function WrittenView({ project, audit, compare }: { project: ProjectRow; audit: AuditRow; compare: ReturnType<typeof compareAudits> }) {
  const { world, me, dispatch, notify } = useGuild();
  const i18n = useI18n();
  const { L, f, err, monthDay } = i18n;
  const w = audit.written!;
  const pv = undoPreviewOf(memoryReadModel(world), audit.id);
  const who = memberById(world, w.byMemberId);
  const label = (u: (typeof w.units)[number]) => {
    const t = u.taskId ? world.tasks[u.taskId] : undefined;
    const s = t ? world.stages[t.stageId] : undefined;
    const cut = t?.cutId ? world.cuts[t.cutId] : u.cutId ? world.cuts[u.cutId] : undefined;
    return [L.audit.unitLabel[u.kind], whereOf(i18n, project.group, s ?? null, cut ?? null, t?.layer ?? null)].filter(Boolean).join(" · ");
  };
  return (
    <div className="audit-write">
      <section className="card" data-testid="written-card">
        <h3 className="t-section-24">{L.audit.writtenTitle}</h3>
        <p className="t-body-14m" data-testid="written-line">
          {f(L.audit.writtenLine, w.counts)}
        </p>
        <p className="label">{i18n.r(L.audit.writtenAt, { date: monthDay(localDate(w.at)), who: <U>{who?.nickname ?? "—"}</U> })}</p>
        <details>
          <summary className="label">{L.audit.history}</summary>
          <ul className="audit-units">
            {w.units
              .filter((u) => u.kind !== "unlock")
              .map((u, i) => (
                <li key={i} className="label">
                  {label(u)}
                </li>
              ))}
          </ul>
        </details>
      </section>
      <div className="stack">
        {pv ? (
          <section className="card" data-testid="undo-card">
            <h3 className="t-heading-18">{L.audit.undoTitle}</h3>
            <p className="label">{f(L.audit.undoCan, { n: pv.revert.length })}</p>
            {pv.kept.length ? (
              <>
                <p className="label">{f(L.audit.undoKeep, { n: pv.kept.length })}</p>
                <ul className="audit-units">
                  {pv.kept.map((u, i) => (
                    <li key={i} className="label">
                      {label(u)}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {isAdmin(me) && pv.revert.length ? (
              <Button
                Label={L.audit.undoGo}
                Style="Secondary"
                onClick={() => {
                  const r = dispatch("audit.undo", { auditId: audit.id }, { quiet: true });
                  if (!r.ok) return notify(err(r.error), "Error");
                  notify(f(L.audit.undoneToast, { n: pv.revert.length, kept: pv.kept.length }), "Neutral");
                }}
                data-testid="undo-go"
              />
            ) : null}
          </section>
        ) : null}
        <CompareCard compare={compare} />
      </div>
    </div>
  );
}
