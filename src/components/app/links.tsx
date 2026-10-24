/**
 * 交成果时挂的链接（SPEC §15.1）：交一版时编辑几条链接（马上认平台、提示会过期 / 要权限 / 类型对不上 / 重复）·
 * 列出一版的链接（点了在新标签页打开）· 审核员标「打不开」· 交的人换一条。
 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { isReviewer, isAdmin } from "@/domain/commands/core";
import { LINK_KINDS, LINK_KIND_LABEL, LINK_REASON, defaultLinkName, linkHints, linkKey, normalizeLink, recognizeLink, type LinkKind } from "@/domain/links";
import type { SubmissionRow } from "@/domain/model";
import { memberById, submissionLinks } from "@/domain/queries";
import { useGuild } from "@/lib/store";
import { SelectField, TextField } from "./bits";
import { U, useI18n } from "@/i18n/I18n";
import type { Text2 } from "@/domain/text";

export interface LinkDraft {
  url: string;
  name: string;
  kind: LinkKind | "";
}

export function emptyLink(): LinkDraft {
  return { url: "", name: "", kind: "" };
}

/** 一条草稿的检查结果（和交的时候的规则一样，只是提前说）。 */
export function checkDraft(d: LinkDraft, all: LinkDraft[], i: number) {
  if (!d.url.trim()) return { state: "empty" as const };
  const n = normalizeLink(d.url);
  if (!n.ok) return { state: "error" as const, message: LINK_REASON[n.reason] as Text2 };
  const info = recognizeLink(n.url);
  const dup = all.findIndex((x, j) => {
    if (j >= i || !x.url.trim()) return false;
    const m = normalizeLink(x.url);
    return m.ok && linkKey(m.url) === linkKey(n.url);
  });
  return { state: "ok" as const, url: n.url, info, hints: linkHints(info, d.kind || null), dup: dup >= 0 ? dup + 1 : null };
}

export function PlatformBadge({ platform, label }: { platform: string; label: string }) {
  return (
    <span className="link-badge" data-platform={platform} data-testid="link-badge">
      {label}
    </span>
  );
}

/** 交一版时编辑几条链接。 */
export function LinksEditor({ value, onChange }: { value: LinkDraft[]; onChange: (next: LinkDraft[]) => void }) {
  const { L, f, t2, lang } = useI18n();
  const set = (i: number, patch: Partial<LinkDraft>) => onChange(value.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <div className="stack" data-gap="small" data-testid="links-editor">
      <span className="label">{L.thread.linksLabel}</span>
      {value.map((d, i) => {
        const c = checkDraft(d, value, i);
        return (
          <div key={i} className="link-row" data-testid={`link-row-${i}`}>
            <div className="link-row-main">
              <TextField
                label={f(L.thread.linkN, { n: i + 1 })}
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={d.url}
                onChange={(e) => set(i, { url: e.target.value })}
                data-testid={`link-url-${i}`}
                error={c.state === "error" ? t2(c.message) : c.state === "ok" && c.dup ? f(L.thread.sameAs, { n: c.dup }) : undefined}
              />
              {c.state === "ok" ? (
                <div className="row" data-testid={`link-info-${i}`}>
                  <PlatformBadge platform={c.info.platform} label={t2(c.info.platformLabel)} />
                  <span className="label">{c.info.platform === "other" ? L.thread.web : t2(c.info.typeLabel)}</span>
                </div>
              ) : null}
              {c.state === "ok"
                ? c.hints.map((h) => (
                    <p key={h.kind} className="link-hint" data-kind={h.kind} data-testid={`link-hint-${i}`}>
                      {t2(h.text)}
                    </p>
                  ))
                : null}
            </div>
            <div className="link-row-side">
              <TextField label={L.thread.linkName} placeholder={c.state === "ok" ? defaultLinkName(c.info, lang) : L.thread.linkNamePlaceholder} value={d.name} onChange={(e) => set(i, { name: e.target.value })} data-testid={`link-name-${i}`} />
              <SelectField label={L.thread.linkKind} value={d.kind} onChange={(e) => set(i, { kind: e.target.value as LinkKind | "" })} data-testid={`link-kind-${i}`}>
                <option value="">{c.state === "ok" ? f(L.thread.byLinkKind, { kind: t2(LINK_KIND_LABEL[c.info.kind]) }) : L.thread.byLink}</option>
                {LINK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t2(LINK_KIND_LABEL[k])}
                  </option>
                ))}
              </SelectField>
              {value.length > 1 ? <Button Label={L.thread.remove} Size="Small" Style="Ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} /> : null}
            </div>
          </div>
        );
      })}
      <div className="form-actions">
        <Button Label={L.thread.addLink} Size="Small" Style="Secondary" onClick={() => onChange([...value, emptyLink()])} data-testid="link-add" disabled={value.length >= 10} />
      </div>
      <p className="label">{L.thread.linksNote}</p>
    </div>
  );
}

