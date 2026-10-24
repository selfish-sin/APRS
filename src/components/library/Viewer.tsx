/**
 * 看图器（SPEC §11.3 / §11.4）：全屏层。
 *   - 放大 / 缩小 / 适应 / 1:1 / 拖动：鼠标滚轮、触控板双指、手机双指、按钮都行。
 *   - 左右切换同一组的图（← →），Esc 关。
 *   - 「看」= 拖动看图；「评论」= 点一下放一个编号的钉，拖一下框一块，然后写意见（层 · 张号 · 退回标签 · @ 谁）。
 *   - 钉和框按图的比例存（0–1），缩放以后还在原处。侧边列出这张图所有的钉，点一下跳过去；能回复、解决、隐藏已解决的。
 *   - 两版对比：并排，或者滑块左右对比。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/Button";
import { MemberLink, SelectField, Tag, TextField } from "@/components/app/bits";
import { isReviewer } from "@/domain/commands/core";
import { Joined, U, useI18n } from "@/i18n/I18n";
import type { FileRow, Id, PinRow } from "@/domain/model";
import { compareCandidates, fileKind, fileWhereP, members, memberById, pinsOf } from "@/domain/queries";
import { RETURN_TAGS } from "@/domain/rules";
import { useFiles, useFileUrl } from "@/lib/files/FilesProvider";
import { useGuild } from "@/lib/store";
import { FileFacts, FileImage, MissingPlaceholder, SaveFileButton } from "./tiles";
import { SheetStage } from "./SheetView";

const MIN_SCALE = 0.05;
const MAX_SCALE = 16;

interface View {
  s: number;
  tx: number;
  ty: number;
}

export type Draft = { kind: "point"; x: number; y: number } | { kind: "box"; x: number; y: number; w: number; h: number } | { kind: "cell"; sheet: string; ref: string };

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export interface ViewerProps {
  files: FileRow[];
  startId: Id;
  onClose: () => void;
  /** 审核时打开的：钉的意见算「审核退回时加的」（进交的人的「等我处理」）。 */
  forReview?: boolean;
  /** 一打开就跳到这个钉。 */
  focusPinId?: Id | null;
}

