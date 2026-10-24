/**
 * 关卡地图：三段（前期 / 中期 / 后期）像三关，每关下面是它的环节节点。
 * 节点形状：过渡 = 圆 · 枢纽 = 菱形 · 审核 = 盾形（审核又是枢纽的，盾里画一个小菱形）。
 * 颜色 = 进度：锁住灰 · 可接天蓝 · 进行中沙色 · 全部通过绿。状态都带字（「8/14」）。
 */
import { PHASE_LABEL, PHASE_LEVEL, STAGE_KIND_LABEL } from "@/domain/labels";
import type { StageKind } from "@/domain/model";
import type { NodeState, Pipeline, StageNode } from "@/domain/queries";

const STATE_LABEL: Record<NodeState, string> = { locked: "锁住", open: "可接", active: "进行中", done: "全部通过" };

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
  return (
    <div className="map" aria-label="三段进度">
      {pipeline.phases.map((phase) => (
        <section key={phase.phase} className="map-level" aria-label={`${PHASE_LEVEL[phase.phase]} · ${PHASE_LABEL[phase.phase]}`}>
          <div className="map-level-head">
            <h3 className="t-heading-18">
              {PHASE_LEVEL[phase.phase]} · {PHASE_LABEL[phase.phase]}
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
                aria-label={`${node.stage.name}，${STAGE_KIND_LABEL[node.stage.kind]}${node.stage.hub && node.stage.kind !== "hub" ? " · 枢纽" : ""}，${STATE_LABEL[node.state]}，通过 ${node.passed} / ${node.total}`}
              >
                <StageShape kind={node.stage.kind} hub={node.stage.hub} state={node.state} />
                <span className="map-node-name">{node.stage.name}</span>
                <span className="map-node-count">
                  {node.passed}/{node.total}
                  {node.counts.submitted ? ` · 待审 ${node.counts.submitted}` : ""}
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
  return (
    <div className="legend" aria-label="图例">
      <span className="legend-item">
        <StageShape kind="transit" hub={false} state="open" size={20} /> 过渡
      </span>
      <span className="legend-item">
        <StageShape kind="hub" hub state="open" size={20} /> 枢纽
      </span>
      <span className="legend-item">
        <StageShape kind="review" hub={false} state="open" size={20} /> 审核
      </span>
      <span className="legend-item">
        <StageShape kind="transit" hub={false} state="locked" size={20} /> 锁住
      </span>
      <span className="legend-item">
        <StageShape kind="transit" hub={false} state="active" size={20} /> 进行中
      </span>
      <span className="legend-item">
        <StageShape kind="transit" hub={false} state="done" size={20} /> 全部通过
      </span>
    </div>
  );
}

export function PhaseBars({ pipeline }: { pipeline: Pipeline }) {
  return (
    <div className="phases">
      {pipeline.phases.map((p) => (
        <div key={p.phase} className="phase-bar" data-state={p.state}>
          <div className="row" data-justify="between">
            <span className="label">{PHASE_LABEL[p.phase]}</span>
            <span className="num label">{Math.round(p.progress * 100)}%</span>
          </div>
          <div className="phase-track" role="img" aria-label={`${PHASE_LABEL[p.phase]} ${Math.round(p.progress * 100)}%`}>
            <span style={{ width: `${Math.round(p.progress * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
