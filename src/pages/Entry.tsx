/** P1 进门：进示范工会看看 · 建自己的空工会（建的人是管理员）· 导入备份 · 这台设备上的工会。 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useStorageUi } from "@/components/storage";
import { TextField, Empty, Tag } from "@/components/app/bits";
import { LangSwitch, U, useI18n } from "@/i18n/I18n";
import type { Say } from "@/domain/text";
import { passcodeProblem } from "@/lib/passcode";
import { navigate } from "@/lib/router";
import { useStore } from "@/lib/store";
import { DEMO_TITLE } from "@/lib/worlds";
import { demoSummary } from "@/lib/worlds";

export function EntryPage() {
  const { guilds, openDemo, openGuild, createGuild } = useStore();
  const { L, f, r, ph, dateTime } = useI18n();
  const ui = useStorageUi();
  const demo = useMemo(() => demoSummary(), []);
  const [title, setTitle] = useState("");
  const [nickname, setNickname] = useState("");
  const [login, setLogin] = useState("admin");
  const [passcode, setPasscode] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<Say | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const problem = !title.trim() ? L.entry.needTitle : !nickname.trim() ? L.entry.needNickname : passcodeProblem(passcode, again);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const res = await createGuild({ title, nickname, login, passcode });
    setBusy(false);
    if (!res.ok) setError(res.message);
    else navigate("/hall", { replace: true });
  };

  return (
    <div className="door">
      <LangSwitch className="page-lang" />
      <div className="door-inner">
        <header className="door-hero">
          <span className="label">{L.nav.appName}</span>
          <h1 className="t-title-32">{L.entry.heroTitle}</h1>
          <p className="muted t-body-14">{L.entry.heroLead}</p>
        </header>

        <div className="cards">
          <section className="card" aria-labelledby="demo-title">
            <div className="card-head">
              <h2 id="demo-title" className="t-heading-18">
                {L.entry.demoTitle}
              </h2>
              <Tag tone="sky">{L.entry.demoTag}</Tag>
            </div>
            <p className="muted">
              {r(L.entry.demoLead, {
                n: demo.projects.length,
                m: demo.members,
                names: (
                  <>
                    {demo.projects.map((name, i) => (
                      <span key={name}>
                        {i ? (L.common.listSep as string) : null}
                        <U>{name}</U>
                      </span>
                    ))}
                  </>
                ),
              })}
            </p>
            <div className="form-actions">
              <Button
                Label={L.entry.openDemo}
                Style="Accent"
                data-testid="open-demo"
                onClick={() => {
                  openDemo();
                  navigate("/login", { replace: true });
                }}
              />
            </div>
          </section>

          <section className="card" aria-labelledby="import-title">
            <h2 id="import-title" className="t-heading-18">
              {L.entry.importTitle}
            </h2>
            <p className="muted">{L.entry.importLead}</p>
            <div className="form-actions">
              <Button Label={L.entry.pickBackup} Style="Secondary" onClick={ui.pickImport} />
            </div>
          </section>
        </div>

        <section className="card" aria-labelledby="new-title">
          <div className="card-head">
            <h2 id="new-title" className="t-heading-18">
              {L.entry.newTitle}
            </h2>
            <span className="label">{L.entry.newCreatorAdmin}</span>
          </div>
          <form
            className="stack"
            data-gap="small"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="form-grid">
              <TextField label={L.entry.guildName} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={24} placeholder={L.entry.guildNamePlaceholder} />
              <TextField label={L.entry.yourNickname} value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={16} />
              <TextField label={L.entry.loginName} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" hint={L.entry.loginNameHint} />
              <TextField label={L.entry.passcode} type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="new-password" hint={L.entry.passcodeHint} />
              <TextField label={L.entry.again} type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
            </div>
            {error ? (
              <p className="error-text" role="alert">
                {ph(error)}
              </p>
            ) : null}
            <div className="form-actions">
              <Button Label={busy ? L.entry.creating : L.entry.create} Style="Primary" type="submit" disabled={busy} />
              <span className="label">{L.entry.passcodeNote}</span>
            </div>
          </form>
        </section>

        <section className="card" aria-labelledby="here-title">
          <h2 id="here-title" className="t-heading-18">
            {L.entry.hereTitle}
          </h2>
          {guilds.length === 0 ? (
            <Empty>{L.entry.hereEmpty}</Empty>
          ) : (
            <ul className="list">
              {guilds.map((g) => (
                <li key={g.id}>
                  <div className="list-main">
                    <span className="t-body-14m">{g.kind === "demo" && g.title === DEMO_TITLE ? L.entry.kindDemo : g.title ? <U>{g.title}</U> : L.entry.unnamed}</span>
                    <span className="label">
                      {g.kind === "demo" ? L.entry.kindDemo : L.entry.kindOwn} · {f(L.entry.steps, { n: g.steps ?? 0 })} · {g.lastBackupAt ? f(L.entry.lastBackup, { at: dateTime(g.lastBackupAt) }) : L.entry.neverBackedUp}
                    </span>
                  </div>
                  <Button
                    Label={L.entry.enter}
                    Size="Small"
                    Style="Secondary"
                    onClick={() => {
                      if (openGuild(g.id)) navigate("/login", { replace: true });
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="label">{L.entry.localNote}</p>
        </section>
      </div>
    </div>
  );
}