/** 一版挂的链接：点了在新标签页打开；审核员能标「打不开」；交的人能换一条。 */
export function LinkList({ submission, compact = false }: { submission: SubmissionRow; compact?: boolean }) {
  const { world, me, dispatch, notify } = useGuild();
  const { L, f, t2, lang, err } = useI18n();
  const links = submissionLinks(submission);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!links.length) return compact ? null : <span className="muted">{L.thread.noLinks}</span>;
  const task = world.tasks[submission.taskId];
  const mine = submission.byMemberId === me.id || (!submission.byMemberId && task?.assigneeId === me.id);
  const canReplace = mine || isAdmin(me);
  return (
    <ul className="link-list" data-testid="link-list">
      {links.map((l) => {
        const info = recognizeLink(l.url);
        // 没起名字、用的是平台的默认名字：按界面语言显示；自己起的照原样。
        const isDefault = l.name === defaultLinkName(info, "zh") || l.name === defaultLinkName(info, "en");
        return (
          <li key={l.id} data-broken={l.broken ? "yes" : "no"} data-testid="link-item">
            <div className="row">
              <PlatformBadge platform={info.platform} label={t2(info.platformLabel)} />
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="break" data-testid="link-open">
                {isDefault ? defaultLinkName(info, lang) : <U>{l.name}</U>}
              </a>
              <span className="label">{t2(LINK_KIND_LABEL[l.kind])}</span>
              {info.expires ? (
                <span className="link-flag" data-kind="expires">
                  {L.thread.expires}
                </span>
              ) : null}
              {l.broken ? (
                <span className="link-flag" data-kind="broken" data-testid="link-broken" title={f(L.thread.markedBy, { name: memberById(world, l.broken.byMemberId)?.nickname ?? L.thread.reviewer })}>
                  {L.thread.broken}
                </span>
              ) : null}
              {!compact && isReviewer(me) && !l.broken && !mine ? (
                <button
                  type="button"
                  className="inline-link label"
                  data-testid="link-mark-broken"
                  onClick={() => {
                    const r = dispatch("link.mark_broken", { submissionId: submission.id, linkId: l.id }, { quiet: true });
                    if (r.ok) notify(f(L.thread.markedBroken, { name: isDefault ? defaultLinkName(info, lang) : l.name }), "Neutral");
                  }}
                >
                  {L.thread.markBroken}
                </button>
              ) : null}
              {canReplace && (l.broken || !compact) && replacing !== l.id ? (
                <button type="button" className="inline-link label" data-testid="link-replace-open" onClick={() => { setReplacing(l.id); setUrl(""); setError(null); }}>
                  {L.thread.replace}
                </button>
              ) : null}
            </div>
            {replacing === l.id ? (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const r = dispatch("link.replace", { submissionId: submission.id, linkId: l.id, url }, { quiet: true });
                  if (!r.ok) setError(err(r.error));
                  else {
                    setReplacing(null);
                    notify(L.thread.replaced, "Neutral");
                  }
                }}
              >
                <TextField label={L.thread.newLink} type="url" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="link-replace-url" error={error ?? undefined} />
                <Button Label={L.thread.replaceGo} Size="Small" Style="Accent" type="submit" data-testid="link-replace-go" />
                <Button Label={L.thread.never} Size="Small" Style="Ghost" onClick={() => setReplacing(null)} />
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
