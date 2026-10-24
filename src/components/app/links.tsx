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
  if (!n.ok) return { state: "error" as const, message: LINK_REASON[n.reason].zh };
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
  const set = (i: number, patch: Partial<LinkDraft>) => onChange(value.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <div className="stack" data-gap="small" data-testid="links-editor">
      <span className="label">链接（一版可以挂几条：飞书、腾讯文档、Google、Dropbox、Discord……）</span>
      {value.map((d, i) => {
        const c = checkDraft(d, value, i);
        return (
          <div key={i} className="link-row" data-testid={`link-row-${i}`}>
            <div className="link-row-main">
              <TextField
                label={`第 ${i + 1} 条`}
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={d.url}
                onChange={(e) => set(i, { url: e.target.value })}
                data-testid={`link-url-${i}`}
                error={c.state === "error" ? c.message : c.state === "ok" && c.dup ? `和第 ${c.dup} 条是同一个链接` : undefined}
              />
              {c.state === "ok" ? (
                <div className="row" data-testid={`link-info-${i}`}>
                  <PlatformBadge platform={c.info.platform} label={c.info.platformLabel.zh} />
                  <span className="label">{c.info.platform === "other" ? "网址" : c.info.typeLabel.zh}</span>
                </div>
              ) : null}
              {c.state === "ok"
                ? c.hints.map((h) => (
                    <p key={h.kind} className="link-hint" data-kind={h.kind} data-testid={`link-hint-${i}`}>
                      {h.text.zh}
                    </p>
                  ))
                : null}
            </div>
            <div className="link-row-side">
              <TextField label="名字" placeholder={c.state === "ok" ? defaultLinkName(c.info) : "不写就用平台的名字"} value={d.name} onChange={(e) => set(i, { name: e.target.value })} data-testid={`link-name-${i}`} />
              <SelectField label="是什么" value={d.kind} onChange={(e) => set(i, { kind: e.target.value as LinkKind | "" })} data-testid={`link-kind-${i}`}>
                <option value="">{c.state === "ok" ? `照链接认（${LINK_KIND_LABEL[c.info.kind].zh}）` : "照链接认"}</option>
                {LINK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LINK_KIND_LABEL[k].zh}
                  </option>
                ))}
              </SelectField>
              {value.length > 1 ? <Button Label="去掉" Size="Small" Style="Ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} /> : null}
            </div>
          </div>
        );
      })}
      <div className="form-actions">
        <Button Label="再加一条链接" Size="Small" Style="Secondary" onClick={() => onChange([...value, emptyLink()])} data-testid="link-add" disabled={value.length >= 10} />
      </div>
      <p className="label">浏览器替你打不开别家的网站去检查，所以审核员点开以后打不开会标出来，你在「等我处理」里看到，换一条就好。</p>
    </div>
  );
}

/** 一版挂的链接：点了在新标签页打开；审核员能标「打不开」；交的人能换一条。 */
export function LinkList({ submission, compact = false }: { submission: SubmissionRow; compact?: boolean }) {
  const { world, me, dispatch, notify } = useGuild();
  const links = submissionLinks(submission);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!links.length) return compact ? null : <span className="muted">没贴链接</span>;
  const task = world.tasks[submission.taskId];
  const mine = submission.byMemberId === me.id || (!submission.byMemberId && task?.assigneeId === me.id);
  const canReplace = mine || isAdmin(me);
  return (
    <ul className="link-list" data-testid="link-list">
      {links.map((l) => {
        const info = recognizeLink(l.url);
        return (
          <li key={l.id} data-broken={l.broken ? "yes" : "no"} data-testid="link-item">
            <div className="row">
              <PlatformBadge platform={info.platform} label={info.platformLabel.zh} />
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="break" data-testid="link-open">
                {l.name}
              </a>
              <span className="label">{LINK_KIND_LABEL[l.kind].zh}</span>
              {info.expires ? <span className="link-flag" data-kind="expires">会过期</span> : null}
              {l.broken ? (
                <span className="link-flag" data-kind="broken" data-testid="link-broken" title={`${memberById(world, l.broken.byMemberId)?.nickname ?? "审核员"} 标的`}>
                  打不开
                </span>
              ) : null}
              {!compact && isReviewer(me) && !l.broken && !mine ? (
                <button
                  type="button"
                  className="inline-link label"
                  data-testid="link-mark-broken"
                  onClick={() => {
                    const r = dispatch("link.mark_broken", { submissionId: submission.id, linkId: l.id }, { quiet: true });
                    if (r.ok) notify(`标了「${l.name}」打不开，交的人会在「等我处理」里看到`, "Neutral");
                  }}
                >
                  标「打不开」
                </button>
              ) : null}
              {canReplace && (l.broken || !compact) && replacing !== l.id ? (
                <button type="button" className="inline-link label" data-testid="link-replace-open" onClick={() => { setReplacing(l.id); setUrl(""); setError(null); }}>
                  换一条
                </button>
              ) : null}
            </div>
            {replacing === l.id ? (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const r = dispatch("link.replace", { submissionId: submission.id, linkId: l.id, url }, { quiet: true });
                  if (!r.ok) setError(r.error.message);
                  else {
                    setReplacing(null);
                    notify("换好了", "Neutral");
                  }
                }}
              >
                <TextField label="新的链接" type="url" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="link-replace-url" error={error ?? undefined} />
                <Button Label="换" Size="Small" Style="Accent" type="submit" data-testid="link-replace-go" />
                <Button Label="算了" Size="Small" Style="Ghost" onClick={() => setReplacing(null)} />
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
