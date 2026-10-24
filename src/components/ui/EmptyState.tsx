/** 空状态。 */
import { Button } from "./Button";

export type EmptyKind = "档期" | "事项" | "作品库";
export type EmptySize = "标准" | "紧凑";

export type EmptyStateProps = {
  Kind?: EmptyKind;
  Size?: EmptySize;
  Message: string;
  Action?: string;
  onAction?: () => void;
};

export function EmptyState({ Kind = "档期", Size = "标准", Message, Action, onAction }: EmptyStateProps) {
  return (
    <div className="ui-empty" data-kind={Kind} data-size={Size}>
      <p>{Message}</p>
      {Action ? <Button Label={Action} Style="Secondary" Size="Small" onClick={onAction} /> : null}
    </div>
  );
}
