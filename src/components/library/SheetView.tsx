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
import { FileFacts, MissingPlaceholder, SaveFileButton } from "./tiles";
import { PinForm, PinItem, type Draft } from "./Viewer";

interface Pos {
  r: number;
  c: number;
}

export function SheetStage({ file, forReview, panel, focusPinId }: { file: FileRow; forReview: boolean; panel: "pins" | "info"; focusPinId: Id | null }) {
  const { world, me, now } = useGuild();
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
        if (!blob) throw new Error("读不到文件");
        const { readWorkbook } = await import("@/lib/sheets/read");
        const parsed = await readWorkbook(new Uint8Array(await blob.arrayBuffer()));
        if (alive) setWb(parsed);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "读不了这个表格");
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
            <p className="error-text">这个表格读不了（{error}）。可以保存到这台设备，用 Excel 打开。</p>
          </div>
        ) : !sheet ? (
          <div className="viewer-stage viewer-stage-file">
            <p className="label">正在读表格…</p>
          </div>
        ) : (
          <>
            <div className="viewer-tools">
              <div className="chips" role="tablist" aria-label="工作表">
                {wb!.sheets.map((s, i) => (
                  <button key={s.name} type="button" role="tab" className="ui-chip" aria-selected={i === sheetIdx} aria-pressed={i === sheetIdx} onClick={() => { setSheetIdx(i); setSel(null); }} data-testid="sheet-tab">
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="row">
                <input className="field-control sheet-search" type="search" placeholder="搜格子里的字" aria-label="搜格子里的字" value={q} onChange={(e) => { setQ(e.target.value); setHit(0); }} data-testid="sheet-search" />
                {q ? (
                  <span className="label num" data-testid="sheet-search-count">
                    {matches.length ? `${hit + 1} / ${matches.length}` : "0"}
                  </span>
                ) : null}
                {matches.length > 1 ? <Button Label="下一个" Size="Small" Style="Ghost" onClick={() => setHit((h) => (h + 1) % matches.length)} /> : null}
                <Button Label="检查这张表" Size="Small" Style="Secondary" onClick={() => setIssues(checkWorkbook(wb!))} data-testid="sheet-check" />
              </div>
            </div>
            {sheet.totalRows > MAX_ROWS ? (
              <p className="label sheet-note" data-testid="sheet-truncated">
                这张表有 {sheet.totalRows} 行，先显示前 {MAX_ROWS} 行。要看全部，保存到这台设备用 Excel 打开。
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
                            <span className="sheet-v">{cell?.v ?? ""}</span>
                            {cell?.f ? <span className="sheet-f" aria-label={`公式 =${cell.f}`} data-testid="sheet-formula" /> : null}
                            {marks?.filter((m) => m.number).map((m) => (
                              <button key={m.id} type="button" className="sheet-pin" data-status={m.resolved ? "resolved" : "open"} onClick={(e) => { e.stopPropagation(); setActivePin(m.id); }} aria-label={`${m.number} 号意见`}>
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
                {selRef ? `选中 ${selRef}` : "点一个格子，或者拖选一片"}
                {sheet.totalRows ? ` · 共 ${sheet.totalRows} 行 ${sheet.totalCols} 列` : ""}
              </span>
              {selRef ? <Button Label={`在 ${selRef} 留意见`} Size="Small" Style="Accent" onClick={() => setDraft({ kind: "cell", sheet: sheet.name, ref: selRef })} data-testid="sheet-comment" /> : null}
            </div>
          </>
        )}
      </div>
      <aside className="viewer-side" aria-label={panel === "info" ? "文件信息" : "这张表上的意见"}>
        {panel === "info" ? (
          <div className="stack" data-gap="small">
            <h2 className="t-heading-18">文件信息</h2>
            <FileFacts file={file} />
            <SaveFileButton file={file} />
          </div>
        ) : (
          <div className="stack" data-gap="small">
            {issues ? (
              <div className="stack" data-gap="small" data-testid="sheet-issues">
                <div className="row" data-justify="between">
                  <h2 className="t-heading-18">
                    检查结果 <span className="count">{issues.length}</span>
                  </h2>
                  <Button Label="收起" Size="Small" Style="Ghost" onClick={() => setIssues(null)} />
                </div>
                <p className="label">只提醒，不改原表。点一条跳到那个格子。</p>
                {issues.length === 0 ? <p className="muted">没查出问题。</p> : null}
                <ol className="pin-list">
                  {issues.map((i, n) => (
                    <li key={n} className="pin-item" data-kind={i.kind} data-testid="sheet-issue">
                      <button type="button" className="pin-item-head" onClick={() => goTo(i.sheet, i.ref)}>
                        <span className="num t-body-14m">{i.ref}</span>
                        <span>
                          {ISSUE_LABEL[i.kind].zh}
                          {i.column ? `：「${i.column}」` : ""}
                          {i.value ? `（${i.value}）` : ""}
                        </span>
                      </button>
                      {wb!.sheets.length > 1 ? <span className="label">{i.sheet}</span> : null}
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
                格子上的意见 <span className="count">{pins.length}</span>
              </h2>
              {pins.some((p) => p.status === "resolved") ? (
                <label className="check-row label">
                  <input type="checkbox" checked={hideResolved} onChange={(e) => setHideResolved(e.target.checked)} />
                  隐藏已解决的
                </label>
              ) : null}
            </div>
            {shownPins.length === 0 ? <p className="label">还没有。选一个格子，点「在这里留意见」。</p> : null}
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
