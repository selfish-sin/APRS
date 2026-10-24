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
import { U, useI18n } from "@/i18n/I18n";

export function BackupPage() {
  const { world, me, base, storage, exportWorld, exportText, resetDemo, leaveGuild, notify } = useGuild();
  const ui = useStorageUi();
  const { L, f, r: rich, ph } = useI18n();
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
      else
        notify(
          packed
            ? packed.missing
              ? f(L.backup.exportedFilesMissing, { file: r.fileName, n: Object.keys(packed.files).length, missing: packed.missing })
              : f(L.backup.exportedFiles, { file: r.fileName, n: Object.keys(packed.files).length })
            : f(L.backup.exported, { file: r.fileName })
        );
    } finally {
      setBusy(false);
    }
  };
  const est = files.usage.estimate;
  const title = theWorld(world)?.title ?? L.nav.guild;
  const days = daysSince(storage.lastBackupAt, new Date().toISOString());
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">{L.backup.title}</span>
          <h1 className="t-title-32">{L.backup.title}</h1>
          <p className="muted">{rich(L.backup.lead, { title: <U>{title}</U> })}</p>
        </div>
      </div>
      <div className="cards">
        <section className="card" aria-label={L.backup.exportTitle}>
          <h2 className="t-heading-18">{L.backup.exportTitle}</h2>
          <p className="muted">{L.backup.exportLead}</p>
          <p className="label">{ph(backupLabel(days))}</p>
          <label className="check-row">
            <input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} data-testid="export-with-files" />
            <span>{f(L.backup.withFiles, { n: lib.files, size: sizeLabel(lib.bytes) })}</span>
          </label>
          <p className="label">{L.backup.withoutFilesNote}</p>
          <div className="form-actions">
            <Button Label={busy ? L.backup.exporting : L.backup.exportGo} Style="Accent" data-testid="export" disabled={busy} onClick={() => void doExport()} />
          </div>
        </section>
        <section className="card" aria-label={L.backup.importTitle}>
          <h2 className="t-heading-18">{L.backup.importTitle}</h2>
          <p className="muted">{L.backup.importLead}</p>
          <div className="form-actions">
            <Button Label={L.backup.pickFile} Style="Secondary" onClick={ui.pickImport} data-testid="import" />
          </div>
        </section>
        <section className="card" aria-label={L.backup.copyTitle}>
          <h2 className="t-heading-18">{L.backup.copyTitle}</h2>
          <p className="muted">{L.backup.copyLead}</p>
          <p className="label">{L.backup.copyNote}</p>
          <div className="form-actions">
            <Button
              Label={L.backup.copyGo}
              Style="Secondary"
              data-testid="export-copy"
              onClick={() => {
                const r = exportText();
                if (!r.ok) {
                  ui.open({ kind: "error", message: r.message });
                  return;
                }
                setCopyText(r.text);
                const done = () => notify(L.backup.copied);
                const fallback = () => notify(L.backup.copyFallback, "Neutral");
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
              aria-label={L.backup.copyText}
              readOnly
              rows={4}
              value={copyText}
              onFocus={(e) => e.currentTarget.select()}
            />
          ) : null}
          <textarea
            id="backup-paste-text"
            className="field-control"
            aria-label={L.backup.pasteLabel}
            placeholder={L.backup.pastePlaceholder}
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            data-testid="import-paste"
          />
          <div className="form-actions">
            <Button
              Label={L.backup.pasteGo}
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
        <section className="card" aria-label={L.backup.storageTitle}>
          <h2 className="t-heading-18">{L.backup.storageTitle}</h2>
          <p className="muted" data-testid="usage-records">
            {L.backup.records}
            {storage.available ? ph(usageLabel(storage.ratio)) : L.backup.recordsBlocked}
          </p>
          <p className="muted" data-testid="usage-files">
            {L.backup.filesLabel}
            {files.persistent ? f(L.backup.filesStored, { n: files.usage.storedFiles, size: sizeLabel(files.usage.storedBytes) }) : L.backup.filesMemory}
            {est ? f(L.backup.filesQuota, { quota: sizeLabel(est.quota), pct: Math.max(1, Math.round((est.usage / Math.max(1, est.quota)) * 100)) }) : ""}
          </p>
          {est && est.usage / Math.max(1, est.quota) >= 0.8 ? (
            <p className="error-text" role="alert">
              {L.backup.filesFull}
            </p>
          ) : null}
          <p className="label">
            {f(L.backup.steps, { n: storage.steps })}
            {storage.skipped.length ? f(L.backup.stepsSkipped, { n: storage.skipped.length }) : ""}
            {L.common.period}
          </p>
          <div className="form-actions">
            <Button Label={L.backup.details} Style="Secondary" onClick={() => ui.open({ kind: "storage" })} />
          </div>
        </section>
        <section className="card" aria-label={L.backup.switchTitle}>
          <h2 className="t-heading-18">{L.backup.switchTitle}</h2>
          <p className="muted">{L.backup.switchLead}</p>
          <div className="form-actions">
            <Button
              Label={L.backup.backToDoor}
              Style="Secondary"
              onClick={() => {
                leaveGuild();
                navigate("/", { replace: true });
              }}
            />
          </div>
        </section>
        {base === "demo" && isAdmin(me) ? (
          <section className="card" aria-label={L.backup.resetTitle}>
            <h2 className="t-heading-18">{L.backup.resetTitle}</h2>
            <p className="muted">{L.backup.resetLead}</p>
            <div className="form-actions">
              <Button Label={L.backup.resetGo} Style="Secondary" onClick={() => setConfirmReset(true)} />
            </div>
          </section>
        ) : null}
      </div>
      {bigConfirm !== null ? (
        <Drawer
          Type="Dialog"
          Title={L.backup.bigTitle}
          Body={f(L.backup.bigBody, { size: sizeLabel(Math.round(bigConfirm * 1.34)) })}
          open
          onClose={() => setBigConfirm(null)}
          actions={
            <>
              <Button Label={L.backup.recordsOnly} Style="Secondary" onClick={() => { setBigConfirm(null); setWithFiles(false); }} />
              <Button Label={L.backup.exportAnyway} onClick={() => { setBigConfirm(null); void doExport(true); }} />
            </>
          }
        />
      ) : null}
      {confirmReset ? (
        <Drawer
          Type="Dialog"
          Title={L.backup.resetConfirmTitle}
          Body={f(L.backup.resetConfirmBody, { n: storage.steps })}
          open
          onClose={() => setConfirmReset(false)}
          actions={
            <>
              <Button Label={L.backup.cancel} Style="Secondary" onClick={() => setConfirmReset(false)} />
              <Button
                Label={L.backup.reset}
                onClick={() => {
                  resetDemo();
                  setConfirmReset(false);
                  notify(L.backup.resetDone, "Neutral");
                }}
              />
            </>
          }
        />
      ) : null}
    </>
  );
}
