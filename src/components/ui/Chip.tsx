/** 小标签。 */
import type { ButtonHTMLAttributes } from "react";

export type ChipTone = "Neutral" | "Selected" | "Show" | "Install" | "Deinstall" | "Matter" | "Media";

export type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
  Label: string;
  Dot?: boolean;
  Tone?: ChipTone;
};

export function Chip({ Label, Dot = false, Tone = "Neutral", type = "button", ...props }: ChipProps) {
  const pressed = Tone === "Selected" || props["aria-pressed"] === true || props["aria-pressed"] === "true";
  return (
    <button type={type} className="ui-chip" data-tone={Tone} aria-pressed={pressed} {...props}>
      {Dot ? <span className="ui-chip-dot" aria-hidden /> : null}
      {Label}
    </button>
  );
}