export function Viewer({ files, startId, onClose, forReview = false, focusPinId = null }: ViewerProps) {
  const { world } = useGuild();
  const { L, f, ph } = useI18n();
  const images = files.filter((f) => !f.archivedAt);
  const [index, setIndex] = useState(() => Math.max(0, images.findIndex((f) => f.id === startId)));
  const file = images[index] ?? images[0];
  const [panel, setPanel] = useState<"pins" | "info">("pins");
  const [compareId, setCompareId] = useState<Id | null>(null);
  const [compareMode, setCompareMode] = useState<"side" | "slider">("side");
  const live = file ? world.files[file.id] ?? file : null;

  const go = useCallback(
    (d: number) => {
      if (images.length < 2) return;
      setIndex((i) => (i + d + images.length) % images.length);
      setCompareId(null);
    },
    [images.length]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  if (!live) return null;
  const isImage = fileKind(live) === "image";
  const candidates = isImage ? compareCandidates(world, live.id) : [];
  const other = compareId ? world.files[compareId] : null;

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={f(L.viewer.dialog, { name: live.name })} data-testid="viewer">
      <header className="viewer-bar">
        <div className="viewer-title">
          <span className="t-body-14m break" data-uc="">
            {live.name}
          </span>
          <span className="label">
            {ph(fileWhereP(world, live))}
            {images.length > 1 ? ` · ${f(L.viewer.position, { i: index + 1, n: images.length })}` : ""}
          </span>
        </div>
        <div className="viewer-actions">
          {images.length > 1 ? (
            <>
              <button type="button" className="viewer-btn" onClick={() => go(-1)} aria-label={L.viewer.prev} data-testid="viewer-prev">
                ←
              </button>
              <button type="button" className="viewer-btn" onClick={() => go(1)} aria-label={L.viewer.next} data-testid="viewer-next">
                →
              </button>
            </>
          ) : null}
          {isImage && candidates.length ? (
            <button type="button" className="viewer-btn" aria-pressed={!!compareId} onClick={() => setCompareId(compareId ? null : candidates[0].id)} data-testid="viewer-compare">
              {compareId ? L.viewer.noCompare : L.viewer.compare}
            </button>
          ) : null}
          <button type="button" className="viewer-btn" aria-pressed={panel === "info"} onClick={() => setPanel(panel === "info" ? "pins" : "info")} data-testid="viewer-info">
            {L.viewer.info}
          </button>
          <button type="button" className="viewer-btn" onClick={onClose} aria-label={L.viewer.close} data-testid="viewer-close">
            ✕
          </button>
        </div>
      </header>
      {other && isImage ? (
        <Compare left={other} right={live} mode={compareMode} setMode={setCompareMode} candidates={candidates} setCompareId={setCompareId} />
      ) : fileKind(live) === "sheet" ? (
        <SheetStage key={live.id} file={live} forReview={forReview} panel={panel} focusPinId={focusPinId} />
      ) : isImage ? (
        <ImageStage key={live.id} file={live} forReview={forReview} panel={panel} focusPinId={focusPinId} />
      ) : (
        <div className="viewer-body">
          <div className="viewer-stage viewer-stage-file">
            <div className="file-card-big">
              <span className="file-ext">{live.name.split(".").pop()?.toUpperCase()}</span>
              <FileFacts file={live} />
              <SaveFileButton file={live} style="Accent" />
            </div>
          </div>
        </div>
      )}
      {images.length > 1 ? (
        <nav className="viewer-strip" aria-label={L.viewer.strip} data-testid="viewer-strip">
          <button type="button" className="viewer-btn viewer-strip-arrow" onClick={() => go(-1)} aria-label={L.viewer.prev}>
            ←
          </button>
          <div className="viewer-strip-list">
            {images.map((x, i) => (
              <StripThumb key={x.id} file={x} current={i === index} onPick={() => { setIndex(i); setCompareId(null); }} />
            ))}
          </div>
          <button type="button" className="viewer-btn viewer-strip-arrow" onClick={() => go(1)} aria-label={L.viewer.next}>
            →
          </button>
        </nav>
      ) : null}
    </div>
  );
}

