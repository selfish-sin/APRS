/** 本机存储 · 备份和提示的浮层。 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { migrationReasonZh, type WorldFile } from "@/lib/migrations";
import { parseImport } from "@/lib/storage/local";
import { useFiles } from "@/lib/files/FilesProvider";
import { useStore, type ImportReport } from "@/lib/store";

/** What the overlay is showing. The world menu (sidebar) asks for these; StorageNotices draws them. */
export type StoragePanel =
  | { kind: "storage" }
  | { kind: "skipped" }
  | { kind: "confirm"; file: WorldFile; title: string }
  | { kind: "report"; report: Extract<ImportReport, { ok: true }> }
  | { kind: "error"; message: string };

interface StorageUiApi {
  panel: StoragePanel | null;
  open: (panel: StoragePanel) => void;
  close: () => void;
  /** Open the file picker; the rest of the import flow follows in StorageNotices. */
  pickImport: () => void;
  /** The chosen file's text. Exposed so tests and the lab can feed a file without the picker. */
  importText: (text: string) => void;
  /** Apply a parsed file after the user confirmed the replacement. */
  confirmImport: (file: WorldFile) => void;
}

const StorageUiContext = createContext<StorageUiApi | null>(null);

export function StorageUiProvider({ children }: { children: ReactNode }) {
  const { guilds, importWorld } = useStore();
  const { importEmbedded } = useFiles();
  const [panel, setPanel] = useState<StoragePanel | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const open = useCallback((next: StoragePanel) => setPanel(next), []);
  const close = useCallback(() => setPanel(null), []);

  const confirmImport = useCallback(
    (file: WorldFile) => {
      const report = importWorld(file);
      if (!report.ok) {
        setPanel({ kind: "error", message: report.message });
        return;
      }
      // 备份里带了文件（勾了「连文件一起」）：放回这台设备的文件仓。
      const n = file.files ? Object.keys(file.files).length : 0;
      if (!n) {
        setPanel({ kind: "report", report });
        return;
      }
      void importEmbedded(file.files).then((put) => setPanel({ kind: "report", report: { ...report, files: put } }));
    },
    [importWorld, importEmbedded]
  );

  const guildsRef = useRef(guilds);
  guildsRef.current = guilds;

  const importText = useCallback(
    (text: string) => {
      const parsed = parseImport(text);
      if (!parsed.ok) {
        setPanel({ kind: "error", message: migrationReasonZh(parsed.reason) });
        return;
      }
      // 这台设备上已经有这个工会（做过事）：先问一句再替换。
      const here = guildsRef.current.find((g) => g.id === parsed.file.worldId);
      if (here && (here.steps ?? 0) > 0) setPanel({ kind: "confirm", file: parsed.file, title: here.title });
      else confirmImport(parsed.file);
    },
    [confirmImport]
  );

  const pickImport = useCallback(() => {
    const el = input.current;
    if (!el) return;
    el.value = "";
    el.click();
  }, []);

  const onFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      file
        .text()
        .then(importText)
        .catch(() => setPanel({ kind: "error", message: "这个文件读不了。" }));
    },
    [importText]
  );

  const api = useMemo<StorageUiApi>(
    () => ({ panel, open, close, pickImport, importText, confirmImport }),
    [panel, open, close, pickImport, importText, confirmImport]
  );

  return (
    <StorageUiContext.Provider value={api}>
      {children}
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        data-testid="storage-import-file"
        onChange={onFile}
      />
    </StorageUiContext.Provider>
  );
}

export function useStorageUi(): StorageUiApi {
  const ctx = useContext(StorageUiContext);
  if (!ctx) throw new Error("useStorageUi must be used within StorageUiProvider");
  return ctx;
}

/** 「已用 1% · 还很宽裕」 / 「已用 72% · 该备份了」 */
export function usageLabel(ratio: number): string {
  const pct = Math.round(ratio * 100);
  if (ratio >= 0.9) return `已用 ${pct}% · 快满了`;
  if (ratio >= 0.7) return `已用 ${pct}% · 该备份了`;
  return `已用 ${pct}% · 还很宽裕`;
}

/** 「上次备份：3 天前」 / 「还没有备份过」 */
export function backupLabel(days: number | null): string {
  if (days === null) return "还没有备份过";
  if (days === 0) return "上次备份：今天";
  return `上次备份：${days} 天前`;
}
