/** 状态胶囊。颜色不单独表意：总带着字。 */
import { STATUS_PILL_LABEL, type StatusPillStatus } from "./statusPillLabel";

export type StatusPillProps = {
  Status: StatusPillStatus;
  /** 换个字（例如「待审 v03」）。 */
  Label?: string;
};

export function StatusPill({ Status, Label }: StatusPillProps) {
  return (
    <span className="ui-pill" data-status={Status}>
      <span className="ui-pill-dot" aria-hidden="true" />
      {Label ?? STATUS_PILL_LABEL[Status]}
    </span>
  );
}
