/**
 * 就地小弹层（SPEC §17：改什么就在它所在的那一层就地改）。
 * 挂在触发按钮旁边（父元素要有 `.pop-anchor`）；点外面 / Esc 关；手机上变成就地展开的一块。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18n";

export function Pop({ title, onClose, children, testId, align = "end" }: { title: string; onClose: () => void; children: ReactNode; testId?: string; align?: "start" | "end" }) {
  const { L } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("input:not([type=checkbox]):not([type=radio]), select, textarea, [data-autofocus]");
    first?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
    }
    function onPointer(e: PointerEvent) {
      const anchor = node?.parentElement;
      const target = e.target as Node | null;
      if (!target || !anchor) return;
      if (anchor.contains(target)) return;
      // 从弹层里打开的对话框 / 提示不算点外面。
      if ((target as Element).closest?.(".ui-drawer, .ui-dialog-card, .ui-scrim, .toast-stack")) return;
      close.current();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, []);
  return (
    <div ref={ref} className="pop" role="dialog" aria-label={title} data-align={align} data-testid={testId}>
      <div className="pop-head">
        <span className="t-body-14m">{title}</span>
        <button type="button" className="pop-x" aria-label={L.common.close} onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="pop-body">{children}</div>
    </div>
  );
}
