/**
 * 关卡地图：三段（前期 / 中期 / 后期）像三关，每关下面是它的环节节点。
 * 节点形状：过渡 = 圆 · 枢纽 = 菱形 · 审核 = 盾形（审核又是枢纽的，盾里画一个小菱形）。
 * 颜色 = 进度：锁住灰 · 可接天蓝 · 进行中沙色 · 全部通过绿。状态都带字（「8/14」）。
 */
import type { StageKind } from "@/domain/model";
import type { NodeState, Pipeline, StageNode } from "@/domain/queries";
import { useI18n } from "@/i18n/I18n";

export function StageShape({ kind, hub, state, size = 36 }: { kind: StageKind; hub: boolean; state: NodeState; size?: number }) {
  return (
    <svg className="node-shape" data-state={state} width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      {kind === "review" ? (
        <>
          <path className="fill" d="M18 4 30 8.5V17c0 7.4-5.1 12.7-12 15-6.9-2.3-12-7.6-12-15V8.5Z" />
          {hub ? <path className="mark" d="M18 13.5 22 18 18 22.5 14 18Z" /> : <path className="mark" d="M13.5 18 16.5 21 22.5 15" />}
        </>
      ) : kind === "hub" ? (
        <path className="fill" d="M18 3.5 32.5 18 18 32.5 3.5 18Z" />
      ) : (
        <circle className="fill" cx="18" cy="18" r="13" />
      )}
      {state === "done" && kind !== "review" ? <path className="mark" d="M12.5 18 16.5 22 23.5 14.5" /> : null}
    </svg>
  );
}

export function StageMap({ pipeline, onPick }: { pipeline: Pipeline; onPick: (node: StageNode) => void }) {
  const { L, f, lang, stageName, stage: stageEl } = useI18n();
  const group = pipeline.project.group;
  const sep = lang === "en" ? ", " : "，";
  return (
    <div className="map" aria-label={L.board.map}>
      {pipeline.phases.map((phase) => (
        <section key={phase.phase} className="map-level" aria-label={`${L.labels.phaseLevel[phase.phase]} · ${L.labels.phase[phase.phase]}`}>
          <div className="map-level-head">
            <h3 className="t-heading-18">
              {L.labels.phaseLevel[phase.phase]} · {L.labels.phase[phase.phase]}
            </h3>
            <span className="num t-body-14m">{Math.round(phase.progress * 100)}%</span>
          </div>
          <div className="map-level-progress" aria-hidden="true">
            <span style={{ width: `${Math.round(phase.progress * 100)}%` }} />
          </div>
          <div className="map-nodes">
            {phase.stages.map((node) => (
              <button
                key={node.stage.id}
                type="button"
                className="map-node"
                data-state={node.state}
                onClick={() => onPick(node)}
                aria-label={[
                  stageName(group, node.stage),
                  `${node.stage.disabled ? `${L.board.disabled}${sep}` : node.stage.acceptedAt ? `${L.board.accepted}${sep}` : ""}${L.labels.stageKind[node.stage.kind]}${node.stage.hub && node.stage.kind !== "hub" ? L.board.hubSuffix : ""}`,
                  L.board.nodeState[node.state],
                  f(L.board.passedOf, { passed: node.passed, total: node.total }),
                ].join(sep)}
              >
                <StageShape kind={node.stage.kind} hub={node.stage.hub} state={node.state} />
                <span className="map-node-name">{stageEl(group, node.stage)}</span>

                <span className="map-node-count">
                  {node.stage.disabled ? (
                    <span className="map-node-flag" data-flag="disabled">
                      {L.board.disabled} ·{" "}
                    </span>
                  ) : node.stage.acceptedAt ? (
                    <span className="map-node-flag" data-flag="accepted">
                      {L.board.accepted} ·{" "}
                    </span>
                  ) : null}
                  {node.passed}/{node.total}
                  {node.state === "locked" ? L.board.nodeLocked : ""}
                  {node.counts.open ? f(L.board.nodeOpen, { n: node.counts.open }) : ""}
                  {node.counts.claimed + node.counts.returned ? f(L.board.nodeActive, { n: node.counts.claimed + node.counts.returned }) : ""}
                  {node.counts.submitted ? f(L.board.nodeReview, { n: node.counts.submitted }) : ""}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function MapLegend() {
  const { L } = useI18n();
  return (
    <div className="legend" aria-label={L.board.legendMap}>
      <span className="legend-item">
        <StageShape kind="transit" hub={false} state="open" size={20} /> {L.board.kindTransit}
      </span>
      <span className="legend-item">
        <StageShape kind="hub" hub state="open" size={20} /> {L.board.kindHub}
      </span>
      <span className="legend-item">
        <StageShape kind="review" hub={false} state="open" size={20} /> {L.board.kindReview}
      </span>
      <span className="legend-item">
        <StageShape kind="transit" hub={false} state="locked" size={20} /> {L.board.locked}
      </span>
      <span className="legend-item">
        <StageShape kind="transit" hub={false} state="active" size={20} /> {L.board.active}
      </span>
      <span className="legend-item">
        <StageShape kind="transit" hub={false} state="done" size={20} /> {L.board.done}
      </span>
    </div>
  );
}

export function PhaseBars({ pipeline }: { pipeline: Pipeline }) {
  const { L } = useI18n();
  return (
    <div className="phases">
      {pipeline.phases.map((p) => (
        <div key={p.phase} className="phase-bar" data-state={p.state}>
          <div className="row" data-justify="between">
            <span className="label">{L.labels.phase[p.phase]}</span>
            <span className="num label">{Math.round(p.progress * 100)}%</span>
          </div>
          <div className="phase-track" role="img" aria-label={`${L.labels.phase[p.phase]} ${Math.round(p.progress * 100)}%`}>
            <span style={{ width: `${Math.round(p.progress * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
