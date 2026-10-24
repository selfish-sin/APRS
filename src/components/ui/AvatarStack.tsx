/** 一排头像（多人）。 */
import { Avatar, type AvatarProps } from "./Avatar";

export type AvatarStackPerson = {
  id: string;
  Initials: string;
  Tone: AvatarProps["Tone"];
  title?: string;
};

export type AvatarStackProps = {
  people: AvatarStackPerson[];
  "Show 3rd"?: boolean;
  "Show 4th"?: boolean;
  "Show more"?: boolean;
  More?: string;
};

export function AvatarStack({
  people,
  "Show 3rd": show3rd = true,
  "Show 4th": show4th = false,
  "Show more": showMore = true,
  More = "+2",
}: AvatarStackProps) {
  const visible = people.filter((_, index) => {
    if (index < 2) return true;
    if (index === 2) return show3rd;
    if (index === 3) return show4th;
    return false;
  });
  const hidden = people.length - visible.length;
  return (
    <div className="ui-stack">
      {visible.map((person) => (
        <Avatar key={person.id} Initials={person.Initials} Tone={person.Tone} Size="28" title={person.title} />
      ))}
      {showMore && hidden > 0 ? <span className="ui-avatar-more">{More}</span> : null}
    </div>
  );
}
