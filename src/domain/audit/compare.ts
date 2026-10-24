/**
 * 再盘点一次时，对比上一次（SPEC §18.8）：「比上次多了 12 个文件 · 3 个文件不见了 · 5 个版本更新了」。
 * 文件按名字认（同一个名字、指纹变了也算「更新了」那一格的事）；版本按格子里算数的那一版比。
 */
import type { AuditRow, Id } from "../model";
import type { ReadModel } from "../readmodel";
import { auditInputs, checkAudit } from "./check";
import { auditsOfProject } from "./deliveries";

export interface AuditCompare {
  prev: AuditRow;
  added: number;
  gone: number;
  updated: number;
}

export function compareAudits(rm: ReadModel, auditId: Id): AuditCompare | null {
  const cur = rm.get("audits", auditId);
  if (!cur) return null;
  const list = auditsOfProject(rm, cur.projectId);
  const i = list.findIndex((a) => a.id === auditId);
  const prev = i >= 0 ? list[i + 1] : undefined;
  if (!prev) return null;
  const a = auditInputs(rm, cur.id);
  const b = auditInputs(rm, prev.id);
  if (!a || !b) return null;
  const names = (items: typeof a.items) => new Set(items.filter((x) => x.origin !== "cell").map((x) => x.name));
  const now = names(a.items);
  const before = names(b.items);
  const added = Array.from(now).filter((n) => !before.has(n)).length;
  const gone = Array.from(before).filter((n) => !now.has(n)).length;
  const ca = checkAudit(a);
  const cb = checkAudit(b);
  let updated = 0;
  for (const cell of ca.cells) {
    const v = cell.top?.place.version ?? null;
    const old = cb.cellByTask.get(cell.task.id)?.top?.place.version ?? null;
    if (v !== null && old !== null && v > old) updated += 1;
  }
  return { prev, added, gone, updated };
}
