/** 提示条。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18n";

export type ToastTone = "Neutral" | "Success" | "Error";

export type ToastProps = {
  Message: ReactNode;
  Action?: string;
  "Show action"?: boolean;
  Tone?: ToastTone;
  onAction?: () => void;
  onClose?: () => void;
};

export function Toast({
  Message,
  Action,
  "Show action": showAction = false,
  Tone = "Neutral",
  onAction,
  onClose,
}: ToastProps) {
  const { L } = useI18n();
  const [paused, setPaused] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (paused || !onCloseRef.current) return;
    const timer = window.setTimeout(() => onCloseRef.current?.(), 5000);
    return () => window.clearTimeout(timer);
  }, [paused, Message]);

  return (
    <div
      className="ui-toast"
      data-tone={Tone}
      role={Tone === "Error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      <span>{Message}</span>
      {showAction && Action ? (
        <button type="button" className="ui-toast-action" onClick={onAction}>
          {Action}
        </button>
      ) : null}
      {Tone === "Error" ? (
        <button type="button" className="ui-toast-close" onClick={() => onClose?.()}>
          {L.nav.close}
        </button>
      ) : null}
    </div>
  );
}
