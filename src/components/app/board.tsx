/**
 * 卡 × 环节网格：行 = C001…，列 = 环节；格子 = 状态色 + 头像字 + 版本号；锁住的是灰的。
 * 每卡每层的环节，一格里左右分成 A / B。点格子 → 卡详情。
 */
import { TASK_STATUS_LABEL } from "@/domain/labels";
import type { Grid, GridCell, GridTask } from "@/domain/queries";
import { Link } from "@/lib/router";

function partTitle(t: GridTask, stageName: string): string {
  const who = t.task.outsourced ? `外包（${t.task.outsourceName ?? ""}）` : t.assignee?.nickname ?? "";
  return [stageName, t.task.layer ? `${t.task.layer} 层` : null, TASK_STATUS_LABEL[t.task.status], who || null, t.versionTag].filter(Boolean).join(" · ");
}

/** 格子里的一个字状态（颜色不单独表意）。 */
export const STATUS_CHAR: Record<GridTask["task"]["status"], string> = { locked: "锁", open: "可", claimed: "接", submitted: "审", returned: "退", passed: "过", reclaimed: "收" };

function Part({ t, stageName }: { t: GridTask; stageName: string }) {
  const who = t.task.outsourced ? "外" : t.assignee?.nickname.slice(0, 1) ?? "";
  return (
    <span className="cell-part" data-status={t.task.status} data-mine={t.mine ? "true" : undefined} title={partTitle(t, stageName)}>
      <span className="ini">
        {STATUS_CHAR[t.task.status]}
        {who ? <span className="who">{who}</span> : null}
      </span>
      <span>{t.versionTag ?? (t.task.layer ? `${t.task.layer} 层` : "")}</span>
    </span>
  );
}

function Cell({ cell, cutId, label }: { cell: GridCell; cutId: string; label: string }) {
  if (!cell.tasks.length && !cell.extras.length) return <span className="cell-empty" aria-hidden="true" />;
  const summary = cell.tasks.map((t) => partTitle(t, cell.stage.name)).join("；");
  const extras = cell.extras.length ? `；额外 / 修正任务 ${cell.extras.length} 件` : "";
  return (
    <Link to={`/cut/${cutId}`} className="cell" aria-label={`${label} · ${summary}${extras}`} data-extras={cell.extras.length || undefined}>
      {cell.tasks.map((t) => (
        <Part key={t.task.id} t={t} stageName={cell.stage.name} />
      ))}
      {cell.extras.length ? (
        <span className="extra-count" data-testid="cell-extras" title={`额外 / 修正任务 ${cell.extras.length} 件`}>
          {cell.extras.length}
        </span>
      ) : null}
    </Link>
  );
}

export function Board({ grid }: { grid: Grid }) {
  return (
    <div className="grid-scroll" data-testid="board">
      <table className="board">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">卡</span>
            </th>
            {grid.columns.map((s) => (
              <th key={s.id} scope="col" title={s.name} data-disabled={s.disabled ? "" : undefined}>
                <span className="board-col">{s.name.replace(/（.*?）/, "")}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.cut.id} data-disabled={row.cut.disabled ? "" : undefined}>
              <th scope="row">
                <Link to={`/cut/${row.cut.id}`}>{row.code}</Link>
                {row.cut.disabled ? <span className="row-off">停用</span> : null}
                {row.openThreads ? <span className="row-flag" title="这一卡有开着的要补或提问">!</span> : null}
              </th>
              {row.cells.map((cell) => (
                <td key={cell.stage.id}>
                  <Cell cell={cell} cutId={row.cut.id} label={`${row.code} ${cell.stage.name}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatusLegend() {
  const items = ["locked", "open", "claimed", "submitted", "returned", "passed"] as const;
  return (
    <div className="legend" aria-label="格子颜色">
      {items.map((s) => (
        <span key={s} className="legend-item">
          <span className="cell-part legend-swatch" data-status={s}>
            {STATUS_CHAR[s]}
          </span>
          {TASK_STATUS_LABEL[s]}
        </span>
      ))}
      <span className="legend-item">
        <span className="cell-part legend-swatch" data-status="claimed" data-mine="true">
          接
        </span>
        我的（黑框）
      </span>
    </div>
  );
}
