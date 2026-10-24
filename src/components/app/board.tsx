/**
 * 卡 × 环节网格：行 = C001…，列 = 环节；格子 = 状态色 + 头像字 + 版本号；锁住的是灰的。
 * 每卡每层的环节，一格里左右分成 A / B。点格子 → 卡详情。
 */
import type { Grid, GridCell, GridTask } from "@/domain/queries";
import type { StageRow } from "@/domain/model";
import { cutCode } from "@/domain/naming";
import { U, useI18n, type I18n } from "@/i18n/I18n";
import { Link } from "@/lib/router";

function partTitle(i: I18n, t: GridTask, stageName: string): string {
  const who = t.task.outsourced ? i.f(i.L.board.outsourcedWho, { name: t.task.outsourceName ?? "" }) : t.assignee?.nickname ?? "";
  return [stageName, t.task.layer ? i.f(i.L.labels.layer, { layer: t.task.layer }) : null, i.L.labels.taskStatus[t.task.status], who || null, t.versionTag].filter(Boolean).join(" · ");
}

function Part({ t, stageName }: { t: GridTask; stageName: string }) {
  const i = useI18n();
  const outsourced = t.task.outsourced;
  const who = outsourced ? i.L.board.outsourceChar : t.assignee?.nickname.slice(0, 1) ?? "";
  return (
    <span className="cell-part" data-status={t.task.status} data-mine={t.mine ? "true" : undefined} title={partTitle(i, t, stageName)}>
      <span className="ini">
        {i.L.board.statusChar[t.task.status]}
        {who ? (
          <span className="who" data-uc={outsourced ? undefined : ""}>
            {who}
          </span>
        ) : null}
      </span>
      <span>{t.versionTag ?? (t.task.layer ? i.f(i.L.labels.layerShort, { layer: t.task.layer }) : "")}</span>
    </span>
  );
}

function Cell({ cell, cutId, label, group }: { cell: GridCell; cutId: string; label: string; group: Grid["project"]["group"] }) {
  const i = useI18n();
  if (!cell.tasks.length && !cell.extras.length) return <span className="cell-empty" aria-hidden="true" />;
  const name = i.stageName(group, cell.stage);
  const summary = cell.tasks.map((t) => partTitle(i, t, name)).join(i.lang === "en" ? "; " : "；");
  const extras = cell.extras.length ? i.f(i.L.board.extras, { n: cell.extras.length }) : "";
  return (
    <Link to={`/cut/${cutId}`} className="cell" aria-label={`${label} · ${summary}${extras}`} data-extras={cell.extras.length || undefined}>
      {cell.tasks.map((t) => (
        <Part key={t.task.id} t={t} stageName={name} />
      ))}
      {cell.extras.length ? (
        <span className="extra-count" data-testid="cell-extras" title={i.f(i.L.board.extrasTitle, { n: cell.extras.length })}>
          {cell.extras.length}
        </span>
      ) : null}
    </Link>
  );
}

/** 表头里的短名字：去掉括号里的说明（「美术设计（人设 / 美设）」→「美术设计」）。 */
export function shortStageName(name: string): string {
  return name.replace(/（.*?）/, "").replace(/\s*\(.*?\)/, "");
}

function ColumnHead({ stage, group }: { stage: StageRow; group: Grid["project"]["group"] }) {
  const i = useI18n();
  const name = i.stageName(group, stage);
  const custom = i.stage(group, stage) !== name;
  return (
    <th scope="col" title={name} data-disabled={stage.disabled ? "" : undefined}>
      <span className="board-col">{custom ? <U>{shortStageName(name)}</U> : shortStageName(name)}</span>
    </th>
  );
}

export function Board({ grid }: { grid: Grid }) {
  const { L, stageName, lang } = useI18n();
  const group = grid.project.group;
  return (
    <div className="grid-scroll" data-testid="board">
      <table className="board">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">{L.board.cut}</span>
            </th>
            {grid.columns.map((s) => (
              <ColumnHead key={s.id} stage={s} group={group} />
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.cut.id} data-disabled={row.cut.disabled ? "" : undefined}>
              <th scope="row">
                <Link to={`/cut/${row.cut.id}`}>{cutCode(row.cut, group, lang)}</Link>
                {row.cut.disabled ? <span className="row-off">{L.board.disabled}</span> : null}
                {row.openThreads ? (
                  <span className="row-flag" title={L.board.openFlag}>
                    !
                  </span>
                ) : null}
              </th>
              {row.cells.map((cell) => (
                <td key={cell.stage.id}>
                  <Cell cell={cell} cutId={row.cut.id} label={`${cutCode(row.cut, group, lang)} ${stageName(group, cell.stage)}`} group={group} />
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
  const { L } = useI18n();
  const items = ["locked", "open", "claimed", "submitted", "returned", "passed"] as const;
  return (
    <div className="legend" aria-label={L.board.legend}>
      {items.map((s) => (
        <span key={s} className="legend-item">
          <span className="cell-part legend-swatch" data-status={s}>
            {L.board.statusChar[s]}
          </span>
          {L.labels.taskStatus[s]}
        </span>
      ))}
      <span className="legend-item">
        <span className="cell-part legend-swatch" data-status="claimed" data-mine="true">
          {L.board.statusChar.claimed}
        </span>
        {L.board.mine}
      </span>
    </div>
  );
}
