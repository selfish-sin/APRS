/** 工会菜单：导出 · 导入 · 存储 · 换工会。 */
import { useEffect, useRef } from "react";
import { daysSince } from "@/lib/storage/local";
import { useStore } from "@/lib/store";
import { backupLabel, usageLabel, useStorageUi } from "./StorageUi";
import { U, useI18n } from "@/i18n/I18n";
import type { ReactNode } from "react";
import "./storage.css";

type Item = { id: string; Label: string; Meta: ReactNode; onSelect: () => void };

/** The popover under the sidebar's world capsule: export · import · storage. Closes on outside click / Escape. */
export function WorldMenu({ open, onClose, worldTitle }: { open: boolean; onClose: () => void; worldTitle: string }) {
  const { storage, exportWorld, leaveGuild } = useStore();
  const { L, f, r, ph } = useI18n();
  const ui = useStorageUi();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  const days = daysSince(storage.lastBackupAt, new Date().toISOString());
  const items: Item[] = [
    {
      id: "export",
      Label: L.storage.exportBackup,
      Meta: ph(backupLabel(days)),
      onSelect: () => {
        onClose();
        void exportWorld().then((r) => {
          if (!r.ok) ui.open({ kind: "error", message: r.message });
        });
      },
    },
    {
      id: "import",
      Label: L.storage.importBackup,
      Meta: L.storage.importMeta,
      onSelect: () => {
        onClose();
        ui.pickImport();
      },
    },
    {
      id: "storage",
      Label: L.storage.storageTitle,
      Meta: storage.available ? ph(usageLabel(storage.ratio)) : L.storage.storageMetaBlocked,
      onSelect: () => {
        onClose();
        ui.open({ kind: "storage" });
      },
    },
    {
      id: "leave",
      Label: L.storage.otherGuild,
      Meta: L.storage.backToDoor,
      onSelect: () => {
        onClose();
        leaveGuild();
      },
    },
  ];

  return (
    <div ref={root} className="storage-menu">
      <ul className="ui-select-panel storage-menu-panel" role="menu" data-testid="world-menu" aria-label={f(L.storage.menuAria, { title: worldTitle })}>
        <li className="storage-menu-title t-caption-12" role="presentation">
          {r(L.storage.menuTitle, { title: <U>{worldTitle}</U> })}
        </li>
        {items.map((item) => (
          <li key={item.id} role="none">
            <button type="button" role="menuitem" className="ui-select-item storage-menu-item" data-item={item.id} onClick={item.onSelect}>
              <span>{item.Label}</span>
              <span className="ui-select-meta">{item.Meta}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
