/** 存储的提示：没存上 · 该备份了 · 有几步没能恢复 · 导入好了 · 同一个工会。 */
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Toast } from "@/components/ui/Toast";
import { daysSince } from "@/lib/storage/local";
import { useFiles } from "@/lib/files/FilesProvider";
import { useStore } from "@/lib/store";
import { backupLabel, useStorageUi } from "./StorageUi";
import { U, useI18n } from "@/i18n/I18n";
import "./storage.css";

function SkippedReason({ reason }: { reason: string }) {
  const { L, f } = useI18n();
  if (reason === "earlier") return <>{L.storage.reasonEarlier}</>;
  if (reason === "other_world") return <>{L.storage.reasonOtherWorld}</>;
  return <>{f(L.storage.reasonRules, { reason })}</>;
}

/** The strip at the top when a save did not go through. Stays until a save succeeds. */
function SaveFailedBanner() {
  const { storage, exportWorld } = useStore();
  const { L, r, ph } = useI18n();
  const ui = useStorageUi();
  if (!storage.saveFailed) return null;
  return (
    <div className="storage-banner" role="alert" data-testid="storage-banner">
      <span className="storage-banner-mark" aria-hidden="true">
        !
      </span>
      <span>{r(L.storage.saveFailed, { why: ph(storage.saveFailed.message) })}</span>
      <button
        type="button"
        className="storage-banner-action"
        onClick={() => {
          void exportWorld().then((r) => {
            if (!r.ok) ui.open({ kind: "error", message: r.message });
          });
        }}
      >
        {L.storage.exportBackup}
      </button>
    </div>
  );
}

/** One-line reminders at the bottom: usage · backup age · entries that did not replay. */
function Reminders() {
  const { storage, exportWorld, dismissReminder, dismissSkipped } = useStore();
  const { L, f, ph } = useI18n();
  const ui = useStorageUi();
  const skippedCount = storage.skipped.length;
  const showSkipped = storage.skippedNew > 0;

  if (!storage.reminder && !showSkipped) return null;
  return (
    <div className="storage-toast-host">
      {storage.reminder ? (
        <Toast
          Message={ph(storage.reminder.message)}
          Action={L.storage.exportBackup}
          {...{ "Show action": true }}
          onAction={() => {
            dismissReminder();
            void exportWorld().then((r) => {
              if (!r.ok) ui.open({ kind: "error", message: r.message });
            });
          }}
          onClose={dismissReminder}
        />
      ) : null}
      {showSkipped ? (
        <Toast
          Message={f(L.storage.skippedToast, { n: skippedCount })}
          Action={L.storage.look}
          {...{ "Show action": true }}
          onAction={() => {
            dismissSkipped();
            ui.open({ kind: "skipped" });
          }}
          onClose={dismissSkipped}
        />
      ) : null}
    </div>
  );
}

function StorageDialog() {
  const { storage, exportWorld } = useStore();
  const { L, f, ph } = useI18n();
  const ui = useStorageUi();
  const now = new Date().toISOString();
  const pct = Math.round(storage.ratio * 100);
  const persisted = storage.persisted === true ? L.storage.persistYes : storage.persisted === false ? L.storage.persistNo : L.storage.persistUnknown;
  return (
    <Drawer
      Type="Dialog"
      Title={L.storage.storageTitle}
      open
      onClose={ui.close}
      actions={
        <>
          <Button Label={L.storage.close} Style="Secondary" onClick={ui.close} />
          <Button
            Label={L.storage.exportBackup}
            onClick={() => {
              void exportWorld().then((r) => {
                if (!r.ok) ui.open({ kind: "error", message: r.message });
                else ui.close();
              });
            }}
          />
        </>
      }
    >
      <dl className="storage-facts t-body-14" data-testid="storage-facts">
        <div>
          <dt>{L.storage.thisDevice}</dt>
          <dd>
            {storage.available ? f(L.storage.used, { pct }) : L.storage.cantStore}
            <span className="storage-facts-meta">{f(L.storage.chars, { used: storage.usedChars.toLocaleString("en-US"), quota: storage.quotaChars.toLocaleString("en-US") })}</span>
          </dd>
        </div>
        <div>
          <dt>{L.storage.thisGuild}</dt>
          <dd>
            {f(L.storage.steps, { n: storage.steps })}
            {storage.skipped.length ? f(L.storage.stepsSkipped, { n: storage.skipped.length }) : ""}
          </dd>
        </div>
        <div>
          <dt>{L.storage.backup}</dt>
          <dd>{ph(backupLabel(daysSince(storage.lastBackupAt, now)))}</dd>
        </div>
        <div>
          <dt>{L.storage.persisted}</dt>
          <dd>{persisted}</dd>
        </div>
      </dl>
      {storage.skipped.length ? (
        <Button Label={L.storage.seeSkipped} Style="Ghost" Size="Small" onClick={() => ui.open({ kind: "skipped" })} />
      ) : null}
    </Drawer>
  );
}

