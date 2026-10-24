/** 页面里常用的小件：头像、表单字段、经验条、空状态、标签、状态胶囊。 */
import { useId, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { U, useI18n } from "@/i18n/I18n";
import { Avatar, type AvatarSize } from "@/components/ui/Avatar";
import type { AvatarTone } from "@/components/ui/avatarTone";
import type { MemberRow } from "@/domain/model";
import { formatPoints } from "@/domain/labels";
import type { LevelInfo } from "@/domain/rules";
import { Link } from "@/lib/router";

export function toneOf(member: Pick<MemberRow, "tone"> | null | undefined): AvatarTone {
  if (!member) return "Neutral";
  return (member.tone.charAt(0).toUpperCase() + member.tone.slice(1)) as AvatarTone;
}

export function MemberAvatar({ member, size = "28", fallback }: { member: MemberRow | null | undefined; size?: AvatarSize; fallback?: string }) {
  const name = member?.nickname ?? fallback ?? "?";
  return <Avatar Initials={name} Tone={toneOf(member)} Size={size} title={member ? member.nickname : fallback} aria-label={name} data-uc="" />;
}

/** 成员的名字（点进成员页）。 */
export function MemberLink({ member, fallback }: { member: MemberRow | null | undefined; fallback?: string }) {
  const { L } = useI18n();
  if (!member) return <span className="muted">{fallback ?? L.common.nobody}</span>;
  return (
    <Link to={`/member/${member.id}`}>
      <U>{member.nickname}</U>
    </Link>
  );
}

type FieldShell = { label: ReactNode; hint?: ReactNode; error?: ReactNode; className?: string };

export function TextField({ label, hint, error, className, ...props }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={`field ${className ?? ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="field-control" aria-invalid={error ? true : undefined} {...props} />
      {error ? <span className="error-text">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function TextArea({ label, hint, error, className, ...props }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className={`field ${className ?? ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className="field-control" aria-invalid={error ? true : undefined} {...props} />
      {error ? <span className="error-text">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function SelectField({ label, hint, error, className, children, ...props }: FieldShell & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const id = useId();
  return (
    <div className={`field ${className ?? ""}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="field-control" aria-invalid={error ? true : undefined} {...props}>
        {children}
      </select>
      {error ? <span className="error-text">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function XpBar({ points, level, compact = false }: { points: number; level: LevelInfo; compact?: boolean }) {
  const { L, f } = useI18n();
  return (
    <div className="xp" aria-label={f(L.common.xpAria, { points: formatPoints(points), level: level.level })}>
      <div className="xp-bar">
        <div className="xp-fill" style={{ width: `${Math.round(level.progress * 100)}%` }} />
      </div>
      {compact ? null : (
        <div className="xp-meta">
          <span className="num">{f(L.common.points, { points: formatPoints(points) })}</span>
          <span className="num">{level.next === null ? L.common.maxLevel : f(L.common.nextLevel, { next: level.next })}</span>
        </div>
      )}
    </div>
  );
}

export function Level({ level }: { level: number }) {
  return (
    <span className="level">
      <span className="level-lv">Lv</span>
      <span className="level-n">{level}</span>
    </span>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Tag({ children, tone }: { children: ReactNode; tone?: "danger" | "warning" | "success" | "info" | "inverse" | "lilac" | "sky" }) {
  return (
    <span className="tag" data-tone={tone}>
      {children}
    </span>
  );
}

export function Stat({ label, value, zh = false, testId }: { label: string; value: ReactNode; zh?: boolean; testId?: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="stat-value" data-text={zh ? "zh" : undefined} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

/** 复制到剪贴板（有的地方不让复制，就提示一下）。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到下面 */
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  } catch {
    return false;
  }
}
