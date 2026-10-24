/** 存储的提示：没存上 · 该备份了 · 有几步没能恢复 · 导入好了 · 同一个工会。 */
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Toast } from "@/components/ui/Toast";
import { daysSince } from "@/lib/storage/local";
import { useStore } from "@/lib/store";
import { backupLabel, useStorageUi } from "./StorageUi";
import "./storage.css";

function skippedReasonZh(reason: string): string {
  if (reason === "earlier") return "更早的一次加载就没对上";
  if (reason === "other_world") return "是别的工会的记录";
  return `现在的规则不认（${reason}）`;
}

/** The strip at the top when a save did not go through. Stays until a save succeeds. */
function SaveFailedBanner() {
  const { storage, exportWorld } = useStore();
  const ui = useStorageUi();
  if (!storage.saveFailed) return null;
  return (
    <div className="storage-banner" role="alert" data-testid="storage-banner">
      <span className="storage-banner-mark" aria-hidden="true">
        !
      </span>
      <span>刚才这一步没有存上（{storage.saveFailed.message}）。先导出备份。</span>
      <button
        type="button"
        className="storage-banner-action"
        onClick={() => {
          const r = exportWorld();
          if (!r.ok) ui.open({ kind: "error", message: r.message });
        }}
      >
        导出备份
      </button>
    </div>
  );
}

/** One-line reminders at the bottom: usage · backup age · entries that did not replay. */
function Reminders() {
  const { storage, exportWorld, dismissReminder, dismissSkipped } = useStore();
  const ui = useStorageUi();
  const skippedCount = storage.skipped.length;
  const showSkipped = storage.skippedNew > 0;

  if (!storage.reminder && !showSkipped) return null;
  return (
    <div className="storage-toast-host">
      {storage.reminder ? (
        <Toast
          Message={storage.reminder.message}
          Action="导出备份"
          {...{ "Show action": true }}
          onAction={() => {
            dismissReminder();
            const r = exportWorld();
            if (!r.ok) ui.open({ kind: "error", message: r.message });
          }}
          onClose={dismissReminder}
        />
      ) : null}
      {showSkipped ? (
        <Toast
          Message={`有 ${skippedCount} 步没能恢复，没有丢。`}
          Action="看一下"
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
  const ui = useStorageUi();
  const now = new Date().toISOString();
  const pct = Math.round(storage.ratio * 100);
  const persisted = storage.persisted === true ? "浏览器答应不随便清掉" : storage.persisted === false ? "浏览器没答应持久保存" : "还没问浏览器";
  return (
    <Drawer
      Type="Dialog"
      Title="存储"
      open
      onClose={ui.close}
      actions={
        <>
          <Button Label="关闭" Style="Secondary" onClick={ui.close} />
          <Button
            Label="导出备份"
            onClick={() => {
              const r = exportWorld();
              if (!r.ok) ui.open({ kind: "error", message: r.message });
              else ui.close();
            }}
          />
        </>
      }
    >
      <dl className="storage-facts t-body-14" data-testid="storage-facts">
        <div>
          <dt>这台设备</dt>
          <dd>
            {storage.available ? `已用 ${pct}%` : "这个浏览器不让存，关掉就没了"}
            <span className="storage-facts-meta">
              {storage.usedChars.toLocaleString("en-US")} / {storage.quotaChars.toLocaleString("en-US")} 字
            </span>
          </dd>
        </div>
        <div>
          <dt>这个工会</dt>
          <dd>
            在这台设备上做了 {storage.steps} 步
            {storage.skipped.length ? `，${storage.skipped.length} 步没能恢复` : ""}
          </dd>
        </div>
        <div>
          <dt>备份</dt>
          <dd>{backupLabel(daysSince(storage.lastBackupAt, now))}</dd>
        </div>
        <div>
          <dt>持久保存</dt>
          <dd>{persisted}</dd>
        </div>
      </dl>
      {storage.skipped.length ? (
        <Button Label="看一下没能恢复的" Style="Ghost" Size="Small" onClick={() => ui.open({ kind: "skipped" })} />
      ) : null}
    </Drawer>
  );
}

function SkippedDialog() {
  const { storage } = useStore();
  const ui = useStorageUi();
  return (
    <Drawer
      Type="Dialog"
      Title={`${storage.skipped.length} 步没能恢复`}
      Body="这些记录还留在这台电脑上，只是现在的规则对不上，没有算进世界里。"
      open
      onClose={ui.close}
      actions={<Button Label="好" onClick={ui.close} />}
    >
      <ul className="storage-skipped t-caption-12" data-testid="storage-skipped">
        {storage.skipped.map(({ entry, reason }) => (
          <li key={`${entry.id}-${entry.seq}`}>
            <span>{entry.command}</span>
            <span>{entry.createdAt.slice(0, 16).replace("T", " ")}</span>
            <span>{skippedReasonZh(reason)}</span>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

function ConfirmDialog({ title, onConfirm }: { title: string; onConfirm: () => void }) {
  const ui = useStorageUi();
  return (
    <Drawer
      Type="Dialog"
      Title={`这台设备上已经有「${title}」`}
      Body="替换以后，这台设备上现在这一份会换成备份里的。替换之前会先自动留一份。"
      open
      onClose={ui.close}
      actions={
        <>
          <Button Label="取消" Style="Secondary" onClick={ui.close} />
          <Button Label="替换" onClick={onConfirm} data-testid="storage-import-confirm" />
        </>
      }
    />
  );
}

/** Overlays for the storage flows. Mount once inside StoreProvider + StorageUiProvider. */
export function StorageNotices() {
  const ui = useStorageUi();
  const panel = ui.panel;
  return (
    <>
      <SaveFailedBanner />
      <Reminders />
      {panel?.kind === "storage" ? <StorageDialog /> : null}
      {panel?.kind === "skipped" ? <SkippedDialog /> : null}
      {panel?.kind === "confirm" ? <ConfirmDialog title={panel.title || panel.file.title || "这个工会"} onConfirm={() => ui.confirmImport(panel.file)} /> : null}
      {panel?.kind === "report" ? (
        <Drawer
          Type="Dialog"
          Title="导入好了"
          Body={
            panel.report.skipped === 0
              ? `「${panel.report.title}」恢复了 ${panel.report.applied.toLocaleString("en-US")} 步，0 步没能恢复，和导出的时候一样。`
              : `恢复了 ${panel.report.applied.toLocaleString("en-US")} 步，${panel.report.skipped} 步没能恢复（留着，没有丢）。`
          }
          open
          onClose={ui.close}
          actions={<Button Label="好" onClick={ui.close} data-testid="storage-import-done" />}
        />
      ) : null}
      {panel?.kind === "error" ? (
        <Drawer Type="Dialog" Title="没能导入" Body={panel.message} open onClose={ui.close} actions={<Button Label="好" onClick={ui.close} />} />
      ) : null}
    </>
  );
}
