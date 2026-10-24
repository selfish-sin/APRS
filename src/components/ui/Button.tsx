/** 按钮。 */
import type { ButtonHTMLAttributes } from "react";

export type ButtonStyle = "Primary" | "Secondary" | "Ghost" | "Accent";
export type ButtonSize = "Medium" | "Small";
export type ButtonState = "Default" | "Hover" | "Disabled";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> & {
  Label: string;
  Style?: ButtonStyle;
  Size?: ButtonSize;
  /** 标本用。Default 时悬停和按下跟指针走。 */
  State?: ButtonState;
};

export function Button({
  Label,
  Style = "Primary",
  Size = "Medium",
  State = "Default",
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  const off = disabled || State === "Disabled";
  return (
    <button
      type={type}
      className="ui-button"
      data-style={Style}
      data-size={Size}
      data-state={State}
      disabled={off}
      {...props}
    >
      {Label}
    </button>
  );
}