function SkippedDialog() {
  const { storage } = useStore();
  const { L, f } = useI18n();
  const ui = useStorageUi();
  return (
    <Drawer
      Type="Dialog"
      Title={f(L.storage.skippedTitle, { n: storage.skipped.length })}
      Body={L.storage.skippedBody}
      open
      onClose={ui.close}
      actions={<Button Label={L.storage.ok} onClick={ui.close} />}
    >
      <ul className="storage-skipped t-caption-12" data-testid="storage-skipped">
        {storage.skipped.map(({ entry, reason }) => (
          <li key={`${entry.id}-${entry.seq}`}>
            <span>{entry.command}</span>
            <span>{entry.createdAt.slice(0, 16).replace("T", " ")}</span>
            <span>
              <SkippedReason reason={reason} />
            </span>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

function ConfirmDialog({ title, onConfirm }: { title: string; onConfirm: () => void }) {
  const ui = useStorageUi();
  const { L, f } = useI18n();
  return (
    <Drawer
      Type="Dialog"
      Title={f(L.storage.confirmTitle, { title })}
      Body={L.storage.confirmBody}
      open
      onClose={ui.close}
      actions={
        <>
          <Button Label={L.storage.cancel} Style="Secondary" onClick={ui.close} />
          <Button Label={L.storage.replace} onClick={onConfirm} data-testid="storage-import-confirm" />
        </>
      }
    />
  );
}

/** Overlays for the storage flows. Mount once inside StoreProvider + StorageUiProvider. */
export function StorageNotices() {
  const ui = useStorageUi();
  const { L, f, ph } = useI18n();
  const panel = ui.panel;
  return (
    <>
      <SaveFailedBanner />
      <Reminders />
      {panel?.kind === "storage" ? <StorageDialog /> : null}
      {panel?.kind === "skipped" ? <SkippedDialog /> : null}
      {panel?.kind === "confirm" ? <ConfirmDialog title={panel.title || panel.file.title || L.storage.thisGuildFallback} onConfirm={() => ui.confirmImport(panel.file)} /> : null}
      {panel?.kind === "report" ? (
        <Drawer
          Type="Dialog"
          Title={L.storage.importedTitle}
          Body={
            (panel.report.skipped === 0
              ? f(L.storage.importedSame, { title: panel.report.title, n: panel.report.applied })
              : f(L.storage.importedSkipped, { n: panel.report.applied, skipped: panel.report.skipped })) + (panel.report.files ? f(L.storage.importedFiles, { n: panel.report.files }) : "")
          }
          open
          onClose={ui.close}
          actions={<Button Label={L.storage.ok} onClick={ui.close} data-testid="storage-import-done" />}
        />
      ) : null}
      {panel?.kind === "error" ? (
        <Drawer Type="Dialog" Title={L.storage.importFailed} Body={ph(panel.message)} open onClose={ui.close} actions={<Button Label={L.storage.ok} onClick={ui.close} />} />
      ) : null}
    </>
  );
}

/** 文件只能存在内存里（预览框、无痕窗口）：顶上一条说清楚。 */
export function FilesNotice() {
  const files = useFiles();
  const { world } = useStore();
  const { L } = useI18n();
  if (!files.ready || files.persistent || !world) return null;
  return (
    <div className="storage-banner" role="status" data-testid="files-memory-banner">
      <span className="storage-banner-mark" aria-hidden="true">
        !
      </span>
      <span>{L.storage.filesMemory}</span>
    </div>
  );
}
