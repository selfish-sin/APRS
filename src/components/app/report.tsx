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
      const tables = buildReport(world, projectId, REPORT_KEYS.filter((k) => keys.includes(k)), { month: month || null, lang: "zh" });
      if (!tables.length) {
        setError("至少选一张表");
        return;
      }
      if (format === "xlsx") {
        const { tablesToXlsx } = await import("@/lib/sheets/write");
        const bytes = await tablesToXlsx(tables);
        const name = reportFileName(world, projectId, "xlsx");
        const r = await saveToDevice(name, new Blob([new Uint8Array(bytes)], { type: XLSX_MIME }));
        if (!r.ok) {
          if (r.reason !== "declined") setError(r.message);
          return;
        }
        notify(`导出好了：${name}（${tables.length} 张表）`);
      } else {
        const { tableToCsv } = await import("@/lib/sheets/write");
        for (const t of tables) {
          const r = await saveToDevice(reportFileName(world, projectId, "csv", "zh", t.name), new Blob([tableToCsv(t)], { type: "text/csv;charset=utf-8" }));
          if (!r.ok) {
            if (r.reason !== "declined") setError(r.message);
            return;
          }
        }
        notify(`导出好了：${tables.length} 个 .csv`);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "没能导出");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      Type="Dialog"
      Title="导出汇报"
      Body="照工会已有的表的列，导进同一个 Excel 文件（.csv 一张表一个文件）。"
      open
      onClose={onClose}
      actions={
        <>
          <Button Label="取消" Style="Secondary" onClick={onClose} />
          <Button Label={busy ? "正在导出…" : "导出"} Style="Accent" disabled={busy || !keys.length} onClick={() => void go()} data-testid="report-go" />
        </>
      }
    >
      <div className="report-options" data-testid="report-dialog">
        {REPORT_KEYS.map((k, i) => (
          <label key={k} className="check-row">
            <input type="checkbox" checked={keys.includes(k)} onChange={(e) => setKeys((xs) => (e.target.checked ? [...xs, k] : xs.filter((x) => x !== k)))} data-testid={`report-key-${k}`} />
            <span>
              {i + 1}. {REPORT_LABEL[k].zh}
            </span>
          </label>
        ))}
        <SelectField label="必要劳动时间统计表按" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="report-month">
          <option value="">整个项目</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </SelectField>
        <div className="chips" role="radiogroup" aria-label="格式">
          <button type="button" className="ui-chip" aria-pressed={format === "xlsx"} onClick={() => setFormat("xlsx")}>
            .xlsx（一个文件）
          </button>
          <button type="button" className="ui-chip" aria-pressed={format === "csv"} onClick={() => setFormat("csv")} data-testid="report-csv">
            .csv（一张表一个）
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
  const [busy, setBusy] = useState(false);
  return (
    <Button
      Label={busy ? "正在导出…" : "导出我的记录"}
      Size="Small"
      Style="Secondary"
      disabled={busy}
      data-testid="export-my-record"
      onClick={async () => {
        setBusy(true);
        try {
          const { tablesToXlsx } = await import("@/lib/sheets/write");
          const bytes = await tablesToXlsx(memberRecord(world, memberId, "zh"));
          const name = memberFileName(world, memberId);
          const r = await saveToDevice(name, new Blob([new Uint8Array(bytes)], { type: XLSX_MIME }));
          if (r.ok) notify(`导出好了：${name}`);
          else if (r.reason !== "declined") notify(r.message, "Error");
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
