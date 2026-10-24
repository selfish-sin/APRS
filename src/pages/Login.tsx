/** 登录：选账号 + 输口令（这台设备上的软锁，换人要输口令）。 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { MemberAvatar, TextField } from "@/components/app/bits";
import { LangSwitch, U, useI18n } from "@/i18n/I18n";
import type { Say } from "@/domain/text";
import type { Id } from "@/domain/model";
import { accounts, memberById, theWorld } from "@/domain/queries";
import { navigate, useRoute } from "@/lib/router";
import { useStore } from "@/lib/store";
import { DEMO_TITLE } from "@/lib/worlds";

export function LoginPage() {
  const { world, login, leaveGuild, base } = useStore();
  const { L, ph } = useI18n();
  const route = useRoute();
  const list = world ? accounts(world) : [];
  const [accountId, setAccountId] = useState<Id | null>(list[0]?.id ?? null);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<Say | null>(null);
  const [busy, setBusy] = useState(false);
  if (!world) return null;
  const rawTitle = theWorld(world)?.title;
  // 示范工会的名字跟着界面语言（自己起的名字照原样）。
  const title = base === "demo" && rawTitle === DEMO_TITLE ? L.entry.kindDemo : rawTitle ?? L.nav.guild;

  const submit = async () => {
    if (!accountId) {
      setError(L.entry.pickAccount);
      return;
    }
    setBusy(true);
    const r = await login(accountId, passcode);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setPasscode("");
    const back = route.query.get("back");
    navigate(back && back.startsWith("/") && back !== "/login" ? back : "/hall", { replace: true });
  };

  return (
    <div className="door">
      <LangSwitch className="page-lang" />
      <div className="door-inner" style={{ maxWidth: 640 }}>
        <header className="door-hero">
          <span className="label">
            <U>{title}</U>
          </span>
          <h1 className="t-title-32">{L.entry.loginTitle}</h1>
          <p className="muted">{L.entry.loginLead}</p>
        </header>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {list.length === 0 ? (
            <p className="muted">{L.entry.noAccounts}</p>
          ) : (
            <div className="accounts" role="radiogroup" aria-label={L.entry.accounts}>
              {list.map((a) => {
                const m = memberById(world, a.memberId);
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={accountId === a.id}
                    aria-pressed={accountId === a.id}
                    className="account-tile"
                    data-testid={`account-${a.login}`}
                    onClick={() => {
                      setAccountId(a.id);
                      setError(null);
                    }}
                  >
                    <MemberAvatar member={m} size="40" />
                    <span className="list-main">
                      <span className="t-body-14m">
                        <U>{a.displayName}</U>
                      </span>
                      <span className="muted label">
                        {a.login}
                        {m ? (
                          <>
                            {" · "}
                            <U>{m.nickname}</U>
                            {` · ${L.labels.role[m.role]}`}
                          </>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <TextField
            label={L.entry.passcode}
            type="password"
            autoComplete="current-password"
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
              setError(null);
            }}
            error={error ? ph(error) : null}
            data-testid="passcode"
          />
          <div className="form-actions">
            <Button Label={busy ? L.entry.checking : L.entry.signIn} Style="Accent" type="submit" disabled={busy || !list.length} data-testid="login-submit" />
            <Button
              Label={L.entry.otherGuild}
              Style="Ghost"
              onClick={() => {
                leaveGuild();
                navigate("/", { replace: true });
              }}
            />
          </div>
        </form>
      </div>
    </div>
  );
}