/** 底部缩略图条的一格：图片是小图，别的写类型字（CLIP · CSV · PDF…）。当前的高亮。 */
function StripThumb({ file, current, onPick }: { file: FileRow; current: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const image = fileKind(file) === "image";
  useEffect(() => {
    // 只横着滚缩略图条本身（不动外面的页面）。
    const el = ref.current;
    const list = el?.parentElement;
    if (!current || !el || !list) return;
    const l = el.offsetLeft - list.offsetLeft;
    if (l < list.scrollLeft) list.scrollLeft = l;
    else if (l + el.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = l + el.offsetWidth - list.clientWidth;
  }, [current]);
  return (
    <button ref={ref} type="button" className="viewer-strip-item" aria-current={current ? "true" : undefined} onClick={onPick} title={file.name} data-testid="viewer-strip-item">
      {image ? <FileImage file={file} className="viewer-strip-img" alt={file.name} /> : <span className="viewer-strip-ext">{(file.name.split(".").pop() ?? "").toUpperCase().slice(0, 5)}</span>}
    </button>
  );
}

/** 一张图 + 钉 + 侧边。 */
function ImageStage({ file, forReview, panel, focusPinId }: { file: FileRow; forReview: boolean; panel: "pins" | "info"; focusPinId: Id | null }) {
  const { world, me, now } = useGuild();
  const { L, f } = useI18n();
  const { present, ready } = useFiles();
  const url = useFileUrl(file.sha256);
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [fitted, setFitted] = useState(false);
  const [mode, setMode] = useState<"look" | "pin">("look");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [hideResolved, setHideResolved] = useState(false);
  const [activePin, setActivePin] = useState<Id | null>(focusPinId);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pan" | "pin" | "pinch"; startX: number; startY: number; view: View; dist?: number; mid?: { x: number; y: number }; moved: boolean } | null>(null);
  const W = file.width ?? 1000;
  const H = file.height ?? 1000;
  const here = present.has(file.sha256);
  const pins = pinsOf(world, file.id);
  const shownPins = pins.filter((p) => !(hideResolved && p.status === "resolved"));

  const fit = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = clamp(Math.min((r.width - 24) / W, (r.height - 24) / H), MIN_SCALE, MAX_SCALE);
    setView({ s, tx: (r.width - W * s) / 2, ty: (r.height - H * s) / 2 });
    setFitted(true);
  }, [W, H]);

  useEffect(() => {
    fit();
    const el = stage.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    setView((v) => {
      const s = clamp(v.s * factor, MIN_SCALE, MAX_SCALE);
      const k = s / v.s;
      return { s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
    });
  }, []);

  // 滚轮 / 触控板双指（ctrlKey）放大缩小：要 passive: false 才能挡住页面缩放。
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /** 屏幕上的点 → 图上的比例。 */
  const toRatio = (clientX: number, clientY: number) => {
    const r = stage.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.tx) / (v.s * W), y: (clientY - r.top - v.ty) / (v.s * H) };
  };

  const jumpTo = (p: PinRow) => {
    setActivePin(p.id);
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setView((v) => {
      const s = Math.max(v.s, Math.min(1, (Math.min(r.width, r.height) * 0.9) / Math.max(W, H)) * 1.6);
      const cx = (p.x + (p.w ?? 0) / 2) * W;
      const cy = (p.y + (p.h ?? 0) / 2) * H;
      return { s, tx: r.width / 2 - cx * s, ty: r.height / 2 - cy * s };
    });
  };

  useEffect(() => {
    if (!focusPinId || !fitted) return;
    const p = pins.find((x) => x.id === focusPinId);
    if (p) jumpTo(p);
    // 只在打开时跳一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitted]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-pin]")) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      const r = stage.current!.getBoundingClientRect();
      gesture.current = { kind: "pinch", startX: 0, startY: 0, view: viewRef.current, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, moved: true };
      setDrag(null);
      return;
    }
    gesture.current = { kind: mode === "pin" ? "pin" : "pan", startX: e.clientX, startY: e.clientY, view: viewRef.current, moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch" && pointers.current.size >= 2 && g.dist && g.mid) {
      const [a, b] = Array.from(pointers.current.values());
      const r = stage.current!.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      const s = clamp(g.view.s * (dist / g.dist), MIN_SCALE, MAX_SCALE);
      const k = s / g.view.s;
      setView({ s, tx: mid.x - (g.mid.x - g.view.tx) * k, ty: mid.y - (g.mid.y - g.view.ty) * k });
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) > 5) g.moved = true;
    if (!g.moved) return;
    if (g.kind === "pan") setView({ ...g.view, tx: g.view.tx + dx, ty: g.view.ty + dy });
    else if (g.kind === "pin") setDrag({ x0: g.startX, y0: g.startY, x1: e.clientX, y1: e.clientY });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (!g || g.kind !== "pin") {
      setDrag(null);
      return;
    }
    if (!g.moved) {
      const p = toRatio(e.clientX, e.clientY);
      if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) setDraft({ kind: "point", x: p.x, y: p.y });
    } else {
      const a = toRatio(g.startX, g.startY);
      const b = toRatio(e.clientX, e.clientY);
      const x = clamp(Math.min(a.x, b.x), 0, 1);
      const y = clamp(Math.min(a.y, b.y), 0, 1);
      const w = clamp(Math.max(a.x, b.x), 0, 1) - x;
      const h = clamp(Math.max(a.y, b.y), 0, 1) - y;
      if (w > 0.005 && h > 0.005) setDraft({ kind: "box", x, y, w, h });
    }
    setDrag(null);
  };

  const screen = (x: number, y: number) => ({ left: view.tx + x * W * view.s, top: view.ty + y * H * view.s });
  const pct = Math.round(view.s * 100);

  return (
    <div className="viewer-body">
      <div className="viewer-main">
        <div className="viewer-tools" role="toolbar" aria-label={L.viewer.tools}>
          <div className="chips" role="radiogroup" aria-label={L.viewer.clickDoes}>
            <button type="button" className="ui-chip" aria-pressed={mode === "look"} onClick={() => setMode("look")} data-testid="viewer-mode-look">
              {L.viewer.look}
            </button>
            <button type="button" className="ui-chip" aria-pressed={mode === "pin"} onClick={() => setMode("pin")} data-testid="viewer-mode-pin">
              {L.viewer.comment}
            </button>
          </div>
          <div className="row">
            <button type="button" className="viewer-btn" onClick={() => zoomAt(1 / 1.25)} aria-label={L.viewer.zoomOut} data-testid="viewer-zoom-out">
              −
            </button>
            <span className="num label viewer-zoom" data-testid="viewer-zoom">
              {pct}%
            </span>
            <button type="button" className="viewer-btn" onClick={() => zoomAt(1.25)} aria-label={L.viewer.zoomIn} data-testid="viewer-zoom-in">
              +
            </button>
            <button type="button" className="viewer-btn" onClick={fit} data-testid="viewer-fit">
              {L.viewer.fit}
            </button>
            <button type="button" className="viewer-btn" onClick={() => zoomAt(1 / view.s)}>
              1:1
            </button>
          </div>
        </div>
        <div
          ref={stage}
          className="viewer-stage"
          data-mode={mode}
          data-testid="viewer-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {here && url ? (
            <img
              className="viewer-img"
              src={url}
              alt={file.name}
              draggable={false}
              data-testid="viewer-img"
              style={{ width: W, height: H, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})` }}
            />
          ) : ready && !here ? (
            <MissingPlaceholder />
          ) : null}
          {here
            ? shownPins.map((p) => {
                const pos = screen(p.x, p.y);
                const box = p.kind === "box" ? { width: (p.w ?? 0) * W * view.s, height: (p.h ?? 0) * H * view.s } : null;
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-pin={p.kind}
                    data-status={p.status}
                    data-active={activePin === p.id ? "yes" : "no"}
                    className={p.kind === "box" ? "pin-box" : "pin-dot"}
                    style={box ? { ...pos, ...box } : pos}
                    aria-label={f(L.viewer.pinLabel, { n: p.number, text: p.text })}
                    onClick={() => setActivePin(p.id)}
                    data-testid="pin-mark"
                  >
                    <span className="pin-num">{p.number}</span>
                  </button>
                );
              })
            : null}
          {draft ? (
            draft.kind === "point" ? (
              <span className="pin-dot" data-pin="draft" style={screen(draft.x, draft.y)}>
                <span className="pin-num">+</span>
              </span>
            ) : draft.kind === "box" ? (
              <span className="pin-box" data-pin="draft" style={{ ...screen(draft.x, draft.y), width: draft.w * W * view.s, height: draft.h * H * view.s }} />
            ) : null
          ) : null}
          {drag ? (
            <span
              className="pin-box"
              data-pin="dragging"
              style={(() => {
                const r = stage.current!.getBoundingClientRect();
                return { left: Math.min(drag.x0, drag.x1) - r.left, top: Math.min(drag.y0, drag.y1) - r.top, width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) };
              })()}
            />
          ) : null}
        </div>
      </div>
      <aside className="viewer-side" aria-label={panel === "info" ? L.viewer.sideInfo : L.viewer.sidePins}>
        {panel === "info" ? (
          <div className="stack" data-gap="small">
            <h2 className="t-heading-18">{L.viewer.sideInfo}</h2>
            <FileFacts file={file} />
            <SaveFileButton file={file} />
          </div>
        ) : (
          <div className="stack" data-gap="small">
            {draft ? (
              <PinForm
                file={file}
                draft={draft}
                forReview={forReview && isReviewer(me)}
                onDone={(pinId) => {
                  setDraft(null);
                  if (pinId) setActivePin(pinId);
                  // 手机上写意见时页面滚到了下面：钉好以后滚回图，接着钉下一个。
                  const body = stage.current?.closest<HTMLElement>(".viewer-body");
                  if (body && body.scrollHeight > body.clientHeight + 1 && getComputedStyle(body).overflowY !== "visible") body.scrollTop = 0;
                }}
              />
            ) : (
              <p className="label">{mode === "pin" ? L.viewer.pinHintOn : L.viewer.pinHintOff}</p>
            )}
            <h2 className="t-heading-18">
              {L.viewer.notes} <span className="count">{pins.length}</span>
            </h2>
            <div className="row viewer-side-tools">
              {here ? (
                <Button
                  Label={L.viewer.addPin2}
                  Size="Small"
                  Style={mode === "pin" ? "Primary" : "Accent"}
                  onClick={() => {
                    setMode("pin");
                    setDraft(null);
                  }}
                  data-testid="viewer-add-pin"
                />
              ) : null}
              <label className="check-row label">
                <input type="checkbox" checked={hideResolved} onChange={(e) => setHideResolved(e.target.checked)} data-testid="pins-hide-resolved" />
                {f(L.viewer.hideResolvedN, { n: pins.filter((p) => p.status === "resolved").length })}
              </label>
            </div>
            {shownPins.length === 0 ? <p className="label">{L.viewer.noNotes}</p> : null}
            <ol className="pin-list" data-testid="pin-list">
              {shownPins.map((p) => (
                <PinItem key={p.id} pin={p} active={activePin === p.id} onJump={() => jumpTo(p)} now={now} />
              ))}
            </ol>
          </div>
        )}
      </aside>
    </div>
  );
}

export function PinForm({ file, draft, forReview, onDone }: { file: FileRow; draft: Draft; forReview: boolean; onDone: (pinId: Id | null) => void }) {
  const { world, me, dispatch, notify } = useGuild();
  const { L, f, err, say, tag: tagText } = useI18n();
  const [text, setText] = useState("");
  const [layer, setLayer] = useState("");
  const [sheets, setSheets] = useState("");
  const [tag, setTag] = useState("");
  const [mentions, setMentions] = useState<Id[]>([]);
  const [error, setError] = useState<string | null>(null);
  const people = members(world).filter((m) => m.id !== me.id);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), [draft]);
  const add = () => {
    const common = { fileId: file.id, text, layer: layer || null, sheets: sheets || null, tag: tag || null, mentions, forReview };
    const r = dispatch("pin.add", draft.kind === "cell" ? { ...common, cell: { sheet: draft.sheet, ref: draft.ref } } : { ...common, ...draft }, { quiet: true });
    if (!r.ok) {
      setError(err(r.error));
      return;
    }
    notify(say((d) => (draft.kind === "cell" ? d.viewer.cellDone : draft.kind === "box" ? d.viewer.boxDone : d.viewer.pinDone)), "Neutral");
    onDone(r.created.pinId);
  };
  return (
    <form
      className="stack pin-form"
      data-gap="small"
      data-testid="pin-form"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <span className="t-body-14m">
        {draft.kind === "cell" ? f(L.viewer.draftCell, { sheet: draft.sheet, ref: draft.ref }) : draft.kind === "box" ? L.viewer.draftBox : L.viewer.draftPin}
        {forReview ? L.viewer.reviewNote : ""}
      </span>
      <textarea ref={area} className="field-control" aria-label={L.viewer.notes} placeholder={L.viewer.notePlaceholder} value={text} onChange={(e) => setText(e.target.value)} data-testid="pin-text" />
      <div className="form-grid">
        <TextField label={L.viewer.layer} placeholder="A" value={layer} onChange={(e) => setLayer(e.target.value)} />
        <TextField label={L.viewer.sheets} placeholder={L.review.sheetsPlaceholder} value={sheets} onChange={(e) => setSheets(e.target.value)} />
        <SelectField label={L.viewer.returnTag} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">{L.viewer.none}</option>
          {RETURN_TAGS.map((t) => (
            <option key={t} value={t}>
              {tagText(t)}
            </option>
          ))}
        </SelectField>
      </div>
      {people.length ? (
        <div className="chips" role="group" aria-label={L.viewer.mention}>
          {people.map((m) => (
            <button
              key={m.id}
              type="button"
              className="ui-chip"
              aria-pressed={mentions.includes(m.id)}
              onClick={() => setMentions((xs) => (xs.includes(m.id) ? xs.filter((x) => x !== m.id) : [...xs, m.id]))}
            >
              @<U>{m.nickname}</U>
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={L.viewer.cancelPin} Size="Small" Style="Ghost" onClick={() => onDone(null)} />
        <Button Label={L.viewer.addPin} Size="Small" Style="Accent" type="submit" data-testid="pin-submit" />
      </div>
    </form>
  );
}

export function PinItem({ pin, active, onJump, now }: { pin: PinRow; active: boolean; onJump: () => void; now: string }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, r: rich, err, say, relative, tag: tagText } = useI18n();
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const meta = [pin.layer ? f(L.viewer.layerMeta, { layer: pin.layer }) : null, pin.sheets ? rich(L.viewer.sheetsMeta, { sheets: <U>{pin.sheets}</U> }) : null].filter(Boolean);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // 只在侧栏自己能滚的时候（桌面）把这一条滚到看得见；手机上侧栏跟着页面走，不去动图的位置。
    const el = ref.current;
    const side = el?.closest<HTMLElement>(".viewer-side");
    if (!active || !el || !side || side.scrollHeight <= side.clientHeight + 1 || getComputedStyle(side).overflowY === "visible") return;
    const top = el.getBoundingClientRect().top - side.getBoundingClientRect().top + side.scrollTop;
    if (top < side.scrollTop) side.scrollTop = top;
    else if (top + el.offsetHeight > side.scrollTop + side.clientHeight) side.scrollTop = top + el.offsetHeight - side.clientHeight;
  }, [active]);
  return (
    <li ref={ref} className="pin-item" data-status={pin.status} data-active={active ? "yes" : "no"} data-testid="pin-item">
      <button type="button" className="pin-item-head" onClick={onJump} data-testid="pin-jump">
        <span className="pin-num" data-status={pin.status}>
          {pin.number}
        </span>
        <span className="break" data-uc="">
          {pin.text}
        </span>
      </button>
      <div className="row">
        {pin.cell ? (
          <Tag>
            <U>{pin.cell.sheet}</U> · {pin.cell.ref}
          </Tag>
        ) : pin.kind === "box" ? (
          <Tag>{L.viewer.box}</Tag>
        ) : null}
        {meta.length ? (
          <span className="label">
            <Joined parts={meta} />
          </span>
        ) : null}
        {pin.tag ? <Tag tone="warning">{tagText(pin.tag)}</Tag> : null}
        {pin.reviewTaskId ? <Tag tone="danger">{L.viewer.review}</Tag> : null}
        {pin.status === "resolved" ? <Tag tone="success">{L.viewer.resolved}</Tag> : null}
      </div>
      <span className="label">
        <MemberLink member={memberById(world, pin.byMemberId)} /> · {relative(pin.at, now)}
        {pin.mentions.length ? (
          <>
            {" · "}
            <U>{`@${pin.mentions.map((id) => memberById(world, id)?.nickname ?? "").join(" @")}`}</U>
          </>
        ) : null}
      </span>
      {pin.replies.length ? (
        <ul className="replies">
          {pin.replies.map((r, i) => (
            <li key={i} className="stack" data-gap="small">
              <span className="break" data-uc="">
                {r.text}
              </span>
              <span className="label">
                <MemberLink member={memberById(world, r.byMemberId)} /> · {relative(r.at, now)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {active ? (
        <form
          className="stack"
          data-gap="small"
          onSubmit={(e) => {
            e.preventDefault();
            const r = dispatch("pin.reply", { pinId: pin.id, text: reply }, { quiet: true });
            if (!r.ok) setError(err(r.error));
            else {
              setReply("");
              setError(null);
            }
          }}
        >
          <textarea className="field-control" aria-label={L.viewer.reply} placeholder={L.viewer.replyPlaceholder} value={reply} onChange={(e) => setReply(e.target.value)} rows={2} data-testid="pin-reply" />
          {error ? <p className="error-text">{error}</p> : null}
          <div className="form-actions">
            <Button Label={L.viewer.reply} Size="Small" Style="Secondary" type="submit" data-testid="pin-reply-send" />
            {pin.status === "open" ? (
              <Button
                Label={L.viewer.resolve}
                Size="Small"
                Style="Ghost"
                data-testid="pin-resolve"
                onClick={() => {
                  const r = dispatch("pin.resolve", { pinId: pin.id }, { quiet: true });
                  if (!r.ok) setError(err(r.error));
                  else notify(say((d) => d.viewer.resolvedToast, { n: pin.number }), "Neutral");
                }}
              />
            ) : (
              <Button
                Label={L.viewer.reopen}
                Size="Small"
                Style="Ghost"
                onClick={() => {
                  const r = dispatch("pin.reopen", { pinId: pin.id }, { quiet: true });
                  if (!r.ok) setError(err(r.error));
                }}
              />
            )}
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** 两版对比：并排，或者滑块。 */
function Compare({ left, right, mode, setMode, candidates, setCompareId }: { left: FileRow; right: FileRow; mode: "side" | "slider"; setMode: (m: "side" | "slider") => void; candidates: FileRow[]; setCompareId: (id: Id | null) => void }) {
  const [pos, setPos] = useState(50);
  const { L } = useI18n();
  const leftUrl = useFileUrl(left.sha256);
  const rightUrl = useFileUrl(right.sha256);
  const area = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const setFrom = (clientX: number) => {
    const r = area.current?.getBoundingClientRect();
    if (!r) return;
    setPos(clamp(((clientX - r.left) / r.width) * 100, 0, 100));
  };
  const ratio = useMemo(() => `${right.width ?? 4} / ${right.height ?? 3}`, [right.width, right.height]);
  return (
    <div className="viewer-body viewer-compare" data-testid="viewer-compare-view">
      <div className="viewer-tools">
        <div className="chips" role="radiogroup" aria-label={L.viewer.howCompare}>
          <button type="button" className="ui-chip" aria-pressed={mode === "side"} onClick={() => setMode("side")} data-testid="compare-side">
            {L.viewer.side}
          </button>
          <button type="button" className="ui-chip" aria-pressed={mode === "slider"} onClick={() => setMode("slider")} data-testid="compare-slider">
            {L.viewer.slider}
          </button>
        </div>
        <SelectField label={L.viewer.compareWith} value={left.id} onChange={(e) => setCompareId(e.target.value)}>
          {candidates.map((c) => (
            <option key={c.id} value={c.id} data-uc="">
              {c.name}
            </option>
          ))}
        </SelectField>
      </div>
      {mode === "side" ? (
        <div className="compare-side">
          {[left, right].map((f, i) => (
            <figure key={f.id} className="compare-pane">
              {(i === 0 ? leftUrl : rightUrl) ? <img src={(i === 0 ? leftUrl : rightUrl)!} alt={f.name} draggable={false} /> : <MissingPlaceholder compact />}
              <figcaption className="label break" data-uc="">
                {f.name}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="compare-slider-wrap">
          <div
            ref={area}
            className="compare-slider"
            style={{ aspectRatio: ratio }}
            data-testid="compare-slider-area"
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setFrom(e.clientX);
            }}
            onPointerMove={(e) => dragging.current && setFrom(e.clientX)}
            onPointerUp={() => (dragging.current = false)}
          >
            {rightUrl ? <img src={rightUrl} alt={right.name} draggable={false} /> : null}
            <div className="compare-slider-left" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
              {leftUrl ? <img src={leftUrl} alt={left.name} draggable={false} /> : null}
            </div>
            <span className="compare-slider-handle" style={{ left: `${pos}%` }} aria-hidden="true" />
          </div>
          <input type="range" min={0} max={100} value={Math.round(pos)} onChange={(e) => setPos(Number(e.target.value))} aria-label={L.viewer.sliderPos} data-testid="compare-range" />
          <div className="row" data-justify="between">
            <span className="label break">
              ← <U>{left.name}</U>
            </span>
            <span className="label break">
              <U>{right.name}</U> →
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
