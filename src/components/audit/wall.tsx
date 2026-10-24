/**
 * 以图为主（SPEC §18.6）：交付物墙 · 看图器 · 还差多少 · 路线行的缩略图条 · 卡详情的胶片条 · 环节页的交付物墙。
 * 数据都从 deliveriesOf（纯函数）来；这里只画。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { AuditBadge, MarkIcon, Thumb, WallTile, type WallSize } from "./parts";
import { MARKS_SHOWN, wallCell, wallStages, type DeliveryCell, type DeliveryMark, type Deliveries, type StageRemaining } from "@/domain/audit/deliveries";
import type { CutRow, Group, Id, StageRow } from "@/domain/model";
import { memoryReadModel } from "@/domain/readmodel";
import { deliveriesOf } from "@/domain/audit/deliveries";
import { memberById, stageRouteOf } from "@/domain/queries";
import { localDate } from "@/domain/clock";
import { U, useI18n } from "@/i18n/I18n";
import { useGuild } from "@/lib/store";

export function useDeliveries(projectId: Id): Deliveries | null {
  const { world } = useGuild();
  return useMemo(() => deliveriesOf(memoryReadModel(world), projectId), [world, projectId]);
}

/** 路线上的编号（第几个环节）。 */
export function useRouteNo(projectId: Id): Map<Id, number> {
  const { world } = useGuild();
  return useMemo(() => new Map((stageRouteOf(world, projectId)?.rows ?? []).map((r) => [r.stage.id, r.no])), [world, projectId]);
}

const vLabel = (v: number | null, note?: string | null) => (v == null ? "" : `v${String(v).padStart(2, "0")}${note ?? ""}`);

// ---------------------------------------------------------------------------
// 还差多少
// ---------------------------------------------------------------------------

