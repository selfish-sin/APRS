/** P10 备份：导出 / 导入· 存储 · 恢复示范工会 · 换工会。 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { backupLabel, usageLabel, useStorageUi } from "@/components/storage";
import { isAdmin } from "@/domain/commands/core";
import { theWorld } from "@/domain/queries";
import { daysSince } from "@/lib/storage/local";
import { navigate } from "@/lib/router";
import { useGuild } from "@/lib/store";

export function BackupPage() {
  const { world, me, base, storage, exportWorld, resetDemo, leaveGuild, notify } = useGuild();
  const ui = useStorageUi();
  const [confirmReset, setConfirmReset] = useState(false);
  const title = theWorld(world)?.title ?? "工会";
  const days = daysSince(storage.lastBackupAt, new Date().toISOString());
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">备份</span>
          <h1 className="t-title-32">备份</h1>
          <p className="muted">「{title}」存在这台设备的浏览器里。换设备、清浏览器之前，先导出一份。</p>
        </div>
      </div>
      <div className="cards">
        <section className="card" aria-label="导出">
          <h2 className="t-heading-18">导出备份</h2>
          <p className="muted">下载一个文件，里面是这个工会在这台设备上做过的每一步。</p>
          <p className="label">{backupLabel(days)}</p>
          <div className="form-actions">
            <Button
              Label="导出备份"
              Style="Accent"
              data-testid="export"
              onClick={() => {
                const r = exportWorld();
                if (!r.ok) ui.open({ kind: "error", message: r.message });
                else notify(`导出好了：${r.fileName}`);
              }}
            />
          </div>
        </section>
        <section className="card" aria-label="导入">
          <h2 className="t-heading-18">从备份导入</h2>
          <p className="muted">选之前导出的文件。同一个工会会先问你要不要替换，替换前自动留一份。</p>
          <div className="form-actions">
            <Button Label="选备份文件" Style="Secondary" onClick={ui.pickImport} data-testid="import" />
          </div>
        </section>
        <section className="card" aria-label="存储">
          <h2 className="t-heading-18">存储</h2>
          <p className="muted">{storage.available ? usageLabel(storage.ratio) : "这个浏览器不让存，关掉就没了。先导出备份。"}</p>
          <p className="label">
            在这台设备上做了 {storage.steps} 步{storage.skipped.length ? `，${storage.skipped.length} 步没能恢复（留着，没有丢）` : ""}。
          </p>
          <div className="form-actions">
            <Button Label="看详细" Style="Secondary" onClick={() => ui.open({ kind: "storage" })} />
          </div>
        </section>
        <section className="card" aria-label="换工会">
          <h2 className="t-heading-18">换一个工会</h2>
          <p className="muted">回到进门：进示范工会、建自己的工会、或者打开这台设备上的别的工会。</p>
          <div className="form-actions">
            <Button
              Label="回到进门"
              Style="Secondary"
              onClick={() => {
                leaveGuild();
                navigate("/", { replace: true });
              }}
            />
          </div>
        </section>
        {base === "demo" && isAdmin(me) ? (
          <section className="card" aria-label="恢复示范工会">
            <h2 className="t-heading-18">把示范工会恢复原样</h2>
            <p className="muted">在这台设备上做过的都撤掉，回到示范的样子。恢复之前自动留一份。</p>
            <div className="form-actions">
              <Button Label="恢复原样" Style="Secondary" onClick={() => setConfirmReset(true)} />
            </div>
          </section>
        ) : null}
      </div>
      {confirmReset ? (
        <Drawer
          Type="Dialog"
          Title="把示范工会恢复原样？"
          Body={`这台设备上做过的 ${storage.steps} 步会撤掉。之前会自动留一份。`}
          open
          onClose={() => setConfirmReset(false)}
          actions={
            <>
              <Button Label="取消" Style="Secondary" onClick={() => setConfirmReset(false)} />
              <Button
                Label="恢复"
                onClick={() => {
                  resetDemo();
                  setConfirmReset(false);
                  notify("示范工会恢复原样了", "Neutral");
                }}
              />
            </>
          }
        />
      ) : null}
    </>
  );
}
