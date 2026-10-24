/**
 * 表格预览（SPEC §15.2）：工作表切换（标签）· 表头固定 · 公式算出来的值（有公式的格子右上角一个小记号，悬停看公式）·
 * 合并单元格照原样 · 列宽大致照原样 · 很大的表只先显示前 2000 行（写明）· 搜格子里的字。
 * 点一个格子（或拖选一片）留意见 —— 和图上的钉一样能回复、解决，进卡时间线和「等我处理」。
 * 「检查这张表」：空着的必填列 · 日期 / 数字写成了文字 · 公式报错，点一条跳到那个格子。只提醒，不改原表。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isReviewer } from "@/domain/commands/core";
import type { FileRow, Id } from "@/domain/model";
import { pinsOf } from "@/domain/queries";
import { useFiles } from "@/lib/files/FilesProvider";
import { ISSUE_LABEL, MAX_ROWS, cellRef, checkWorkbook, colName, headerRow, parseRef, rangeRef, type SheetIssue, type WorkbookData } from "@/lib/sheets/model";
import { useGuild } from "@/lib/store";
import { U, useI18n } from "@/i18n/I18n";
import { FileFacts, MissingPlaceholder, SaveFileButton } from "./tiles";
import { PinForm, PinItem, type Draft } from "./Viewer";

interface Pos {
  r: number;
  c: number;
}

export function SheetStage({ file, forReview, panel, focusPinId }: { file: FileRow; forReview: boolean; panel: "pins" | "info"; focusPinId: Id | null }) {
  const { world, me, now } = useGuild();
  const { L, f, t2 } = useI18n();
  const { present, ready, getBlob } = useFiles();
  const here = present.has(file.sha256);
  const [wb, setWb] = useState<WorkbookData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [q, setQ] = useState("");
  const [hit, setHit] = useState(0);
  const [sel, setSel] = useState<{ a: Pos; b: Pos } | null>(null);
  const dragging = useRef(false);
  const [issues, setIssues] = useState<SheetIssue[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [activePin, setActivePin] = useState<Id | null>(focusPinId);
  const [hideResolved, setHideResolved] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!here) return;
    let alive = true;
    (async () => {
      try {
        const blob = await getBlob(file.sha256);
        if (!blob) throw new Error(L.viewer.cantRead);
        const { readWorkbook } = await import("@/lib/sheets/read");
        const parsed = await readWorkbook(new Uint8Array(await blob.arrayBuffer()));
        if (alive) setWb(parsed);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : L.viewer.sheetUnreadable);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file.sha256, here, getBlob]);

  const sheet = wb?.sheets[sheetIdx] ?? null;
  const pins = pinsOf(world, file.id).filter((p) => !!p.cell);
  const shownPins = pins.filter((p) => !(hideResolved && p.status === "resolved"));

  /** 合并单元格：左上角那一格的跨度，以及被盖住的格子。 */
  const merge = useMemo(() => {
    const span = new Map<string, { rows: number; cols: number }>();
    const skip = new Set<string>();
    for (const m of sheet?.merges ?? []) {
      span.set(`${m.r0}:${m.c0}`, { rows: m.r1 - m.r0 + 1, cols: m.c1 - m.c0 + 1 });
      for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) if (r !== m.r0 || c !== m.c0) skip.add(`${r}:${c}`);
    }
    return { span, skip };
  }, [sheet]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!sheet || !needle) return [] as Pos[];
    const out: Pos[] = [];
    sheet.rows.forEach((row, r) => row.forEach((cell, c) => cell && cell.v.toLowerCase().includes(needle) && out.push({ r, c })));
    return out;
  }, [sheet, q]);

  const pinAt = useMemo(() => {
    const m = new Map<string, { number: number; resolved: boolean; id: Id }[]>();
    if (!sheet) return m;
    for (const p of shownPins) {
      if (p.cell!.sheet !== sheet.name) continue;
      const rg = parseRef(p.cell!.ref);
      if (!rg) continue;
      for (let r = rg.r0; r <= rg.r1; r++)
        for (let c = rg.c0; c <= rg.c1; c++) {
          const k = `${r}:${c}`;
          const list = m.get(k) ?? [];
          if (r === rg.r0 && c === rg.c0) list.push({ number: p.number, resolved: p.status === "resolved", id: p.id });
          else if (!list.length) list.push({ number: 0, resolved: p.status === "resolved", id: p.id });
          m.set(k, list);
        }
    }
    return m;
  }, [shownPins, sheet]);

  const goTo = (sheetName: string, ref: string) => {
    const i = wb?.sheets.findIndex((s) => s.name === sheetName) ?? -1;
    if (i >= 0) setSheetIdx(i);
    const rg = parseRef(ref);
    if (!rg) return;
    setSel({ a: { r: rg.r0, c: rg.c0 }, b: { r: rg.r1, c: rg.c1 } });
    window.setTimeout(() => scroller.current?.querySelector<HTMLElement>(`[data-ref="${cellRef(rg.r0, rg.c0)}"]`)?.scrollIntoView?.({ block: "center", inline: "center" }), 30);
  };

  useEffect(() => {
    if (!wb || !focusPinId) return;
    const p = pins.find((x) => x.id === focusPinId);
    if (p?.cell) goTo(p.cell.sheet, p.cell.ref);
    // 只在打开时跳一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wb]);

  useEffect(() => {
    const m = matches[hit];
    if (m && sheet) goTo(sheet.name, cellRef(m.r, m.c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit, matches]);

  const inSel = (r: number, c: number) => !!sel && r >= Math.min(sel.a.r, sel.b.r) && r <= Math.max(sel.a.r, sel.b.r) && c >= Math.min(sel.a.c, sel.b.c) && c <= Math.max(sel.a.c, sel.b.c);
  const selRef = sel ? rangeRef(sel.a, sel.b) : null;
  const hdr = sheet ? headerRow(sheet) : 0;
  const width = sheet ? Math.max(1, ...sheet.rows.map((r) => r.length), sheet.colWidths.length) : 1;
  const matchSet = new Set(matches.map((m) => `${m.r}:${m.c}`));
  const current = matches[hit];

  return (
    <div className="viewer-body">
      <div className="viewer-main">
        {!here && ready ? (
          <div className="viewer-stage viewer-stage-file">
            <MissingPlaceholder />
          </div>
        ) : error ? (
          <div className="viewer-stage viewer-stage-file">
            <p className="error-text">{f(L.viewer.sheetError, { why: error })}</p>
          </div>
        ) : !sheet ? (
          <div className="viewer-stage viewer-stage-file">
            <p className="label">{L.viewer.sheetLoading}</p>
          </div>
        ) : (
          <>
            <div className="viewer-tools">
              <div className="chips" role="tablist" aria-label={L.viewer.sheetTabs}>
                {wb!.sheets.map((s, i) => (
                  <button key={s.name} type="button" role="tab" className="ui-chip" aria-selected={i === sheetIdx} aria-pressed={i === sheetIdx} onClick={() => { setSheetIdx(i); setSel(null); }} data-testid="sheet-tab" data-uc="">
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="row">
                <input className="field-control sheet-search" type="search" placeholder={L.viewer.sheetSearch} aria-label={L.viewer.sheetSearch} value={q} onChange={(e) => { setQ(e.target.value); setHit(0); }} data-testid="sheet-search" />
                {q ? (
                  <span className="label num" data-testid="sheet-search-count">
                    {matches.length ? `${hit + 1} / ${matches.length}` : "0"}
                  </span>
                ) : null}
                {matches.length > 1 ? <Button Label={L.viewer.nextHit} Size="Small" Style="Ghost" onClick={() => setHit((h) => (h + 1) % matches.length)} /> : null}
                <Button Label={L.viewer.checkSheet} Size="Small" Style="Secondary" onClick={() => setIssues(checkWorkbook(wb!))} data-testid="sheet-check" />
              </div>
            </div>
            {sheet.totalRows > MAX_ROWS ? (
              <p className="label sheet-note" data-testid="sheet-truncated">
                {f(L.viewer.truncated, { total: sheet.totalRows, max: MAX_ROWS })}
              </p>
            ) : null}
            <div className="sheet-scroll" ref={scroller} data-testid="sheet-grid" onMouseUp={() => (dragging.current = false)} onMouseLeave={() => (dragging.current = false)}>
              <table className="sheet">
                <colgroup>
                  <col style={{ width: 44 }} />
                  {Array.from({ length: width }, (_, c) => (
                    <col key={c} style={{ width: sheet.colWidths[c] ?? 88 }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="sheet-corner" aria-hidden="true" />
                    {Array.from({ length: width }, (_, c) => (
                      <th key={c} scope="col">
                        {colName(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row, r) => (
                    <tr key={r} className={r === hdr ? "sheet-header-row" : undefined}>
                      <th scope="row">{r + 1}</th>
                      {Array.from({ length: width }, (_, c) => {
                        const k = `${r}:${c}`;
                        if (merge.skip.has(k)) return null;
                        const cell = row[c];
                        const span = merge.span.get(k);
                        const marks = pinAt.get(k);
                        const ref = cellRef(r, c);
                        return (
                          <td
                            key={c}
                            rowSpan={span?.rows}
                            colSpan={span?.cols}
                            data-ref={ref}
                            data-type={cell?.t}
                            data-selected={inSel(r, c) ? "yes" : undefined}
                            data-match={matchSet.has(k) ? (current && current.r === r && current.c === c ? "current" : "yes") : undefined}
                            data-pinned={marks ? (marks.every((m) => m.resolved) ? "resolved" : "yes") : undefined}
                            data-merged={span ? "yes" : undefined}
                            title={cell?.f ? `=${cell.f}` : undefined}
                            onMouseDown={(e) => {
                              if (e.shiftKey && sel) setSel({ a: sel.a, b: { r, c } });
                              else setSel({ a: { r, c }, b: { r, c } });
                              dragging.current = true;
                            }}
                            onMouseEnter={() => dragging.current && sel && setSel({ a: sel.a, b: { r, c } })}
                            data-testid="sheet-cell"
                          >
                            <span className="sheet-v" data-uc="">
                              {cell?.v ?? ""}
                            </span>
                            {cell?.f ? <span className="sheet-f" aria-label={f(L.viewer.formula, { f: cell.f })} data-testid="sheet-formula" /> : null}
                            {marks?.filter((m) => m.number).map((m) => (
                              <button key={m.id} type="button" className="sheet-pin" data-status={m.resolved ? "resolved" : "open"} onClick={(e) => { e.stopPropagation(); setActivePin(m.id); }} aria-label={f(L.viewer.cellPin, { n: m.number })}>
                                {m.number}
                              </button>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row sheet-status">
              <span className="label">
                {selRef ? f(L.viewer.selected, { ref: selRef }) : L.viewer.pickCell}
                {sheet.totalRows ? f(L.viewer.sheetSize, { rows: sheet.totalRows, cols: sheet.totalCols }) : ""}
              </span>
              {selRef ? <Button Label={f(L.viewer.commentAt, { ref: selRef })} Size="Small" Style="Accent" onClick={() => setDraft({ kind: "cell", sheet: sheet.name, ref: selRef })} data-testid="sheet-comment" /> : null}
            </div>
          </>
        )}
      </div>
      <aside className="viewer-side" aria-label={panel === "info" ? L.viewer.sideInfo : L.viewer.sideSheetPins}>
        {panel === "info" ? (
          <div className="stack" data-gap="small">
            <h2 className="t-heading-18">{L.viewer.sideInfo}</h2>
            <FileFacts file={file} />
            <SaveFileButton file={file} />
          </div>
        ) : (
          <div className="stack" data-gap="small">
            {issues ? (
              <div className="stack" data-gap="small" data-testid="sheet-issues">
                <div className="row" data-justify="between">
                  <h2 className="t-heading-18">
                    {L.viewer.issues} <span className="count">{issues.length}</span>
                  </h2>
                  <Button Label={L.viewer.collapse} Size="Small" Style="Ghost" onClick={() => setIssues(null)} />
                </div>
                <p className="label">{L.viewer.issuesNote}</p>
                {issues.length === 0 ? <p className="muted">{L.viewer.noIssues}</p> : null}
                <ol className="pin-list">
                  {issues.map((i, n) => (
                    <li key={n} className="pin-item" data-kind={i.kind} data-testid="sheet-issue">
                      <button type="button" className="pin-item-head" onClick={() => goTo(i.sheet, i.ref)}>
                        <span className="num t-body-14m">{i.ref}</span>
                        <span>
                          {t2(ISSUE_LABEL[i.kind])}
                          {i.column ? (
                            <>
                              {L.common.colon}
                              {L.common.quoteOpen}
                              <U>{i.column}</U>
                              {L.common.quoteClose}
                            </>
                          ) : null}
                          {i.value ? (
                            <>
                              {" ("}
                              <U>{i.value}</U>
                              {")"}
                            </>
                          ) : null}
                        </span>
                      </button>
                      {wb!.sheets.length > 1 ? (
                        <span className="label" data-uc="">
                          {i.sheet}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {draft ? (
              <PinForm file={file} draft={draft} forReview={forReview && isReviewer(me)} onDone={(id) => { setDraft(null); if (id) setActivePin(id); }} />
            ) : null}
            <div className="row" data-justify="between">
              <h2 className="t-heading-18">
                {L.viewer.cellNotes} <span className="count">{pins.length}</span>
              </h2>
              {pins.some((p) => p.status === "resolved") ? (
                <label className="check-row label">
                  <input type="checkbox" checked={hideResolved} onChange={(e) => setHideResolved(e.target.checked)} />
                  {L.viewer.hideResolved}
                </label>
              ) : null}
            </div>
            {shownPins.length === 0 ? <p className="label">{L.viewer.noCellNotes}</p> : null}
            <ol className="pin-list" data-testid="pin-list">
              {shownPins.map((p) => (
                <PinItem key={p.id} pin={p} active={activePin === p.id} now={now} onJump={() => { setActivePin(p.id); goTo(p.cell!.sheet, p.cell!.ref); }} />
              ))}
            </ol>
          </div>
        )}
      </aside>
    </div>
  );
}
