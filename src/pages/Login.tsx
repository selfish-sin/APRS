/** 登录：选账号 + 输口令（这台设备上的软锁，换人要输口令）。 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { MemberAvatar, TextField } from "@/components/app/bits";
import { ROLE_LABEL } from "@/domain/labels";
import type { Id } from "@/domain/model";
import { accounts, memberById, theWorld } from "@/domain/queries";
import { navigate, useRoute } from "@/lib/router";
import { useStore } from "@/lib/store";

export function LoginPage() {
  const { world, login, leaveGuild } = useStore();
  const route = useRoute();
  const list = world ? accounts(world) : [];
  const [accountId, setAccountId] = useState<Id | null>(list[0]?.id ?? null);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!world) return null;
  const title = theWorld(world)?.title ?? "工会";

  const submit = async () => {
    if (!accountId) {
      setError("先选一个账号");
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
      <div className="door-inner" style={{ maxWidth: 640 }}>
        <header className="door-hero">
          <span className="label">{title}</span>
          <h1 className="t-title-32">选账号登录</h1>
          <p className="muted">口令只用来在这台设备上换人，不是联网登录。</p>
        </header>
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {list.length === 0 ? (
            <p className="muted">这个工会还没有账号。</p>
          ) : (
            <div className="accounts" role="radiogroup" aria-label="账号">
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
                      <span className="t-body-14m">{a.displayName}</span>
                      <span className="muted label">
                        {a.login} · {m ? `${m.nickname} · ${ROLE_LABEL[m.role]}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <TextField
            label="口令"
            type="password"
            autoComplete="current-password"
            value={passcode}
            onChange={(e) => {
              setPasscode(e.target.value);
              setError(null);
            }}
            error={error}
            data-testid="passcode"
          />
          <div className="form-actions">
            <Button Label={busy ? "正在核对…" : "登录"} Style="Accent" type="submit" disabled={busy || !list.length} data-testid="login-submit" />
            <Button
              Label="换一个工会"
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
