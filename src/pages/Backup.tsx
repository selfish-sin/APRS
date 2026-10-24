/** P10 备份：导出 / 导入· 存储 · 恢复示范工会 · 换工会。 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { backupLabel, usageLabel, useStorageUi } from "@/components/storage";
import { isAdmin } from "@/domain/commands/core";
import { libraryBytes, sizeLabel, theWorld } from "@/domain/queries";
import { useFiles } from "@/lib/files/FilesProvider";
import { daysSince } from "@/lib/storage/local";
import { navigate } from "@/lib/router";
import { useGuild } from "@/lib/store";

export function BackupPage() {
  const { world, me, base, storage, exportWorld, exportText, resetDemo, leaveGuild, notify } = useGuild();
  const ui = useStorageUi();
  const [confirmReset, setConfirmReset] = useState(false);
  const [copyText, setCopyText] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const files = useFiles();
  const [withFiles, setWithFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bigConfirm, setBigConfirm] = useState<number | null>(null);
  const lib = libraryBytes(world);
  /** 超过这么大先问一句（base64 会再大三分之一）。 */
  const BIG = 20 * 1024 * 1024;
  const doExport = async (force = false) => {
    if (busy) return;
    if (withFiles && !force && lib.bytes > BIG) {
      setBigConfirm(lib.bytes);
      return;
    }
    setBusy(true);
    try {
      const packed = withFiles ? await files.embed() : null;
      const r = await exportWorld(packed ? { files: packed.files } : {});
      if (!r.ok) ui.open({ kind: "error", message: r.message });
      else notify(packed ? `导出好了：${r.fileName}（带了 ${Object.keys(packed.files).length} 个文件${packed.missing ? `，${packed.missing} 个不在这台设备上没带` : ""}）` : `导出好了：${r.fileName}`);
    } finally {
      setBusy(false);
    }
  };
  const est = files.usage.estimate;
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
          <label className="check-row">
            <input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} data-testid="export-with-files" />
            <span>
              连文件一起（资料库的图和文件放进同一个备份，{lib.files} 个 · {sizeLabel(lib.bytes)}）
            </span>
          </label>
          <p className="label">不勾就只导记录：在别的设备上导入后，缺的文件显示「这个文件不在这台设备上」，再把文件拖进来就能对上。</p>
          <div className="form-actions">
            <Button Label={busy ? "正在导出…" : "导出备份"} Style="Accent" data-testid="export" disabled={busy} onClick={() => void doExport()} />
          </div>
        </section>
        <section className="card" aria-label="导入">
          <h2 className="t-heading-18">从备份导入</h2>
          <p className="muted">选之前导出的文件。同一个工会会先问你要不要替换，替换前自动留一份。</p>
          <div className="form-actions">
            <Button Label="选备份文件" Style="Secondary" onClick={ui.pickImport} data-testid="import" />
          </div>
        </section>
        <section className="card" aria-label="复制和粘贴备份">
          <h2 className="t-heading-18">复制 / 粘贴备份</h2>
          <p className="muted">点了「导出备份」没下载下来（有的预览页面不让下载）时用这个：把备份复制下来存好，要恢复时粘贴回来。</p>
          <p className="label">复制 / 粘贴只带记录，不带资料库的文件。</p>
          <div className="form-actions">
            <Button
              Label="复制备份"
              Style="Secondary"
              data-testid="export-copy"
              onClick={() => {
                const r = exportText();
                if (!r.ok) {
                  ui.open({ kind: "error", message: r.message });
                  return;
                }
                setCopyText(r.text);
                const done = () => notify("备份复制好了，粘到一个文本文件里存起来");
                const fallback = () => notify("没能自动复制。下面的框里就是备份，全选后复制", "Neutral");
                try {
                  navigator.clipboard.writeText(r.text).then(done, fallback);
                } catch {
                  fallback();
                }
              }}
            />
          </div>
          {copyText !== null ? (
            <textarea
              id="backup-copy-text"
              className="field-control"
              aria-label="备份内容"
              readOnly
              rows={4}
              value={copyText}
              onFocus={(e) => e.currentTarget.select()}
            />
          ) : null}
          <textarea
            id="backup-paste-text"
            className="field-control"
            aria-label="粘贴备份"
            placeholder="把之前复制的备份粘贴到这里"
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            data-testid="import-paste"
          />
          <div className="form-actions">
            <Button
              Label="从粘贴的内容导入"
              Style="Secondary"
              disabled={pasteText.trim() === ""}
              data-testid="import-paste-go"
              onClick={() => {
                ui.importText(pasteText);
                setPasteText("");
              }}
            />
          </div>
        </section>
        <section className="card" aria-label="存储">
          <h2 className="t-heading-18">存储</h2>
          <p className="muted" data-testid="usage-records">
            记录（浏览器的本机存储）：{storage.available ? usageLabel(storage.ratio) : "这个浏览器不让存，关掉就没了。先导出备份。"}
          </p>
          <p className="muted" data-testid="usage-files">
            文件（IndexedDB）：{files.persistent ? `${files.usage.storedFiles} 个 · ${sizeLabel(files.usage.storedBytes)}` : "只在内存里，关掉就没了"}
            {est ? ` · 浏览器给这个站 ${sizeLabel(est.quota)}，已用 ${Math.max(1, Math.round((est.usage / Math.max(1, est.quota)) * 100))}%` : ""}
          </p>
          {est && est.usage / Math.max(1, est.quota) >= 0.8 ? (
            <p className="error-text" role="alert">
              文件快把浏览器给的空间用满了：先「导出备份 · 连文件一起」，再把不要的文件从资料库里拿掉。
            </p>
          ) : null}
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
      {bigConfirm !== null ? (
        <Drawer
          Type="Dialog"
          Title="文件有点多"
          Body={`连文件一起导出大概有 ${sizeLabel(Math.round(bigConfirm * 1.34))}（文件转成文字会大三分之一），要一会儿，存的时候也要这么大的地方。`}
          open
          onClose={() => setBigConfirm(null)}
          actions={
            <>
              <Button Label="只导记录" Style="Secondary" onClick={() => { setBigConfirm(null); setWithFiles(false); }} />
              <Button Label="照样导出" onClick={() => { setBigConfirm(null); void doExport(true); }} />
            </>
          }
        />
      ) : null}
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
