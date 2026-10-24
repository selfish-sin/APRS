/** 输入框。 */
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

export type InputType = "单行" | "多行" | "数字";
export type InputState = "默认" | "焦点" | "出错" | "禁用" | "只读";

type Common = {
  Label?: string;
  Value?: string;
  Hint?: string;
  "Show label"?: boolean;
  "Show hint"?: boolean;
  Type?: InputType;
  State?: InputState;
  onValue?: (value: string) => void;
};

export type InputProps = Common &
  Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">;

function inches(cm: string) {
  const n = Number(cm);
  if (!Number.isFinite(n)) return "";
  const whole = Math.floor(n / 2.54);
  const frac = n / 2.54 - whole;
  const half = frac >= 0.25 && frac < 0.75 ? "½" : "";
  const rounded = frac >= 0.75 ? whole + 1 : whole;
  return `${rounded}${half} in`;
}

export function Input({
  Label,
  Value = "",
  Hint,
  "Show label": showLabel = true,
  "Show hint": showHint = true,
  Type = "单行",
  State = "默认",
  onValue,
  ...props
}: InputProps) {
  const disabled = State === "禁用";
  const readOnly = State === "只读";
  const hint = Type === "数字" && State !== "出错" && inches(Value) ? `自动换算：${inches(Value)}` : Hint;
  const fieldProps = {
    className: "ui-field",
    value: Value,
    disabled,
    readOnly,
    "aria-invalid": State === "出错" || undefined,
    onChange: (event: { target: { value: string } }) => onValue?.(event.target.value),
  };
  return (
    <label className="ui-input" data-state={State} data-type={Type}>
      {showLabel && Label ? <span className="ui-input-label">{Label}</span> : null}
      {Type === "多行" ? (
        <textarea {...fieldProps} {...props} />
      ) : (
        <span className="ui-field">
          <input
            {...props}
            className=""
            value={Value}
            disabled={disabled}
            readOnly={readOnly}
            inputMode={Type === "数字" ? "decimal" : undefined}
            aria-invalid={State === "出错" || undefined}
            onChange={(event) => onValue?.(event.target.value)}
          />
          {Type === "数字" ? <span className="ui-input-unit">cm</span> : null}
        </span>
      )}
      {showHint && hint ? <p className="ui-input-hint">{hint}</p> : null}
    </label>
  );
}
