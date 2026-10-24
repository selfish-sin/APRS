/** 导出汇报（SPEC §15.3）：项目页「导出汇报」选几张表导进同一个 Excel；成员页「导出我的记录」。 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { REPORT_KEYS, REPORT_LABEL, buildReport, memberFileName, memberRecord, reportFileName, type ReportKey } from "@/domain/report";
import type { Id } from "@/domain/model";
import { projectById, todayOf } from "@/domain/queries";
import { saveToDevice } from "@/lib/download";
import { useGuild } from "@/lib/store";
import { SelectField } from "./bits";
import { useI18n } from "@/i18n/I18n";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while ((y < ey || (y === ey && m <= em)) && out.length < 36) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function ReportDialog({ projectId, onClose }: { projectId: Id; onClose: () => void }) {
  const { world, notify } = useGuild();
  const { L, f, pt, lang, t2 } = useI18n();
  const project = projectById(world, projectId);
  const [keys, setKeys] = useState<ReportKey[]>([...REPORT_KEYS]);
  const [month, setMonth] = useState("");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!project) return null;
  const months = monthsBetween(project.startOn, todayOf(world));
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const tables = buildReport(world, projectId, REPORT_KEYS.filter((k) => keys.includes(k)), { month: month || null, lang });
      if (!tables.length) {
        setError(L.report.pickOne);
        return;
      }
      if (format === "xlsx") {
        const { tablesToXlsx } = await import("@/lib/sheets/write");
        const bytes = await tablesToXlsx(tables);
        const name = reportFileName(world, projectId, "xlsx", lang);
        const r = await saveToDevice(name, new Blob([new Uint8Array(bytes)], { type: XLSX_MIME }));
        if (!r.ok) {
          if (r.reason !== "declined") setError(pt(r.message));
          return;
        }
        notify(f(L.report.exportedXlsx, { name, n: tables.length }));
      } else {
        const { tableToCsv } = await import("@/lib/sheets/write");
        for (const t of tables) {
          const r = await saveToDevice(reportFileName(world, projectId, "csv", lang, t.name), new Blob([tableToCsv(t)], { type: "text/csv;charset=utf-8" }));
          if (!r.ok) {
            if (r.reason !== "declined") setError(pt(r.message));
            return;
          }
        }
        notify(f(L.report.exportedCsv, { n: tables.length }));
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : L.report.failed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      Type="Dialog"
      Title={L.report.title}
      Body={L.report.body}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label={L.report.cancel} Style="Secondary" onClick={onClose} />
          <Button Label={busy ? L.report.exporting : L.report.go} Style="Accent" disabled={busy || !keys.length} onClick={() => void go()} data-testid="report-go" />
        </>
      }
    >
      <div className="report-options" data-testid="report-dialog">
        {REPORT_KEYS.map((k, i) => (
          <label key={k} className="check-row">
            <input type="checkbox" checked={keys.includes(k)} onChange={(e) => setKeys((xs) => (e.target.checked ? [...xs, k] : xs.filter((x) => x !== k)))} data-testid={`report-key-${k}`} />
            <span>
              {i + 1}. {t2(REPORT_LABEL[k])}
            </span>
          </label>
        ))}
        <SelectField label={L.report.hoursBy} value={month} onChange={(e) => setMonth(e.target.value)} data-testid="report-month">
          <option value="">{L.report.wholeProject}</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </SelectField>
        <div className="chips" role="radiogroup" aria-label={L.report.format}>
          <button type="button" className="ui-chip" aria-pressed={format === "xlsx"} onClick={() => setFormat("xlsx")}>
            {L.report.xlsx}
          </button>
          <button type="button" className="ui-chip" aria-pressed={format === "csv"} onClick={() => setFormat("csv")} data-testid="report-csv">
            {L.report.csv}
          </button>
        </div>
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}

/** 成员页：导出我的记录（我的任务 · 工时 · 活力点流水）。 */
export function ExportMyRecord({ memberId }: { memberId: Id }) {
  const { world, notify } = useGuild();
  const { L, f, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      Label={busy ? L.report.exporting : L.report.myRecord}
      Size="Small"
      Style="Secondary"
      disabled={busy}
      data-testid="export-my-record"
      onClick={async () => {
        setBusy(true);
        try {
          const { tablesToXlsx } = await import("@/lib/sheets/write");
          const bytes = await tablesToXlsx(memberRecord(world, memberId, lang));
          const name = memberFileName(world, memberId, lang);
          const r = await saveToDevice(name, new Blob([new Uint8Array(bytes)], { type: XLSX_MIME }));
          if (r.ok) notify(f(L.report.exported, { name }));
          else if (r.reason !== "declined") notify(r.message, "Error");
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
