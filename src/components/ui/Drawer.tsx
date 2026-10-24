/** 抽屉（浮层）。 */

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

export type DrawerProps = {
  Type?: "Drawer" | "Dialog";
  Title: string;
  Body?: string;
  children?: ReactNode;
  "Show actions"?: boolean;
  actions?: ReactNode;
  open: boolean;
  onClose: () => void;
};

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Drawer({
  Type = "Drawer",
  Title,
  Body,
  children,
  "Show actions": showActions = true,
  actions,
  open,
  onClose,
}: DrawerProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const modal = Type === "Dialog";

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    if (modal) node?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (!modal || event.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && node.contains(active);
      if (event.shiftKey) {
        if (!inside || active === first || active === node) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (modal) previous?.focus();
    };
  }, [open, modal]);

  if (!open) return null;
  const card = (
    <div
      ref={panel}
      className={modal ? "ui-dialog-card" : "ui-drawer"}
      role="dialog"
      aria-modal={modal ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <h2 id={titleId} className="t-heading-18">
        {Title}
      </h2>
      {Body ? <p className="t-body-14">{Body}</p> : null}
      {children}
      {showActions && actions ? <div className="ui-overlay-actions">{actions}</div> : null}
    </div>
  );
  if (modal) {
    return (
      <div className="ui-scrim" onClick={() => onCloseRef.current()}>
        <div onClick={(event) => event.stopPropagation()}>{card}</div>
      </div>
    );
  }
  return card;
}