export function RemainingTable({ d, group, onPick, current }: { d: Deliveries; group: Group; onPick?: (stage: StageRow | null, mark: DeliveryMark) => void; current?: Id | null }) {
  const { L, f, stageName, stage: stageEl } = useI18n();
  const no = useRouteNo(d.facts.project.id);
  const cols: DeliveryMark[] = ["verified", "pending", "nofile", "issue", "missing"];
  const row = (r: StageRemaining, key: string, label: ReactNode, total = false) => (
    <tr key={key} data-testid={total ? "remaining-total" : "remaining-row"} data-stage={r.stage?.templateKey} data-current={r.stage && r.stage.id === current ? "yes" : undefined} className={total ? "remaining-total" : undefined}>
      <th scope="row">{label}</th>
      <td className="num">{r.due}</td>
      {cols.map((m) => (
        <td key={m} className="num" data-mark={m}>
          {r[m] ? (
            onPick ? (
              <button type="button" className="remaining-num" data-testid={`remaining-${m}`} onClick={() => onPick(r.stage, m)} aria-label={f(L.audit.pickAria, { stage: r.stage ? stageName(group, r.stage) : L.audit.total, mark: L.audit.mark[m], n: r[m] })}>
                {r[m]}
              </button>
            ) : (
              <span data-testid={`remaining-${m}`}>{r[m]}</span>
            )
          ) : (
            <span className="remaining-zero" aria-hidden="true">
              —
            </span>
          )}
        </td>
      ))}
      <td className="remaining-bar-cell">
        <span className="remaining-bar" aria-hidden="true">
          {(["verified", "pending", "nofile", "issue"] as const).map((m) => (r[m] ? <span key={m} data-mark={m} style={{ width: `${(r[m] / Math.max(1, r.due)) * 100}%` }} /> : null))}
        </span>
      </td>
    </tr>
  );
  let lastPhase = "";
  return (
    <div className="remaining" data-testid="remaining">
      <div className="table-scroll">
        <table className="remaining-table">
          <thead>
            <tr>
              <th scope="col">{L.audit.col.stage}</th>
              <th scope="col">{L.audit.col.due}</th>
              {cols.map((m) => (
                <th key={m} scope="col" data-mark={m} title={L.audit.mark[m]}>
                  {/* 窄屏上表头只放图形（和下面的图例对着看），字留给读屏 */}
                  <span className="remaining-col-icon" aria-hidden="true">
                    <MarkIcon mark={m} size={14} />
                  </span>
                  <span className="remaining-col-label">{L.audit.col[m]}</span>
                </th>
              ))}
              <th scope="col">{L.audit.col.progress}</th>
            </tr>
          </thead>
          <tbody>
            {row(d.total, "total", L.audit.total, true)}
            {d.stages.flatMap((r) => {
              const s = r.stage!;
              const out: ReactNode[] = [];
              if (s.phase !== lastPhase) {
                lastPhase = s.phase;
                out.push(
                  <tr key={`ph-${s.phase}`} className="remaining-phase">
                    <th colSpan={9} scope="rowgroup" className="label">
                      {L.labels.phase[s.phase]}
                    </th>
                  </tr>
                );
              }
              out.push(
                row(
                  r,
                  s.id,
                  <>
                    <span className="num">{no.get(s.id) ?? ""}</span> {stageEl(group, s)}
                  </>
                )
              );
              return out;
            })}
          </tbody>
        </table>
      </div>
      <p className="label remaining-legend">
        {(["verified", "pending", "nofile", "issue"] as const).map((m) => (
          <span key={m} className="remaining-key" data-mark={m}>
            <span aria-hidden="true" />
            <MarkIcon mark={m} />
            {L.audit.mark[m]}
          </span>
        ))}
        <span className="remaining-key" data-mark="missing">
          <span aria-hidden="true" />
          <MarkIcon mark="missing" />
          {L.audit.legendMissing}
        </span>
        <span>{L.audit.legendNote}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 交付物墙
// ---------------------------------------------------------------------------

export interface WallPick {
  stageId: Id;
  cutId: Id | null;
}

export function DeliveryWall({
  d,
  group,
  filter,
  onFilter,
  onOpen,
  initialSize = "s",
  extraHead,
  testId = "delivery-wall",
}: {
  d: Deliveries;
  group: Group;
  filter: DeliveryMark | "all";
  onFilter?: (m: DeliveryMark | "all") => void;
  onOpen: (p: WallPick) => void;
  initialSize?: WallSize;
  extraHead?: ReactNode;
  testId?: string;
}) {
  const { L, f, stage: stageEl, stageName, cut: cutOf } = useI18n();
  const [size, setSize] = useState<WallSize>(initialSize);
  const [folded, setFolded] = useState(true);
  const no = useRouteNo(d.facts.project.id);
  const shownStages = wallStages(d.facts, !folded);
  const foldedCount = wallStages(d.facts, true).length - wallStages(d.facts, false).length;
  const projectStages = d.facts.stages.filter((s) => s.grain === "project");
  const counts = new Map<DeliveryMark, number>();
  const cutCells = (cut: CutRow) => shownStages.map((s) => wallCell(d, s, cut));
  for (const cut of d.facts.cuts) for (const c of cutCells(cut)) counts.set(c.mark, (counts.get(c.mark) ?? 0) + 1);
  const label = (s: StageRow, cut: CutRow | null) => (cut ? `${cutOf(cut, group)} · ${stageName(group, s)}` : stageName(group, s));
  return (
    <section className="card audit-wall-card" data-testid={testId} data-size={size}>
      <div className="card-head">
        <div className="stack" data-gap="tight">
          <h2 className="t-section-24">{L.audit.wallTitle}</h2>
          <span className="label">{f(L.audit.wallLead, { cuts: d.facts.cuts.length, stages: wallStages(d.facts, false).length })}</span>
        </div>
        <div className="row audit-wall-tools">
          {onFilter ? (
            <div className="chips" role="group" aria-label={L.audit.filterAria}>
              <button type="button" className="ui-chip" aria-pressed={filter === "all"} onClick={() => onFilter("all")} data-testid="wall-filter-all">
                {L.audit.filterAll}
              </button>
              {MARKS_SHOWN.map((m) => (
                <button key={m} type="button" className="ui-chip" aria-pressed={filter === m} onClick={() => onFilter(m)} data-testid={`wall-filter-${m}`}>
                  {L.audit.mark[m]} <span className="num">{counts.get(m) ?? 0}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="chips" role="group" aria-label={L.audit.sizeAria}>
            {(["s", "m", "l"] as const).map((s) => (
              <button key={s} type="button" className="ui-chip" aria-pressed={size === s} onClick={() => setSize(s)} data-testid={`wall-size-${s}`}>
                {L.audit.size[s]}
              </button>
            ))}
          </div>
          {foldedCount ? (
            <button type="button" className="ui-chip" aria-pressed={!folded} onClick={() => setFolded((x) => !x)} data-testid="wall-folded">
              {folded ? f(L.audit.showFolded, { n: foldedCount }) : L.audit.hideFolded}
            </button>
          ) : null}
          {extraHead}
        </div>
      </div>
      <div className="audit-wall-scroll">
        <table className="audit-wall" data-size={size}>
          <thead>
            <tr>
              <th scope="col" className="label audit-wall-corner">
                {L.audit.cutStage}
              </th>
              {shownStages.map((s) => (
                <th key={s.id} scope="col" className="label">
                  <span className="num">{no.get(s.id) ?? ""}</span> {stageEl(group, s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projectStages.length ? (
              <tr className="audit-wall-project">
                <th scope="row" className="label">
                  {L.audit.projectRow}
                </th>
                <td colSpan={Math.max(1, shownStages.length)}>
                  <div className="audit-wall-strip">
                    {projectStages.map((s) => {
                      const c = wallCell(d, s, null);
                      return (
                        <figure key={s.id} className="audit-wall-pcell" data-dim={filter !== "all" && c.mark !== filter ? "yes" : undefined}>
                          <WallTile cell={c} size={size} label={label(s, null)} onOpen={() => onOpen({ stageId: s.id, cutId: null })} testId="wall-pcell" />
                          <figcaption className="label">{stageEl(group, s)}</figcaption>
                        </figure>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ) : null}
            {d.facts.cuts.map((cut) => (
              <tr key={cut.id} data-testid="wall-row" data-cut={cut.number}>
                <th scope="row" className="num t-body-14m">
                  {cutOf(cut, group)}
                </th>
                {cutCells(cut).map((c) => (
                  <td key={c.stage.id} data-dim={filter !== "all" && c.mark !== filter ? "yes" : undefined}>
                    <WallTile cell={c} size={size} label={label(c.stage, cut)} onOpen={() => onOpen({ stageId: c.stage.id, cutId: cut.id })} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 看图器：←→ 同一卡前后环节 · ↑↓ 上一卡 / 下一卡 · 底下一条是这一格的几个版本
// ---------------------------------------------------------------------------

interface VersionTile {
  key: string;
  label: string;
  thumb: { sha256: string } | null;
  name: string | null;
  info: string | null;
}

function versionsOf(d: Deliveries, c: DeliveryCell, i18n: ReturnType<typeof useI18n>): VersionTile[] {
  const out: VersionTile[] = [];
  const seen = new Set<string>();
  const entries = c.cell?.entries ?? [];
  const { L, f } = i18n;
  for (const e of [...entries].sort((a, b) => (a.place.version ?? 0) - (b.place.version ?? 0) || (a.parsed.note ? 1 : 0) - (b.parsed.note ? 1 : 0))) {
    const it = e.items.find((x) => x.thumb) ?? e.items[0];
    const label = vLabel(e.place.version, e.parsed.note);
    seen.add(`v${e.place.version}`);
    // 文件里读出来的：画布大小 · 帧率 · 时长（只显示，不算错）
    const info = e.items.find((x) => x.info?.canvas || x.info?.fps)?.info ?? null;
    const meta = info
      ? [info.canvas ? f(L.audit.info.canvas, { w: info.canvas.width, h: info.canvas.height }) : null, info.fps ? f(L.audit.info.fps, { fps: info.fps }) : null, info.seconds != null ? f(L.audit.info.seconds, { s: info.seconds.toFixed(1) }) : null].filter(Boolean).join(" · ")
      : null;
    out.push({ key: e.key, label, thumb: it.thumb, name: it.name, info: meta || null });
  }
  for (const s of d.facts.subsByTask.get(c.task.id) ?? []) {
    if (seen.has(`v${s.versionNo}`)) continue;
    // 系统里的这一版：只用它自己的图（没附图就是「没有图」的占位，不借盘点里新版本的图）
    out.push({ key: s.id, label: vLabel(s.versionNo), thumb: c.subThumbs.get(s.id) ?? null, name: s.fileName, info: i18n.f(i18n.L.audit.sysVersion, { version: vLabel(s.versionNo) }) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function WallViewer({ d, group, pick, onClose }: { d: Deliveries; group: Group; pick: WallPick; onClose: () => void }) {
  const i18n = useI18n();
  const { L, f, stageName, cut: cutOf } = i18n;
  const [pos, setPos] = useState<WallPick>(pick);
  const [layer, setLayer] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const stages = pos.cutId ? wallStages(d.facts, true) : d.facts.stages.filter((s) => s.grain === "project");
  const stage = d.facts.stages.find((s) => s.id === pos.stageId) ?? stages[0];
  const cut = pos.cutId ? d.facts.cutById.get(pos.cutId) ?? null : null;
  const wc = wallCell(d, stage, cut);
  const shown = (layer ? wc.layers.find((l) => l.layer === layer) : null) ?? wc.shown ?? wc.layers[0] ?? null;
  const vs = shown ? versionsOf(d, shown, i18n) : [];
  const cur = vs.find((v) => v.key === version) ?? vs.find((v) => v.label === vLabel(shown?.version ?? null, shown?.note)) ?? vs[vs.length - 1] ?? null;
  const si = stages.findIndex((s) => s.id === stage.id);
  const ci = cut ? d.facts.cuts.findIndex((c) => c.id === cut.id) : -1;
  const prevS = si > 0 ? stages[si - 1] : null;
  const nextS = si >= 0 && si < stages.length - 1 ? stages[si + 1] : null;
  const upC = ci > 0 ? d.facts.cuts[ci - 1] : null;
  const downC = ci >= 0 && ci < d.facts.cuts.length - 1 ? d.facts.cuts[ci + 1] : null;
  const move = (p: WallPick) => {
    setPos(p);
    setVersion(null);
    setLayer(null);
  };
  useEffect(() => {
    card.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" && prevS) move({ stageId: prevS.id, cutId: pos.cutId });
      else if (e.key === "ArrowRight" && nextS) move({ stageId: nextS.id, cutId: pos.cutId });
      else if (e.key === "ArrowUp" && upC) move({ stageId: pos.stageId, cutId: upC.id });
      else if (e.key === "ArrowDown" && downC) move({ stageId: pos.stageId, cutId: downC.id });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const where = [cut ? cutOf(cut, group) : null, stageName(group, stage), shown?.layer ? f(L.audit.layerTab, { layer: shown.layer }) : null].filter(Boolean).join(" · ");
  const none = L.audit.viewerNone;
  return (
    <div className="ui-scrim" onClick={onClose}>
      <div ref={card} className="ui-dialog-card audit-viewer" role="dialog" aria-modal="true" aria-label={where} tabIndex={-1} onClick={(e) => e.stopPropagation()} data-testid="wall-viewer">
        <div className="card-head">
          <h2 className="t-heading-18">
            {where} <AuditBadge mark={shown?.mark ?? wc.mark} />
          </h2>
          <span className="label">
            {f(L.audit.viewerNav, {
              prev: prevS ? stageName(group, prevS) : none,
              next: nextS ? stageName(group, nextS) : none,
              up: upC ? cutOf(upC, group) : none,
              down: downC ? cutOf(downC, group) : none,
            })}
          </span>
        </div>
        {wc.layers.length > 1 ? (
          <div className="chips" role="group">
            {wc.layers.map((l) => (
              <button key={l.task.id} type="button" className="ui-chip" aria-pressed={l === shown} onClick={() => setLayer(l.layer)} data-testid="viewer-layer">
                {f(L.audit.layerTab, { layer: l.layer ?? "" })} <AuditBadge mark={l.mark} compact />
              </button>
            ))}
          </div>
        ) : null}
        <div className="audit-viewer-body">
          <Thumb thumb={(cur ? cur.thumb : shown?.thumb) ?? null} alt={where} className="audit-viewer-img" caption={(cur ? cur.thumb : shown?.thumb) ? undefined : L.audit.noPicture} />
          <div className="stack" data-gap="small">
            {cur?.name ? (
              <span className="t-body-14m audit-file-name" data-uc="">
                {cur.name}
              </span>
            ) : null}
            {cur?.info ? (
              <span className="label" data-testid="viewer-info">
                {cur.info}
              </span>
            ) : null}
            {shown?.backfilled ? <span className="label">{L.audit.backfilled}</span> : null}
            {shown?.entry?.issues.length ? (
              <ul className="audit-issue-lines">
                {shown.entry.issues.map((x, i) => (
                  <li key={i} className="label" data-tone="danger">
                    {L.audit.issue[x.code].title}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        {vs.length ? (
          <div className="stack" data-gap="tight">
            <span className="label">{L.audit.versionsTitle}</span>
            <div className="audit-versions" role="group" aria-label={L.audit.versionsTitle}>
              {vs.map((v) => (
                <button key={v.key} type="button" className="audit-version" aria-pressed={v === cur} onClick={() => setVersion(v.key)} data-testid="viewer-version">
                  <Thumb thumb={v.thumb} alt={v.label} caption={v.thumb ? undefined : L.audit.noPicture} />
                  <span className="num label">{v.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="ui-overlay-actions">
          <Button Label={L.audit.close} Style="Secondary" Size="Small" onClick={onClose} data-testid="viewer-close" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 路线行的缩略图条（按可用宽度放 2–6 张 + 「+N」）
// ---------------------------------------------------------------------------

export function StageThumbStrip({ d, stage, onOpen }: { d: Deliveries; stage: StageRow; onOpen?: (p: WallPick) => void }) {
  const { L, f, stageName } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(6);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setFit(Math.max(2, Math.min(6, Math.floor((w - 32) / 48))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cells = d.cells.filter((c) => c.stage.id === stage.id && c.thumb);
  // 最新交的在前
  cells.sort((a, b) => (b.sub?.at ?? b.entry?.primary.createdAt ?? "").localeCompare(a.sub?.at ?? a.entry?.primary.createdAt ?? ""));
  const byCut = new Map<string, DeliveryCell>();
  for (const c of cells) if (!byCut.has(c.cut?.id ?? "p")) byCut.set(c.cut?.id ?? "p", c);
  const list = Array.from(byCut.values());
  const shown = list.slice(0, fit);
  const more = list.length - shown.length;
  return (
    <div ref={ref} className="route-thumbs" data-testid="route-thumbs" data-count={list.length} aria-label={f(L.audit.stripAria, { stage: stageName(d.facts.project.group, stage), n: list.length })}>
      {list.length ? (
        <>
          {shown.map((c) => (
            <button
              key={c.task.id}
              type="button"
              className="route-thumb"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpen?.({ stageId: stage.id, cutId: c.cut?.id ?? null });
              }}
              data-testid="route-thumb"
            >
              <Thumb thumb={c.thumb} alt={c.fileName ?? ""} caption="" />
            </button>
          ))}
          {more > 0 ? <span className="label num route-thumbs-more">{f(L.audit.stripMore, { n: more })}</span> : null}
        </>
      ) : (
        <span className="label">{L.audit.stripNone}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 卡详情的胶片条：这一卡从前到后每个环节的缩略图
// ---------------------------------------------------------------------------

export function CutFilmstrip({ d, cut, group }: { d: Deliveries; cut: CutRow; group: Group }) {
  const { world } = useGuild();
  const { L, f, stage: stageEl, stageName, cut: cutOf } = useI18n();
  const no = useRouteNo(d.facts.project.id);
  const [reviews, setReviews] = useState(false);
  const layers = cut.layers.map((l) => l.name);
  const [layer, setLayer] = useState<string | null>(layers[0] ?? null);
  const [pick, setPick] = useState<WallPick | null>(null);
  const stages = wallStages(d.facts, reviews);
  return (
    <section className="card" data-testid="cut-filmstrip" aria-labelledby="film-title">
      <div className="card-head">
        <div className="stack" data-gap="tight">
          <h2 id="film-title" className="t-section-24">
            {f(L.audit.filmTitle, { cut: cutOf(cut, group) })}
          </h2>
          <span className="label">{L.audit.filmLead}</span>
        </div>
        <div className="chips">
          <button type="button" className="ui-chip" aria-pressed={reviews} onClick={() => setReviews((x) => !x)} data-testid="film-reviews">
            {f(L.audit.reviewStages, { state: reviews ? L.audit.reviewShown : L.audit.reviewHidden })}
          </button>
          {layers.length > 1
            ? layers.map((l) => (
                <button key={l} type="button" className="ui-chip" aria-pressed={layer === l} onClick={() => setLayer(l)} data-testid="film-layer">
                  {f(L.audit.layerTab, { layer: l })}
                </button>
              ))
            : null}
        </div>
      </div>
      <div className="audit-film">
        {stages.map((s) => {
          const wc = wallCell(d, s, cut);
          const c = (s.grain === "layer" ? wc.layers.find((x) => x.layer === layer) : null) ?? wc.layers[0] ?? null;
          const single = c ? { ...wc, layers: [c], mark: c.mark, shown: c } : wc;
          return (
            <figure key={s.id} className="audit-film-cell" data-testid="film-cell" data-stage={s.templateKey} data-mark={single.mark}>
              <span className="label">
                <span className="num">{no.get(s.id) ?? ""}</span> {stageEl(group, s)}
              </span>
              <WallTile cell={single} size="m" label={`${cutOf(cut, group)} · ${stageName(group, s)}`} onOpen={() => setPick({ stageId: s.id, cutId: cut.id })} />
              <figcaption className="label">{c ? captionOf(c, L) : L.audit.stillNothing}</figcaption>
            </figure>
          );
        })}
      </div>
      <div className="table-scroll">
        <table className="audit-cut-table" data-testid="cut-deliveries">
          <thead>
            <tr>
              <th scope="col">{L.audit.tableCols.stage}</th>
              <th scope="col">{L.audit.tableCols.system}</th>
              <th scope="col">{L.audit.tableCols.audit}</th>
              <th scope="col">{L.audit.tableCols.latest}</th>
              <th scope="col">{L.audit.tableCols.who}</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => {
              const wc = wallCell(d, s, cut);
              const c = (s.grain === "layer" ? wc.layers.find((x) => x.layer === layer) : null) ?? wc.layers[0] ?? null;
              if (!c) return null;
              const by = c.sub?.byMemberId ? memberById(world, c.sub.byMemberId)?.nickname : c.task.outsourceName;
              const passer = Object.values(world.reviews).filter((r) => r.taskId === c.task.id && r.verdict !== "return" && !r.archivedAt).pop();
              return (
                <tr key={s.id}>
                  <th scope="row">
                    <span className="num">{no.get(s.id) ?? ""}</span> {stageEl(group, s)}
                  </th>
                  <td>
                    {L.labels.taskStatus[c.task.status]}
                    {c.sub ? ` · ${vLabel(c.sub.versionNo)}` : ""}
                  </td>
                  <td>
                    <AuditBadge mark={c.mark} />
                  </td>
                  <td className="label">{c.fileName ? <U>{c.fileName}</U> : "—"}</td>
                  <td className="label">
                    <U>{by ?? "—"}</U> · <U>{passer ? memberById(world, passer.byMemberId)?.nickname ?? "—" : "—"}</U>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pick ? <WallViewer d={d} group={group} pick={pick} onClose={() => setPick(null)} /> : null}
    </section>
  );
}

function captionOf(c: DeliveryCell, L: ReturnType<typeof useI18n>["L"]): string {
  if (c.mark === "missing") return L.audit.stillNothing;
  if (c.mark === "nofile") return L.audit.markLong.nofile;
  const v = vLabel(c.version, c.note);
  return [v, c.backfilled ? L.audit.backfilled : null, L.audit.mark[c.mark]].filter(Boolean).join(" · ");
}

/** 环节页「交付物」块：这一环节的交付物墙（一卡一张大缩略图）+ 按状态筛。 */
export function StageWall({ d, stage, group }: { d: Deliveries; stage: StageRow; group: Group }) {
  const { world } = useGuild();
  const { L, f, cut: cutOf, monthDay, stageName } = useI18n();
  const [filter, setFilter] = useState<DeliveryMark | "all">("all");
  const [pick, setPick] = useState<WallPick | null>(null);
  const cuts = stage.grain === "project" ? [null] : d.facts.cuts;
  const cells = cuts.map((cut) => wallCell(d, stage, cut));
  const counts = new Map<DeliveryMark, number>();
  for (const c of cells) counts.set(c.mark, (counts.get(c.mark) ?? 0) + 1);
  return (
    <div className="stack" data-gap="small" data-testid="stage-wall">
      <div className="chips" role="group" aria-label={L.audit.filterAria}>
        <button type="button" className="ui-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")} data-testid="stage-wall-all">
          {f(L.audit.allCuts, { n: cells.length })}
        </button>
        {MARKS_SHOWN.filter((m) => counts.get(m)).map((m) => (
          <button key={m} type="button" className="ui-chip" aria-pressed={filter === m} onClick={() => setFilter(m)} data-testid={`stage-wall-${m}`}>
            {f(L.audit.markN, { mark: L.audit.mark[m], n: counts.get(m) ?? 0 })}
          </button>
        ))}
      </div>
      <div className="stage-wall-grid">
        {cells
          .filter((c) => filter === "all" || c.mark === filter)
          .map((c) => {
            const shown = c.shown;
            const layers = c.layers.map((l) => l.layer).filter(Boolean);
            return (
              <figure key={c.cut?.id ?? "p"} className="stage-wall-cell" data-testid="stage-wall-cell" data-mark={c.mark} data-cut={c.cut?.number ?? ""}>
                <WallTile cell={c} size="m" label={c.cut ? cutOf(c.cut, group) : stageName(group, stage)} onOpen={() => setPick({ stageId: stage.id, cutId: c.cut?.id ?? null })} />
                <figcaption className="stack" data-gap="tight">
                  <span className="row" data-justify="between">
                    <span className="t-body-14m">
                      {c.cut ? cutOf(c.cut, group) : null} {layers.length > 1 ? <span className="label num">{layers.join(" · ")}</span> : null}
                    </span>
                    {shown?.sub?.byMemberId || shown?.task.outsourceName ? (
                      <span className="label">
                        <U>{(shown.sub?.byMemberId ? memberById(world, shown.sub.byMemberId)?.nickname : null) ?? shown.task.outsourceName ?? ""}</U>
                      </span>
                    ) : null}
                  </span>
                  {shown?.backfilled ? (
                    <span className="tag" data-tone="info" data-testid="stage-wall-backfill">
                      {shown.verifiedAt ? f(L.audit.backfillOn, { date: monthDay(localDate(shown.verifiedAt)) }) : L.audit.backfilled}
                    </span>
                  ) : shown?.mark === "verified" && shown.verifiedAt ? (
                    <span className="tag" data-tone="success">
                      {f(L.audit.verifiedOn, { date: monthDay(localDate(shown.verifiedAt)) })}
                    </span>
                  ) : shown?.entry?.parsed.note && shown.mark === "issue" ? (
                    <span className="tag" data-tone="danger">
                      <U>{vLabel(shown.version, shown.note)}</U>
                    </span>
                  ) : null}
                </figcaption>
              </figure>
            );
          })}
      </div>
      {!cells.some((c) => filter === "all" || c.mark === filter) ? <p className="label">{L.audit.wallEmpty}</p> : null}
      {pick ? <WallViewer d={d} group={group} pick={pick} onClose={() => setPick(null)} /> : null}
    </div>
  );
}
