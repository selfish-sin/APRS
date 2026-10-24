/** 工会菜单：导出 · 导入 · 存储 · 换工会。 */
import { useEffect, useRef } from "react";
import { daysSince } from "@/lib/storage/local";
import { useStore } from "@/lib/store";
import { backupLabel, usageLabel, useStorageUi } from "./StorageUi";
import "./storage.css";

type Item = { id: string; Label: string; Meta: string; onSelect: () => void };

/** The popover under the sidebar's world capsule: export · import · storage. Closes on outside click / Escape. */
export function WorldMenu({ open, onClose, worldTitle }: { open: boolean; onClose: () => void; worldTitle: string }) {
  const { storage, exportWorld, leaveGuild } = useStore();
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
      Label: "导出备份",
      Meta: backupLabel(days),
      onSelect: () => {
        const r = exportWorld();
        if (!r.ok) ui.open({ kind: "error", message: r.message });
        onClose();
      },
    },
    {
      id: "import",
      Label: "从备份导入",
      Meta: "用你导出的那个文件",
      onSelect: () => {
        onClose();
        ui.pickImport();
      },
    },
    {
      id: "storage",
      Label: "存储",
      Meta: storage.available ? usageLabel(storage.ratio) : "这个浏览器不让存",
      onSelect: () => {
        onClose();
        ui.open({ kind: "storage" });
      },
    },
    {
      id: "leave",
      Label: "换一个工会",
      Meta: "回到进门",
      onSelect: () => {
        onClose();
        leaveGuild();
      },
    },
  ];

  return (
    <div ref={root} className="storage-menu">
      <ul className="ui-select-panel storage-menu-panel" role="menu" data-testid="world-menu" aria-label={`${worldTitle} 的菜单`}>
        <li className="storage-menu-title t-caption-12" role="presentation">
          {worldTitle} · 存在这台设备上
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
