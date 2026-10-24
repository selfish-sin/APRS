/** 状态胶囊。颜色不单独表意：总带着字。 */
import { useI18n } from "@/i18n/I18n";
import type { StatusPillStatus } from "./statusPillLabel";

export type StatusPillProps = {
  Status: StatusPillStatus;
  /** 换个字（例如「待审 v03」）。 */
  Label?: string;
};

export function StatusPill({ Status, Label }: StatusPillProps) {
  const { L } = useI18n();
  return (
    <span className="ui-pill" data-status={Status}>
      <span className="ui-pill-dot" aria-hidden="true" />
      {Label ?? L.labels.taskStatus[Status]}
    </span>
  );
}
