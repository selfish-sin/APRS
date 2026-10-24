/**
 * 盘点和「以图为主」的小零件（设计组 v7-11）：AuditBadge（字 + 颜色 + 图形）· Thumb（缩略图 / 占位）· WallTile（墙上一格）· NameSegs（文件名切开）。
 * 颜色只用 tokens.css 里的变量（app.css 的 .audit-* 一节）。
 */
import type { ReactNode } from "react";
import type { AuditEntry } from "@/domain/audit/check";
import type { DeliveryMark, ThumbRef, WallCell } from "@/domain/audit/deliveries";
import type { AuditThumb } from "@/domain/model";
import { useI18n } from "@/i18n/I18n";
import { useFileUrl } from "@/lib/files/FilesProvider";

/** 五种状态的图形：✓ · 眼睛 · 文件 · 三角 · 斜线。 */
export function MarkIcon({ mark, size = 12 }: { mark: DeliveryMark; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": true as const, className: "audit-mark-icon" };
  switch (mark) {
    case "verified":
      return (
        <svg {...common}>
          <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "pending":
      return (
        <svg {...common}>
          <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="8" cy="8" r="2.2" fill="currentColor" />
        </svg>
      );
    case "nofile":
      return (
        <svg {...common}>
          <path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M9 2v3.3h3.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case "issue":
      return (
        <svg {...common}>
          <path d="M8 1.8L15 14H1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8 6v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="12" r="1" fill="currentColor" />
        </svg>
      );
    case "missing":
      return (
        <svg {...common}>
          <path d="M3 13L13 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
  }
}

/** 格子右上角的状态小标：字 + 颜色 + 图形；compact = 只有图形（小格子）。 */
export function AuditBadge({ mark, compact = false, children }: { mark: DeliveryMark; compact?: boolean; children?: ReactNode }) {
  const { L } = useI18n();
  return (
    <span className="audit-badge" data-mark={mark} data-compact={compact ? "yes" : undefined} title={compact ? L.audit.mark[mark] : undefined} aria-label={compact ? L.audit.mark[mark] : undefined} data-testid="audit-badge">
      <MarkIcon mark={mark} />
      {compact ? null : <span>{children ?? L.audit.mark[mark]}</span>}
    </span>
  );
}

/** 斜线底（「缺」= 整格斜线）：画在 SVG 里，不用渐变。 */
export function Hatch() {
  return (
    <svg className="audit-hatch" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
      {Array.from({ length: 14 }, (_, i) => (
        <path key={i} d={`M${i * 14 - 100} 100 L${i * 14} 0`} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/** 文件类型的小图标（只有名字的 · 没有图的）。 */
export function FileGlyph() {
  return (
    <svg className="audit-file-glyph" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 2v3.3h3.3" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/** 缩略图：文件仓里有就显示；没有（或者只有名字）就是占位。 */
export function Thumb({ thumb, alt, caption, className }: { thumb: Pick<ThumbRef, "sha256"> | Pick<AuditThumb, "sha256"> | null; alt: string; caption?: ReactNode; className?: string }) {
  const { L } = useI18n();
  const url = useFileUrl(thumb?.sha256 ?? null);
  return (
    <span className={`audit-thumb ${className ?? ""}`} data-has={url ? "yes" : "no"}>
      {url ? (
        <img src={url} alt={alt} draggable={false} />
      ) : (
        <span className="audit-thumb-none">
          <FileGlyph />
          <span className="label">{caption ?? (thumb ? L.audit.notOnDevice : L.audit.nameOnly)}</span>
        </span>
      )}
    </span>
  );
}

export type WallSize = "s" | "m" | "l";

/** 交付物墙的一格（一卡 × 一环节；几层的卡显示 A 层的图，标「A · B」，旁边每层一个小点）。 */
export function WallTile({ cell, size, onOpen, label, testId = "wall-cell" }: { cell: WallCell; size: WallSize; onOpen?: () => void; label: string; testId?: string }) {
  const { L, f } = useI18n();
  const shown = cell.shown;
  const mark = cell.mark;
  const version = shown?.version != null ? `v${String(shown.version).padStart(2, "0")}${shown.note ?? ""}` : null;
  const layers = cell.layers.filter((l) => l.layer);
  const body =
    mark === "missing" && !shown?.thumb ? (
      <span className="audit-tile-empty">
        <Hatch />
        {size === "s" ? null : <span className="t-body-14m">{L.audit.mark.missing}</span>}
      </span>
    ) : mark === "nofile" && !shown?.thumb ? (
      <span className="audit-tile-empty">
        <FileGlyph />
        {size === "s" ? null : <span className="label">{L.audit.noFileFound}</span>}
      </span>
    ) : (
      <Thumb thumb={shown?.thumb ?? null} alt={label} caption={size === "s" ? "" : undefined} />
    );
  return (
    <button
      type="button"
      className="audit-tile"
      data-mark={mark}
      data-size={size}
      onClick={onOpen}
      aria-label={`${label} · ${L.audit.mark[mark]}${version ? ` · ${version}` : ""}`}
      data-testid={testId}
      data-stage={cell.stage.templateKey}
      data-cut={cell.cut?.number ?? ""}
    >
      {body}
      <AuditBadge mark={mark} compact={size === "s"} />
      {version && size !== "s" ? <span className="audit-tile-version num">{version}</span> : null}
      {layers.length > 1 ? (
        <span className="audit-tile-layers" aria-label={f(L.audit.layerDots, { list: layers.map((l) => `${l.layer} ${L.audit.mark[l.mark]}`).join(" · ") })}>
          {size !== "s" ? <span className="num">{layers.map((l) => l.layer).join(" · ")}</span> : null}
          {layers.map((l) => (
            <span key={l.task.id} className="audit-dot" data-mark={l.mark} />
          ))}
        </span>
      ) : null}
    </button>
  );
}

/** 文件名切开显示：项目 / 集 / 场 / 卡 / 层 / 流程 / 版本，有问题的那一段标出来；版本后面带的字是「备注」。 */
export function NameSegs({ entry, codeStage }: { entry: AuditEntry; codeStage?: string | null }) {
  const { L, f } = useI18n();
  const parts = entry.parsed.parts;
  return (
    <span className="audit-segs" data-testid="name-segs">
      {parts.map((p, i) => {
        const versionNote = p.as === "version" && entry.parsed.note && i === parts.findIndex((x) => x.as === "version");
        const vm = versionNote ? p.text.match(/^([vV]\d+)(.+)$/) : null;
        const label = p.as === "code" && codeStage ? f(L.audit.codeTo, { stage: codeStage }) : L.audit.part[p.as];
        const seg = (
          <span key={i} className="audit-seg" data-bad={p.bad ? "yes" : undefined} data-as={p.as}>
            <span className="audit-seg-text num" data-uc="">
              {vm ? vm[1] : p.text}
            </span>
            <span className="label">{label}</span>
          </span>
        );
        if (!vm) return seg;
        return [
          seg,
          <span key={`${i}-note`} className="audit-seg" data-as="note">
            <span className="audit-seg-text" data-uc="">
              {vm[2]}
            </span>
            <span className="label">{L.audit.part.note}</span>
          </span>,
        ];
      })}
    </span>
  );
}
