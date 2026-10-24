/** 头像。 */
import type { HTMLAttributes } from "react";
import type { AvatarTone } from "./avatarTone";

export type AvatarSize = "20" | "28" | "40" | "64";

export type AvatarProps = HTMLAttributes<HTMLSpanElement> & {
  Initials: string;
  Size?: AvatarSize;
  Tone?: AvatarTone;
};

export function Avatar({ Initials, Size = "28", Tone = "Neutral", title, ...props }: AvatarProps) {
  return (
    <span
      className="ui-avatar"
      data-size={Size}
      data-tone={Tone}
      title={title}
      tabIndex={title ? 0 : undefined}
      {...props}
    >
      {Initials.slice(0, 1)}
    </span>
  );
}
