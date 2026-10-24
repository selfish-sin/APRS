/** P1 进门：进示范工会看看 · 建自己的空工会（建的人是管理员）· 导入备份 · 这台设备上的工会。 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useStorageUi } from "@/components/storage";
import { TextField, Empty, Tag } from "@/components/app/bits";
import { dateTimeZh } from "@/domain/clock";
import { passcodeProblem } from "@/lib/passcode";
import { navigate } from "@/lib/router";
import { useStore } from "@/lib/store";
import { demoSummary } from "@/lib/worlds";

export function EntryPage() {
  const { guilds, openDemo, openGuild, createGuild } = useStore();
  const ui = useStorageUi();
  const demo = useMemo(() => demoSummary(), []);
  const [title, setTitle] = useState("");
  const [nickname, setNickname] = useState("");
  const [login, setLogin] = useState("admin");
  const [passcode, setPasscode] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const problem = !title.trim() ? "给工会起个名字" : !nickname.trim() ? "写一下你的昵称" : passcodeProblem(passcode, again);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const r = await createGuild({ title, nickname, login, passcode });
    setBusy(false);
    if (!r.ok) setError(r.message);
    else navigate("/hall", { replace: true });
  };

  return (
    <div className="door">
      <div className="door-inner">
        <header className="door-hero">
          <span className="label">ARPS制作工会</span>
          <h1 className="t-title-32">报到一个环节，系统给你配一张任务单</h1>
          <p className="muted t-body-14">交上来，审核过了，就记活力点。整个项目走到哪一关、哪一卡卡住了，大家都看得到。</p>
        </header>

        <div className="cards">
          <section className="card" aria-labelledby="demo-title">
            <div className="card-head">
              <h2 id="demo-title" className="t-heading-18">
                先看看示范工会
              </h2>
              <Tag tone="sky">示范</Tag>
            </div>
            <p className="muted">
              {demo.projects.length} 个真实的项目（{demo.projects.join("、")}），{demo.members} 个编出来的成员。用工会给你的账号和口令登录。
            </p>
            <div className="form-actions">
              <Button
                Label="进示范工会"
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
              从备份导入
            </h2>
            <p className="muted">换了设备、清了浏览器？用之前导出的那个文件，工会原样回来。</p>
            <div className="form-actions">
              <Button Label="选备份文件" Style="Secondary" onClick={ui.pickImport} />
            </div>
          </section>
        </div>

        <section className="card" aria-labelledby="new-title">
          <div className="card-head">
            <h2 id="new-title" className="t-heading-18">
              建自己的工会
            </h2>
            <span className="label">建的人是管理员</span>
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
              <TextField label="工会名字" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={24} placeholder="例如：周末动画小组" />
              <TextField label="你的昵称" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={16} />
              <TextField label="登录名" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" hint="字母、数字、点、横线" />
              <TextField label="口令" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="new-password" hint="至少 6 位" />
              <TextField label="再输一次" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
            </div>
            {error ? (
              <p className="error-text" role="alert">
                {error}
              </p>
            ) : null}
            <div className="form-actions">
              <Button Label={busy ? "正在建…" : "建好进去"} Style="Primary" type="submit" disabled={busy} />
              <span className="label">口令只用来在这台设备上换人，不是联网的账号。</span>
            </div>
          </form>
        </section>

        <section className="card" aria-labelledby="here-title">
          <h2 id="here-title" className="t-heading-18">
            这台设备上的工会
          </h2>
          {guilds.length === 0 ? (
            <Empty>还没有。进示范工会看看，或者建一个。</Empty>
          ) : (
            <ul className="list">
              {guilds.map((g) => (
                <li key={g.id}>
                  <div className="list-main">
                    <span className="t-body-14m">{g.title || "没有名字的工会"}</span>
                    <span className="label">
                      {g.kind === "demo" ? "示范工会" : "自己的工会"} · 在这台设备上做了 {g.steps ?? 0} 步 · {g.lastBackupAt ? `上次备份 ${dateTimeZh(g.lastBackupAt)}` : "还没备份过"}
                    </span>
                  </div>
                  <Button
                    Label="进去"
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
          <p className="label">数据只存在这台设备的浏览器里。换设备之前，在「备份」里导出一份。</p>
        </section>
      </div>
    </div>
  );
}
