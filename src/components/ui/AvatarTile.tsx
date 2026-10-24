/** 头像块。 */
import type { HTMLAttributes } from "react";

export type AvatarTileProps = HTMLAttributes<HTMLSpanElement> & {
  Initials: string;
};

export function AvatarTile({ Initials, title, ...props }: AvatarTileProps) {
  return (
    <span className="ui-avatar-tile" title={title} tabIndex={title ? 0 : undefined} {...props}>
      {Initials.slice(0, 1)}
    </span>
  );
}
